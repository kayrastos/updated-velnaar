# Yerel çalışma zamanı benchmark protokolü

Bu belge LM Studio ve llama.cpp server için karşılaştırılabilir yerel ölçüm yöntemini tanımlar. Aşama 2 depo altyapısı yalnız çevrimdışı sözleşme ve doğrulama kodunu hazırlar; model indirmez, yüklemez, sunucu başlatmaz veya gerçek benchmark isteği göndermez. Gerçek ölçüm ayrıca `G-BENCH` gerektirir.

## Amaç ve sınır

Benchmark aşağıdaki işletim ölçülerini toplar:

- Windows Available physical memory;
- GPU VRAM kullanımı;
- ilk token süresi (TTFT);
- üretim hızı (token/s);
- toplam istek süresi;
- hata oranı.

Bu ölçüler semantik kaliteyi göstermez. Kalite değerlendirmesi, insan incelemesi ve rubric sonuçları ayrı raporlanır. Deterministik MockBackend yalnız ölçüm ve raporlama hattını sınamak içindir; mock süreleri, token kullanım değerleri veya başarı oranı gerçek performans benchmark'ı olarak sunulamaz.

## Sabit koşullar

Her karşılaştırmada aşağıdaki koşullar aynı tutulur ve rapora kaydedilir:

- context hedefi: 4096 token;
- kullanıcı: 1;
- `max_in_flight`: 1;
- eşzamanlı istek: yok;
- KV cache GPU offload: kapalı (`offload_kv_cache_to_gpu: false`);
- retry: 0;
- aynı prompt/vaka sırası;
- aynı üretim ayarları;
- thinking ve non-thinking için ayrı seriler;
- model artifact adı, yerel SHA-256 değeri ve model revision'ı;
- runtime adı/sürümü ve varsa motor revision'ı;
- işletim sistemi, GPU sürücüsü ve ölçüm aracı/sürümü;
- runtime ve assistant config hash'leri.

Makine artifact'i GPU sürücüsünü `runtime.gpu_driver_version`, doğrulanan
yapılandırmaları ise `configuration.runtime_config_sha256` ve
`configuration.assistant_config_sha256` alanlarında taşır. Hash'ler dosyaların
koşu öncesinde hesaplanan küçük harfli SHA-256 değerleridir; yapılandırma
içeriği benchmark özetine kopyalanmaz.

Model kimliği veya revision ortam değişkeninden çözülüyorsa makinece okunabilir koşu artifact'inde ham değer yerine tek yönlü `sha256:` tanımlayıcısı tutulur. Gerçek artifact SHA-256 değeri ancak model edinme aşamasında ayrıca doğrulanmışsa kaydedilir.

Model çalışırken yüksek RAM veya VRAM kullanan diğer Windows uygulamaları kapatılır. WSL'nin gördüğü yaklaşık 7,5 GiB bellek Windows üzerindeki fiziksel 16 GB RAM yerine kullanılmaz. Sunucu LAN'a açılmaz ve güvenlik duvarı ayarı değiştirilmez.

Gerçek runtime'ın uyguladığı chat template kullanılır. Uygulama template üretmez. Thinking capability doğrulanamayan bir backend için profil benchmark'ı yapılmaz; açık backend-default fallback sonucu ayrı sınıflandırılır ve thinking/non-thinking karşılaştırmasına katılmaz.

LM Studio Aşama 2 serisinde profil kontrol yöntemi yalnız
`native_api_reasoning_parameter` olabilir. `requested`, API'nin ilan ettiği
`advertised` ve response'ta gözlenen `observed` reasoning kanıtları ayrı
tutulur. Runtime request için çözümlenmiş state'i açıkça echo etmediğinden
`resolved_reasoning_state: unknown` kalır; request değeri `effective_profile`
olarak kopyalanmaz. Benchmark ancak ön profil probu
`profile_verification_status: behaviorally_consistent` ürettiyse başlar.

Her profil bu eşli probun kanıtını `reasoning_evidence` altında ayrı kaydeder:
`requested_reasoning`, `advertised_reasoning_options`, opsiyonel/nullable
`advertised_reasoning_default`, `observed_reasoning_output`,
`profile_verification_status` ve `resolved_reasoning_state`. İstenen değer ilan
edilen seçeneklerin içinde olmalı; eşli prob hem `off` hem `on` seçeneğini
gerektirir. Thinking profili yalnız `on`+`present`, non-thinking profili yalnız
`off`+`absent` kanıtıyla kabul edilir. İlan edilen `default` etkin request state'i
olarak yorumlanmaz.

