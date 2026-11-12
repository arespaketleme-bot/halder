import express from 'express';
import ExcelJS from 'exceljs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PG, init, run, all, get, tx, ayarGetir, ayarKaydet, hashle, dogrula, logYaz, demoYukle } from './db.js';
import { pencere } from './yayin.js';

const PORT = process.env.PORT || 3000;
// Uygulamanın yayınlandığı alt adres (www.newhal.com/halder). Kök için BASE_PATH='' verin.
const BASE = (process.env.BASE_PATH ?? '/halder').replace(/\/$/, '');
const OTURUM_SURE = 12 * 3600_000;
const URETIM = process.env.NODE_ENV === 'production';

const app = express.Router();
// Express 4 async hataları yakalamaz; her async işleyici bununla sarılır.
const h = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
  next();
});
app.use(express.static(join(dirname(fileURLToPath(import.meta.url)), '..', 'public')));
app.use('/api', express.json({ limit: '2mb' }));

// ---------- yardımcılar ----------
const hata = (res, kod, mesaj) => res.status(kod).json({ hata: mesaj });
const cerez = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(p => p[0]));
// Sayı ise olduğu gibi; metin ise Türkçe biçim ("1.500,50") kabul edilir.
const kurus = v => Math.round((typeof v === 'number' ? v : Number(String(v ?? '').replace(/\./g, '').replace(',', '.'))) * 100);
const telNorm = t => String(t || '').replace(/\D/g, '').replace(/^90/, '').replace(/^(?!0)/, '0');
const CEREZ = `HttpOnly; SameSite=Strict; Path=${BASE || '/'}${URETIM ? '; Secure' : ''}`;

app.get('/api/saglik', (req, res) => res.json({ ok: true })); // Render sağlık kontrolü

// CSRF: durum değiştiren isteklerde JSON veya özel başlık şart (SameSite=Strict çerezle birlikte).
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json') && req.get('X-Halder') !== '1')
    return hata(res, 415, 'Geçersiz istek');
  next();
});

app.use('/api', h(async (req, res, next) => {
  const t = cerez(req).oturum;
  if (t) {
    const s = await get(`SELECT u.id,u.ad,u.telefon,u.rol,u.durum,u.demo FROM halder_sessions s JOIN halder_users u ON u.id=s.user_id
                         WHERE s.token=? AND s.bitis>?`, [t, Date.now()]);
    // Demo hesaplar sadece demo modu açıkken geçerlidir.
    if (s && s.durum === 'onayli' && (!s.demo || (await ayarGetir()).demo_modu)) req.user = { ...s, demo: !!s.demo };
  }
  next();
}));
const girisli = (req, res, next) => (req.user ? next() : hata(res, 401, 'Giriş yapmalısınız'));
const admin = (req, res, next) => (req.user?.rol === 'admin' ? next() : hata(res, 403, 'Bu işlem sadece admin içindir'));
const gercek = (req, res, next) => (req.user && !req.user.demo ? next() : hata(res, 403, 'Demo hesabıyla bu işlem yapılamaz'));
const D = req => (req.user?.demo ? 1 : 0); // sorgularda demo / gerçek veri ayrımı
const kom = (req, res, next) => (req.user?.rol === 'kom' ? next() : hata(res, 403, 'Bu işlem sadece komisyoncular içindir'));

// Tüccarlar adlarıyla eşleşir: büyük/küçük harf ve fazla boşluk önemsiz.
const anahtar = ad => ad.toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();

