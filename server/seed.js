// Demo verisi. SADECE geliştirme içindir; üretimde bu hesapları kullanmayın.
import { db, hashle } from './db.js';
import { DEMO_HESAPLAR } from './seed-data.js';

const ekle = db.prepare('INSERT OR IGNORE INTO users(ad,telefon,sifre_hash,rol,durum) VALUES (?,?,?,?,?)');
for (const u of DEMO_HESAPLAR) ekle.run(u.ad, u.telefon, hashle(u.sifre), u.rol, u.durum);

const id = tel => db.prepare('SELECT id FROM users WHERE telefon=?').get(tel).id;
if (!db.prepare('SELECT COUNT(*) n FROM alacak').get().n) {
  const a = db.prepare('INSERT INTO alacak(kom_id,tuccar,tuccar_key,tutar_kurus,durum) VALUES (?,?,?,?,?)');
  const tl = n => n * 100;
  a.run(id('05000000001'), 'Ahmet Sebze', 'ahmet sebze', tl(450_000), 'acik');
  a.run(id('05000000002'), 'Ahmet Sebze', 'ahmet sebze', tl(185_000), 'acik');
  a.run(id('05000000002'), 'Bereket Meyve', 'bereket meyve', tl(2_700_000), 'kismi');
  a.run(id('05000000001'), 'Bereket Meyve', 'bereket meyve', tl(900_000), 'acik');
  a.run(id('05000000001'), 'Anadolu Gıda', 'anadolu gıda', tl(7_500_000), 'acik');
  a.run(id('05000000002'), 'Yeşil Hal Pazarlama', 'yeşil hal pazarlama', tl(12_400_000), 'acik');
  a.run(id('05000000001'), 'Çiftçi Market', 'çiftçi market', tl(98_000), 'tahsil');
}
console.log('Demo verisi hazır. Hesaplar ve şifre için server/seed-data.js dosyasına bakın.');
