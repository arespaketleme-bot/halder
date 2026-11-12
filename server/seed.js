// Demo verisi. SADECE geliştirme içindir; üretimde bu hesapları kullanmayın.
import { db, hashle } from './db.js';
import { DEMO_HESAPLAR, DEMO_TUCCARLAR } from './seed-data.js';

const ekle = db.prepare('INSERT OR IGNORE INTO users(ad,telefon,sifre_hash,rol,durum) VALUES (?,?,?,?,?)');
for (const u of DEMO_HESAPLAR) ekle.run(u.ad, u.telefon, hashle(u.sifre), u.rol, u.durum);

if (!db.prepare('SELECT COUNT(*) n FROM alacak').get().n) {
  const komlar = db.prepare("SELECT id FROM users WHERE rol='kom' AND durum='onayli' ORDER BY id").all().map(r => r.id);
  const a = db.prepare('INSERT INTO alacak(kom_id,tuccar,tuccar_key,tutar_kurus,durum) VALUES (?,?,?,?,?)');
  // Sabit tohumlu basit rastgele sayı üreteci: her çalıştırmada aynı veri.
  let s = 42;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

  DEMO_TUCCARLAR.forEach(([ad, hedef], ti) => {
    // Her tüccara 1-6 komisyoncu; hedef tutar aralarında paylaştırılır.
    const n = 1 + Math.floor(rnd() * 6);
    const secilen = [...komlar].sort(() => rnd() - 0.5).slice(0, n);
    const paylar = secilen.map(() => 0.5 + rnd());
    const top = paylar.reduce((x, y) => x + y, 0);
    secilen.forEach((kid, i) => {
      const tl = Math.round((hedef * paylar[i]) / top / 100) * 100;
      a.run(kid, ad, ad.toLocaleLowerCase('tr'), tl * 100, 'acik');
    });
    // Birkaç tüccarda tahsil edilmiş eski kayıt da olsun (yayına girmez).
    if (ti % 4 === 0) a.run(secilen[0], ad, ad.toLocaleLowerCase('tr'), 150_000 * 100, 'tahsil');
  });
}
const sayi = db.prepare('SELECT (SELECT COUNT(*) FROM users) u, (SELECT COUNT(*) FROM alacak) a').get();
console.log(`Demo verisi hazır: ${sayi.u} kullanıcı, ${sayi.a} alacak kaydı. Hesaplar için server/seed-data.js dosyasına bakın.`);
