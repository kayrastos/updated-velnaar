# Çalışma zamanı, LM Studio native v1 ve eval

Bu belge Aşama 1 ortak çalışma zamanı ile Aşama 2'nin çevrimdışı LM Studio
native v1 sözleşmesini, güvenli preflight'ı ve eval hattını açıklar. G-CODE
uygulaması model/uygulama/runtime indirmez, yüklemez, sunucu başlatmaz, gerçek
HTTP/socket bağlantısı kurmaz ve Windows ağ/güvenlik duvarı ayarını değiştirmez.

## Mimari sınır

Birincil gerçek çalışma zamanı Windows üzerinde LM Studio, ikinci çalışma zamanı
llama.cpp server'dır. Ortak sınır HTTP biçimi değil, iç Backend sözleşmesidir:

```text
assistant.yaml + runtime.yaml + eval JSONL
                  |
                  v
          sıkı yapılandırma doğrulaması
                  |
                  v
             Backend sözleşmesi
             /                    |                    \
    deterministik mock    LM Studio native v1    OpenAI-compatible
                          /api/v1/models+chat       llama.cpp
                  |
                  v
        run-result JSONL + özet rapor
```

Backend'e özgü farklar küçük adaptörlerde kalır. Ortak katman mesaj, üretim ayarı, yanıt, token kullanımı, süre, capability ve tipli hata sözleşmelerini taşır. Model kimliği ile base URL koda sabitlenmez.

Ortak mesaj sözleşmesi adaptöre verilir. LM Studio native v1 adapter'i Aşama 2
tek turlu smoke girdisini belgelenmiş `input`/`system_prompt` alanlarına eşler;
desteklenmeyen geçmişi sessizce düzleştirmez. Uygulama Qwen chat template'ini
veya profil seçmek için prompt metni oluşturmaz. Resmî template'i uygulamak
runtime'ın sorumluluğudur.

## Başlangıç profili

Aşama 2 başlangıç varsayımları şunlardır:

- context uzunluğu: 4096 token;
- kullanıcı sayısı: 1;
- aynı anda yürüyen istek: 1;
- otomatik retry: 0;
- thinking ve non-thinking: iki ayrı, açık profil.

`context_length` model yükleme ve preflight hedefidir; native chat request'iyle
override edilmez. `parallel: 1` ve CPU KV ayarı `/api/v1/models` içindeki loaded
instance config'inden doğrulanır. Belgelenmemiş alan gönderilmez.

## Runtime yapılandırması

Sürümlenen `configs/runtime.yaml` güvenli varsayılan olarak mock backend'i seçer
ve değişmeden kalır. `configs/runtime.lm-studio.yaml` açıkça seçilmesi gereken
gerçek-backend profilidir. Gerçek backend URL'si, model kimliği/revision'ı ve
varsa API anahtarı ortam değişkenlerinden çözülür.

```yaml
schema_version: "1.0"
assistant_config: configs/assistant.yaml
active_backend: mock

execution:
  context_length: 4096
  max_in_flight: 1
  retries: 0
  connect_timeout_seconds: 3
  request_timeout_seconds: 180

network:
  allow_non_loopback: false
  allowed_hosts:
    - localhost
    - 127.0.0.1
    - "::1"
  disable_environment_proxies: true
  follow_redirects: false

privacy:
  log_prompts: false
  log_responses: false
  log_headers: false

backends:
  mock:
    kind: mock
    model:
      id: kayra-mock
      revision: deterministic-v1

  lm_studio:
    kind: lm_studio
    enabled: false
    base_url_env: KAYRA_LM_STUDIO_BASE_URL
    model_id_env: KAYRA_LM_STUDIO_MODEL
    model_revision_env: KAYRA_LM_STUDIO_MODEL_REVISION
    api_key_env: KAYRA_LM_STUDIO_API_KEY

  llama_cpp:
    kind: llama_cpp
    enabled: false
    base_url_env: KAYRA_LLAMA_CPP_BASE_URL
    model_id_env: KAYRA_LLAMA_CPP_MODEL
    model_revision_env: KAYRA_LLAMA_CPP_MODEL_REVISION
    api_key_env: KAYRA_LLAMA_CPP_API_KEY

profiles:
  thinking:
    requested_mode: thinking
    unsupported_capability: error
    temperature: 0.6
    top_p: 0.95
    max_output_tokens: 512

  non_thinking:
    requested_mode: non_thinking
    unsupported_capability: error
    temperature: 0.6
    top_p: 0.95
    max_output_tokens: 512
```

