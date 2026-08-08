# Yerel çalışma zamanı benchmark protokolü

Bu belge LM Studio ve llama.cpp server için karşılaştırılabilir yerel ölçüm yöntemini tanımlar. Aşama 1 yalnız protokolü ve veri sözleşmesini hazırlar; model indirmez, gerçek model benchmark'ı başlatmaz ve Aşama 2'ye geçmez.

## Amaç ve sınır

Benchmark aşağıdaki işletim ölçülerini toplar:

- Windows RAM kullanımı;
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
- retry: 0;
- aynı prompt/vaka sırası;
- aynı üretim ayarları;
- thinking ve non-thinking için ayrı seriler;
- model artifact adı, yerel SHA-256 değeri ve model revision'ı;
- runtime adı/sürümü ve varsa motor revision'ı;
- işletim sistemi, GPU sürücüsü ve ölçüm aracı/sürümü;
- runtime ve assistant config hash'leri.

Model kimliği veya revision ortam değişkeninden çözülüyorsa makinece okunabilir koşu artifact'inde ham değer yerine tek yönlü `sha256:` tanımlayıcısı tutulur. Gerçek artifact SHA-256 değeri ancak model edinme aşamasında ayrıca doğrulanmışsa kaydedilir.

Model çalışırken yüksek RAM veya VRAM kullanan diğer Windows uygulamaları kapatılır. WSL'nin gördüğü yaklaşık 7,5 GiB bellek Windows üzerindeki fiziksel 16 GB RAM yerine kullanılmaz. Sunucu LAN'a açılmaz ve güvenlik duvarı ayarı değiştirilmez.

Gerçek runtime'ın uyguladığı chat template kullanılır. Uygulama template üretmez. Thinking capability doğrulanamayan bir backend için profil benchmark'ı yapılmaz; açık backend-default fallback sonucu ayrı sınıflandırılır ve thinking/non-thinking karşılaştırmasına katılmaz.

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

RAM değerleri Windows tarafından görünür fiziksel bellek üzerinden MiB cinsinden toplanır:

- `ram_baseline_mib`: runtime ve model yüklenmeden hemen önce sistemde kullanılan RAM;
- `ram_idle_mib`: model yüklenmiş, istek yok ve kullanım dengelenmişken sistemde kullanılan RAM;
- `ram_peak_mib`: ölçümlü istek serisi sırasında gözlenen en yüksek kullanılan RAM.

Rapor hem mutlak değerleri hem de `loaded_idle - baseline` ile `peak - baseline` farklarını gösterebilir. Kullanılan Windows aracı, örnekleme aralığı ve değerin sistem geneli mi yoksa runtime süreci mi olduğu zorunlu metadata'dır. Farklı kapsamlar aynı tabloda karşılaştırılmaz.

### VRAM

VRAM MiB cinsinden, Windows `nvidia-smi` veya açıkça belgelenmiş eşdeğer bir Windows gözlem yöntemiyle toplanır:

- `vram_baseline_mib`: model yüklenmeden önce kullanılan VRAM;
- `vram_idle_mib`: model yüklü ve idle iken kullanılan VRAM;
- `vram_peak_mib`: ölçümlü seri sırasında gözlenen en yüksek VRAM.

Araç komutu/sürümü, GPU kimliği, örnekleme aralığı ve sistem geneli ya da süreç kapsamı kaydedilir. Bir araç süreç bazında güvenilir değer vermiyorsa sistem geneli değer açıkça etiketlenir; tahmini süreç değeri üretilmez.

### İlk token süresi (TTFT)

`first_token_ms`, istemci monotonic saatte isteği göndermeye başlamadan hemen önce alınan zaman ile streaming yanıtta ilk boş olmayan assistant içerik olayının alındığı zaman arasındaki süredir.

- Bağlantı kurulması ve sunucu kuyruğu bu süreye dahildir.
- Yalnız rol, keep-alive veya boş içerik olayı ilk token sayılmaz.
- Streaming kullanılmıyorsa TTFT çıkarılamaz ve `null` yazılır.
- Timeout veya ilk içerikten önce hata oluşursa TTFT `null` kalır; hata ayrıca sınıflandırılır.

### Toplam süre

`total_ms`, aynı monotonic istek başlangıcından terminal başarı yanıtı, streaming bitiş olayı veya terminal hata alınana kadarki süredir. Başarısız koşuda ölçülen toplam süre tutulabilir, ancak başarı sürelerinin percentile/ortalama hesabına karıştırılmaz.

### Token/s

`tokens_per_second` yalnız şu iki değer güvenilir biçimde mevcutsa hesaplanır:

1. backend'in verdiği `completion_tokens`;
2. geçerli bir üretim süresi (`generation_duration_seconds`).

Formül:

```text
tokens_per_second = completion_tokens / generation_duration_seconds
```

Üretim süresinin kaynağı rapora yazılır. Tercih sırası, runtime'ın resmî olarak raporladığı generation süresi; bu yoksa streaming'de ilk boş olmayan içerikten terminal bitişe kadar ölçülen aralıktır. Süre sıfır/geçersizse ya da non-streaming yanıtta ayrı generation süresi yoksa değer `null` kalır. Karakter, kelime, boşluk veya yerel tokenizer tahmini token sayısı yerine kullanılmaz.

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
- başarılar için TTFT, toplam süre ve token/s değerlerinin örnek sayısı, medyanı ve p95'i;
- RAM/VRAM baseline, loaded-idle ve peak değerleri;
- toplam ve hata türüne göre hata oranı;
- `null` kalan ölçülerin nedeni;
- ölçüm araçları, kapsamı ve örnekleme aralığı.

Beş örneklik seride p95 hesap yöntemi raporda belirtilir; önerilen yöntem sıralı örnekler üzerinde en yakın-sıra (`ceil(0.95 * n)`) değeridir. Az örnek sayısı nedeniyle sonuçlar kararlılık sinyali olarak yorumlanır, kesin kapasite sınırı olarak değil.

Prompt, yanıt, API anahtarı, `Authorization` header'ı, çözümlenmiş ortam değişkeni, raw response gövdesi ve exception `repr` benchmark özetine veya genel runtime loguna yazılmaz. İçerik incelemesi gerekiyorsa yalnız Git dışı, kasıtlı eval artifact'i olan `results.jsonl` ayrı güvenlik sınırı içinde kullanılır.

## Kabul yorumu

Bir profilin benchmark hattını geçmiş sayılması için beş ölçümlü denemenin tamamlanması, bütün metriklerin tanımlı kurallara göre raporlanması ve hataların tipli olması gerekir. Donanıma uygun kabul eşikleri Aşama 2'de gerçek model baseline'ı alınmadan belirlenmez. MockBackend çıktısından RAM, VRAM, TTFT, token/s veya kalite kabul kararı çıkarılmaz.