// Yayında tutar yerine gösterilen seviye (renk). Sınırlar TL cinsinden.
// 0-1, 1-5, 5-10, 10-20, sonra 100 milyona kadar 10'ar milyon, en üstte 100+.
const SEVIYELER = [1, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(m => m * 1_000_000);
const seviye = k => { const i = SEVIYELER.findIndex(s => k / 100 < s); return i < 0 ? SEVIYELER.length : i; };

async function alacakDogrula(r, komId, q = run) {
  const e = [];
  const tuccar = String(r.tuccar ?? '').trim();
  const tutar_kurus = kurus(r.tutar);
  if (!tuccar || tuccar.length > 120) e.push('Tüccar adı geçersiz');
  if (!(tutar_kurus > 0) || tutar_kurus > 1e13) e.push('Tutar geçersiz');
  const k = { tuccar, tuccar_key: anahtar(tuccar), tutar_kurus, aciklama: r.aciklama ? String(r.aciklama).slice(0, 500) : null };
  if (!e.length && (await q(`SELECT 1 FROM halder_alacak WHERE kom_id=? AND tuccar_key=? AND tutar_kurus=? AND durum!='tahsil'`,
    [komId, k.tuccar_key, tutar_kurus])).rows.length) e.push('Mükerrer kayıt');
  return { k, e };
}
const ekleKayit = (uid, k, demo, q = run) =>
  q('INSERT INTO halder_alacak(kom_id,tuccar,tuccar_key,tutar_kurus,aciklama,demo) VALUES (?,?,?,?,?,?)', [uid, k.tuccar, k.tuccar_key, k.tutar_kurus, k.aciklama, demo]);

// ---------- oturum ----------
const denemeler = new Map();
app.post('/api/giris', h(async (req, res) => {
  const tel = telNorm(req.body.telefon);
  const d = denemeler.get(tel) || { n: 0, t: Date.now() };
  if (Date.now() - d.t > 15 * 60_000) { d.n = 0; d.t = Date.now(); }
  if (d.n >= 5) return hata(res, 429, 'Çok fazla deneme. 15 dakika sonra tekrar deneyin.');
  const u = await get('SELECT * FROM halder_users WHERE telefon=?', [tel]);
  if (!u || !dogrula(String(req.body.sifre || ''), u.sifre_hash)) {
    d.n++; denemeler.set(tel, d);
    return hata(res, 401, 'Telefon veya şifre hatalı');
  }
  denemeler.delete(tel);
  if (u.durum === 'bekliyor') return hata(res, 403, 'Hesabınız admin onayı bekliyor');
  if (u.durum === 'pasif') return hata(res, 403, 'Hesabınız kapatılmış');
  if (u.demo && !(await ayarGetir()).demo_modu) return hata(res, 403, 'Demo modu şu an kapalı');
  const token = randomBytes(32).toString('hex');
  await run('INSERT INTO halder_sessions(token,user_id,bitis) VALUES (?,?,?)', [token, u.id, Date.now() + OTURUM_SURE]);
  res.set('Set-Cookie', `oturum=${token}; Max-Age=${OTURUM_SURE / 1000}; ${CEREZ}`);
  await logYaz(u.id, 'Giriş yaptı');
  res.json({ ok: true });
}));
app.post('/api/cikis', h(async (req, res) => {
  await run('DELETE FROM halder_sessions WHERE token=?', [cerez(req).oturum || '']);
  res.set('Set-Cookie', `oturum=; Max-Age=0; ${CEREZ}`);
  res.json({ ok: true });
}));
app.post('/api/kayit', h(async (req, res) => {
  const ad = String(req.body.ad || '').trim(), tel = telNorm(req.body.telefon), sifre = String(req.body.sifre || '');
  if (ad.length < 2 || !/^05\d{9}$/.test(tel) || sifre.length < 8) return hata(res, 400, 'Ad, geçerli cep telefonu (05xx) ve en az 8 karakterli şifre gerekli');
  if (await get('SELECT 1 FROM halder_users WHERE telefon=?', [tel])) return hata(res, 409, 'Bu telefon zaten kayıtlı');
  const r = await get("INSERT INTO halder_users(ad,telefon,sifre_hash,rol) VALUES (?,?,?,'kom') RETURNING id", [ad, tel, hashle(sifre)]);
  await logYaz(r.id, `Kayıt oldu: ${ad}`);
  res.json({ ok: true, mesaj: 'Kaydınız alındı. Admin onayından sonra giriş yapabilirsiniz.' });
}));
// Giriş ekranındaki demo hesap listesi: sadece demo modu açıkken dolu gelir.
app.get('/api/demo/hesaplar', h(async (req, res) => {
  if (!(await ayarGetir()).demo_modu) return res.json([]);
  const { DEMO_HESAPLAR } = await import('./seed-data.js');
  res.json(DEMO_HESAPLAR);
}));
app.get('/api/ben', girisli, (req, res) => res.json(req.user));

// ---------- yayın ----------
app.get('/api/yayin/durum', girisli, h(async (req, res) => res.json({ ...pencere(await ayarGetir()), simdi: Date.now() })));
app.get('/api/yayin/liste', girisli, h(async (req, res) => {
  const a = await ayarGetir();
  const p = pencere(a);
  // Demo kullanıcılar listeyi yayın saatini beklemeden görebilir (sadece demo verisi).
  if (!p.acik && req.user.rol !== 'admin' && !req.user.demo) return hata(res, 423, 'Liste şu an yayında değil');
  const rows = await all(`SELECT MAX(tuccar) tuccar, SUM(tutar_kurus) toplam, COUNT(DISTINCT kom_id) kom_sayisi
    FROM halder_alacak WHERE durum!='tahsil' AND demo=? GROUP BY tuccar_key ORDER BY toplam DESC`, [D(req)]);
  // Tutarın kendisi komisyoncuya gönderilmez, sadece renk seviyesi.
  // Komisyoncu sayısı kapalıysa hiç gönderilmez.
  res.json({ acik: p.acik || req.user.demo, demo: req.user.demo, bitis: p.bitis, seviyeler: SEVIYELER, goster_kom: a.goster_kom, goster_arama: a.goster_arama,
    liste: rows.map(r => ({ tuccar: r.tuccar, seviye: seviye(r.toplam),
      ...(a.goster_kom ? { kom_sayisi: r.kom_sayisi } : {}),
      // Toplam tutar sadece admine gönderilir.
      ...(req.user.rol === 'admin' ? { toplam: r.toplam } : {}) })) });
}));

// ---------- komisyoncu: alacaklar ----------
app.get('/api/alacak', girisli, kom, h(async (req, res) =>
  // Komisyoncu sadece kendi eklediği kayıtları ve tutarlarını görür.
  res.json(await all("SELECT id, tuccar, tutar_kurus, aciklama, olusturma FROM halder_alacak WHERE kom_id=? AND durum!='tahsil' ORDER BY id DESC", [req.user.id]))));
app.post('/api/alacak', girisli, kom, h(async (req, res) => {
  const { k, e } = await alacakDogrula(req.body, req.user.id);
  if (e.length) return hata(res, 400, e.join(', '));
  await ekleKayit(req.user.id, k, D(req));
  await logYaz(req.user.id, `Alacak eklendi: ${k.tuccar} ${(k.tutar_kurus / 100).toFixed(2)} ₺`); // log sadece admine açık
  res.json({ ok: true });
}));
app.delete('/api/alacak/:id', girisli, kom, h(async (req, res) => {
  const r = await run('DELETE FROM halder_alacak WHERE id=? AND kom_id=?', [Number(req.params.id), req.user.id]);
  if (!r.changes) return hata(res, 404, 'Kayıt bulunamadı');
  await logYaz(req.user.id, `Alacak #${req.params.id} silindi`);
  res.json({ ok: true });
}));

// ---------- Excel ----------
const BASLIK = ['Tüccar', 'Tutar', 'Açıklama'];
const yuklemeler = new Map(); // önizleme token -> { uid, t, satirlar }
setInterval(() => { for (const [k, v] of yuklemeler) if (Date.now() - v.t > 30 * 60_000) yuklemeler.delete(k); }, 600_000).unref();
app.get('/api/excel/sablon', girisli, h(async (req, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Alacaklar');
  ws.addRow(BASLIK).font = { bold: true };
  ws.addRow(['Örnek Sebze Ltd', 15000, 'Kasım domates']);
  ws.columns.forEach(c => (c.width = 24));
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="halder_sablon.xlsx"' });
  await wb.xlsx.write(res);
  res.end();
}));
const hucre = v => {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') return v.text ?? v.result ?? (v.richText ? v.richText.map(t => t.text).join('') : '');
  return v;
};
app.post('/api/excel/onizle', girisli, kom, express.raw({ type: () => true, limit: '5mb' }), h(async (req, res) => {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(req.body); } catch { return hata(res, 400, 'Dosya okunamadı. Lütfen .xlsx formatında yükleyin.'); }
  const ws = wb.worksheets[0];
  if (!ws) return hata(res, 400, 'Sayfa bulunamadı');
  const bas = ws.getRow(1).values.map(v => String(hucre(v)).trim().toLocaleLowerCase('tr'));
  const sutun = ad => bas.indexOf(ad.toLocaleLowerCase('tr'));
  const idx = { tuccar: sutun('Tüccar'), tutar: sutun('Tutar'), aciklama: sutun('Açıklama') };
  if (idx.tuccar < 0 || idx.tutar < 0) return hata(res, 400, 'Başlık satırı hatalı. Şablonu kullanın.');
  const ham = [];
  ws.eachRow((row, n) => {
    if (n === 1 || ham.length >= 2000) return;
    const r = { satir: n };
    for (const [k, i] of Object.entries(idx)) r[k] = i > 0 ? hucre(row.getCell(i).value) : '';
    if (typeof r.tutar === 'string') r.tutar = r.tutar.replace(/[₺\s]/g, '');
    ham.push(r);
  });
  const satirlar = [];
  const gorulen = new Set();
  for (const r of ham) {
    const { k, e } = await alacakDogrula(r, req.user.id);
    const tekrar = `${k.tuccar_key}|${k.tutar_kurus}`;
    if (!e.length && gorulen.has(tekrar)) e.push('Dosyada tekrar eden satır');
    gorulen.add(tekrar);
    satirlar.push({ satir: r.satir, ...k, hatalar: e });
  }
  // Ayrıştırılan satırlar sunucuda bekletilir; aktarım token ile yapılır.
  const token = randomBytes(16).toString('hex');
  yuklemeler.set(token, { uid: req.user.id, t: Date.now(), satirlar: satirlar.filter(r => !r.hatalar.length) });
  res.json({ token, satirlar: satirlar.map(r => ({ satir: r.satir, tuccar: r.tuccar, tutar_kurus: r.tutar_kurus, aciklama: r.aciklama, hatalar: r.hatalar })) });
}));
app.post('/api/excel/aktar', girisli, kom, h(async (req, res) => {
  const y = yuklemeler.get(String(req.body.token || ''));
  if (!y || y.uid !== req.user.id || Date.now() - y.t > 30 * 60_000) return hata(res, 400, 'Önizleme süresi doldu, dosyayı tekrar yükleyin');
  yuklemeler.delete(req.body.token);
  const atlanan = [];
  const eklenen = await tx(async q => {
    let n = 0;
    for (const r of y.satirlar) {
      const { k, e } = await alacakDogrula({ ...r, tutar: r.tutar_kurus / 100 }, req.user.id, q);
      if (e.length) { atlanan.push({ satir: r.satir, hatalar: e }); continue; }
      await ekleKayit(req.user.id, k, D(req), q);
      n++;
    }
    return n;
  });
  await logYaz(req.user.id, `Excel'den ${eklenen} kayıt yüklendi`);
  res.json({ eklenen, atlanan });
}));