Bilinmeyen yapılandırma alanları reddedilir. Etkin gerçek backend için base URL
veya model kimliği çözülemezse transport çağrısından önce yapılandırma hatası
oluşur. İlk model otomatik seçilmez; `/api/v1/models` içinde yapılandırılmış exact
`key` tam bir kez bulunmalıdır. Model manifesti dosya adı/boyut/hash kaynağını,
native config ise beklenen GGUF/Q4_K_M/byte/context/parallel/CPU-KV değerlerini
sabitler.

`api_key_env` isteğe bağlıdır. Alan yoksa veya adını verdiği ortam değişkeni tanımlı değilse bu bir yapılandırma hatası değildir ve `Authorization` header'ı gönderilmez. Değer tanımlıysa yalnız `Authorization: Bearer <değer>` olarak bellekte kullanılır; çözümlenmiş değer yapılandırmaya, loga, rapora veya hata mesajına yazılmaz.

Gerçek backend'in çözümlenmiş base URL, model kimliği ve model revision değeri de artifact veya genel loglara ham olarak yazılmaz. Run-result ve summary içindeki gerçek model kimliği alanlarında bu değerlerin yalnız tek yönlü `sha256:` tanımlayıcıları tutulur. Mock kimliği ortam değişkeninden gelmediği için açık biçimde kaydedilebilir.

Artifact'e taşınacak backend metinlerinden herhangi biri (assistant içeriği veya `finish_reason`) çözümlenmiş bu değerlerin ham ya da normalize edilmiş biçimini içerirse yanıt artifact'e alınmaz; yürütme `privacy_policy` hatası ve `not_retained` response durumuyla kaydedilir.

### Base URL sözleşmesi

LM Studio native v1 base URL'si tam `http://127.0.0.1:<port>/api/v1`
köküdür. Adapter yalnız GET `models` ve POST `chat` göreli endpoint'lerini
kullanır. llama.cpp OpenAI uyumlu base URL'si ayrı olarak
`http://127.0.0.1:<port>/v1` köküdür.

- Sondaki tek veya birden çok `/` normalize edilir; kökün anlamı değişmez.
- Endpoint birleştirmesi `/api/v1/api/v1`, `/v1/v1` veya çift eğik çizgi üretmez.
- URL içindeki userinfo (`kullanıcı@host`), query ve fragment reddedilir.
- Yalnız `http` ve `https` şemaları kabul edilir.
- Bağlanılacak adres otomatik keşfedilmez veya başka bir adrese çevrilmez.
- `0.0.0.0` ve `::` dinleme adresleridir, istemci hedefi olarak reddedilir.

**Yer — WSL/Ubuntu terminali; yalnız ilgili API kapısı verildikten sonra.** LM
Studio örnek environment ayarı:

```bash
export KAYRA_LM_STUDIO_BASE_URL=http://127.0.0.1:1234/api/v1
export KAYRA_LM_STUDIO_MODEL='<çalışma-zamanındaki-tam-model-kimliği>'
```

Bu örnek sunucuyu başlatmaz veya dış ağa açmaz. API anahtarı gerekmeyen yerel kurulumlarda anahtar değişkeni tanımlanmamalıdır.

## LM Studio native capability ve profil davranışı

Mock backend iki profili deterministik/statik olarak destekler. LM Studio native
adapter'inde doğrulama üç ayrı katmandır:

1. `advertised`: `/api/v1/models` reasoning `allowed_options` içinde hem `off`
   hem `on` bulunur. `default` yalnız metadata'dır.
