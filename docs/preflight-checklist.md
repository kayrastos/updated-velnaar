# Çalışma zamanı, model indirme ve eğitim öncesi kontrol listesi

Bu belge bir komut dosyası değildir. İlgili aşama için ayrı kullanıcı onayı alınmadan model indirilmez, eğitim başlatılmaz veya eğitim paketi kurulmaz.

## Sabit yerel hedef

- [ ] Birincil gerçek çalışma zamanının Windows üzerinde LM Studio, ikincil çalışma zamanının llama.cpp server olduğu doğrulandı.
- [ ] İki çalışma zamanının ortak OpenAI uyumlu yerel HTTP arayüzünden kullanılacağı doğrulandı.
- [ ] Fiziksel RAM 16 GB olarak Windows üzerinden doğrulandı.
- [ ] GTX 1650 Ti ve o anda kullanılabilir VRAM Windows `nvidia-smi` ile kaydedildi.
- [ ] Model çalışırken yüksek RAM/VRAM kullanan diğer Windows uygulamalarının kapatılacağı kabul edildi.
- [ ] WSL'nin yaklaşık 7,5 GiB sınırının yalnızca geliştirme ortamıyla ilgili olduğu kayda geçirildi.
- [ ] Başlangıç profili 4096 token, tek kullanıcı ve aynı anda tek istek; daha yüksek değerler yalnızca benchmark sonrasında kullanılacak.

## Aşama 1 çalışma zamanı preflight'ı

- [ ] Model kimliğinin ve OpenAI uyumlu API kök URL'sinin koda veya sürümlü gerçek-backend ayarına sabitlenmediği doğrulandı.
- [ ] Base URL'nin `.../v1` API kökünü gösterdiği; userinfo, query ve fragment içermediği doğrulandı.
- [ ] Sondaki `/` normalizasyonunun endpoint'te `/v1/v1` veya çift eğik çizgi üretmediği test edildi.
- [ ] API anahtarının isteğe bağlı olduğu; yoksa `Authorization` header'ı gönderilmediği doğrulandı.
- [ ] API anahtarı tanımlıysa yalnız Bearer header'ında kullanıldığı ve log/artifact/hata metnine sızmadığı test edildi.
- [ ] Mock backend'in HTTP transport oluşturmadığı ve hiçbir ağ bağlantısı denemediği test edildi.
- [ ] Genel runtime loglarının prompt, yanıt, header, ortam değişkeni değeri, raw response gövdesi ve exception `repr` saklamadığı doğrulandı.
- [ ] Varsayılan ağ politikasının yalnız loopback hedeflerine izin verdiği doğrulandı.
- [ ] Non-loopback kullanımın hem açık izin hem tam host allowlist kaydı gerektirdiği doğrulandı.
- [ ] Araçların sunucuyu LAN'a açmadığı, port taramadığı ve Windows güvenlik duvarı/ağ ayarını değiştirmediği doğrulandı.
- [ ] WSL'den Windows `localhost` erişiminin garanti kabul edilmediği ve erişilemeyen hedefin güvenli bağlantı hatası ürettiği doğrulandı.
- [ ] Qwen chat template'inin uygulamada yeniden oluşturulmadığı; resmî template uygulamasının runtime'a bırakıldığı doğrulandı.
- [ ] Thinking ve non-thinking profillerinin ayrı olduğu; capability `unknown`/`unsupported` iken varsayılanın güvenli hata olduğu doğrulandı.
- [ ] Açık backend-default fallback kullanılırsa istenen ve etkin profil bilgisinin ayrı kaydedildiği doğrulandı.
- [ ] Var olan `reports/runs/<run-id>/` dizininin üzerine yazılmadığı veya içeriğinin silinmediği doğrulandı.
- [ ] 40 benzersiz eval vakasının mock ile 54 yürütmeye açıldığı ve sonuçların yalnız pipeline doğrulaması olarak işaretlendiği doğrulandı.
- [ ] Mock sonuçlarının semantik kalite veya gerçek model benchmark'ı olarak raporlanmadığı doğrulandı.
- [ ] Mevcut eval kayıtlarının `human_reviewed: false`, `draft/unreviewed` durumunun değişmediği doğrulandı.

## Model indirmeden önce

