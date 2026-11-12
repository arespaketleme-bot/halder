# Halder – Tüccar Veresiye Takip Sistemi (MVP)

Komisyoncular tüccarlardan alacaklarını elle veya Excel ile girer; admin listeyi
belirlediği gün/saatte (varsayılan **Cumartesi 10:00, 60 dk**) yayınlar. Yayın dışında
liste **sunucu tarafında** kapalıdır (HTTP 423).

## Çalıştırma
Gereksinim: Node.js 22.5+ (yerleşik `node:sqlite` kullanılır).

```bash
npm install
npm run seed     # demo hesaplar ve veriler (bkz. server/seed.js)
npm start        # http://localhost:3000
npm test         # yayın penceresi testleri
```

## Roller
- **Admin:** yayın ayarı (gün/saat/süre/otomatik), manuel aç/kapat, komisyoncu onayı, tüm kayıtlar, işlem geçmişi.
- **Komisyoncu:** kendi kaydını açar (admin onayı gerekir), alacak ekler / Excel yükler, durum günceller, yayında listeyi görür.

## Yayın listesi
Tüccar (VKN) bazında toplam açık borç, kaç komisyoncuya borçlu olduğu ve vade durumu.
Komisyoncu bazlı tutarlar ve tam VKN gösterilmez.

## Yapı
- `server/index.js` – Express API, oturum (HttpOnly çerez), yetki kontrolleri, Excel
- `server/yayin.js` – yayın penceresi hesabı (Türkiye saati, UTC+3)
- `server/db.js` – SQLite şeması (`data/halder.db`)
- `public/` – mobil uyumlu arayüz

## Üretime çıkmadan önce
- HTTPS arkasında `NODE_ENV=production` ile çalıştırın (Secure çerez).
- Demo hesapları silin, gerçek admin oluşturun.
- KVKK: tüccar açık rızası, aydınlatma metni, itiraz süreci — hukukçu görüşü alın.
- Planlanan: SMS doğrulama, tüccar itiraz akışı, PostgreSQL'e geçiş, yedekleme.
