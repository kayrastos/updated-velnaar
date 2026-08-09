# Çalışma zamanı, model indirme ve eğitim öncesi kontrol listesi

Bu belge bir komut dosyası değildir. G0 yalnız plan onayıdır; G-CODE depo
değişikliği/test, G-GIT stage/commit/bundle için ayrı yetkilerdir. İlgili kapı
ayrıca açılmadan uygulama/runtime/model indirilmez, model yüklenmez, API isteği
gönderilmez, benchmark/eval başlatılmaz veya Git yazma işlemi yapılmaz.

## Sabit yerel hedef

- [ ] Birincil gerçek çalışma zamanının Windows üzerinde LM Studio, ikincil çalışma zamanının llama.cpp server olduğu doğrulandı.
- [ ] Ortak Backend sözleşmesinin LM Studio native v1 ve llama.cpp OpenAI uyumlu adaptörleri ayırdığı doğrulandı.
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

- [ ] `Qwen/Qwen3-14B-GGUF` resmî deposu tam adıyla seçildi.
- [ ] Artifact commit `c75e7b2d0234068f674a1bacf548ea32e27ccd29` olarak sabitlendi.
- [ ] Model kartı ve lisans koşulları incelendi.
- [ ] Dosya adı tam `Qwen3-14B-Q4_K_M.gguf`.
- [ ] Boyut `9001752960` byte ve SHA-256 `500a8806e85ee9c83f3ae08420295592451379b4f8cf2d0f41c15dffeb6b81f0` yeniden doğrulandı.
- [ ] İndirme sonrası byte ve SHA doğrulaması planlandı; eşleşmeden yükleme yapılmayacak.
- [ ] `Get-Volume -DriveLetter D` ve `Get-PSDrive -Name D` sonuçları kaydedildi.
- [ ] D:\ NTFS; sağlıklı; en az 24 GiB, tercihen 32 GiB boş. FAT32 ve belirsiz dosya sistemi reddedildi.
- [ ] Model dizini ACL'sinde Everyone/BUILTIN\Users için yazma/modify/full-control/create/append/delete yetkisi bulunmadığı doğrulandı; ACL otomatik değiştirilmedi.
- [ ] LM Studio model dizini D diskine ayarlandı.
- [ ] Uygulama ve küçük config/cache verilerinin tamamen D:\ üzerinde kalmayabileceği kabul edildi veya kullanıcı "tamamen dur" seçeneğini seçti.
- [ ] `models/` içeriğinin Git dışında kaldığı doğrulandı.
- [ ] Windows GPU denetiminde GTX 1650 Ti, driver sürümü ve `nvidia-smi` görünürlüğü doğrulandı.
- [ ] LM Studio GUI/Windows PowerShell'de gerekli GGUF/NVIDIA runtime adı ve sürümü salt okunur doğrulandı.
- [ ] Sürücü/runtime güncellemesi ya da indirmesi otomatik yapılmadı; gerekiyorsa ayrı kapıda duruldu.
- [ ] Runtime'ın resmî chat template uygulaması doğrulandı; uygulama içinde template kopyası oluşturulmadı.
- [ ] Thinking/non-thinking kontrolü ilgili runtime sürümünün resmî capability bilgisiyle doğrulandı; belgelenmemiş parametre kullanılmadı.
- [ ] Model indirme için kullanıcıdan ayrı açık onay alındı.

## Modeli ilk kez yüklemeden önce

- [ ] VS Code'daki kaydedilmemiş işler kontrol edildi, VS Code ve Ubuntu terminalleri kapatıldı.
- [ ] Kullanıcı Windows PowerShell'de `wsl --shutdown` çalıştırdı ve çalışan dağıtım kalmadığını doğruladı; araç bunu otomatik çalıştırmadı.
- [ ] LM Studio sürümü ve kullandığı llama.cpp motor sürümü kaydedildi.
- [ ] Bellek tahmini 4096 context ile alındı.
- [ ] GPU offload otomatik ayarı ile başlanacak; sonuç kaydedilecek.
- [ ] Başlangıçta context 4096, parallel 1, retry 0, tek instance ve CPU KV kullanılıyor.
- [ ] Windows Available physical memory ve `nvidia-smi` used VRAM ayrı kaydedildi; RAM için `free` kullanılmadı, RAM+VRAM toplanmadı.
- [ ] UI yükleme öncesi Available physical memory en az 9.0 GiB ve used VRAM en çok 0.75 GiB.
- [ ] UI prompt'u öncesi Available en az 2.5 GiB/VRAM en çok 3.4 GiB; prompt sırasında Available en az 2.0 GiB/VRAM en çok 3.5 GiB.
- [ ] **LM Studio UI'da Thinking seçeneği var ve thinking/non-thinking seçimi etkili görünüyor; aksi halde G-API-PROMPT'a geçilmedi.**
- [ ] API denemesinde VS Code kapalı; yalnız hafif Ubuntu terminali açık.
- [ ] WSL açıldıktan sonra prompt öncesi iki ölçümde Available en az 2.5 GiB ve used VRAM en çok 3.4 GiB; eşik aşılırsa model unload edildi.
- [ ] Benchmark metadata'sı hazır: model/artifact hash'i, runtime sürümü, profil ve config hash'i.
- [ ] Ölçüm sırası hazır: profil başına bir dışlanan ısınma ve beş ölçümlü, sıralı istek.
- [ ] Prompt öncesi `GET /api/v1/models` ile exact key/GGUF/boyut/Q4_K_M/instance/context/parallel/KV/advertised off+on alanları doğrulandı; eksik alan `unknown` olarak durdu.
- [ ] `reasoning.default` etkin request state'i sayılmadı; request değeri effective profile olarak kopyalanmadı.
- [ ] Profil probunda request `on/off`, advertised options ve observed reasoning ayrı kaydedildi; `resolved_reasoning_state: unknown` kaldı.
- [ ] Her native request açık `store:false`; response `response_id` içermiyor.
- [ ] Başarılı her benchmark örneğinde input/output/reasoning token, native token/s ve native TTFT mevcut; yalnız model-load süresi opsiyonel.
- [ ] RAM `available_physical_mib` minimumu ve VRAM `used_mib` tepesi ayrı kaydedilecek.
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
