# Model indirme ve eğitim öncesi kontrol listesi

Bu belge bir komut dosyası değildir. İlgili aşama için ayrı kullanıcı onayı alınmadan model indirilmez, eğitim başlatılmaz veya eğitim paketi kurulmaz.

## Sabit yerel hedef

- [ ] Nihai çalışma zamanının Windows üzerinde LM Studio olduğu doğrulandı.
- [ ] Fiziksel RAM 16 GB olarak Windows üzerinden doğrulandı.
- [ ] GTX 1650 Ti ve o anda kullanılabilir VRAM Windows `nvidia-smi` ile kaydedildi.
- [ ] Model çalışırken yüksek RAM/VRAM kullanan diğer Windows uygulamalarının kapatılacağı kabul edildi.
- [ ] WSL'nin yaklaşık 7,5 GiB sınırının yalnızca geliştirme ortamıyla ilgili olduğu kayda geçirildi.
- [ ] Başlangıç bağlamı 4096 token; daha yüksek değerler yalnızca benchmark sonrasında kullanılacak.

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
- [ ] Chat template ile thinking/non-thinking kullanım biçimi belirlendi.
- [ ] Model indirme için kullanıcıdan ayrı açık onay alındı.

## Modeli ilk kez yüklemeden önce

- [ ] LM Studio sürümü ve kullandığı llama.cpp motor sürümü kaydedildi.
- [ ] Bellek tahmini 4096 context ile alındı.
- [ ] GPU offload otomatik ayarı ile başlanacak; sonuç kaydedilecek.
- [ ] VRAM taşması durumunda GPU katmanları ve KV-cache konumu ayrı ayrı ayarlanacak.
- [ ] Windows Görev Yöneticisi ve `nvidia-smi` ile RAM/VRAM ölçüm yöntemi hazır.
- [ ] Başarı ölçütleri belirlendi: yükleme, ilk token süresi, token/s, tepe RAM/VRAM ve kararlılık.
- [ ] Base model eval koşusu, herhangi bir ince ayardan önce kaydedilecek.

## Veri üretmeden önce

- [ ] Asistan tanımı ve prompt sürümü sabitlendi.
- [ ] Eğitim, validation ve kapalı eval sınırları belirlendi.
- [ ] Başlangıçta `synthetic`, `human_reviewed: false`, `draft/unreviewed` olan `data/eval/seed.jsonl` gerçek bir insan tarafından gözden geçirilip `human_reviewed: true` ve `locked` yapıldı.
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
