# Halder'ı www.newhal.com/halder adresinde yayına alma

Yapı:

```
tarayıcı ──► www.newhal.com/halder/...  (newhal servisi, Render)
                    │  halim-vekil ile aktarır
                    ▼
            halder-xxxx.onrender.com/halder/...  (halder servisi, Render)
                    │
                    ▼
            Supabase PostgreSQL (halder_* tabloları)
```

## 1. GitHub: repoyu gizli yapın (önerilir)
`arespaketleme-bot/halder` → **Settings** → en alttaki **Danger Zone** → **Change visibility** → **Make private**.
Render'ın gizli repoya erişimi varsa (newhal ile aynı GitHub bağlantısı) sorun olmaz.

## 2. Supabase: bağlantı adresini alın
1. Supabase'de newhal'ın kullandığı projeyi açın (ya da Halder için yeni bir proje açın).
2. Üstteki **Connect** düğmesi → **Connection string** → **Session pooler** seçin.
3. `postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-0-....pooler.supabase.com:5432/postgres` gibi bir adres görünür.
   `[YOUR-PASSWORD]` yerine veritabanı şifresini yazın. Bu adres **DATABASE_URL** olacak.

Tablolar ilk açılışta otomatik oluşturulur ve `halder_` önekiyle başlar; newhal'ın tablolarına dokunulmaz.

## 3. Render: halder servisini açın
1. Render panelinde **New +** → **Blueprint** → `arespaketleme-bot/halder` reposunu seçin.
   (`render.yaml` okunur; servis adı `halder` olur.)
2. Sorulan ortam değişkenlerini girin:
   | Değişken | Değer |
   |---|---|
   | `DATABASE_URL` | 2. adımdaki adres |
   | `ADMIN_TELEFON` | Admin olarak giriş yapacağınız cep telefonu (05xx…) |
   | `ADMIN_SIFRE` | Güçlü bir şifre (en az 12 karakter) |
3. **Apply** / **Deploy**. Kurulum bitince servisin adresini not edin, ör. `https://halder-abcd.onrender.com`.
4. Kontrol: `https://halder-abcd.onrender.com/halder/` açılmalı ve admin bilgileriyle giriş yapılabilmeli.
5. Giriş yaptıktan sonra `ADMIN_SIFRE` değişkenini Render'dan silebilirsiniz (admin zaten oluşturuldu).

> **Plan:** Ücretsiz planda servis 15 dk kullanılmayınca uyur, ilk açılış 30-60 sn sürer.
> Cumartesi yayını sırasında herkes aynı anda gireceği için **Starter** plan önerilir.

## 4. newhal: /halder yönlendirmesini açın
1. Render'da **newhal** servisi → **Environment** → yeni değişken:
   `HALDER_URL` = `https://halder-abcd.onrender.com/halder` (3. adımdaki adres + `/halder`)
2. newhal reposundaki `halder-vekil` değişikliği `main`'e alınınca newhal yeniden yayınlanır.
3. Kontrol: `https://www.newhal.com/halder` açılmalı.

## Sorun giderme
- **"Halder şu anda açılamadı"**: halder servisi uyuyor veya `HALDER_URL` yanlış. Render'da halder loglarına bakın.
- **Sunucu hatası / veritabanı**: `DATABASE_URL` şifresi yanlış olabilir; halder loglarında `password authentication failed` arayın.
- **Giriş yapılıyor ama hemen çıkıyor**: tarayıcı çerezleri engelliyor olabilir; adresin `https://www.newhal.com/halder/` olduğundan emin olun.
