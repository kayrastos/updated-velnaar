# KayraAI yerel tool-use v1

Bu asama, model ile yerel araclar arasina varsayilan olarak reddeden bir
guvenlik siniri koyar. Ilk surum gercek dosya veya komut calistirmaz; yalnizca
istek, onizleme ve kullanici onayi sozlesmelerini tanimlar.

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

## Sonraki uygulama sirasi

1. Izin verilen koklere hapsolmus dosya yolu politikasi
2. Symlink kacisi, hassas dosya adi ve boyut siniri kontrolleri
3. Salt-okunur dosya listeleme, metadata ve metin okuma yurutuculari
4. Tam arguman dizisine gore allowlist kullanan komut politikasi
5. `shell=False`, minimum ortam, timeout ve cikti sinirli komut yurutucu
6. Kullanici arayuzu onizleme/onay akisi
7. Yerel, kisisel veri icermeyen denetim olaylari

## Guven siniri

`ToolAuthorization` bir yetki uretme mekanizmasi degildir. Yalnizca guvenilir
kullanici arayuzu, gercek bir kullanici onay olayindan sonra bu nesneyi
olusturabilir. Modelin kendi urettigi onay nesnesi guvenilir kabul edilmez.