// ---------- admin ----------
app.get('/api/admin/ayar', girisli, admin, h(async (req, res) => res.json(await ayarGetir())));
app.put('/api/admin/ayar', girisli, admin, gercek, h(async (req, res) => {
  const { gun, saat, sure, aktif, goster_kom, goster_arama } = req.body;
  if (!Number.isInteger(gun) || gun < 0 || gun > 6 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(saat) || !Number.isInteger(sure) || sure < 5 || sure > 720)
    return hata(res, 400, 'Geçersiz ayar');
  const a = { ...(await ayarGetir()), gun, saat, sure, aktif: !!aktif, goster_kom: !!goster_kom, goster_arama: !!goster_arama, kapat_bitis: null };
  await ayarKaydet(a);
  await logYaz(req.user.id, `Yayın ayarı: gün=${gun} saat=${saat} süre=${sure}dk otomatik=${a.aktif ? 'açık' : 'kapalı'} komisyoncu sayısı=${a.goster_kom ? 'göster' : 'gizle'} arama=${a.goster_arama ? 'açık' : 'kapalı'}`);
  res.json(a);
}));
app.post('/api/admin/yayin', girisli, admin, gercek, h(async (req, res) => {
  const a = await ayarGetir();
  if (req.body.ac) {
    a.manuel_bitis = Date.now() + a.sure * 60_000;
    a.kapat_bitis = null;
  } else {
    const p = pencere(a);
    a.manuel_bitis = null;
    a.kapat_bitis = p.acik && !p.manuel ? p.bitis : null;
  }
  await ayarKaydet(a);
  await logYaz(req.user.id, req.body.ac ? `Manuel yayın başlatıldı (${a.sure} dk)` : 'Yayın manuel kapatıldı');
  res.json(pencere(a));
}));
// Demo modu: sadece gerçek admin açıp kapatabilir. Açılınca demo hesap ve verileri yüklenir.
app.post('/api/admin/demo', girisli, admin, gercek, h(async (req, res) => {
  const acik = !!req.body.acik;
  if (acik) await demoYukle();
  else await run('DELETE FROM halder_sessions WHERE user_id IN (SELECT id FROM halder_users WHERE demo=TRUE)');
  await ayarKaydet({ ...(await ayarGetir()), demo_modu: acik });
  await logYaz(req.user.id, `Demo modu ${acik ? 'açıldı' : 'kapatıldı'}`);
  res.json({ demo_modu: acik });
}));
app.get('/api/admin/kullanicilar', girisli, admin, h(async (req, res) =>
  res.json(await all('SELECT id,ad,telefon,rol,durum,olusturma FROM halder_users WHERE demo=? ORDER BY durum, id', [D(req)]))));
