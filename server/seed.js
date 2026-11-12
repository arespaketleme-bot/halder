// Demo verisi. SADECE geliştirme içindir; üretim veritabanında çalıştırmayın.
import { init, run, all, get, hashle } from './db.js';
import { DEMO_HESAPLAR, DEMO_TUCCARLAR } from './seed-data.js';

if (process.env.NODE_ENV === 'production') {
  console.error('Demo verisi üretimde yüklenmez.');
  process.exit(1);
}
await init();
for (const u of DEMO_HESAPLAR)
  await run('INSERT INTO halder_users(ad,telefon,sifre_hash,rol,durum) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING',
    [u.ad, u.telefon, hashle(u.sifre), u.rol, u.durum]);

if (!(await get('SELECT COUNT(*) n FROM halder_alacak')).n) {
  const komlar = (await all("SELECT id FROM halder_users WHERE rol='kom' AND durum='onayli' ORDER BY id")).map(r => r.id);
  const ekle = (kid, ad, kurus, durum) =>
    run('INSERT INTO halder_alacak(kom_id,tuccar,tuccar_key,tutar_kurus,durum) VALUES (?,?,?,?,?)', [kid, ad, ad.toLocaleLowerCase('tr'), kurus, durum]);
  // Sabit tohumlu basit rastgele sayı üreteci: her çalıştırmada aynı veri.
  let s = 42;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

  for (const [ti, [ad, hedef]] of DEMO_TUCCARLAR.entries()) {
    // Her tüccara 1-6 komisyoncu; hedef tutar aralarında paylaştırılır.
    const n = 1 + Math.floor(rnd() * 6);
    const secilen = [...komlar].sort(() => rnd() - 0.5).slice(0, n);
    const paylar = secilen.map(() => 0.5 + rnd());
    const top = paylar.reduce((x, y) => x + y, 0);
    for (const [i, kid] of secilen.entries()) await ekle(kid, ad, Math.round((hedef * paylar[i]) / top / 100) * 100 * 100, 'acik');
    // Birkaç tüccarda tahsil edilmiş eski kayıt da olsun (yayına girmez).
    if (ti % 4 === 0) await ekle(secilen[0], ad, 150_000 * 100, 'tahsil');
  }
}
const sayi = await get('SELECT (SELECT COUNT(*) FROM halder_users) u, (SELECT COUNT(*) FROM halder_alacak) a');
console.log(`Demo verisi hazır: ${sayi.u} kullanıcı, ${sayi.a} alacak kaydı. Hesaplar için server/seed-data.js dosyasına bakın.`);
process.exit(0);