- [ ] Resmi model deposu tam adıyla seçildi.
- [ ] Model revision/commit değeri sabitlendi.
- [ ] Model kartı ve lisans koşulları incelendi.
- [ ] GGUF dosya adı tam olarak Q4_K_M quantization'ını gösteriyor.
- [ ] Beklenen dosya boyutu ve yayıncı checksum bilgisi kaydedildi.
- [ ] İndirme sonrası yerel SHA-256 üretme ve manifest yazma adımı tanımlandı.
- [ ] LM Studio model dizini D diskine ayarlandı.
- [ ] D diskinde model, geçici dosya ve en az bir geri dönüş kopyası için yeterli boş alan var.
- [ ] `models/` içeriğinin Git dışında kaldığı doğrulandı.
- [ ] Runtime'ın resmî chat template uygulaması doğrulandı; uygulama içinde template kopyası oluşturulmadı.
- [ ] Thinking/non-thinking kontrolü ilgili runtime sürümünün resmî capability bilgisiyle doğrulandı; belgelenmemiş parametre kullanılmadı.
- [ ] Model indirme için kullanıcıdan ayrı açık onay alındı.

## Modeli ilk kez yüklemeden önce

- [ ] LM Studio sürümü ve kullandığı llama.cpp motor sürümü kaydedildi.
- [ ] Bellek tahmini 4096 context ile alındı.
- [ ] GPU offload otomatik ayarı ile başlanacak; sonuç kaydedilecek.
- [ ] VRAM taşması durumunda GPU katmanları ve KV-cache konumu ayrı ayrı ayarlanacak.
- [ ] Windows Görev Yöneticisi ve `nvidia-smi` ile RAM/VRAM ölçüm yöntemi hazır.
- [ ] Benchmark metadata'sı hazır: model/artifact hash'i, runtime sürümü, profil ve config hash'i.
- [ ] Ölçüm sırası hazır: profil başına bir dışlanan ısınma ve beş ölçümlü, sıralı istek.
- [ ] Başarı ölçütleri belirlendi: yükleme, ilk token süresi, token/s, toplam süre, tepe RAM/VRAM, hata oranı ve kararlılık.
- [ ] TTFT'nin yalnız streaming'de ilk boş olmayan içerik olayına kadar ölçüleceği; streaming yoksa `null` kalacağı kabul edildi.
- [ ] Token/s hesabının yalnız backend `completion_tokens` değeri ve geçerli generation süresiyle yapılacağı; karakter/token tahmini kullanılmayacağı kabul edildi.
- [ ] Mock ölçümlerinin gerçek performans benchmark'ı olmadığı doğrulandı.
- [ ] Base model eval koşusu, herhangi bir ince ayardan önce kaydedilecek.

## Veri üretmeden önce

- [ ] Asistan tanımı ve prompt sürümü sabitlendi.
- [ ] Eğitim, validation ve kapalı eval sınırları belirlendi.
- [ ] Aşama 1 boyunca değişmeden kalan `synthetic`, `human_reviewed: false`, `draft/unreviewed` kayıtlar gerçek veri üretimi/baseline kapısından önce ayrıca insan tarafından incelendi; yalnız gerçek inceleme sonrasında uygun review/lock durumu verildi.
- [ ] Üretici ve eleştirmen modellerin kimlik/sürüm kayıt biçimi belirlendi.
- [ ] Veri kaynaklarının lisans ve kullanım koşulları kaydedildi.
- [ ] PII, şema, hash, duplicate ve train/eval örtüşme kontrolleri çalışıyor.
- [ ] Kişisel belgeler sentetik üretim ve eğitim hattının dışında.

## Tam QLoRA eğitiminden önce

- [ ] Base model baseline raporu tamamlandı.
- [ ] Eğitim verisinin tamamı doğrulayıcılardan geçti.
- [ ] Token uzunluğu dağılımı ve truncation oranı raporlandı.
- [ ] Bulut ortamı Python, CUDA, PyTorch, Transformers, PEFT ve quantization sürümleriyle sabitlendi.
- [ ] Seçilen GPU'nun BF16/FP16 kabiliyeti ve kullanılabilir VRAM'i doğrulandı.
- [ ] Tahmini eğitim süresi ve harcama üst sınırı onaylandı.
- [ ] Checkpoint sıklığı, resume testi ve buluttan artifact alma yöntemi hazırlandı.
- [ ] 20–100 örneklik smoke run başarıyla tamamlandı.
- [ ] Loss değerlerinin yanında örnek çıktı kalitesi ve regresyonlar incelendi.
- [ ] Tam eğitim için kullanıcıdan ayrı açık onay alındı.

## GGUF dönüşümünden önce

- [ ] LoRA adaptörü base modelden ayrı olarak değerlendirmeyi geçti.
- [ ] Birleştirme Q4 GGUF üzerinde değil, BF16/FP16 temel model üzerinde yapılacak.
- [ ] Dönüşüm ve quantization araçlarının revision değerleri kaydedildi.
- [ ] FP16/BF16 ara artifact, nihai Q4_K_M ve adaptör için checksum planı hazırlandı.
- [ ] Base, adaptörlü ve quantize model aynı kapalı eval setinde karşılaştırılacak.
