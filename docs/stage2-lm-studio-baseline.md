# Aşama 2 Windows LM Studio baseline runbook'u

Bu belge elle uygulanacak Aşama 2 baseline'ını tanımlar. Komutlar örnektir;
bu deponun çevrimdışı G-CODE değişikliği onları çalıştırmaz, LM Studio/model
indirmez, model yüklemez ve API isteği göndermez.

## Yetki kapıları

- `G0` yalnız plan onayıdır.
- `G-CODE` yalnız listelenen depo değişiklikleri ve çevrimdışı testlerdir.
- `G-GIT` stage, commit ve bundle için ayrıca gerekir; G-CODE bunu kapsamaz.
- `G-INSTALL`, `G-RUNTIME`, `G-MODEL`, `G-LOAD`, `G-API-READ`,
  `G-API-PROMPT`, `G-BENCH` ve `G-FULL` birbirinden ayrı onaylardır.
- Bir kapı daha sonraki kapıyı kendiliğinden açmaz.

## Sabit artifact ve disk bütçesi

| Alan | Değer |
|---|---|
| Depo | `Qwen/Qwen3-14B-GGUF` |
| Dosya | `Qwen3-14B-Q4_K_M.gguf` |
| Boyut | `9001752960` byte (`8.383535743 GiB`) |
| SHA-256 | `500a8806e85ee9c83f3ae08420295592451379b4f8cf2d0f41c15dffeb6b81f0` |
| Artifact commit | `c75e7b2d0234068f674a1bacf548ea32e27ccd29` |
| Lisans | `Apache-2.0` |
| Başlangıç context'i | `4096` |

İndirmeden hemen önce uzaktaki dosya adı, byte boyutu ve SHA-256 yeniden
doğrulanır; değişiklik varsa durulur. İndirmeden sonra aynı kontroller yerel
dosyada tekrarlanır ve eşleşmeden `G-LOAD` istenmez. Model WSL içine ikinci kez
kopyalanmaz. Asgari boş alan 24 GiB, yeniden deneme payıyla önerilen alan 32
GiB'dir.

LM Studio uygulaması, runtime'ı ve küçük config/cache dosyalarının tümünü D:
üzerinde tutan destekli bir yöntem olduğu varsayılmaz. `G-INSTALL` sırasında
kullanıcı iki seçenekten birini seçer:

1. Uygulama ve küçük kullanıcı verileri gerektiğinde C:\ üzerinde kalır; yalnız
   model kökü `D:\KayraAI\LMStudio\models` olur.
2. Tamamının D:\ üzerinde olması zorunluysa süreç tamamen durur.

Junction, symlink, registry veya otomatik ACL değişikliği yapılmaz.

## D:\ volume, alan ve ACL preflight'ı

**Yer — Windows PowerShell; salt okunur, `G-MODEL` öncesi**

```powershell
Get-Volume -DriveLetter D |
    Select-Object DriveLetter, FileSystem, HealthStatus, Size, SizeRemaining

Get-PSDrive -Name D |
    Select-Object Name, Provider, Root, Used, Free
```

Buradaki `Free` yalnız disk alanıdır; RAM metriği değildir. Kabul edilen dosya
sistemi NTFS'tir. FAT32 tek dosyada bu 9 GB artifact'i taşıyamadığı için
reddedilir. exFAT, ReFS, mapped/network drive veya belirsiz sonuç otomatik kabul
edilmez; `unknown` sayılıp durulur.

**Yer — Windows PowerShell; model dizini oluşturulduktan sonra salt okunur**

```powershell
Get-Acl -LiteralPath 'D:\KayraAI\LMStudio\models' |
    Format-List Owner, AccessToString

(Get-Acl -LiteralPath 'D:\KayraAI\LMStudio\models').Access |
    Select-Object IdentityReference, FileSystemRights, AccessControlType, IsInherited
```

