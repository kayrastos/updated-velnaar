# Modelden bağımsız çalışma zamanı ve eval

Bu belge Aşama 1 kapsamındaki ortak çalışma zamanı, güvenli bağlantı preflight'ı ve mock değerlendirme hattını açıklar. Bu aşama model indirmez, LM Studio veya llama.cpp kurmaz ya da başlatmaz, eğitim yapmaz ve Windows ağ veya güvenlik duvarı ayarlarını değiştirmez.

## Mimari sınır

Birincil gerçek çalışma zamanı Windows üzerinde LM Studio, ikinci çalışma zamanı llama.cpp server'dır. İkisi de ortak OpenAI uyumlu yerel HTTP sınırının arkasında kullanılır:

```text
assistant.yaml + runtime.yaml + eval JSONL
                  |
                  v
          sıkı yapılandırma doğrulaması
                  |
                  v
             Backend sözleşmesi
             /               \
    deterministik mock       OpenAI-compatible HTTP
                              /                 \
                     LM Studio adaptörü   llama.cpp adaptörü
                  |
                  v
        run-result JSONL + özet rapor
```

Backend'e özgü farklar küçük adaptörlerde kalır. Ortak katman mesaj, üretim ayarı, yanıt, token kullanımı, süre, capability ve tipli hata sözleşmelerini taşır. Model kimliği ile base URL koda sabitlenmez.

Mesajlar OpenAI `messages` biçiminde çalışma zamanına gönderilir. Uygulama Qwen chat template'ini, özel token'larını veya `/think` ve `/no_think` benzeri template metinlerini elle oluşturmaz. Modelin resmî template'ini uygulamak çalışma zamanının sorumluluğudur.

## Başlangıç profili

Aşama 1 varsayımları şunlardır:

- context uzunluğu: 4096 token;
- kullanıcı sayısı: 1;
- aynı anda yürüyen istek: 1;
- otomatik retry: 0;
- thinking ve non-thinking: iki ayrı, açık profil.

`context_length` model yükleme ve benchmark hedefidir; chat-completions HTTP gövdesine taşınmaz. Benzer biçimde, `top_k` gibi standart OpenAI alanı olmayan seçenekler doğrulanmış backend capability'si olmadan gönderilmez.

## Runtime yapılandırması

Sürümlenen `configs/runtime.yaml` güvenli varsayılan olarak mock backend'i seçer. Gerçek backend URL'si, model kimliği ve varsa API anahtarı ortam değişkenlerinden çözülür. Örnek yapı:

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

Bilinmeyen yapılandırma alanları reddedilir. Etkin gerçek backend için base URL veya model kimliği çözülemezse istek gönderilmeden yapılandırma hatası oluşur. `/v1/models` yanıtındaki ilk model otomatik olarak seçilmez; yapılandırılmış kimliğin listede bulunması gerekir.

`api_key_env` isteğe bağlıdır. Alan yoksa veya adını verdiği ortam değişkeni tanımlı değilse bu bir yapılandırma hatası değildir ve `Authorization` header'ı gönderilmez. Değer tanımlıysa yalnız `Authorization: Bearer <değer>` olarak bellekte kullanılır; çözümlenmiş değer yapılandırmaya, loga, rapora veya hata mesajına yazılmaz.

Gerçek backend'in çözümlenmiş base URL, model kimliği ve model revision değeri de artifact veya genel loglara ham olarak yazılmaz. Run-result ve summary içindeki gerçek model kimliği alanlarında bu değerlerin yalnız tek yönlü `sha256:` tanımlayıcıları tutulur. Mock kimliği ortam değişkeninden gelmediği için açık biçimde kaydedilebilir.

Artifact'e taşınacak backend metinlerinden herhangi biri (assistant içeriği veya `finish_reason`) çözümlenmiş bu değerlerin ham ya da normalize edilmiş biçimini içerirse yanıt artifact'e alınmaz; yürütme `privacy_policy` hatası ve `not_retained` response durumuyla kaydedilir.

### Base URL sözleşmesi

Base URL, sunucunun OpenAI uyumlu API kökünü gösterir; örneğin `http://127.0.0.1:1234/v1` veya `http://127.0.0.1:8080/v1`. İstemci bunun altına göreli `models` ve `chat/completions` endpoint'lerini ekler.

- Sondaki tek veya birden çok `/` normalize edilir; kökün anlamı değişmez.
- Endpoint birleştirmesi `/v1/v1`, `//models` veya `//chat/completions` üretmez.
- URL içindeki userinfo (`kullanıcı@host`), query ve fragment reddedilir.
- Yalnız `http` ve `https` şemaları kabul edilir.
- Bağlanılacak adres otomatik keşfedilmez veya başka bir adrese çevrilmez.
- `0.0.0.0` ve `::` dinleme adresleridir, istemci hedefi olarak reddedilir.

