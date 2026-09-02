# KayraAI Training Data

## Dataset layers

### raw/
Ham veya henüz doğrulanmamış eğitim örnekleri.

### curated/
İnsan tarafından kontrol edilmiş, eğitime girebilecek kaliteli örnekler.

### eval/
Eğitim sırasında modele ASLA gösterilmeyecek değerlendirme örnekleri.

## Canonical SFT format

Her satır bağımsız bir JSON nesnesidir:

{"id":"sft_tr_000001","category":"instruction_following","messages":[{"role":"user","content":"..."},{"role":"assistant","content":"..."}]}

## Kurallar

- UTF-8
- JSONL: satır başına tek kayıt
- Her kaydın benzersiz `id` alanı olmalı
- `messages` en az bir user ve bir assistant mesajı içermeli
- Eval örnekleri train/curated dosyalarına kopyalanmamalı
- Kişisel veya zamanla değişen bilgiler fine-tune ağırlıklarına gömülmemeli; RAG/memory katmanında tutulmalı
- Kalite, örnek sayısından önce gelir