app.patch('/api/admin/kullanicilar/:id', girisli, admin, h(async (req, res) => {
  const id = Number(req.params.id);
  if (!['onayli', 'pasif', 'bekliyor'].includes(req.body.durum)) return hata(res, 400, 'Geçersiz durum');
  if (id === req.user.id) return hata(res, 400, 'Kendi hesabınızı değiştiremezsiniz');
  const r = await run("UPDATE halder_users SET durum=? WHERE id=? AND rol='kom' AND demo=?", [req.body.durum, id, D(req)]);
  if (!r.changes) return hata(res, 404, 'Kullanıcı bulunamadı');
  if (req.body.durum !== 'onayli') await run('DELETE FROM halder_sessions WHERE user_id=?', [id]);
  await logYaz(req.user.id, `Kullanıcı #${id} durumu: ${req.body.durum}`);
  res.json({ ok: true });
}));
app.get('/api/admin/alacak', girisli, admin, h(async (req, res) =>
  res.json(await all('SELECT a.*, u.ad kom_ad FROM halder_alacak a JOIN halder_users u ON u.id=a.kom_id WHERE a.demo=? ORDER BY a.id DESC', [D(req)]))));
app.get('/api/admin/log', girisli, admin, h(async (req, res) =>
  res.json(await all('SELECT l.zaman, u.ad, l.islem FROM halder_log l LEFT JOIN halder_users u ON u.id=l.user_id WHERE COALESCE(u.demo, FALSE)=? ORDER BY l.id DESC LIMIT 500', [D(req)]))));

app.use('/api', (req, res) => hata(res, 404, 'Bulunamadı'));
app.use((err, req, res, next) => { console.error(err); hata(res, 500, 'Sunucu hatası'); });

// ---------- sunucu ----------
const sunucu = express();
sunucu.disable('x-powered-by');
sunucu.set('trust proxy', true);
if (BASE) {
  // /halder → /halder/ (göreli adreslerin doğru çözülmesi için)
  sunucu.get(BASE, (req, res, next) => (req.originalUrl.split('?')[0] === BASE ? res.redirect(301, BASE + '/') : next()));
  sunucu.get('/', (req, res) => res.redirect(302, BASE + '/'));
}
sunucu.use(BASE || '/', app);

setInterval(() => run('DELETE FROM halder_sessions WHERE bitis<?', [Date.now()]).catch(console.error), 3600_000).unref();

if (process.env.NODE_ENV !== 'test') {
  await init();
  sunucu.listen(PORT, () => console.log(`Halder çalışıyor: http://localhost:${PORT}${BASE}/  (veritabanı: ${PG ? 'PostgreSQL' : 'SQLite'})`));
}
export default sunucu;