Gerçek backend için örnek ortam ayarı aşağıdaki gibidir; değerler makineye ve çalışma zamanına göre kullanıcı tarafından seçilir:

```bash
export KAYRA_LM_STUDIO_BASE_URL=http://127.0.0.1:1234/v1
export KAYRA_LM_STUDIO_MODEL='<çalışma-zamanındaki-tam-model-kimliği>'
```

Bu örnek sunucuyu başlatmaz veya dış ağa açmaz. API anahtarı gerekmeyen yerel kurulumlarda anahtar değişkeni tanımlanmamalıdır.

## Thinking capability davranışı

OpenAI-compatible API'nin evrensel bir thinking açma/kapama alanı olduğu varsayılmaz. Capability sonucu `supported`, `unsupported` veya `unknown` olarak ele alınır.

- Mock backend her iki profili deterministik olarak destekler.
- Gerçek adaptör yalnız resmî olarak belgelenmiş ve ilgili runtime sürümüyle ilişkilendirilmiş kontrolü uygular.
- Capability `unsupported` veya `unknown` ise varsayılan `unsupported_capability: error` davranışı güvenli biçimde durur; belgelenmemiş parametre tahmin edilmez.
- Yapılandırmada açıkça bir backend-default fallback seçilirse `requested_profile` ile `effective_profile` ayrı kaydedilir. Etkin profil doğrulanamıyorsa `unknown`/`backend_default` olarak görünür ve bu yürütme profil karşılaştırması sayılmaz.

Sessiz fallback yapılmaz.

## Güvenli bağlantı preflight'ı

Mock kontrolü ağ kullanmadan çalışır:

```bash
PYTHONPATH=src /home/kayra/.venvs/kayra-ai/bin/python -m kayra_ai.runtime.preflight \
  --config configs/runtime.yaml \
  --backend mock
```

Gerçek backend preflight'ı yalnız yapılandırılmış base URL altındaki `models` endpoint'ine prompt içermeyen bir istek gönderir. Port taramaz, Windows gateway adresini keşfetmez, alternatif host denemez, sunucu başlatmaz, dinleme adresini değiştirmez ve güvenlik duvarına dokunmaz.

Varsayılan politika yalnız loopback hedeflerine izin verir. Non-loopback hedef hem `allow_non_loopback: true` hem de tam bir `allowed_hosts` kaydı olmadan reddedilir. Bu açık izin dahi projeye sunucuyu LAN üzerinde açma yetkisi vermez. Ortam proxy'leri kullanılmaz ve redirect takip edilmez.

WSL içinden Windows `localhost` adresine her ağ yapılandırmasında erişilebildiği varsayılmaz. Bağlantı başarısızsa preflight güvenli bir bağlantı hatasıyla çıkar. Kullanıcı Windows-native istemciyi veya kendi güvenli WSL ağ yapılandırmasını tercih edebilir; araç firewall değişikliği ya da LAN bind otomasyonu yapmaz.

## Eval yürütme

Kapalı eval seti şu komutla deterministik mock üzerinden çalıştırılır:

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

Sonuç doğrulaması:

```bash
PYTHONPATH=src /home/kayra/.venvs/kayra-ai/bin/python -m kayra_ai.validation.validate_dataset \
  reports/runs/<run-id>/results.jsonl \
  --kind run-result
```

## Hata ve gizlilik davranışı

Yapılandırma, bağlantı, timeout, HTTP durum kodu, bozuk yanıt, bulunamayan model, capability, gizlilik politikası ve iç hata ayrı tipler olarak raporlanır. Fatal yapılandırma veya eval hatasında hiçbir backend çağrısı yapılmaz. Vaka düzeyindeki backend hatası tipli bir run-result satırı üretir; kalan vakalar yürütülmeye devam eder.

Genel runtime loglarında ve özet raporlarında şunlar saklanmaz:

- prompt veya model yanıtı;
- çözümlenmiş API anahtarı ya da onu taşıyan `Authorization` header'ı;
- başka bir ortam değişkeninin çözümlenmiş değeri;
- istek/yanıt header'ları;
- sunucunun raw response gövdesi;
- exception `repr` çıktısı.

Hata çıktısı yalnız güvenli, sınıflandırılmış bağlamı verir. HTTP durum kodu tutulabilir fakat gövde tutulmaz. Bu kural `results.jsonl` içindeki kasıtlı eval yanıtı istisnasını değiştirmez; o dosya log değil, Git dışı değerlendirme artifact'idir.

Performans ölçümlerinin nasıl toplanacağı [benchmark protokolünde](benchmark-protocol.md), artifact saklama kuralları ise [`reports/README.md`](../reports/README.md) içinde tanımlıdır.
