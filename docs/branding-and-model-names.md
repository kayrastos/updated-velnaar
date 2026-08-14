# Fulgor AI marka ve model adları

Bu belge Fulgor AI ürün markasını, model ailesini ve teknik provenance
kurallarını tanımlar. Marka adı teknik temeli gizlemez ve mevcut legacy
kimlikleri örtük biçimde yeniden adlandırmaz.

## Marka mimarisi

- **Ana marka:** Fulgor AI
- **Çekirdek:** Fulgor Core
- **Etkin model:** Fulgor Ray 1.0 "Genesis"
- **Etkin teknik temel:** Qwen3.5-9B, GGUF Q4_K_M

Fulgor AI kullanıcıya görünen ürün ve asistan adıdır. Fulgor Core; çalışma
zamanı adaptörleri, güvenlik politikaları, şifreli hafıza, araç yönlendirme,
veri sözleşmeleri ve değerlendirme altyapısından oluşan modelden bağımsız
çekirdeğin adıdır. Fulgor Ray 1.0 "Genesis" bu çekirdek üzerinde çalışan mevcut
yerel model sürümüdür.

## Model segmentleri

Segment adı modelin ürün ailesindeki konumunu belirtir; temel model üreticisini,
parametre sayısını veya lisansını tek başına belirtmez.

| Segment | Amaç |
| --- | --- |
| Fulgor Spark | Daha küçük, hızlı ve kaynak verimli yerel modeller |
| Fulgor Ray | Dengeli, genel amaçlı kişisel asistan modelleri |
| Fulgor Nova | Daha yüksek kapasite ve daha geniş görev kapsamı |
| Fulgor Zenith | Ailenin en yüksek yetenek hedefli üst segmenti |

Spark, Nova ve Zenith gelecek segment adlarıdır. Bir artifact, manifest ve kabul
sonucu yayımlanmadan bu adlar belirli bir temel modele veya yetenek iddiasına
bağlanmaz.

## Sürümleme ve kod adları

Kullanıcıya görünen model adı şu biçimdedir:

```text
Fulgor <Segment> <major.minor> "<MajorCodeName>"
```

- `major`, model davranışı veya uyumluluk hedefinde büyük nesil değişimini
  belirtir.
- `minor`, aynı büyük nesilde geriye uyumlu model, veri, adaptör veya çalışma
  profili geliştirmelerini belirtir.
- Artifact düzeltmeleri gerektiğinde teknik manifest/revision alanında izlenir;
  pazarlama adı provenance yerine kullanılmaz.
- Major sürüm kod adları sırasıyla **Genesis**, **Astra**, **Solstice** ve
  **Omnia** olarak ayrılmıştır.

Mevcut sürüm bu kurala göre **Fulgor Ray 1.0 "Genesis"** adını taşır.

## Teknik provenance

Her Fulgor model yayını aşağıdaki bilgileri kullanıcıya görünen marka adından
ayrı ve doğrulanabilir biçimde korur:

- temel model üreticisi, model ailesi ve kesin sürüm/revision;
- parametre ölçeği ve mimari ailesi;
- artifact biçimi ve quantization;
- model manifesti, dosya adı, boyut ve SHA-256 özeti;
- çalışma zamanı, context ve yükleme profili;
- kullanılan adaptör/fine-tune yöntemi ve sürümü;
- eğitim/veri provenance'i, lisanslar ve kullanım koşulları;
- değerlendirme kapsamı, insan incelemesi ve bilinen sınırlamalar.

Fulgor Ray 1.0 "Genesis" sıfırdan eğitilmiş bir temel model olarak sunulmaz.
Teknik temeli **Qwen3.5-9B**, mevcut yerel artifact biçimi **GGUF Q4_K_M** ve
birincil çalışma zamanı Windows üzerindeki LM Studio'dur. Qwen3-14B yalnız
gelecek ölçekleme hedefidir; etkin modelin provenance'i değildir.

## Geriye uyumlu geçiş tablosu

| Önceki/teknik ad | Yeni kullanıcı adı | Birinci aşama durumu |
| --- | --- | --- |
| Kayra AI / Kayra | Fulgor AI | Yeni kullanıcıya dönük ana ad |
| Kayra çekirdek altyapısı | Fulgor Core | Kavramsal ad; kod paketi değişmez |
| Kayra v1 modeli | Fulgor Ray 1.0 "Genesis" | Görünen model adı |
| `kayra_ai` | Fulgor Core Python paketi | Legacy/internal; bu aşamada değişmez |
| `kayra-*` CLI komutları | Fulgor AI CLI yüzeyi | Legacy/internal; bu aşamada değişmez |
| `kayra-general-tr` | Fulgor AI asistan tanımı | Config kimliği geriye uyum için değişmez |
| `qwen3.5-9b-kayra-v1` | Fulgor Ray 1.0 "Genesis" | LM Studio kimliği bu aşamada değişmez |
| `KAYRA_*` ortam değişkenleri | Fulgor AI runtime ayarları | Legacy/internal; bu aşamada değişmez |
| `configs/runtime.kayra-v1.lm-studio.yaml` | Fulgor Ray runtime profili | Dosya yolu bu aşamada değişmez |
| `KayraAI/memory/memory.sqlite3` | Fulgor AI şifreli hafızası | Veritabanı yolu ve biçimi değişmez |
| `kayra-ai` depo/dizin adı | Fulgor AI kaynak deposu | Yerel yol uyumluluğu için değişmez |

`Kayra` bundan sonra yeni marka, model veya özellik adı üretmek için kullanılmaz.
Ad yalnız yukarıdaki mevcut legacy/internal compatibility identifier'ları
açıklarken korunur. Bu kimliklerin ileride değiştirilmesi; alias, çift okuma,
geri dönüş ve veri göçü planı olan ayrı bir teknik rename aşaması gerektirir.
