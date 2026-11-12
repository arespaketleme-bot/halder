// Çalışan bir sunucuya karşı uçtan uca test (demo verisi yüklü olmalı).
// Kullanım: node test/e2e.mjs [http://localhost:3000/halder]
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { DEMO_HESAPLAR } from '../server/seed-data.js';

const KOK = (process.argv[2] || 'http://localhost:3000/halder').replace(/\/$/, '');
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
let ok = 0;
const t = async (ad, fn) => { await fn(); ok++; console.log('✔', ad); };

const A = DEMO_HESAPLAR[0], K1 = DEMO_HESAPLAR[1], K2 = DEMO_HESAPLAR[2], BEKLEYEN = DEMO_HESAPLAR.at(-1);

await t('kök adres /halder/ adresine yönleniyor', async () => {
  const r = await fetch(KOK, { redirect: 'manual' });
  // Doğrudan sunucu 301 verir; newhal vekili üzerinden sayfa gelir ve sayfa kendini "/" ile yeniden açar.
  if (r.status === 301) assert.ok(r.headers.get('location').endsWith('/halder/'));
  else { assert.equal(r.status, 200); assert.match(await r.text(), /location\.replace\(location\.pathname \+ '\/'/); }
  assert.equal((await fetch(KOK + '/')).status, 200);
});
await t('girişler ve çerez yolu', async () => {
  const r = await c('a', '/giris', { m: 'POST', json: { telefon: A.telefon, sifre: A.sifre } });
  assert.equal(r.s, 200); assert.match(r.sc, /Path=\/halder/);
  assert.equal((await c('k1', '/giris', { m: 'POST', json: { telefon: K1.telefon, sifre: K1.sifre } })).s, 200);
  assert.equal((await c('k2', '/giris', { m: 'POST', json: { telefon: K2.telefon, sifre: K2.sifre } })).s, 200);
  assert.equal((await c('x', '/giris', { m: 'POST', json: { telefon: BEKLEYEN.telefon, sifre: BEKLEYEN.sifre } })).s, 403);
  assert.equal((await c('x', '/giris', { m: 'POST', json: { telefon: K1.telefon, sifre: 'yanlis' } })).s, 401);
});
await t('yetkiler', async () => {
  assert.equal((await c('z', '/yayin/liste')).s, 401);
  assert.equal((await c('k1', '/admin/ayar', { m: 'PUT', json: { gun: 1, saat: '10:00', sure: 60, aktif: true } })).s, 403);
  assert.equal((await c('k1', '/admin/alacak')).s, 403);
  assert.equal((await c('a', '/alacak')).s, 403);
});
await t('alacak ekle, mükerrer engeli, kendi kayıtları', async () => {
  assert.equal((await c('k1', '/alacak', { m: 'POST', json: { tuccar: 'E2E Test Ltd', tutar: '1.250,50' } })).s, 200);
  assert.equal((await c('k1', '/alacak', { m: 'POST', json: { tuccar: 'e2e  TEST ltd', tutar: 1250.5 } })).d.hata, 'Mükerrer kayıt');
  const L1 = (await c('k1', '/alacak')).d, L2 = (await c('k2', '/alacak')).d;
  const kayit = L1.find(x => x.tuccar === 'E2E Test Ltd');
  assert.equal(kayit.tutar_kurus, 125050);
  assert.ok(!L2.some(x => L1.some(y => y.id === x.id)), 'komisyoncular birbirinin kaydını görmemeli');
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
await t('yayın penceresi ve görünürlük', async () => {
  const ayar = (await c('a', '/admin/ayar')).d;
  const temel = { gun: ayar.gun, saat: ayar.saat, sure: ayar.sure, aktif: ayar.aktif };
  await c('a', '/admin/yayin', { m: 'POST', json: { ac: false } });
  assert.equal((await c('k1', '/yayin/liste')).s, 423);
  const adm = (await c('a', '/yayin/liste')).d;
  assert.ok(adm.liste.every(x => typeof x.toplam === 'number'), 'admin toplamı görmeli');
  await c('a', '/admin/yayin', { m: 'POST', json: { ac: true } });
  let k = (await c('k1', '/yayin/liste')).d;
  assert.ok(k.acik && k.liste.length);
  assert.ok(!k.liste.some(x => 'toplam' in x), 'komisyoncu toplamı görmemeli');
  assert.ok(k.liste.every(x => 'kom_sayisi' in x));
  await c('a', '/admin/ayar', { m: 'PUT', json: { ...temel, goster_kom: false, goster_arama: false } });
  k = (await c('k1', '/yayin/liste')).d;
  assert.ok(!k.liste.some(x => 'kom_sayisi' in x)); assert.equal(k.goster_arama, false);
  await c('a', '/admin/ayar', { m: 'PUT', json: { ...temel, goster_kom: true, goster_arama: true } });
  await c('a', '/admin/yayin', { m: 'POST', json: { ac: false } });
  assert.equal((await c('k1', '/yayin/liste')).s, 423);
});
await t('kullanıcı onayı ve log', async () => {
  const us = (await c('a', '/admin/kullanicilar')).d;
  const b = us.find(u => u.telefon === BEKLEYEN.telefon);
  await c('a', '/admin/kullanicilar/' + b.id, { m: 'PATCH', json: { durum: 'onayli' } });
  assert.equal((await c('x', '/giris', { m: 'POST', json: { telefon: BEKLEYEN.telefon, sifre: BEKLEYEN.sifre } })).s, 200);
  await c('a', '/admin/kullanicilar/' + b.id, { m: 'PATCH', json: { durum: 'bekliyor' } });
  assert.equal((await c('x', '/ben')).s, 401, 'onayı kaldırılan kullanıcının oturumu düşmeli');
  assert.ok((await c('a', '/admin/log')).d.length > 0);
});
for (const k of Object.keys(jar)) await c(k, '/cikis', { m: 'POST', json: {} });
console.log(`\n${ok} test geçti (${KOK})`);