Kullanıcının kendi hesabı yazabilmelidir. `SYSTEM` ve `Administrators` kabul
edilebilir. `Everyone` (`S-1-1-0`) veya `BUILTIN\Users`
(`S-1-5-32-545`) için `Allow` türünde `Write`, `Modify`, `FullControl`, create,
append, delete ya da izin değiştirme yetkisi varsa, inherited olsa dahi durulur.
Ad/SID eşlemesi belirsizse `unknown` sayılır. Araç ACL'yi kendisi değiştirmez.

## Sürücü, GPU ve runtime preflight'ı

**Yer — Windows PowerShell; salt okunur, `G-MODEL` öncesi**

```powershell
Get-CimInstance Win32_VideoController |
    Select-Object Name, DriverVersion, Status

nvidia-smi -L

nvidia-smi `
    --query-gpu=name,driver_version,memory.total,memory.used,memory.free `
    --format=csv,noheader,nounits
```

GTX 1650 Ti görünmeli, `nvidia-smi` hatasız olmalı ve sürücü sürümü boş
olmamalıdır. Sabit bir minimum sürücü numarası uydurulmaz; LM Studio/runtime
uyumsuzluk bildirirse durulur. Sürücü indirme veya güncelleme otomatik değildir.

`lms` yalnız Windows tarafında doğrulanır; WSL komutu gibi gösterilmez. Komut
kapsamı için 2026-08-08 tarihinde resmî
[LM Studio CLI](https://lmstudio.ai/docs/cli) ve
[local server](https://lmstudio.ai/docs/developer/core/server) belgeleri esas
alınmıştır. Kurulu sürümün yerel `--help` çıktısı son sözdür; listelenmeyen bir
alt komut veya seçenek tahmin edilmez.

**Yer — Windows PowerShell; salt okunur**

```powershell
Get-Command lms
lms --version
lms --help
lms runtime --help
lms runtime ls
```

**Yer — LM Studio GUI**

- Windows x64, GGUF/llama.cpp ve NVIDIA'yı destekleyen runtime'ın tam adı ve
  sürümü kaydedilir.
- Runtime eksik veya çelişkiliyse `unknown` sayılıp durulur.
- Runtime indirme, güncelleme veya seçme için ayrıca `G-RUNTIME` gerekir.

## İlk UI yüklemesi: kısa Windows runbook'u

Bu adımlar yalnız `G-LOAD` sonrasında kullanıcı tarafından uygulanır.

1. **Yer — VS Code GUI:** Bütün dosya ve terminallerde kaydedilmemiş işler
   kontrol edilir. İşler güvene alınır, çalışan görevler kapatılır ve VS Code
   tamamen kapatılır.
2. **Yer — Ubuntu/WSL terminal pencereleri:** Açık oturumlar kapatılır.
3. **Yer — Windows PowerShell; kullanıcı çalıştırır, otomatik değildir:**

   ```powershell
   wsl --list --running
   wsl --shutdown
   wsl --list --running
   ```

   Son komut çalışan dağıtım gösterirse model yüklenmez.
4. **Yer — Windows Task Manager GUI:** Performance > Memory altında
   **Available/Kullanılabilir fiziksel bellek** kaydedilir. RAM için `Free`
   kullanılmaz.
5. **Yer — Windows PowerShell; alternatif salt-okunur ölçüm:**

   ```powershell
   (Get-Counter '\Memory\Available MBytes').CounterSamples |
       Select-Object Path, CookedValue
   ```

   Sayaç adı yerelleştirme nedeniyle bulunamazsa Task Manager'daki Available
   değeri kullanılır; başka bir `free` metriğe geçilmez.
6. **Yer — Windows PowerShell; VRAM ölçümü:**

   ```powershell
   nvidia-smi `
       --query-gpu=timestamp,memory.total,memory.used,memory.free,utilization.gpu `
       --format=csv,noheader,nounits
   ```

### UI yükleme kapıları

| An | Available physical memory | Kullanılan VRAM |
|---|---:|---:|
| Yükleme öncesi | en az 9.0 GiB | en çok 0.75 GiB |
| Yüklendikten 60 sn sonra | en az 2.5 GiB | en çok 3.4 GiB |
| UI prompt'u öncesi | en az 2.5 GiB | en çok 3.4 GiB |
| UI prompt'u sırasında/sonrasında | en az 2.0 GiB | en çok 3.5 GiB |

Başlangıç profili: context 4096, parallel 1, retry 0, tek instance, CPU'da KV
cache, JIT kapalı ve speculative decoding kapalıdır. RAM ve VRAM ayrı
değerlendirilir; toplanmaz.

**Yer — LM Studio GUI; yalnız yükleme ekranındaki bellek kestirimi**

Context 4096 ve seçili offload için GUI'nin gösterdiği tahmini toplam GPU
kullanımı yaklaşık 3.2 GiB üstündeyse offload azaltılıp kestirim yinelenir.
Sonuç anlaşılamıyorsa `unknown` sayılıp durulur. Belgelenmiş ve kurulu sürümün
yerel yardımında doğrulanmış bir eşdeğeri yoksa `lms load` seçeneği uydurulmaz.

**Yer — LM Studio GUI**

- Doğrulanmış tek artifact belirtilen profille yüklenir.
- Thinking ve non-thinking, kişisel olmayan kısa bir girdide ayrı yeni
  sohbetlerde denenir.
- Sürekli paging, UI donması, OOM/allocation veya GPU sürücü hatasında model
  unload edilir.

> **ZORUNLU DURDURMA KURALI: LM Studio UI'da Thinking seçeneği yoksa veya
> thinking/non-thinking seçimi etkisiz görünüyorsa `G-API-PROMPT` aşamasına
> geçilmez. Template ya da prompt tabanlı bir geçici çözüm üretilmez.**

## WSL/API için ayrı bellek kapısı

UI denemesi `G-API-READ` veya `G-API-PROMPT` yetkisi vermez. API aşamasında VS
Code kapalı kalır; yalnız hafif bir Ubuntu/WSL terminali açılır.

WSL açılmadan önce Available physical memory en az 3.0 GiB, kullanılan VRAM en
çok 3.4 GiB olmalıdır. WSL açıldıktan sonra Windows tarafında yaklaşık on saniye
arayla iki kez yeniden ölçülür. Her iki ölçümde Available physical memory en az
2.5 GiB ve kullanılan VRAM en çok 3.4 GiB değilse prompt gönderilmez; WSL
kapatılır ve model unload edilir.

İstekler arasında Available physical memory en az 2.0 GiB ve kullanılan VRAM en
çok 3.5 GiB kalmalıdır. Bu sınırın dışına çıkılırsa sonraki istek gönderilmez;
**Yer — LM Studio GUI:** model kullanıcı tarafından unload edilir ve yerel
sunucu durdurulur. Available 1.5 GiB altına iner, VRAM 3.6 GiB'ı aşar veya
OOM/sürücü/UI sorunu görülürse aynı geri çekilme beklenmeden acil uygulanır.
Kurulu sürümün `lms unload --help`/`lms server --help` çıktısında exact komut
doğrulanmadıkça CLI geri çekilme sözdizimi tahmin edilmez.

## Native v1 doğrulama sırası

Kullanılan alanların resmî URL, erişim tarihi ve exact JSON yolları
[`docs/runtime-and-eval.md`](runtime-and-eval.md#resmî-native-v1-şema-izi)
içinde tek tek kayıtlıdır.

**Yer — LM Studio GUI**

- Sunucu yalnız `127.0.0.1` üzerinde tutulur.
- LAN paylaşımı, CORS, MCP ve JIT kapalıdır.
- Firewall, portproxy veya `0.0.0.0` kullanılmaz.

`G-API-READ` yalnız prompt içermeyen `GET /api/v1/models` kontrolüne izin verir.
Tam model key, GGUF, Q4_K_M, byte boyutu, loaded instance, context 4096,
parallel 1, CPU KV ve ilan edilen `off`/`on` seçenekleri doğrulanır. Opsiyonel bir
alan yoksa değer uydurulmaz; `unknown` sayılıp durulur. `reasoning.default`, etkin
request durumunun kanıtı değildir.

**Yer — Windows PowerShell; yalnız `G-API-READ` sonrasında**

```powershell
Invoke-RestMethod `
    -Method Get `
    -Uri 'http://127.0.0.1:<gui-port>/api/v1/models'
```

Windows kontrolü geçtikten sonra WSL'den loopback erişimi ayrıca sınanır. WSL
erişimi başarısızsa LAN'a açılmaz. Sonra bellek kapısı yeniden geçilmeden
`G-API-PROMPT` kapsamında bile prompt gönderilmez.

**Yer — WSL/Ubuntu terminali; yalnız Windows kontrolü ve `G-API-READ` sonrasında**

```bash
curl --fail --silent --show-error \
  'http://127.0.0.1:<gui-port>/api/v1/models'
```

`G-API-PROMPT` verilirse aynı güvenli girdiye iki ayrı native request yapılır.
Her request açıkça `reasoning: on/off`, `store: false` ve `stream: false` taşır.
Runtime'ın response içinde etkin reasoning state'i echo ettiği varsayılmaz:
`resolved_reasoning_state` daima `unknown` kalır. İlan edilen capability,
istenen değer ve gözlenen reasoning output/token istatistiği ayrı kaydedilir.
Native runner var olan `mode: both` smoke vakasını thinking/non-thinking çifti
olarak ilk sıraya alır; yeni probe promptu üretmez. Davranış çelişkili, zorunlu
alan eksik veya çift tamamlanmamışsa kalan smoke istekleri gönderilmez ve kısmi
run artifact'i yazılmaz.

## Smoke, benchmark ve tam eval kapıları

`data/eval/stage2-smoke.jsonl`, seed'in 1, 7 ve 10. satırlarının byte-for-byte
kopyasıdır. SHA-256 değeri
`605ecf339774b5130c9214fbaa126202f2f91b20327092f3d44cb9df8111751d`
olmalıdır. Üç vaka iki profile açıldığında dört sıralı istek ve en çok 252 output
token üretir.

Smoke yalnız `G-API-PROMPT`, benchmark yalnız `G-BENCH`, 40 vaka/54 yürütmelik
tam eval yalnız `G-FULL` sonrasında yapılır. Başarılı smoke semantik kalite
kanıtı değildir. Native runner sabit smoke hash'i dışındaki eval dosyalarını
varsayılan olarak backend oluşturmadan reddeder. `--allow-native-non-smoke-eval`
interlock'u yalnız ayrı `G-FULL` onayından sonra kullanılabilir; flag tek başına
yetki değildir.

**Yer — WSL/Ubuntu terminali; yalnız `G-API-PROMPT` sonrasında**

```bash
PYTHONPATH=src /home/kayra/.venvs/kayra-ai/bin/python \
  -m kayra_ai.evaluation.cli \
  --config configs/runtime.lm-studio.yaml \
  --backend lm_studio \
  --eval data/eval/stage2-smoke.jsonl \
  --profiles all \
  --run-id stage2-lmstudio-smoke-YYYYMMDD-HHMM
```

Benchmark her profil için özetten çıkarılan bir warm-up ve beş ölçümlü istek
kullanır; concurrency 1 ve retry 0'dır. Native metrikler yeniden hesaplanmaz.
RAM için Available physical MiB, VRAM için used MiB ayrı seriler olarak
kaydedilir. Prompt, yanıt, header, raw body, exception ayrıntısı veya secret
benchmark özetine girmez.

## G-GIT sınırı

G-CODE tamamlanınca oluşturulan/değiştirilen dosyalar ve çevrimdışı testler
raporlanır. `git add`, commit veya bundle ancak kullanıcı ayrıca `G-GIT`
verirse yapılabilir. Push, tag, reset ve revert Aşama 2 G-CODE kapsamında
değildir.
