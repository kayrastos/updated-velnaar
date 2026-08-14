# KayraAI yerel tool-use v1

Bu asama, model ile yerel araclar arasina varsayilan olarak reddeden bir
guvenlik siniri koyar. Dosya listeleme, metadata ve metin okuma yalnizca acikca
izin verilen koklerde ve her istek icin ayri kullanici onayiyla calisabilir.
Komut calistirma henuz etkin degildir.

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

`command.run_readonly` adi tek basina bir komutu guvenli yapmaz. Gelecek
yurutucu, komutu `shell=False` ile calistiracak ve arac/alt-komut/arguman
duzeyinde allowlist uygulayacaktir. Politika tarafindan taninmayan her komut
reddedilecektir.

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

## Sonraki uygulama sirasi

1. Tam arguman dizisine gore allowlist kullanan komut politikasi
2. `shell=False`, minimum ortam, timeout ve cikti sinirli komut yurutucu
3. Kullanici arayuzu onizleme/onay akisi
4. Yerel, kisisel veri icermeyen denetim olaylari

## Guven siniri

`ToolAuthorization` bir yetki uretme mekanizmasi degildir. Yalnizca guvenilir
kullanici arayuzu, gercek bir kullanici onay olayindan sonra bu nesneyi
olusturabilir. Modelin kendi urettigi onay nesnesi guvenilir kabul edilmez.
