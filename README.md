# Halder – Tüccar Veresiye Takip Sistemi

Komisyoncular tüccarlardan alacaklarını elle veya Excel ile girer; admin listeyi
belirlediği gün/saatte (varsayılan **Cumartesi 10:00, 60 dk**) yayınlar. Yayın dışında
liste **sunucu tarafında** kapalıdır (HTTP 423).

Canlı adres: **https://www.newhal.com/halder/** (newhal sitesi `/halder` isteklerini bu servise iletir).

## Yerelde çalıştırma
Gereksinim: Node.js 22.5+. `DATABASE_URL` yoksa yerel SQLite (`data/halder.db`) kullanılır.

```bash
npm install
npm run seed     # demo hesaplar ve veriler (bkz. server/seed-data.js)
npm start        # http://localhost:3000/halder/
npm test         # yayın penceresi birim testleri
E2E_ADMIN_TEL=.. E2E_ADMIN_SIFRE=.. node test/e2e.mjs http://localhost:3000/halder   # uçtan uca test (sunucu aynı ADMIN_* ile başlatılmalı)
```

## Ortam değişkenleri
| Değişken | Açıklama |
|---|---|
| `DATABASE_URL` | PostgreSQL bağlantısı (Supabase). Yoksa SQLite. |
| `BASE_PATH` | Alt adres, varsayılan `/halder`. Kök için boş bırakın. |
| `NODE_ENV` | `production`: Secure çerez, demo listesi kapalı, seed engelli. |
| `ADMIN_TELEFON`, `ADMIN_SIFRE`, `ADMIN_AD` | Hiç admin yoksa ilk açılışta bu admin oluşturulur. |
| `PGSSL` | `false` ise SSL kapatılır (sadece yerel PostgreSQL için). |

Tablolar `halder_` önekiyle oluşturulur, aynı Supabase veritabanındaki diğer tablolarla çakışmaz.

## Roller
- **Admin:** yayın ayarı, manuel aç/kapat, komisyoncu sayısı/arama görünürlüğü, komisyoncu onayı, tüm kayıtlar ve tutarlar, işlem geçmişi.
- **Komisyoncu:** kayıt olur (admin onayı gerekir), alacak ekler / Excel yükler, sadece kendi kayıtlarını ve tutarlarını görür, yayında listeyi renk seviyeleriyle görür.

## Yapı
- `server/index.js` – Express API, oturum (HttpOnly çerez), yetki kontrolleri, Excel
- `server/db.js` – PostgreSQL / SQLite katmanı ve şema
- `server/yayin.js` – yayın penceresi hesabı (Türkiye saati, UTC+3)
- `public/` – mobil uyumlu arayüz
- `render.yaml` – Render servis tanımı

## Demo modu
Admin → **Yayın Ayarları** → **Demo modu** ile açılıp kapatılır (sadece gerçek admin).
- Açıkken giriş ekranında demo hesaplar listelenir (şifre `demo1234`, bkz. `server/seed-data.js`).
- Demo kayıtları `demo` sütunuyla işaretlidir: demo hesaplar sadece demo verisini, gerçek hesaplar sadece gerçek veriyi görür.
- Demo hesapların kendi yayın ayarları vardır: demo admin gün/saat/süre, görünürlük ve yayın aç/kapat ayarlarını değiştirebilir; bunlar sadece demo hesaplarını etkiler. Demo modunu sadece gerçek admin açıp kapatır.
- Kapatınca demo hesaplarla giriş yapılamaz ve açık demo oturumları kapanır.
