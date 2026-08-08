# Kayra AI çalışma kuralları

Bu depo, çevrimdışı çalışacak kişisel ve genel amaçlı Kayra AI asistanının kaynak, veri sözleşmesi ve değerlendirme altyapısını içerir.

## Değişmez sınırlar

- Yerel temel model hedefi `Qwen3-14B`, nihai biçim `GGUF Q4_K_M` ve birincil çalışma zamanı Windows üzerindeki LM Studio'dur.
- Bilgisayarda fiziksel olarak 16 GB RAM ve GTX 1650 Ti 4 GB VRAM vardır. WSL'nin yaklaşık 7,5 GiB görmesi WSL geliştirme ortamı sınırıdır; nihai Windows çıkarım sınırı değildir.
- Model çalıştırılırken yüksek RAM kullanan diğer Windows uygulamalarının kapalı olduğu varsayılır.
- Python komutları yalnızca `/home/kayra/.venvs/kayra-ai/bin/python` ile çalıştırılır.
- Depodaki `.venv` ve `.venv_broken` güvenilir değildir; kullanılmaz, değiştirilmez ve açık onay olmadan silinmez.
- Model indirmek, eğitim başlatmak, Torch veya eğitim paketleri kurmak için kullanıcıdan ayrı ve açık onay gerekir.
- Kişisel bilgi model ağırlıklarına veya eğitim verisine eklenmez. Kişisel bağlam ileride yerel ve Git dışı bir RAG katmanında tutulur.
- Sırlar, erişim anahtarları, kişisel belgeler, model ağırlıkları, adaptörler ve checkpoint'ler Git'e eklenmez.

## Veri ve değerlendirme kuralları

- `data/raw/` değişmez kaynak alanıdır; ham kayıtların üzerine yazılmaz.
- İşlenmiş kayıtlar şemaya uymalı, benzersiz kimlik taşımalı ve kaynak/provenance bilgisi içermelidir.
- Eval örnekleri eğitim verisine kopyalanmaz veya yeniden ifade edilerek dahil edilmez.
- Sentetik veride üretici ve eleştirmen kimliği, model sürümü, prompt sürümü, lisans/kullanım koşulu ve içerik hash'i kaydedilir.
- Eğitim verisi kabul edilmeden önce şema, PII, tekrar ve train/eval örtüşme kontrollerinden geçer.
- Aynı öğretmen, bir örneğin hem tek üreticisi hem de tek kalite hakemi olamaz.
- Otomatik değerlendirme tek başına kabul ölçütü değildir; kritik örnekler insan tarafından incelenir.

## Kod ve doğrulama kuralları

- Doğrulama araçları model gerektirmeden ve internet olmadan çalışmalıdır.
- Yeni bir veri alanı eklenirse ilgili JSON Schema, Pydantic modeli, fixture ve test birlikte güncellenir.
- Bozuk girdi sessizce atlanmaz; dosya, satır ve anlaşılır hata mesajıyla reddedilir.
- Üretilmiş büyük çıktılar yerine küçük manifestler, konfigürasyonlar ve yeniden üretim talimatları sürümlenir.
- Değişikliklerden sonra en az şu komut çalıştırılır:

  `/home/kayra/.venvs/kayra-ai/bin/python -m unittest discover -s tests -v`

## Dizin sorumlulukları

- `configs/`: sürümlü asistan ve deney ayarları
- `schemas/`: veri sözleşmeleri
- `data/eval/`: küçük, kişisel olmayan ve eğitimden kapalı değerlendirme seti
- `data/raw/`, `data/processed/`: büyük veri; Git dışı
- `models/`, `adapters/`, `checkpoints/`: büyük model artifact'leri; Git dışı
- `src/kayra_ai/validation/`: çevrimdışı doğrulama araçları
- `reports/`: üretilmiş raporlar; gerekli küçük özetler dışında Git dışı

