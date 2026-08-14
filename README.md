# Fulgor AI

Fulgor AI, internet bağlantısı olmadan kişisel dizüstü bilgisayarda çalışan
Türkçe öncelikli, kişisel ve genel amaçlı bir yapay zekâ asistanı projesidir.
Asistanın çekirdeği **Fulgor Core**, etkin model sürümü ise
**Fulgor Ray 1.0 "Genesis"** adını taşır.

## Mevcut sistem

- Ana marka: Fulgor AI
- Çekirdek: Fulgor Core
- Etkin model: Fulgor Ray 1.0 "Genesis"
- Teknik temel model: Qwen3.5-9B
- Yerel artifact: GGUF Q4_K_M
- Birincil çalışma zamanı: Windows üzerinde LM Studio
- İkincil çalışma zamanı: llama.cpp server
- İstemci sınırı: ortak Backend sözleşmesi; LM Studio için native v1, llama.cpp için OpenAI uyumlu HTTP
- Çalışma şekli: CPU/GPU hibrit
- Donanım: Ryzen 5 4600H, fiziksel 16 GB RAM, GTX 1650 Ti 4 GB
- İnce ayar: Bulut GPU üzerinde QLoRA
- Kişisel bağlam: Model ağırlıklarından ayrı, ileride eklenecek yerel RAG
- Veri geliştirme: Yapay zekâ öğretmen/üretici/eleştirmenler ve insan denetimi

WSL'nin yaklaşık 7,5 GiB RAM görmesi varsayılan WSL sınırından kaynaklanır ve
nihai modelin RAM sınırı değildir. Model Windows üzerinde çalıştırılırken yüksek
RAM kullanan diğer uygulamalar kapatılacaktır. Mevcut Fulgor Ray 1.0 "Genesis"
Qwen3.5-9B tabanını kullanır. Qwen3-14B Q4_K_M bu donanımda alt sınıra yakın
bir **gelecek ölçekleme hedefidir**; etkin model veya mevcut artifact değildir.
Başlangıç profili 4096 token, tek kullanıcı ve aynı anda tek istek olarak
tutulur; daha yüksek değerler yalnızca benchmark sonucuyla kabul edilir.

Marka, model ailesi, sürümleme, teknik provenance ve geriye uyumlu adlar için
[marka ve model adları](docs/branding-and-model-names.md) belgesine bakın.
`Kayra` adı yeni kullanıcıya dönük adlandırmada kullanılmaz; geriye uyumluluk
amacıyla yalnız mevcut paket, CLI, ortam değişkeni, model/runtime kimliği ve
şifreli hafıza yolu gibi legacy/internal compatibility identifier'larda korunur.

Yeni komut standardı `fulgor-*` adlarıdır; her mevcut `kayra-*` komutu aynı
Python `main` fonksiyonuna yönelen bir `fulgor-*` alias'ına sahiptir. Eski
`kayra-*` girişleri kaldırılmamış ve çıktılarına deprecation uyarısı
eklenmemiştir. Yeni ortam değişkeni standardı `FULGOR_*` biçimidir. Karşılık
gelen `KAYRA_*` adları geriye uyumlu çalışır; iki ad birlikte tanımlıysa yalnız
aynı değeri taşıdıklarında kabul edilir. Farklı değerler güvenlik amacıyla
backend preflight, araç veya hafıza işlemi başlamadan reddedilir ve değerler
hata çıktısına yazılmaz.

LM Studio ve llama.cpp farklılıkları küçük adaptörlerde kalır. LM Studio adaptörü
reasoning capability'sini ve native istatistikleri belgelenmiş `/api/v1/models`
ve `/api/v1/chat` yüzeyinden ele alır; llama.cpp adaptörü OpenAI uyumlu sınırda
kalır. Model kimliği ile API kök URL'si koda sabitlenmez. WSL içinden Windows
`localhost` adresine her ağ yapılandırmasında erişilebildiği varsayılmaz; istemci
yalnız açıkça yapılandırılmış ve güvenli preflight kontrolünden geçmiş hedefi
kullanır. Proje sunucuyu yerel ağa açmaz, Windows güvenlik duvarını değiştirmez
ve Qwen chat template'ini yeniden üretmez; resmî template uygulaması çalışma
zamanına aittir.

