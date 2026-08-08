# Kapalı değerlendirme seti

Bu dizin, eğitim verisinden tamamen ayrı tutulacak küçük ve kişisel olmayan değerlendirme vakalarını içerir. `seed.jsonl` içindeki mevcut 40 vaka bu Codex oturumunda AI tarafından üretilmiş sentetik taslaklardır; insan yazımı veya insan tarafından doğrulanmış değildir.

## Mevcut provenance

- `kind`: `synthetic`
- `generator`: `OpenAI Codex`
- `generator_model`: `not_recorded` — bu oturumdan kesin model kimliği doğrulanamadı.
- `human_reviewed`: `false`
- `review_status`: `draft/unreviewed`

## Kurallar

- Buradaki prompt veya beklenen davranışlar eğitim/SFT/preference verisine kopyalanmaz.
- Yakın yeniden ifadeler de veri sızıntısı kabul edilir.
- Bir vaka ancak gerçek insan incelemesinden sonra `human_reviewed: true` ve `review_status: reviewed` yapılır; nihai baseline öncesinde ayrıca `locked` durumuna geçirilir.
- Eval setini üreten veya gören bir öğretmen model, eğitim verisi üretirken bu içeriğe erişmemelidir.
- Referans cevap tek doğru kabul edilmez; ağırlıklı rubric esas alınır.
- Otomatik LLM hakemi yardımcı sinyaldir, tek kabul kararı değildir.
- Gerçek kişisel bilgi veya gizli anahtar kullanılmaz.

## Doğrulama

Depo kökünden:

```bash
PYTHONPATH=src /home/kayra/.venvs/kayra-ai/bin/python -m kayra_ai.validation.validate_dataset --kind eval data/eval/seed.jsonl
PYTHONPATH=src /home/kayra/.venvs/kayra-ai/bin/python -m kayra_ai.validation.check_pii data/eval/seed.jsonl
```

`seed.jsonl` şu anda 40 sentetik, incelenmemiş başlangıç vakası içerir. Kategoriler Türkçe ifade, talimat takibi, muhakeme, kodlama, özetleme, dürüstlük, mahremiyet, güvenlik, biçim, RAG sınırı ve persona tutarlılığını kapsar.
