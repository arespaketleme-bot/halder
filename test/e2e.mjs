// Çalışan bir sunucuya karşı uçtan uca test.
// Sunucu ADMIN_TELEFON / ADMIN_SIFRE ile başlatılmış olmalı; aynı değerler E2E_ADMIN_TEL / E2E_ADMIN_SIFRE ile verilir.
// Kullanım: E2E_ADMIN_TEL=05.. E2E_ADMIN_SIFRE=.. node test/e2e.mjs [http://localhost:3000/halder]
// Test sırasında demo modu açılır, test sonunda açık bırakılır; geçici gerçek komisyoncu hesabı pasif yapılır.
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { randomBytes } from 'node:crypto';
import { DEMO_HESAPLAR } from '../server/seed-data.js';

const KOK = (process.argv[2] || 'http://localhost:3000/halder').replace(/\/$/, '');
const ADMIN = { telefon: process.env.E2E_ADMIN_TEL, sifre: process.env.E2E_ADMIN_SIFRE };
assert.ok(ADMIN.telefon && ADMIN.sifre, 'E2E_ADMIN_TEL ve E2E_ADMIN_SIFRE gerekli');

const jar = {};
async function c(kim, yol, { m = 'GET', json, raw } = {}) {
  const h = { 'X-Halder': '1', cookie: jar[kim] || '' };
  if (json !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(KOK + '/api' + yol, { method: m, headers: h, body: raw ?? (json !== undefined ? JSON.stringify(json) : undefined), redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc) jar[kim] = sc.split(';')[0];
  const ct = r.headers.get('content-type') || '';
  return { s: r.status, d: ct.includes('json') ? await r.json() : await r.arrayBuffer(), sc };
}
const giris = (kim, u) => c(kim, '/giris', { m: 'POST', json: { telefon: u.telefon, sifre: u.sifre } });
let ok = 0;
const t = async (ad, fn) => { await fn(); ok++; console.log('✔', ad); };

const DA = DEMO_HESAPLAR[0], K1 = DEMO_HESAPLAR[1], K2 = DEMO_HESAPLAR[2], BEKLEYEN = DEMO_HESAPLAR.at(-1);
// Geçici gerçek komisyoncu (test sonunda pasif yapılır).
const GK = { ad: 'E2E Gerçek Komisyon', telefon: '0599' + String(Date.now()).slice(-7), sifre: randomBytes(9).toString('hex') };

await t('kök adres /halder/ adresine yönleniyor', async () => {
  const r = await fetch(KOK, { redirect: 'manual' });
  // Doğrudan sunucu 301 verir; newhal vekili üzerinden sayfa gelir ve sayfa kendini "/" ile yeniden açar.
  if (r.status === 301) assert.ok(r.headers.get('location').endsWith('/halder/'));
  else { assert.equal(r.status, 200); assert.match(await r.text(), /location\.replace\(location\.pathname \+ '\/'/); }
});
await t('gerçek admin girişi, çerez yolu, demo modunu açma', async () => {
  const r = await giris('a', ADMIN);
  assert.equal(r.s, 200); assert.match(r.sc, /Path=\/halder/);
  assert.equal((await c('a', '/admin/demo', { m: 'POST', json: { acik: true } })).d.demo_modu, true);
  assert.ok((await c('z', '/demo/hesaplar')).d.length > 20);
});
await t('demo girişleri', async () => {
  assert.equal((await giris('da', DA)).s, 200);
  assert.equal((await giris('k1', K1)).s, 200);
  assert.equal((await giris('k2', K2)).s, 200);
  assert.equal((await giris('x', BEKLEYEN)).s, 403);
  assert.equal((await giris('x', { telefon: K1.telefon, sifre: 'yanlis' })).s, 401);
  assert.equal((await c('k1', '/ben')).d.demo, true);
});
await t('yetkiler: demo admin gerçek ayarları değiştiremez', async () => {
  assert.equal((await c('z', '/yayin/liste')).s, 401);
  assert.equal((await c('da', '/admin/ayar', { m: 'PUT', json: { gun: 1, saat: '10:00', sure: 60, aktif: true } })).s, 403);
  assert.equal((await c('da', '/admin/yayin', { m: 'POST', json: { ac: true } })).s, 403);
  assert.equal((await c('da', '/admin/demo', { m: 'POST', json: { acik: false } })).s, 403);
  assert.equal((await c('k1', '/admin/alacak')).s, 403);
  assert.equal((await c('a', '/alacak')).s, 403);
});
await t('demo: alacak ekle, mükerrer engeli, komisyoncular birbirini görmez', async () => {
  assert.equal((await c('k1', '/alacak', { m: 'POST', json: { tuccar: 'E2E Test Ltd', tutar: '1.250,50' } })).s, 200);
  assert.equal((await c('k1', '/alacak', { m: 'POST', json: { tuccar: 'e2e  TEST ltd', tutar: 1250.5 } })).d.hata, 'Mükerrer kayıt');
  const L1 = (await c('k1', '/alacak')).d, L2 = (await c('k2', '/alacak')).d;
  const kayit = L1.find(x => x.tuccar === 'E2E Test Ltd');
  assert.equal(kayit.tutar_kurus, 125050);
  assert.ok(!L2.some(x => L1.some(y => y.id === x.id)));
  assert.equal((await c('k2', '/alacak/' + kayit.id, { m: 'DELETE', json: {} })).s, 404);
  assert.equal((await c('k1', '/alacak/' + kayit.id, { m: 'DELETE', json: {} })).s, 200);
});
await t('Excel önizle / aktar (token)', async () => {
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('A');
  ws.addRow(['Tüccar', 'Tutar', 'Açıklama']); ws.addRow(['E2E Excel', 3000.75, 'x']); ws.addRow(['', -5, '']);
  const o = (await c('k1', '/excel/onizle', { m: 'POST', raw: Buffer.from(await wb.xlsx.writeBuffer()) })).d;
  assert.equal(o.satirlar[0].tutar_kurus, 300075); assert.equal(o.satirlar[0].hatalar.length, 0); assert.ok(o.satirlar[1].hatalar.length);
  assert.equal((await c('k2', '/excel/aktar', { m: 'POST', json: { token: o.token } })).s, 400);
  assert.equal((await c('k1', '/excel/aktar', { m: 'POST', json: { token: o.token } })).d.eklenen, 1);
  assert.equal((await c('k1', '/excel/aktar', { m: 'POST', json: { token: o.token } })).s, 400);
  const k = (await c('k1', '/alacak')).d.find(x => x.tuccar === 'E2E Excel');
  await c('k1', '/alacak/' + k.id, { m: 'DELETE', json: {} });
  assert.ok((await c('k1', '/excel/sablon')).d.byteLength > 1000);
});
await t('gerçek komisyoncu: kayıt, admin onayı, alacak', async () => {
  assert.equal((await c('gk', '/kayit', { m: 'POST', json: GK })).s, 200);
  assert.equal((await giris('gk', GK)).s, 403);
  const u = (await c('a', '/admin/kullanicilar')).d.find(x => x.telefon === GK.telefon);
  assert.ok(u, 'gerçek admin yeni kaydı görmeli');
  assert.ok(!(await c('da', '/admin/kullanicilar')).d.some(x => x.telefon === GK.telefon), 'demo admin gerçek kullanıcıyı görmemeli');
  assert.equal((await c('da', '/admin/kullanicilar/' + u.id, { m: 'PATCH', json: { durum: 'onayli' } })).s, 404, 'demo admin gerçek kullanıcıyı onaylayamamalı');
  await c('a', '/admin/kullanicilar/' + u.id, { m: 'PATCH', json: { durum: 'onayli' } });
  assert.equal((await giris('gk', GK)).s, 200);
  assert.equal((await c('gk', '/alacak', { m: 'POST', json: { tuccar: 'E2E Gerçek Tüccar', tutar: 777 } })).s, 200);
});
await t('veri yalıtımı: demo ve gerçek kayıtlar birbirine karışmaz', async () => {
  const gercek = (await c('a', '/admin/alacak')).d, demo = (await c('da', '/admin/alacak')).d;
  assert.ok(gercek.some(x => x.tuccar === 'E2E Gerçek Tüccar'));
  assert.ok(!gercek.some(x => x.demo === true || x.demo === 1), 'gerçek admin demo kaydı görmemeli');
  assert.ok(demo.length > 0 && !demo.some(x => x.tuccar === 'E2E Gerçek Tüccar'), 'demo admin gerçek kaydı görmemeli');
  assert.ok(!(await c('da', '/admin/log')).d.some(l => /E2E Gerçek/.test(l.islem)), 'demo admin gerçek logu görmemeli');
});
await t('yayın penceresi ve görünürlük', async () => {
  const ayar = (await c('a', '/admin/ayar')).d;
  const temel = { gun: ayar.gun, saat: ayar.saat, sure: ayar.sure, aktif: ayar.aktif };
  await c('a', '/admin/yayin', { m: 'POST', json: { ac: false } });
  assert.equal((await c('gk', '/yayin/liste')).s, 423, 'gerçek komisyoncu yayın dışında göremez');
  let k = (await c('k1', '/yayin/liste')).d;
  assert.ok(k.acik && k.liste.length, 'demo komisyoncu her zaman demo listesini görür');
  assert.ok(!k.liste.some(x => x.tuccar === 'E2E Gerçek Tüccar'));
  assert.ok(!k.liste.some(x => 'toplam' in x), 'komisyoncu toplamı görmemeli');
  assert.ok((await c('a', '/yayin/liste')).d.liste.every(x => typeof x.toplam === 'number'), 'admin toplamı görmeli');
  await c('a', '/admin/yayin', { m: 'POST', json: { ac: true } });
  const g = (await c('gk', '/yayin/liste')).d;
  assert.ok(g.acik && g.liste.some(x => x.tuccar === 'E2E Gerçek Tüccar') && g.liste.every(x => 'kom_sayisi' in x));
  await c('a', '/admin/ayar', { m: 'PUT', json: { ...temel, goster_kom: false, goster_arama: false } });
  k = (await c('gk', '/yayin/liste')).d;
  assert.ok(!k.liste.some(x => 'kom_sayisi' in x)); assert.equal(k.goster_arama, false);
  await c('a', '/admin/ayar', { m: 'PUT', json: { ...temel, goster_kom: true, goster_arama: true } });
  await c('a', '/admin/yayin', { m: 'POST', json: { ac: false } });
});
await t('demo modunu kapatma: demo girişi ve oturumları kapanır', async () => {
  await c('a', '/admin/demo', { m: 'POST', json: { acik: false } });
  assert.equal((await c('k1', '/ben')).s, 401);
  assert.equal((await giris('k1', K1)).s, 403);
  assert.deepEqual((await c('z', '/demo/hesaplar')).d, []);
  assert.equal((await c('gk', '/ben')).s, 200, 'gerçek kullanıcı etkilenmemeli');
  await c('a', '/admin/demo', { m: 'POST', json: { acik: true } });
  assert.equal((await giris('k1', K1)).s, 200);
});
// Temizlik: geçici gerçek komisyoncunun alacağını sil, hesabını pasif yap.
const gL = (await c('gk', '/alacak')).d;
for (const x of gL) await c('gk', '/alacak/' + x.id, { m: 'DELETE', json: {} });
const gu = (await c('a', '/admin/kullanicilar')).d.find(x => x.telefon === GK.telefon);
if (gu) await c('a', '/admin/kullanicilar/' + gu.id, { m: 'PATCH', json: { durum: 'pasif' } });
for (const k of Object.keys(jar)) await c(k, '/cikis', { m: 'POST', json: {} });
console.log(`\n${ok} test geçti (${KOK})`);
