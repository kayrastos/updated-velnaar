# Kayra AI

Kayra AI, internet bağlantısı olmadan kişisel dizüstü bilgisayarda çalışması hedeflenen Türkçe öncelikli, kişisel ve genel amaçlı bir yapay zekâ asistanı projesidir.

## Hedef mimari

- Temel model: Qwen3-14B
- Nihai yerel artifact: GGUF Q4_K_M
- Nihai çalışma zamanı: Windows üzerinde LM Studio
- Çalışma şekli: CPU/GPU hibrit
- Donanım: Ryzen 5 4600H, fiziksel 16 GB RAM, GTX 1650 Ti 4 GB
- İnce ayar: Bulut GPU üzerinde QLoRA
- Kişisel bağlam: Model ağırlıklarından ayrı, ileride eklenecek yerel RAG
- Veri geliştirme: Yapay zekâ öğretmen/üretici/eleştirmenler ve insan denetimi

WSL'nin yaklaşık 7,5 GiB RAM görmesi varsayılan WSL sınırından kaynaklanır ve nihai modelin RAM sınırı değildir. Model Windows üzerinde çalıştırılırken yüksek RAM kullanan diğer uygulamalar kapatılacaktır. Buna rağmen 16 GB RAM ve 4 GB VRAM Qwen3-14B Q4_K_M için alt sınıra yakın olduğundan başlangıç bağlamı 4K tutulacak ve daha yüksek değerler yalnızca benchmark sonucuyla kabul edilecektir.

## Proje ilkeleri

- Kişisel bilgiler eğitim verisine veya model ağırlıklarına gömülmez.
- Eğitim ve değerlendirme verileri kesin biçimde ayrılır.
- Her sentetik kaydın kaynağı ve üretim zinciri izlenebilir olur.
- Büyük artifact'ler Git dışında, D diskinde tutulur.
- Doğrulama ve veri hazırlama araçları çevrimdışı çalışabilir.
- Model indirme, eğitim ve eğitim paketi kurulumu ayrı onay kapılarıdır.

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

Paket kurmadan mevcut doğrulamaları çalıştırmak için:

```bash
PYTHONPATH=src /home/kayra/.venvs/kayra-ai/bin/python -m kayra_ai.validation.validate_dataset --kind eval data/eval/seed.jsonl
PYTHONPATH=src /home/kayra/.venvs/kayra-ai/bin/python -m kayra_ai.validation.check_pii data/eval/seed.jsonl
/home/kayra/.venvs/kayra-ai/bin/python -m unittest discover -s tests -v
```

## Artifact ve cache yerleşimi

Büyük dosyalar D diskinde kalır. İleriki aşamalarda cache yolları aşağıdaki gibi proje içine yönlendirilecektir:

```text
HF_HOME=/mnt/d/YapayZeka/kayra-ai/.cache/huggingface
TORCH_HOME=/mnt/d/YapayZeka/kayra-ai/.cache/torch
```

Sanal ortam, makineye özel küçük ayarlar ve kimlik bilgileri WSL ana dizininde tutulur. Kimlik bilgileri hiçbir zaman bu depoya yazılmaz.

## Aşamalar

1. Sözleşmeler, şemalar, kapalı eval seti ve çevrimdışı doğrulama.
2. Modelden bağımsız backend arayüzü ve benchmark protokolü.
3. Ayrı onayla resmi GGUF edinimi ve Windows LM Studio baseline'ı.
4. İzlenebilir sentetik veri üretimi ve insan kalite kontrolü.
5. Bulut GPU üzerinde küçük smoke run ve ardından QLoRA deneyleri.
6. Base/adaptör karşılaştırması, GGUF dönüşümü ve yerel kabul testi.
7. Model ağırlıklarından ayrı yerel RAG.

## Mevcut kapsam

Bu sürüm yalnızca Aşama 0 altyapısını içerir. Mevcut 40 eval vakası OpenAI Codex tarafından üretilmiş, kesin üretici model kimliği kaydedilmemiş ve henüz insan incelemesinden geçmemiş sentetik taslaklardır. Model, Torch, eğitim kodu veya eğitim artifact'i içermez.
Model indirme ve eğitim öncesi kalıcı kontrol listesi için `docs/preflight-checklist.md` kullanılır.