Native alan yollarının resmî kaynak izi ve 2026-08-08 kontrol tarihi için
`docs/runtime-and-eval.md` içindeki “Resmî native v1 şema izi” bölümü esas
alınır. Benchmark sözleşmesi orada belgelenmeyen bir metrik veya etkin state
üretmez.

## Koşu düzeni

Her runtime/model/profil birleşimi için:

1. Model yüklenir ve yükleme tamamlanana kadar beklenir.
2. Model-yüklü idle RAM ve VRAM değeri kaydedilir.
3. Bir ısınma koşusu yapılır; bu koşu ölçümlü örneklemden ve özet istatistiklerinden çıkarılır.
4. Aynı profil için art arda beş ölçümlü koşu yapılır.
5. Thinking ve non-thinking serileri birbirine karıştırılmadan raporlanır.
6. Başarısız denemeler yeniden denenmez; hata oranına dahil edilir.

Koşular arasında model, runtime ayarı veya donanım koşulu değişirse yeni bir seri ve yeni run kimliği açılır. Isınma dahil bütün prosedürün başlangıç ve bitiş zamanı Europe/Istanbul saat dilimiyle, süre ölçümleri ise monotonic saatle kaydedilir.

## Ölçüm tanımları

### RAM

RAM, Windows `\Memory\Available MBytes` sayacıyla sistem genelindeki
**Available physical memory** olarak MiB cinsinden toplanır. `free` RAM veya
WSL'nin kendi limiti bu metriğin yerine kullanılmaz:

- `baseline_mib`: runtime ve model yüklenmeden hemen önce Available physical MiB;
- `loaded_idle_mib`: model yüklenmiş ve kullanım dengelenmişken Available physical MiB;
- `measured_minimum_mib`: ölçümlü seri boyunca gözlenen en düşük Available physical MiB.

Collector adı `powershell_get_counter_memory_available_mbytes`, kapsam
`windows_system` olarak kaydedilir. Araç/sürüm ve örnekleme aralığı zorunludur.
RAM ve VRAM değerleri toplanarak tek bellek havuzu oluşturulmaz.

### VRAM

VRAM MiB cinsinden, Windows `nvidia-smi` veya açıkça belgelenmiş eşdeğer bir Windows gözlem yöntemiyle toplanır:

- `memory.vram.baseline_mib`: model yüklenmeden önce kullanılan VRAM;
- `memory.vram.loaded_idle_mib`: model yüklü ve idle iken kullanılan VRAM;
- `memory.vram.measured_peak_mib`: ölçümlü seri sırasında gözlenen en yüksek VRAM.

Araç komutu/sürümü, GPU kimliği, örnekleme aralığı ve sistem geneli ya da süreç kapsamı kaydedilir. Bir araç süreç bazında güvenilir değer vermiyorsa sistem geneli değer açıkça etiketlenir; tahmini süreç değeri üretilmez.

### İlk token süresi (TTFT)

LM Studio Aşama 2 benchmark'ında TTFT yalnız native v1 response içindeki
`stats.time_to_first_token_seconds` değeridir ve kaynak
`lm_studio_native_v1` olarak etiketlenir. İstemci bu değeri response süresinden
türetmez. Başarılı örnekte alanın eksik/null olması contract hatasıdır.

### Toplam süre

`total_request_ms`, aynı monotonic istek başlangıcından terminal başarı yanıtı
veya terminal hata alınana kadarki süredir. Bu protokolde `stream: false`
zorunludur. Başarısız koşuda ölçülen toplam süre tutulabilir, ancak yalnız
başarılı measured örneklerden üretilen medyan/p95 hesabına karıştırılmaz.

### Native token ve hız istatistikleri

LM Studio başarılı örneğinde aşağıdaki native v1 alanlarının tamamı zorunludur:

- `stats.input_tokens`;
- `stats.total_output_tokens`;
- `stats.reasoning_output_tokens`;
- `stats.tokens_per_second`;
- `stats.time_to_first_token_seconds`.