## Proje ilkeleri

- Kişisel bilgiler eğitim verisine veya model ağırlıklarına gömülmez.
- Eğitim ve değerlendirme verileri kesin biçimde ayrılır.
- Her sentetik kaydın kaynağı ve üretim zinciri izlenebilir olur.
- Büyük artifact'ler Git dışında, D diskinde tutulur.
- Doğrulama ve veri hazırlama araçları çevrimdışı çalışabilir.
- Model indirme, eğitim ve eğitim paketi kurulumu ayrı onay kapılarıdır.
- Plan onayı depo değişikliği değildir; G-CODE ile dosya/test, G-GIT ile
  stage/commit/bundle ayrı yetkilendirilir.
- Genel çalışma zamanı logları prompt, yanıt, HTTP header'ı veya kimlik bilgisi saklamaz.

## Depo düzeni

```text
configs/             Asistan ve deney konfigürasyonları
schemas/             JSON Schema veri sözleşmeleri
data/raw/            Değişmez ham veri (Git dışı)
data/processed/      Üretilmiş/temizlenmiş veri (Git dışı)
data/eval/           Kapalı değerlendirme verisi
models/              GGUF ve temel model artifact'leri (Git dışı)
adapters/            LoRA/QLoRA adaptörleri (Git dışı)
checkpoints/         Eğitim checkpoint'leri (Git dışı)
reports/             Üretilmiş değerlendirme raporları
src/kayra_ai/        Proje kodu
tests/               Çevrimdışı testler ve küçük fixture'lar
```

## Python ortamı

Tek desteklenen yerel Python yorumlayıcısı:

```text
/home/kayra/.venvs/kayra-ai/bin/python
```

Depo kökündeki `.venv` ve `.venv_broken` kullanılmaz, değiştirilmez veya otomatik olarak silinmez.

**Yer — WSL/Ubuntu terminali.** Paket kurmadan mevcut doğrulamaları çalıştırmak için:

```bash
PYTHONPATH=src /home/kayra/.venvs/kayra-ai/bin/python -m kayra_ai.validation.validate_dataset --kind eval data/eval/seed.jsonl
PYTHONPATH=src /home/kayra/.venvs/kayra-ai/bin/python -m kayra_ai.validation.check_pii data/eval/seed.jsonl
/home/kayra/.venvs/kayra-ai/bin/python -m unittest discover -s tests -v
```

## Çalışma zamanı ve Aşama 2 çevrimdışı altyapısı

Aşama 1, model indirmeden veya yerel sunucu başlatmadan ortak çalışma zamanı ve
değerlendirme hattını sağlar. Aşama 2 G-CODE altyapısı buna sabit model artifact
manifestini, LM Studio native v1 adapter sözleşmesini, üç vakalık smoke setini ve
içeriksiz benchmark-series doğrulamasını ekler. Bu depo değişiklikleri LM Studio
kurmaz, model indirmez/yüklemez ve gerçek API isteği göndermez.

Varsayılan `mock` backend deterministiktir ve HTTP taşıması oluşturmaz. Gerçek
backend etkinleştirilmeden önce model kimliği ile API kök URL'si ortam
değişkenlerinden çözülmelidir. LM Studio base URL'si tam
`http://127.0.0.1:<port>/api/v1` köküdür. API anahtarı isteğe bağlıdır; tanımlı
değilse `Authorization` header'ı gönderilmez.

Çözümlenmiş gerçek-backend ortam değerleri log veya artifact'lere ham yazılmaz; model ve revision kimlikleri sonuçlarda tek yönlü `sha256:` tanımlayıcılarıyla temsil edilir.

**Yer — WSL/Ubuntu terminali.** Mock preflight:

```bash
PYTHONPATH=src /home/kayra/.venvs/kayra-ai/bin/python -m kayra_ai.runtime.preflight --config configs/runtime.yaml --backend mock
```

**Yer — WSL/Ubuntu terminali.** Kapalı eval setini iki açık profil üzerinden çalıştırma:

```bash
PYTHONPATH=src /home/kayra/.venvs/kayra-ai/bin/python -m kayra_ai.evaluation.cli \
  --config configs/runtime.yaml \
  --backend mock \
  --eval data/eval/seed.jsonl \
  --profiles all \
  --run-id stage1-mock
```

40 benzersiz vaka, `both` vakaları iki profile açıldığında 54 yürütme üretir. Mock sonucu yalnız yapılandırma, yönlendirme, sözleşme ve raporlama hattının çalıştığını gösterir; semantik kalite puanı veya gerçek model benchmark'ı değildir. Var olan bir `reports/runs/<run-id>/` dizininin üzerine yazılmaz; başka bir run kimliği seçilmelidir.

Thinking ve non-thinking ayrı profillerdir. LM Studio native request'teki
`reasoning` değeri yalnız istenen profildir; request'ten `effective_profile`
uydurulmaz. İlan edilen seçenekler, istenen değer ve gözlenen reasoning kanıtı
ayrı tutulur; runtime etkin state'i echo etmediği için
`resolved_reasoning_state: unknown` kalır. Capability ya da davranış kanıtı
eksikse güvenli biçimde durulur.

Ayrıntılı kullanım, bağlantı ve gizlilik davranışı için [çalışma zamanı ve eval
kılavuzuna](docs/runtime-and-eval.md), manuel Windows kapıları için [Aşama 2 LM
Studio baseline runbook'una](docs/stage2-lm-studio-baseline.md), ölçüm tanımları
için [benchmark protokolüne](docs/benchmark-protocol.md) bakın.

**Yer — WSL/Ubuntu terminali; yalnız yerel dosyaları doğrular.**

```bash
PYTHONPATH=src /home/kayra/.venvs/kayra-ai/bin/python \
  -m kayra_ai.validation.model_artifact configs/models/qwen3-14b-q4_k_m.yaml

PYTHONPATH=src /home/kayra/.venvs/kayra-ai/bin/python \
  -m kayra_ai.evaluation.benchmark_cli tests/fixtures/benchmark-series-valid.json
```

## Artifact ve cache yerleşimi

Büyük dosyalar D diskinde kalır. İleriki aşamalarda cache yolları aşağıdaki gibi proje içine yönlendirilecektir:

```text
HF_HOME=/mnt/d/YapayZeka/kayra-ai/.cache/huggingface
TORCH_HOME=/mnt/d/YapayZeka/kayra-ai/.cache/torch
```

Sanal ortam, makineye özel küçük ayarlar ve kimlik bilgileri WSL ana dizininde tutulur. Kimlik bilgileri hiçbir zaman bu depoya yazılmaz.

## Aşamalar

0. Sözleşmeler, şemalar, kapalı eval seti ve çevrimdışı doğrulama.
1. Modelden bağımsız çalışma zamanı, mock eval hattı ve benchmark protokolü.
2. Ayrı onayla resmî GGUF edinimi ve Windows LM Studio baseline'ı.
3. İzlenebilir sentetik veri üretimi ve insan kalite kontrolü.
4. Bulut GPU üzerinde küçük smoke run ve ardından QLoRA deneyleri.
5. Base/adaptör karşılaştırması, GGUF dönüşümü ve yerel kabul testi.
6. Model ağırlıklarından ayrı yerel RAG.

## Mevcut kapsam

Bu sürüm Aşama 0/1 altyapısı ile Aşama 2'nin çevrimdışı G-CODE sözleşmelerini
içerir. Gerçek LM Studio/model çalıştırması ayrı kapılara bağlıdır. Mevcut 40
eval vakası OpenAI Codex tarafından üretilmiş, kesin üretici model kimliği
kaydedilmemiş ve henüz insan incelemesinden geçmemiş sentetik taslaklardır.
Smoke dosyası seed'in yalnız üç byte-for-byte kopyasını taşır; seed değişmez.
Model, Torch, eğitim kodu veya eğitim artifact'i içermez.
Model indirme ve eğitim öncesi kalıcı kontrol listesi için `docs/preflight-checklist.md` kullanılır.
