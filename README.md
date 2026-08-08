# Kayra AI

Kayra AI, internet bağlantısı olmadan kişisel dizüstü bilgisayarda çalışması hedeflenen Türkçe öncelikli, kişisel ve genel amaçlı bir yapay zekâ asistanı projesidir.

## Hedef mimari

- Temel model: Qwen3-14B
- Nihai yerel artifact: GGUF Q4_K_M
- Birincil çalışma zamanı: Windows üzerinde LM Studio
- İkincil çalışma zamanı: llama.cpp server
- Ortak istemci sınırı: OpenAI uyumlu yerel HTTP API
- Çalışma şekli: CPU/GPU hibrit
- Donanım: Ryzen 5 4600H, fiziksel 16 GB RAM, GTX 1650 Ti 4 GB
- İnce ayar: Bulut GPU üzerinde QLoRA
- Kişisel bağlam: Model ağırlıklarından ayrı, ileride eklenecek yerel RAG
- Veri geliştirme: Yapay zekâ öğretmen/üretici/eleştirmenler ve insan denetimi

WSL'nin yaklaşık 7,5 GiB RAM görmesi varsayılan WSL sınırından kaynaklanır ve nihai modelin RAM sınırı değildir. Model Windows üzerinde çalıştırılırken yüksek RAM kullanan diğer uygulamalar kapatılacaktır. Buna rağmen 16 GB RAM ve 4 GB VRAM Qwen3-14B Q4_K_M için alt sınıra yakın olduğundan başlangıç profili 4096 token, tek kullanıcı ve aynı anda tek istek olarak tutulacak; daha yüksek değerler yalnızca benchmark sonucuyla kabul edilecektir.

LM Studio ve llama.cpp farklılıkları küçük adaptörlerde kalır. Model kimliği ile API kök URL'si koda sabitlenmez. WSL içinden Windows `localhost` adresine her ağ yapılandırmasında erişilebildiği varsayılmaz; istemci yalnız açıkça yapılandırılmış ve güvenli preflight kontrolünden geçmiş hedefi kullanır. Proje sunucuyu yerel ağa açmaz, Windows güvenlik duvarını değiştirmez ve Qwen chat template'ini yeniden üretmez; resmî template uygulaması çalışma zamanına aittir.

## Proje ilkeleri

- Kişisel bilgiler eğitim verisine veya model ağırlıklarına gömülmez.
- Eğitim ve değerlendirme verileri kesin biçimde ayrılır.
- Her sentetik kaydın kaynağı ve üretim zinciri izlenebilir olur.
- Büyük artifact'ler Git dışında, D diskinde tutulur.
- Doğrulama ve veri hazırlama araçları çevrimdışı çalışabilir.
- Model indirme, eğitim ve eğitim paketi kurulumu ayrı onay kapılarıdır.
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

Paket kurmadan mevcut doğrulamaları çalıştırmak için:

```bash
PYTHONPATH=src /home/kayra/.venvs/kayra-ai/bin/python -m kayra_ai.validation.validate_dataset --kind eval data/eval/seed.jsonl
PYTHONPATH=src /home/kayra/.venvs/kayra-ai/bin/python -m kayra_ai.validation.check_pii data/eval/seed.jsonl
/home/kayra/.venvs/kayra-ai/bin/python -m unittest discover -s tests -v
```

## Modelden bağımsız çalışma zamanı

Aşama 1, model indirmeden veya yerel sunucu başlatmadan ortak çalışma zamanı ve değerlendirme hattını sağlar. Varsayılan `mock` backend deterministiktir ve HTTP taşıması oluşturmaz. Gerçek backend'ler etkinleştirilmeden önce model kimliği ile OpenAI uyumlu API kök URL'si ortam değişkenlerinden çözülmelidir. API anahtarı isteğe bağlıdır; tanımlı değilse `Authorization` header'ı gönderilmez.

Çözümlenmiş gerçek-backend ortam değerleri log veya artifact'lere ham yazılmaz; model ve revision kimlikleri sonuçlarda tek yönlü `sha256:` tanımlayıcılarıyla temsil edilir.

Mock preflight:

```bash
PYTHONPATH=src /home/kayra/.venvs/kayra-ai/bin/python -m kayra_ai.runtime.preflight --config configs/runtime.yaml --backend mock
```

Kapalı eval setini iki açık profil üzerinden çalıştırma:

```bash
PYTHONPATH=src /home/kayra/.venvs/kayra-ai/bin/python -m kayra_ai.evaluation.cli \
  --config configs/runtime.yaml \
  --backend mock \
  --eval data/eval/seed.jsonl \
  --profiles all \
  --run-id stage1-mock
```

40 benzersiz vaka, `both` vakaları iki profile açıldığında 54 yürütme üretir. Mock sonucu yalnız yapılandırma, yönlendirme, sözleşme ve raporlama hattının çalıştığını gösterir; semantik kalite puanı veya gerçek model benchmark'ı değildir. Var olan bir `reports/runs/<run-id>/` dizininin üzerine yazılmaz; başka bir run kimliği seçilmelidir.

Thinking ve non-thinking ayrı profillerdir. Gerçek backend'in ilgili kontrolü belgelenmiş bir capability olarak doğrulanamıyorsa varsayılan davranış güvenli hatadır. Açıkça seçilmiş bir backend-default fallback kullanılırsa istenen ve fiilen uygulanan profil sonuçta ayrı kaydedilir; uygulama belgelenmemiş parametre veya chat-template işareti uydurmaz.

Ayrıntılı kullanım, bağlantı ve gizlilik davranışı için [çalışma zamanı ve eval kılavuzuna](docs/runtime-and-eval.md); ölçüm tanımları için [benchmark protokolüne](docs/benchmark-protocol.md) bakın.

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

Bu sürüm Aşama 0 altyapısı ile Aşama 1'in modelden bağımsız çalışma zamanı ve değerlendirme hattını içerir. Mevcut 40 eval vakası OpenAI Codex tarafından üretilmiş, kesin üretici model kimliği kaydedilmemiş ve henüz insan incelemesinden geçmemiş sentetik taslaklardır. Aşama 1 bu kayıtların `human_reviewed: false` durumunu değiştirmez. Model, Torch, eğitim kodu veya eğitim artifact'i içermez.
Model indirme ve eğitim öncesi kalıcı kontrol listesi için `docs/preflight-checklist.md` kullanılır.
