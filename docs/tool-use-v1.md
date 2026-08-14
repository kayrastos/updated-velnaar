# KayraAI yerel tool-use v1

Bu asama, model ile yerel araclar arasina varsayilan olarak reddeden bir
guvenlik siniri koyar. Dosya listeleme, metadata ve metin okuma yalnizca acikca
izin verilen koklerde ve her istek icin ayri kullanici onayiyla calisabilir.
Komut katmani yalnizca kodda tanimli kesin Git sorgularini calistirabilir.

## Degismez ilkeler

- Model dogrudan dosya sistemi, `subprocess` veya shell erisimi alamaz.
- v1 arac adlari yalnizca salt-okunur islemleri ifade eder.
- Her calistirma, kullaniciya gosterilen kesin istegin SHA-256 ozetiyle
  eslesen acik onay gerektirir.
- Onay kisa omurludur, tek kullanimlidir ve baska bir istege aktarilamaz.
- `shell=True`, serbest komut metni, yazma, silme, tasima, ag erisimi ve surec
  yonetimi v1 kapsaminda yoktur.
- Model cikisi guvenilmeyen girdidir; Pydantic dogrulamasi politika kontrolunun
  yerine gecmez.

## Akis

1. Model veya kullanici katmanindan katı bir `ToolRequest` uretilir.
2. Istek normalize edilip kanonik JSON biciminde ozetlenir.
3. Kullaniciya arac, amac, hedef ve argumanlari iceren `ToolPreview` gosterilir.
4. Arayuz, yalnizca kullanici acikca onaylarsa ilgili ozete bagli
   `ToolAuthorization` olusturur.
5. `ToolApprovalGate`, ozet eslesmesini, zamani ve tek kullanim durumunu
   denetler.
6. Sonraki asamadaki politika katmani izin verilen kok dizini ve komut
   allowlist'ini denetledikten sonra araci calistirabilir.
7. Yapilandirilmis sonuc ve denetim kaydi kullaniciya doner.

## v1 istek turleri

- `filesystem.list_directory`
- `filesystem.stat`
- `filesystem.read_text`
- `command.run_readonly`

`command.run_readonly` adi tek basina bir komutu guvenli yapmaz. Yurutucu komutu
`shell=False` ile calistirir ve tum `argv` dizisini kesin allowlist ile
karsilastirir. Politika tarafindan taninmayan her komut reddedilir.

## Dosya politikasi

- Goreli yollar ilk izinli koke gore cozumlenir; mutlak yollar da izinli bir
  kokun icinde kalmalidir.
- `..` ile ust dizin gecisi ve symlink yol bilesenleri reddedilir.
- `.git`, `.ssh`, `.aws`, `.gnupg`, `.kube`, `.env`, ozel anahtar ve kimlik
  bilgisi dosyalari varsayilan olarak reddedilir.
- `read_text` yalnizca normal, UTF-8, NUL icermeyen ve politika boyut sinirini
  asmayan dosyalari okur.
- Dizin listeleme recursive degildir, siralidir, ust sinirlidir ve symlink
  girdilerini izlemeksizin isaretler.

## Komut politikasi

- Yalnizca sinirli `git status`, `git diff`, `git show` ve `git ls-files`
  sorgularinin tam arguman dizileri kabul edilir.
- Shell, pipe, yonlendirme, komut birlestirme, serbest executable ve serbest
  Git secenekleri yoktur.
- Calisma dizini dosya politikasindaki izinli koklerin icinde kalmalidir.
- Git pager, terminal prompt, global/system config ve optional lock yazimlari
  kapatilir; fsmonitor devre disi birakilir.
- Diff/show calismalarinda external diff ve textconv devre disidir.
- Alt surec minimum ortamla, `stdin=DEVNULL`, `shell=False`, timeout ve sinirli
  sonuc okuma ile calisir.
- Timeout ve cikti kesilmesi yapilandirilmis sonuc alanlarinda belirtilir.

## Kullanici onayli CLI

`kayra-tools`, izinli koku `--root` ile acikca alir. Dosya yolu veya Git sorgusu
katı sozlesmeye donusturulup kanonik SHA-256 ozetiyle birlikte onizlenir. Arac
yalnizca kullanici terminale tam olarak `EVET` yazdiktan sonra calisir. Model
ciktisi veya istek verisi kendi basina onay sayilmaz.

CLI serbest komut metni kabul etmez. Git sorgulari `git-status`,
`git-diff-check`, `git-diff-names`, `git-head` ve `git-ls-files` adli alt
komutlardan guvenli `argv` dizilerine donusturulur. Dosya ve komut ciktilarindaki
terminal kontrol/bicimlendirme karakterleri yazdirilmadan once kacislanir.

## Guvenilmeyen model istek router'i

`UntrustedToolRequestRouter`, model tarafindan uretilen metni calistirilabilir
talimat olarak degil, guvenilmeyen veri olarak ele alir. Yalnizca tek ve boyutu
sinirli JSON nesnesi kabul edilir. Tekrar eden alanlar, kod bloklari, ek metin,
sonlu olmayan sayilar, bilinmeyen alanlar ve sozlesme disi arac adlari reddedilir.

