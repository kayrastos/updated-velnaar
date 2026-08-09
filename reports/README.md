# Üretilmiş raporlar

Bu dizin değerlendirme ve ilerideki gerçek model benchmark koşularının üretilmiş artifact'leri içindir. Koşu çıktıları yeniden üretilebilir ve makineye özgü olabileceğinden Git dışında tutulur; yalnız gerekli küçük, içerik taşımayan özetlerin sürümlenmesi ayrıca değerlendirilir.

## Koşu dizini

Her eval koşusu kendi benzersiz dizinine yazılır:

```text
reports/runs/<run-id>/
  results.jsonl
  summary.json
  summary.md
```

Var olan bir `reports/runs/<run-id>/` dizininin üzerine yazılmaz. İçeriği silinmez, birleştirilmez veya kısmen yenilenmez. Örneğin `stage1-mock` varsa yeni koşu için zaman damgası ya da başka benzersiz bir run kimliği seçilir.

Benchmark series artifact'i eval sonuçlarından ayrıdır:

```text
reports/benchmarks/<series-id>.json
```

Bu dosya `schemas/benchmark-series.schema.json` sözleşmesine uyar; prompt veya
response taşımaz. Thinking ve non-thinking için birer dışlanmış warm-up ve beşer
ölçümlü örnek, native metrikler, client monotonic toplam süre ve RAM/VRAM
gözlemlerini taşır. Aynı series kimliğinin üzerine yazılmaz.

## İçerik ve gizlilik sınırı

`results.jsonl` içindeki model/mock yanıtı genel runtime logu değildir. Değerlendirme için kasıtlı olarak üretilen, erişimi sınırlandırılması ve Git dışında tutulması gereken bir artifact'tir. Eval promptu sonuç içine tekrar kopyalanmaz; kayıt `case_id` ile Git'teki kişisel olmayan kapalı eval vakasına bağlanır.

`summary.json`, `summary.md` ve benchmark CLI özeti yalnız koşu sağlığı,
sayımlar, süre/kullanım özeti ve hata türleri gibi içeriksiz toplulaştırmaları
taşır. Prompt veya yanıt içermez. Benchmark özeti ayrıca ham response, exception
ayrıntısı, header veya environment değeri içermez.

Hiçbir artifact ya da genel runtime logu aşağıdakileri içermemelidir:

- çözümlenmiş API anahtarı;
- `Authorization` veya başka bir istek/yanıt header'ı;
- çözümlenmiş ortam değişkeni değeri;
- sunucunun raw response gövdesi;
- exception `repr` çıktısı.

HTTP durum kodu ve güvenli, tipli hata sınıfı tutulabilir. Bir artifact'in bu kuralları ihlal ettiği düşünülüyorsa Git'e eklenmez veya paylaşılmaz; koşu başarısız kabul edilip neden kodda giderilir.

Gerçek backend'in model kimliği ve revision değeri ortamdan çözülüyorsa sonuç sözleşmesinde ham değer yerine tek yönlü `sha256:` tanımlayıcısı bulunur. Mock kimliği sürümlü yapılandırmada açıkça tanımlandığından bu dönüşüme ihtiyaç duymaz.

LM Studio benchmark'ında `requested`, advertised ve observed reasoning kanıtı
ayrı tutulur; request değeri effective profile olarak kopyalanmaz.
`resolved_reasoning_state: unknown`, mode kontrolü
`native_api_reasoning_parameter` ve ön doğrulama
`behaviorally_consistent` olmalıdır. Native TTFT/token istatistiğinin kaynağı
`lm_studio_native_v1` olarak etiketlenir. Başarılı örnekte zorunlu native
metrikler null olamaz; yalnız model-load süresi eksik olabilir.

**Yer — WSL/Ubuntu terminali; yalnız yerel artifact'i çevrimdışı doğrular**

```bash
PYTHONPATH=src /home/kayra/.venvs/kayra-ai/bin/python \
  -m kayra_ai.evaluation.benchmark_cli \
  reports/benchmarks/<series-id>.json
```

Koşu yazıcısı mevcut işletim sistemi umask/ACL politikasını kullanır; WSL altındaki DrvFS/NTFS üzerinde POSIX `chmod` görünümü güvenilir bir Windows erişim sınırı değildir. Aşama 1 kişisel veri içermez. Gerçek model yanıtı veya hassas eval içeriği üretilmeden önce hedef rapor dizini için Windows ACL ve saklama politikası ayrıca belirlenmelidir; uygulama güvenli ACL'yi kendi başına var saymaz veya değiştirmez.

## Mock yorumlama kuralı

Aşama 1 mock koşusunda 40 benzersiz eval vakası 54 profil yürütmesine genişler: 29 thinking ve 25 non-thinking. Mock sonuçları yalnız yapılandırma, backend yönlendirme, şema, hata ve raporlama hattının çalıştığını doğrular. `semantic_scoring_performed: false` olmalıdır; çıktı semantik kalite, doğruluk, rubric başarısı veya gerçek model performansı olarak yorumlanmaz.

Mock süre ve token kullanım değerleri benchmark değildir. Gerçek ölçüm tanımları için [`docs/benchmark-protocol.md`](../docs/benchmark-protocol.md), çalışma zamanı davranışı için [`docs/runtime-and-eval.md`](../docs/runtime-and-eval.md) kullanılır.
