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

| Önceki/teknik ad | Yeni kullanıcı adı | Geçiş durumu |
| --- | --- | --- |
| Kayra AI / Kayra | Fulgor AI | Yeni kullanıcıya dönük ana ad |
| Kayra çekirdek altyapısı | Fulgor Core | Kavramsal ad; kod paketi değişmez |
| Kayra v1 modeli | Fulgor Ray 1.0 "Genesis" | Görünen model adı |
| `kayra_ai` | Fulgor Core Python paketi | Legacy/internal; bu aşamada değişmez |
| `kayra-*` CLI komutları | `fulgor-*` | Geriye uyumlu kalır; yeni adlar aynı `main` fonksiyonlarının alias'ıdır |
| `kayra-general-tr` | Fulgor AI asistan tanımı | Config kimliği geriye uyum için değişmez |
| `qwen3.5-9b-kayra-v1` | Fulgor Ray 1.0 "Genesis" | LM Studio kimliği bu aşamada değişmez |
| `KAYRA_*` ortam değişkenleri | `FULGOR_*` | Geriye uyumlu kalır; yeni standart `FULGOR_*` adlarıdır |
| `configs/models/qwen3_5_9b_kayra_v1_q4_k_m.yaml` | `configs/models/fulgor-ray-v1-q4_k_m.yaml` | Legacy profil desteklenir; yeni yol önerilir |
| `configs/runtime.kayra-v1.lm-studio.yaml` | `configs/runtime.fulgor-ray-v1.lm-studio.yaml` | Legacy profil desteklenir; yeni yol önerilir |
| `KayraAI/memory/memory.sqlite3` | Fulgor AI şifreli hafızası | Veritabanı yolu ve biçimi değişmez |
| `kayra-ai` depo/dizin adı | Fulgor AI kaynak deposu | Yerel yol uyumluluğu için değişmez |

`Kayra` bundan sonra yeni marka, model veya özellik adı üretmek için kullanılmaz.
Ad yalnız yukarıdaki mevcut legacy/internal compatibility identifier'ları
açıklarken korunur. Kalan kimliklerin ileride fiziksel olarak değiştirilmesi;
mevcut alias'ları koruyan çift okuma, geri dönüş ve veri göçü planı gerektirir.

## İkinci aşama teknik alias politikası

Önerilen CLI adları `fulgor-*` biçimindedir. Her `kayra-*` komutu korunur ve
karşılık gelen yeni adla aynı Python `main` fonksiyonuna yönelir. Legacy
komutların stdout/stderr sözleşmesini değiştirecek deprecation uyarısı bu
aşamada yoktur.

Yeni ortam değişkeni standardı `FULGOR_*` biçimidir. Desteklenen eşlemeler:

| Legacy ad | Yeni standart |
| --- | --- |
| `KAYRA_MEMORY_DB` | `FULGOR_MEMORY_DB` |
| `KAYRA_LM_STUDIO_BASE_URL` | `FULGOR_LM_STUDIO_BASE_URL` |
| `KAYRA_LM_STUDIO_MODEL` | `FULGOR_LM_STUDIO_MODEL` |
| `KAYRA_LM_STUDIO_MODEL_REVISION` | `FULGOR_LM_STUDIO_MODEL_REVISION` |
| `KAYRA_LM_STUDIO_API_KEY` | `FULGOR_LM_STUDIO_API_KEY` |
| `KAYRA_LLAMA_CPP_BASE_URL` | `FULGOR_LLAMA_CPP_BASE_URL` |
| `KAYRA_LLAMA_CPP_MODEL` | `FULGOR_LLAMA_CPP_MODEL` |
| `KAYRA_LLAMA_CPP_MODEL_REVISION` | `FULGOR_LLAMA_CPP_MODEL_REVISION` |
| `KAYRA_LLAMA_CPP_API_KEY` | `FULGOR_LLAMA_CPP_API_KEY` |

Yalnız yeni ad varsa yeni değer, yalnız legacy ad varsa legacy değer kullanılır.
İki ad aynı değere sahipse kabul edilir. İki ad farklıysa yapılandırma güvenli
biçimde reddedilir; ağ bağlantısı, araç veya hafıza işlemi başlamaz. Hata yalnız
değişken adlarını içerir, ortam değerlerini veya sırları içermez. Varsayılan
şifreli hafıza yolu, veritabanı biçimi, anahtar türetimi, `kayra_ai` paketi ve
`qwen3.5-9b-kayra-v1` LM Studio kimliği değişmez.

## Fulgor Ray 1.0 "Genesis" teknik profilleri

Önerilen model artifact profili
`configs/models/fulgor-ray-v1-q4_k_m.yaml`, önerilen LM Studio runtime profili
ise `configs/runtime.fulgor-ray-v1.lm-studio.yaml` yolundadır. Bunlar yeni bir
GGUF veya farklı inference davranışı üretmez; mevcut Qwen3.5-9B GGUF Q4_K_M
no-MTP artifact'i için geriye uyumlu teknik adlardır.

Yeni model manifestinin profil kimliği `fulgor-ray-v1-genesis` değeridir. Bu
gösterim/manifest kimliği LM Studio'nun gerçek model anahtarı değildir; runtime
preflight hâlâ tam olarak `qwen3.5-9b-kayra-v1` değerini bekler.

Legacy `configs/models/qwen3_5_9b_kayra_v1_q4_k_m.yaml` ve
`configs/runtime.kayra-v1.lm-studio.yaml` yüklenmeye devam eder. Her iki profil
aynı SHA-256, GGUF dosya adı, context 4096, parallel 1, kapalı KV cache GPU
offload, reasoning profilleri ve güvenlik politikasını taşır. LM Studio'nun iç
model kimliği bu aşamada `qwen3.5-9b-kayra-v1` olarak kalır.

Yeni adlarla örnek:

```bash
export FULGOR_LM_STUDIO_BASE_URL=http://127.0.0.1:1234/api/v1
export FULGOR_LM_STUDIO_MODEL=qwen3.5-9b-kayra-v1
fulgor-runtime-preflight --config configs/runtime.fulgor-ray-v1.lm-studio.yaml
```

Legacy kullanımda aynı alanların `KAYRA_LM_STUDIO_*` karşılıkları desteklenir.
Yeni ve legacy adların farklı değerlerle birlikte tanımlanması preflight
öncesinde reddedilir; değerler hata çıktısına alınmaz.
