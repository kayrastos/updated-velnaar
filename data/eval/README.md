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
- Aşama 1 yalnız çalışma zamanı hattını doğrular; mevcut 40 kaydı insan incelemesinden geçmiş saymaz ve `human_reviewed: false`, `draft/unreviewed` durumunu değiştirmez.
- Eval setini üreten veya gören bir öğretmen model, eğitim verisi üretirken bu içeriğe erişmemelidir.
- Referans cevap tek doğru kabul edilmez; ağırlıklı rubric esas alınır.
- Otomatik LLM hakemi yardımcı sinyaldir, tek kabul kararı değildir.
- Gerçek kişisel bilgi veya gizli anahtar kullanılmaz.

## Aşama 1 mock koşusu

Eval runner, `mode: both` olan 14 vakayı iki açık profile genişletir. Mevcut dağılım 15 thinking, 11 non-thinking ve 14 both vakasından oluşur; sonuçta 40 benzersiz vaka için toplam 54 yürütme, 29 thinking ve 25 non-thinking sonucu üretilir.

Deterministik MockBackend promptu cevaplamaya veya rubric'i taklit etmeye çalışmaz. Mock koşusu yalnız eval okuma, profil genişletme, backend yönlendirme, sonuç sözleşmesi ve özet hattını doğrular. Sonuçlar semantik kalite puanı değildir ve `semantic_scoring_performed: false` olarak işaretlenir. Hiçbir kayıt bu koşu nedeniyle `human_reviewed` yapılmaz.

**Yer — WSL/Ubuntu terminali.** Koşu komutu:

```bash
PYTHONPATH=src /home/kayra/.venvs/kayra-ai/bin/python -m kayra_ai.evaluation.cli \
  --config configs/runtime.yaml \
  --backend mock \
  --eval data/eval/seed.jsonl \
  --profiles all \
  --run-id stage1-mock
```

Var olan `reports/runs/stage1-mock/` dizininin üzerine yazılmaz; varsa farklı ve benzersiz bir run kimliği seçilir. Üretilen `results.jsonl` içindeki yanıt genel runtime logu değil, kasıtlı ve Git dışı bir değerlendirme artifact'idir. Prompt sonuç dosyasına kopyalanmaz. Genel runtime logları ve özetler prompt, yanıt, header, API anahtarı, çözümlenmiş ortam değişkeni, raw response gövdesi veya exception `repr` saklamaz.

## Aşama 2 smoke altkümesi

`stage2-smoke.jsonl` yeni veya yeniden ifade edilmiş veri değildir. `seed.jsonl`
dosyasındaki 1, 7 ve 10. satırların byte-for-byte, aynı sıradaki kopyasıdır:

| Vaka | Mod | Max output token |
|---|---|---:|
| `eval-tr-001` | `non_thinking` | 32 |
| `eval-if-003` | `both` | 60 |
| `eval-reason-001` | `thinking` | 100 |

Dosya SHA-256 değeri
`605ecf339774b5130c9214fbaa126202f2f91b20327092f3d44cb9df8111751d`
olarak sabittir. Profil uyumluluğuna göre smoke, iki thinking ve iki
non-thinking olmak üzere dört sıralı yürütme ve en çok 252 output token üretir.
Seed kayıtları değiştirilmez. Smoke yalnız transport/capability/sözleşme ve
kaynak güvenliği kontrolüdür; semantik kalite değerlendirmesi değildir.

## Doğrulama

**Yer — WSL/Ubuntu terminali.** Depo kökünden:

```bash
PYTHONPATH=src /home/kayra/.venvs/kayra-ai/bin/python -m kayra_ai.validation.validate_dataset --kind eval data/eval/seed.jsonl
PYTHONPATH=src /home/kayra/.venvs/kayra-ai/bin/python -m kayra_ai.validation.check_pii data/eval/seed.jsonl
```

**Yer — WSL/Ubuntu terminali.** Üretilen bir koşunun run-result doğrulaması:

```bash
PYTHONPATH=src /home/kayra/.venvs/kayra-ai/bin/python -m kayra_ai.validation.validate_dataset \
  reports/runs/<run-id>/results.jsonl \
  --kind run-result
```

`seed.jsonl` şu anda 40 sentetik, incelenmemiş başlangıç vakası içerir. Kategoriler Türkçe ifade, talimat takibi, muhakeme, kodlama, özetleme, dürüstlük, mahremiyet, güvenlik, biçim, RAG sınırı ve persona tutarlılığını kapsar.