2. `requested`: her `/api/v1/chat` request'i açıkça `reasoning: on` veya `off`
   ve `store: false` taşır.
3. `observed`: response'taki reasoning output öğesi ve
   `stats.reasoning_output_tokens` birlikte değerlendirilir.

Models yanıtı request düzeyindeki etkin state'i göstermez ve chat response bunu
echo etmez. Bu nedenle native sonuçta `effective_profile: unknown` ve
`resolved_reasoning_state: unknown` kalır; request değeri bu alanlara
kopyalanmaz. `on` gözleminde reasoning output+pozitif reasoning tokeni, `off`
gözleminde reasoning output yokluğu+sıfır reasoning tokeni birlikte tutarlıysa
`verification_status: behaviorally_consistent` kaydedilir. Models capability
alanı eksikse durum `unknown` kalır ve herhangi bir chat isteğinden önce
durulur. Chat response alanı eksik veya gözlem çelişkiliyse istek hata sayılır;
kalan smoke istekleri gönderilmez ve kısmi artifact yazılmaz. Sessiz fallback
yoktur.

### Resmî native v1 şema izi

Aşağıdaki alan eşlemeleri 2026-08-08 tarihinde LM Studio'nun resmî
[GET `/api/v1/models`](https://lmstudio.ai/docs/developer/rest/endpoints/get-api-v1-models)
ve [POST `/api/v1/chat`](https://lmstudio.ai/docs/developer/rest/endpoints/post-api-v1-chat)
belgelerinden doğrulanmıştır. Kod bu tabloda yer almayan bir alanı etkin profil
veya performans metriği olarak türetmez.

| Amaç | Resmî JSON yolu | Kullanım |
|---|---|---|
| Model anahtarı | `models[].key` | Yapılandırılmış exact key ile eşleşme |
| Model biçimi/boyutu | `models[].format`, `models[].size_bytes` | GGUF ve sabit byte kontrolü |
| Model quantization | `models[].quantization.name` | Exact `Q4_K_M` kontrolü |
| Reasoning capability | `models[].capabilities.reasoning.allowed_options` | İlan edilen `off` ve `on` desteği |
| Reasoning varsayılanı | `models[].capabilities.reasoning.default` | Yalnız metadata; etkin request state'i değildir |
| Yüklü instance | `models[].loaded_instances[].id` | Tek instance kimliği |
| Context/concurrency | `models[].loaded_instances[].config.context_length`, `.parallel` | Exact `4096` ve `1` kontrolü |
| KV GPU offload | `models[].loaded_instances[].config.offload_kv_cache_to_gpu` | Başlangıçta `false` kontrolü |
| Chat girdisi | `model`, `input`, `system_prompt` | Native tek turlu istek |
| Reasoning isteği | `reasoning` | Açık `on`/`off`; resolved state kanıtı değildir |
| Saklama/stream | `store`, `stream` | Her istekte `false` |
| Gözlenen çıktı | `output[].type`, `output[].content` | `reasoning` ve `message` parçalarını ayırma |
| Token sayıları | `stats.input_tokens`, `stats.total_output_tokens`, `stats.reasoning_output_tokens` | Yeniden hesaplanmadan native değer |
| Hız ve TTFT | `stats.tokens_per_second`, `stats.time_to_first_token_seconds` | Kaynak `lm_studio_native_v1` |
| Opsiyonel model-load | `stats.model_load_time_seconds` | Yoksa `unavailable`; türetilmez |

Resmî models yanıtında request düzeyindeki güncel/çözümlenmiş reasoning state'i
bildiren ayrı bir alan belgelenmemiştir. `default`, `allowed_options`, istenen
`reasoning` ve gözlenen output birbirinin yerine kullanılmaz;
`resolved_reasoning_state` bu nedenle `unknown` kalır. `store:true` akışıyla
ilişkilendirilen `response_id`, `store:false` başlangıç sözleşmesinde kabul
edilmez. LM Studio belgeleri yeni alanlar eklerse adapter bunları otomatik anlam
yükleyerek kullanmaz; sözleşme ve testler ayrıca sürümlenir.

## Güvenli bağlantı preflight'ı

**Yer — WSL/Ubuntu terminali.** Mock kontrolü ağ kullanmadan çalışır:

```bash
PYTHONPATH=src /home/kayra/.venvs/kayra-ai/bin/python -m kayra_ai.runtime.preflight \
  --config configs/runtime.yaml \
  --backend mock
```

LM Studio preflight'ı ancak `G-API-READ` verilirse yapılandırılmış base URL
altındaki GET `models` endpoint'ine prompt içermeyen tek istek gönderir. Exact
model key, `gguf`, byte boyutu, `Q4_K_M`, tek loaded instance, context 4096,
parallel 1, CPU KV ve advertised `off`+`on` doğrulanır. Zorunlu alan eksikse
`unknown` kabul edilip chat çağrısından önce durulur. Preflight port taramaz,
gateway keşfetmez, alternatif host denemez, sunucu başlatmaz veya firewall'a
dokunmaz.

Varsayılan politika yalnız loopback hedeflerine izin verir. Non-loopback hedef hem `allow_non_loopback: true` hem de tam bir `allowed_hosts` kaydı olmadan reddedilir. Bu açık izin dahi projeye sunucuyu LAN üzerinde açma yetkisi vermez. Ortam proxy'leri kullanılmaz ve redirect takip edilmez.

WSL içinden Windows `localhost` adresine her ağ yapılandırmasında erişilebildiği varsayılmaz. Bağlantı başarısızsa preflight güvenli bir bağlantı hatasıyla çıkar. Kullanıcı Windows-native istemciyi veya kendi güvenli WSL ağ yapılandırmasını tercih edebilir; araç firewall değişikliği ya da LAN bind otomasyonu yapmaz.

## Eval yürütme

**Yer — WSL/Ubuntu terminali.** Kapalı eval seti şu komutla deterministik mock üzerinden çalıştırılır:

```bash
PYTHONPATH=src /home/kayra/.venvs/kayra-ai/bin/python -m kayra_ai.evaluation.cli \
  --config configs/runtime.yaml \
  --backend mock \
  --eval data/eval/seed.jsonl \
  --profiles all \
  --run-id stage1-mock
```

Runner bütün yapılandırmayı ve eval satırlarını backend çağrısından önce doğrular. Bozuk bir kayıt sessizce atlanmaz; dosya ve satır bilgisiyle reddedilir.

40 benzersiz vaka profil matrisinde şöyle genişler:

| Kaynak modu | Benzersiz vaka | Yürütme |
|---|---:|---:|
| thinking | 15 | 15 |
| non-thinking | 11 | 11 |
| both | 14 | 28 |
| Toplam | 40 | 54 |

Böylece toplam 29 thinking ve 25 non-thinking yürütmesi oluşur. Aşama 1 mevcut kayıtları insan incelemesinden geçmiş saymaz; `human_reviewed: false` ve `draft/unreviewed` provenance durumu değişmeden kalır.

Mock yanıtı promptu cevaplamaya veya semantik kaliteyi taklit etmeye çalışmaz. Aynı mantıksal istek için kararlı bir işaret üretir ve prompt metnini geri yansıtmaz. Mock sonucu yalnız veri akışı, profil genişletme, hata işleme, şema ve raporlama hattının çalıştığını kanıtlar. Rubric, doğruluk veya semantik kalite skoru değildir; `semantic_scoring_performed: false` olarak kaydedilir.

### Aşama 2 smoke

`data/eval/stage2-smoke.jsonl`, seed kayıtlarının 1, 7 ve 10. satırlarının
byte-for-byte kopyasıdır; seed dosyası değiştirilmez. Üç vaka iki profile dört
sıralı yürütme üretir. Smoke ancak manuel UI kapısı, `G-API-READ`, eşleştirilmiş
profil probu, WSL sonrası ayrı bellek kapısı ve `G-API-PROMPT` tamamlanınca
çalıştırılabilir. Başarısı semantik kalite puanı değildir.

Native runner yalnız `--profiles all` kabul eder ve smoke içindeki mevcut
`mode: both` vakayı yeni bir prompt üretmeden önce thinking, sonra non-thinking
olarak aynı girdiyle yürütür. Bu eşleştirilmiş iki request profil kapısıdır.
İkisinden biri çelişkili reasoning gözlemi, eksik zorunlu native alan veya tipli
runtime hatası üretirse hata doğrudan yayılır; kalan promptlar gönderilmez ve
kısmi run artifact'i yazılmaz.

Runner varsayılan native yolda eval dosyasının byte SHA-256 değerini sabit smoke
hash'iyle karşılaştırır; başka bir eval backend oluşturulmadan önce reddedilir.
`--allow-native-non-smoke-eval` interlock'u yalnız ayrı `G-FULL` onayı alındıktan
sonra kullanılabilir; flag kendi başına bu onayı vermez.

Native request yalnız `model`, tek-turlu `input`, gerekirse `system_prompt`,
`reasoning`, temperature/top-p/max-output, `store:false` ve `stream:false`
alanlarını taşır. Context request'te override edilmez. Response'ta
`response_id` görülürse saklama sözleşmesi ihlali sayılır. Başarılı response için
input/output/reasoning token, native token/s ve native TTFT zorunlu; model-load
süresi opsiyoneldir. Belgelenmeyen metrik türetilmez.

## Artifact'ler ve üzerine yazma koruması

Her koşu Git dışındaki benzersiz bir dizine yazılır:

```text
reports/runs/<run-id>/
  results.jsonl
  summary.json
  summary.md
```

Var olan `reports/runs/<run-id>/` dizininin üzerine yazılmaz, içeriği silinmez veya kısmen değiştirilmez. `stage1-mock` zaten varsa komutta yeni bir kimlik seçilmelidir.

`results.jsonl` içindeki yanıt alanı genel runtime logu değildir; değerlendirme için kasıtlı olarak üretilmiş, erişimi sınırlandırılması gereken ve Git dışında tutulan bir artifact'tir. Girdi promptu sonuç dosyasına tekrar kopyalanmaz; `case_id` üzerinden kaynak eval kaydına bağlanır. `summary.json` ve `summary.md` prompt veya yanıt içermez.

**Yer — WSL/Ubuntu terminali.** Sonuç doğrulaması:

```bash
PYTHONPATH=src /home/kayra/.venvs/kayra-ai/bin/python -m kayra_ai.validation.validate_dataset \
  reports/runs/<run-id>/results.jsonl \
  --kind run-result
```

## Hata ve gizlilik davranışı

Yapılandırma, bağlantı, timeout, HTTP durum kodu, bozuk yanıt, bulunamayan model,
capability, gizlilik politikası ve iç hata ayrı tipler olarak raporlanır. Fatal
yapılandırma veya eval hatasında hiçbir backend çağrısı yapılmaz. Non-native
vaka düzeyindeki backend hatası tipli bir run-result satırı üretir ve kalan
vakalar devam eder. LM Studio native v1 yolunda ise ilk runtime/contract hatası
bütün koşuyu kısmi artifact yazmadan keser.

Genel runtime loglarında ve özet raporlarında şunlar saklanmaz:

- prompt veya model yanıtı;
- çözümlenmiş API anahtarı ya da onu taşıyan `Authorization` header'ı;
- başka bir ortam değişkeninin çözümlenmiş değeri;
- istek/yanıt header'ları;
- sunucunun raw response gövdesi;
- exception `repr` çıktısı.

Hata çıktısı yalnız güvenli, sınıflandırılmış bağlamı verir. HTTP durum kodu
tutulabilir fakat gövde tutulmaz. Bu kural `results.jsonl` içindeki kasıtlı eval
yanıtı istisnasını değiştirmez; o dosya log değil, Git dışı değerlendirme
artifact'idir.

Performans ölçümlerinin nasıl toplanacağı [benchmark protokolünde](benchmark-protocol.md), artifact saklama kuralları ise [`reports/README.md`](../reports/README.md) içinde tanımlıdır.