Modelin verdigi `request_id` host tarafindan yenisiyle degistirilir.
`confirmed_by_user` gibi sahte onay alanlari katı sozlesme nedeniyle reddedilir.
Dosya yolu ve komut allowlist politikasi gectikten sonra router yalnizca
`ToolPreview` uretir; onay nesnesi olusturmaz ve hicbir yurutucu cagiramaz.

## Kullanici onayli yurutme host'u

`UserConfirmedToolExecutionHost`, router ile mevcut salt-okunur yurutucular
arasindaki guvenilir host/UI siniridir. `prepare()` model JSON'unu router'dan
gecirir, normalize edilmis istegi host icinde beklemeye alir ve arac adi, amac,
salt-okunur etki, parametreler, host kaynakli `request_id` ve istek SHA-256
ozetini iceren deterministik bir JSON onizlemesi dondurur. Dinamik metin ASCII
JSON kacislariyla gosterildigi icin kontrol karakterleri onay ekranini
degistiremez.

Guvenilir UI, onizlemeyi kullaniciya gosterdikten sonra `confirm()` metoduna
bekleyen `request_id`, ozet ve kullanicinin cevabini ayri host girdileri olarak
verir. Yalnizca cevap tam olarak `EVET` ise ve kimlik ile ozet host'taki ayni
bekleyen istekle eslesiyorsa bir dakikalik `ToolAuthorization` olusturulur.
Bekleyen istek yurutmeden once tek kullanimlik olarak tuketilir. Ret, bos veya
farkli cevap, kimlik/ozet uyusmazligi ve ikinci kullanim yurutme yapmadan
yapilandirilmis bir host sonucu dondurur.

Host yalnizca router ile ayni `ReadOnlyPathPolicy` nesnesini kullanan
`ReadOnlyFilesystem` ve istege bagli `ReadOnlyCommandExecutor` kabul eder.
Komut yurutucusu router'daki ayni kesin Git allowlist politikasina bagli
olmalidir; iki yurutucu da ayni `ToolApprovalGate` nesnesini kullanir. Boylece
host kontrolune ek olarak mevcut digest, sure ve authorization replay
kontrolleri de yurutme sinirinda tekrar uygulanir. Router, onay veya yurutme
hatalari ham exception metni ya da traceback yerine ekstra alanlara kapali,
guvenli Pydantic sonuclariyla bildirilir.

## Model cikti zarfi ve sinirli tool loop

`StrictModelOutputParser`, `GenerationResponse.content` alanini guvenilmeyen
veri olarak ele alir. Model her cagri icin yalnizca tek, boyutu sinirli JSON
nesnesi dondurebilir. Markdown code fence, JSON oncesi/sonrasi metin, birden
fazla nesne, tekrar eden veya bilinmeyen alan, sonlu olmayan sayi ve tur
coercion'i reddedilir. Belgelenmis zarf yalnizca su iki bicimden biridir:

```json
{"kind":"assistant_response","content":"Normal assistant yaniti"}
```

```json
{
  "kind": "tool_request",
  "request": {
    "tool": "filesystem.read_text",
    "path": "docs/tool-use-v1.md",
    "purpose": "guvenlik belgesini incele",
    "max_chars": 4096
  }
}
```

`tool_request.request` mevcut strict `ToolRequest` union'idir; yeni arac,
komut veya onay sozlesmesi tanimlamaz. `authorization`, `approved`,
`confirmed_by_user`, `EVET` veya benzeri ekstra alanlar model tarafindan
tasindiginda reddedilir. Gecerli istek kanonik JSON'a donusturulerek mevcut
router'a, ardindan mevcut user-confirmed host'a aktarilir. Kullanici cevabi
model zarfina degil ayri ve guvenilir UI callback'ine aittir; host yine yalnizca
tam `EVET` cevabinda yurutme yapabilir.

`GuardedModelToolLoop` backend arayuzunu dependency injection ile alir ve tek
kullanici turunda varsayilan olarak en fazla bir onayli arac adimina izin
verir. Ayni kanonik arac onerisi tur icinde tekrar kullanilamaz. Sinira
ulasildiginda ikinci istek router/host veya executor'a verilmez. Normal
`assistant_response` hicbir arac cagrisi yapmadan dondurulur.

Onayli arac sonucu modele geri verilecekse sonuc dogrudan prompt metni olarak
eklenmez. `untrusted_tool_result_data` zarfinda "talimat degil, guvenilmeyen
veri" bildirimi, istek ozeti, kesilme bilgisi ve boyutu sinirli JSON metni
tasir. Kontrol karakterleri ASCII JSON kacislarina; HTML/XML isaretleri ve
Markdown backtick karakterleri acik Unicode kacislarina donusturulur. Boylece
arac icerigindeki prompt veya markup metni talimat sinirini taklit edemez.

## Sonraki uygulama sirasi

1. Yerel, kisisel veri icermeyen denetim olaylari
2. Guvenilir UI ile guarded loop arasinda yerel sohbet entegrasyonu

## Guven siniri

`ToolAuthorization` bir yetki uretme mekanizmasi degildir. Yalnizca guvenilir
kullanici arayuzu, gercek bir kullanici onay olayindan sonra bu nesneyi
olusturabilir. Modelin kendi urettigi onay nesnesi guvenilir kabul edilmez.
Model yalnizca `prepare()` girdisi uretebilir; `confirm()` cagrisi ve cevabi
guvenilir host/UI tarafindan saglanir ve modele arac onayi yetkisi verilmez.