`stats.model_load_time_seconds` tek opsiyonel native metriktir; yoksa
`server_field_absent` ile `null` yazılır. Token/s yeniden hesaplanmaz; reasoning
tokenlerinin toplam çıktıyla ilişkisi hakkında belgelenmeyen bir denklem
kurulmaz. Başarılı örnekte diğer zorunlu native metrikler `null` olamaz.
Başarılı thinking örneğinde gözlem `present` ve reasoning token sayısı pozitif;
başarılı non-thinking örneğinde gözlem `absent` ve reasoning token sayısı sıfır
olmalıdır. Başarısız örnek reasoning gözlemi iddia etmez (`unknown`) ve bütün
native stats alanlarını `request_failed` nedeniyle `null` kaydeder. Başarılı
örnekte model yükleme metriği yalnız sayısal değer veya
`server_field_absent` olabilir.

### Hata oranı

Isınma koşusu hata oranına dahil değildir. Ölçümlü seri için:

```text
error_rate = başarısız_ölçümlü_deneme / toplam_ölçümlü_deneme
```

Payda, her profil için başlangıçta planlanan beş ölçümlü denemedir. Hatalar en az yapılandırma, bağlantı, timeout, HTTP durumu, bozuk yanıt, bulunamayan model ve capability sınıflarında ayrıca sayılır. Bir hata sessizce atlanmaz veya başarıya çevrilmez.

## Raporlama

Her serinin makinece okunabilir ve insan tarafından okunabilir özeti şunları içerir:

- run kimliği ve zaman damgaları;
- model/runtime/config kimliği ve hash'leri;
- profil, context ve eşzamanlılık ayarları;
- ısınma koşusunun dışlandığı bilgisi;
- beş ölçümlü denemenin ham süre ve hata durumu;
- yalnız başarılı measured örnekler için TTFT, toplam süre ve token/s
  değerlerinin örnek sayısı, medyanı ve p95'i;
- RAM/VRAM baseline, loaded-idle ve peak değerleri;
- toplam ve hata türüne göre hata oranı (başarısız örnek süreleri percentile'a
  katılmaz);
- başarılı örneklerde `null` kalan opsiyonel ölçülerin nedeni; başarısız örnek
  ve hata sayıları ayrı;
- ölçüm araçları, kapsamı ve örnekleme aralığı.

Makine sözleşmesi `schemas/benchmark-series.schema.json`, çevrimdışı yükleyici
`kayra_ai.evaluation.benchmark` modülüdür. Seride iki profil sırası sabittir:
thinking, ardından non-thinking. Her profil tam bir dışlanmış warm-up ve ordinal
1..5 olan beş measured örnek içerir. `retry_count` daima sıfırdır.

Beş örneklik seride p95 hesap yöntemi raporda belirtilir; önerilen yöntem sıralı örnekler üzerinde en yakın-sıra (`ceil(0.95 * n)`) değeridir. Az örnek sayısı nedeniyle sonuçlar kararlılık sinyali olarak yorumlanır, kesin kapasite sınırı olarak değil.

Prompt, yanıt, API anahtarı, `Authorization` header'ı, çözümlenmiş ortam değişkeni, raw response gövdesi ve exception `repr` benchmark özetine veya genel runtime loguna yazılmaz. İçerik incelemesi gerekiyorsa yalnız Git dışı, kasıtlı eval artifact'i olan `results.jsonl` ayrı güvenlik sınırı içinde kullanılır.

**Yer — WSL/Ubuntu terminali; yalnız mevcut bir seriyi çevrimdışı doğrular**

```bash
PYTHONPATH=src /home/kayra/.venvs/kayra-ai/bin/python \
  -m kayra_ai.evaluation.benchmark_cli \
  reports/benchmarks/<series-id>.json
```

Bu CLI transport oluşturmaz, socket açmaz ve API isteği göndermez; yalnız yerel
JSON artifact'ini doğrulayıp içeriksiz özetini stdout'a yazar.

## Kabul yorumu

Bir profilin benchmark hattını geçmiş sayılması için ön profil probu davranışsal
olarak tutarlı olmalı, beş ölçümlü deneme tamamlanmalı, zorunlu native metrikler
raporlanmalı ve hatalar tipli olmalıdır. Donanıma uygun performans eşiği gerçek
baseline alınmadan uydurulmaz. MockBackend çıktısından RAM, VRAM, TTFT, token/s
veya kalite kabul kararı çıkarılmaz.
