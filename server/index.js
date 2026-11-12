import express from 'express';
import ExcelJS from 'exceljs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, ayarGetir, ayarKaydet, hashle, dogrula, logYaz } from './db.js';
import { pencere } from './yayin.js';

const app = express();
const PORT = process.env.PORT || 3000;
const OTURUM_SURE = 12 * 3600_000;

app.disable('x-powered-by');
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

// CSRF: durum değiştiren isteklerde JSON veya özel başlık şart (SameSite=Strict çerezle birlikte).
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json') && req.get('X-Halder') !== '1')
    return hata(res, 415, 'Geçersiz istek');
  next();
});

app.use('/api', (req, res, next) => {
  const t = cerez(req).oturum;
  if (t) {
    const s = db.prepare(`SELECT u.id,u.ad,u.telefon,u.rol,u.durum FROM sessions s JOIN users u ON u.id=s.user_id
                          WHERE s.token=? AND s.bitis>?`).get(t, Date.now());
    if (s && s.durum === 'onayli') req.user = s;
  }
  next();
});
const girisli = (req, res, next) => (req.user ? next() : hata(res, 401, 'Giriş yapmalısınız'));
const admin = (req, res, next) => (req.user?.rol === 'admin' ? next() : hata(res, 403, 'Bu işlem sadece admin içindir'));
const kom = (req, res, next) => (req.user?.rol === 'kom' ? next() : hata(res, 403, 'Bu işlem sadece komisyoncular içindir'));

// Tüccarlar adlarıyla eşleşir: büyük/küçük harf ve fazla boşluk önemsiz.
const anahtar = ad => ad.toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();

// Yayında tutar yerine gösterilen seviye (renk). Sınırlar TL cinsinden.
// 0-1, 1-5, 5-10, 10-20, sonra 100 milyona kadar 10'ar milyon, en üstte 100+.
const SEVIYELER = [1, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(m => m * 1_000_000);
const seviye = k => { const i = SEVIYELER.findIndex(s => k / 100 < s); return i < 0 ? SEVIYELER.length : i; };

function alacakDogrula(r, komId) {
  const e = [];
  const tuccar = String(r.tuccar ?? '').trim();
  const tutar_kurus = kurus(r.tutar);
  if (!tuccar || tuccar.length > 120) e.push('Tüccar adı geçersiz');
  if (!(tutar_kurus > 0) || tutar_kurus > 1e13) e.push('Tutar geçersiz');
  const k = { tuccar, tuccar_key: anahtar(tuccar), tutar_kurus, aciklama: r.aciklama ? String(r.aciklama).slice(0, 500) : null };
  if (!e.length && db.prepare(`SELECT 1 FROM alacak WHERE kom_id=? AND tuccar_key=? AND tutar_kurus=? AND durum!='tahsil'`)
    .get(komId, k.tuccar_key, tutar_kurus)) e.push('Mükerrer kayıt');
  return { k, e };
}
const alacakEkle = db.prepare('INSERT INTO alacak(kom_id,tuccar,tuccar_key,tutar_kurus,aciklama) VALUES (?,?,?,?,?)');
const ekleKayit = (uid, k) => alacakEkle.run(uid, k.tuccar, k.tuccar_key, k.tutar_kurus, k.aciklama);

// ---------- oturum ----------
const denemeler = new Map();
app.post('/api/giris', (req, res) => {
  const tel = telNorm(req.body.telefon);
  const d = denemeler.get(tel) || { n: 0, t: Date.now() };
  if (Date.now() - d.t > 15 * 60_000) { d.n = 0; d.t = Date.now(); }
  if (d.n >= 5) return hata(res, 429, 'Çok fazla deneme. 15 dakika sonra tekrar deneyin.');
  const u = db.prepare('SELECT * FROM users WHERE telefon=?').get(tel);
  if (!u || !dogrula(String(req.body.sifre || ''), u.sifre_hash)) {
    d.n++; denemeler.set(tel, d);
    return hata(res, 401, 'Telefon veya şifre hatalı');
  }
  denemeler.delete(tel);
  if (u.durum === 'bekliyor') return hata(res, 403, 'Hesabınız admin onayı bekliyor');
  if (u.durum === 'pasif') return hata(res, 403, 'Hesabınız kapatılmış');
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token,user_id,bitis) VALUES (?,?,?)').run(token, u.id, Date.now() + OTURUM_SURE);
  const guvenli = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.set('Set-Cookie', `oturum=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${OTURUM_SURE / 1000}${guvenli}`);
  logYaz(u.id, 'Giriş yaptı');
  res.json({ ok: true });
});
app.post('/api/cikis', (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token=?').run(cerez(req).oturum || '');
  res.set('Set-Cookie', 'oturum=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.post('/api/kayit', (req, res) => {
  const ad = String(req.body.ad || '').trim(), tel = telNorm(req.body.telefon), sifre = String(req.body.sifre || '');
  if (ad.length < 2 || !/^05\d{9}$/.test(tel) || sifre.length < 8) return hata(res, 400, 'Ad, geçerli cep telefonu (05xx) ve en az 8 karakterli şifre gerekli');
  try {
    const r = db.prepare("INSERT INTO users(ad,telefon,sifre_hash,rol) VALUES (?,?,?,'kom')").run(ad, tel, hashle(sifre));
    logYaz(r.lastInsertRowid, `Kayıt oldu: ${ad}`);
    res.json({ ok: true, mesaj: 'Kaydınız alındı. Admin onayından sonra giriş yapabilirsiniz.' });
  } catch { hata(res, 409, 'Bu telefon zaten kayıtlı'); }
});
// Sadece geliştirmede: giriş ekranındaki demo hesap düğmeleri için.
if (process.env.NODE_ENV !== 'production') {
  app.get('/api/dev/demo', async (req, res) => {
    const { DEMO_HESAPLAR } = await import('./seed-data.js');
    res.json(DEMO_HESAPLAR);
  });
}
app.get('/api/ben', girisli, (req, res) => res.json(req.user));

// ---------- yayın ----------
app.get('/api/yayin/durum', girisli, (req, res) => res.json({ ...pencere(ayarGetir()), simdi: Date.now() }));
app.get('/api/yayin/liste', girisli, (req, res) => {
  const a = ayarGetir();
  const p = pencere(a);
  if (!p.acik && req.user.rol !== 'admin') return hata(res, 423, 'Liste şu an yayında değil');
  const rows = db.prepare(`SELECT MAX(tuccar) tuccar, SUM(tutar_kurus) toplam, COUNT(DISTINCT kom_id) kom_sayisi
    FROM alacak WHERE durum!='tahsil' GROUP BY tuccar_key ORDER BY toplam DESC`).all();
  // Tutarın kendisi istemciye gönderilmez, sadece renk seviyesi.
  // Komisyoncu sayısı kapalıysa hiç gönderilmez.
  res.json({ acik: p.acik, bitis: p.bitis, seviyeler: SEVIYELER, goster_kom: a.goster_kom, goster_arama: a.goster_arama,
    liste: rows.map(r => ({ tuccar: r.tuccar, seviye: seviye(r.toplam), ...(a.goster_kom ? { kom_sayisi: r.kom_sayisi } : {}) })) });
});

// ---------- komisyoncu: alacaklar ----------
app.get('/api/alacak', girisli, kom, (req, res) =>
  // Tutarları sadece admin görür; komisyoncuya tutar gönderilmez.
  res.json(db.prepare("SELECT id, tuccar, aciklama, olusturma FROM alacak WHERE kom_id=? AND durum!='tahsil' ORDER BY id DESC").all(req.user.id)));
app.post('/api/alacak', girisli, kom, (req, res) => {
  const { k, e } = alacakDogrula(req.body, req.user.id);
  if (e.length) return hata(res, 400, e.join(', '));
  ekleKayit(req.user.id, k);
  logYaz(req.user.id, `Alacak eklendi: ${k.tuccar} ${(k.tutar_kurus / 100).toFixed(2)} ₺`); // log sadece admine açık
  res.json({ ok: true });
});
app.patch('/api/alacak/:id', girisli, kom, (req, res) => {
  if (!['acik', 'kismi', 'tahsil'].includes(req.body.durum)) return hata(res, 400, 'Geçersiz durum');
  const r = db.prepare("UPDATE alacak SET durum=?, guncelleme=datetime('now') WHERE id=? AND kom_id=?").run(req.body.durum, req.params.id, req.user.id);
  if (!r.changes) return hata(res, 404, 'Kayıt bulunamadı');
  logYaz(req.user.id, `Alacak #${req.params.id} durumu: ${req.body.durum}`);
  res.json({ ok: true });
});
app.delete('/api/alacak/:id', girisli, kom, (req, res) => {
  const r = db.prepare('DELETE FROM alacak WHERE id=? AND kom_id=?').run(req.params.id, req.user.id);
  if (!r.changes) return hata(res, 404, 'Kayıt bulunamadı');
  logYaz(req.user.id, `Alacak #${req.params.id} silindi`);
  res.json({ ok: true });
});

// ---------- Excel ----------
const BASLIK = ['Tüccar', 'Tutar', 'Açıklama'];
const yuklemeler = new Map(); // önizleme token -> { uid, t, satirlar }
setInterval(() => { for (const [k, v] of yuklemeler) if (Date.now() - v.t > 30 * 60_000) yuklemeler.delete(k); }, 600_000).unref();
app.get('/api/excel/sablon', girisli, async (req, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Alacaklar');
  ws.addRow(BASLIK).font = { bold: true };
  ws.addRow(['Örnek Sebze Ltd', 15000, 'Kasım domates']);
  ws.columns.forEach(c => (c.width = 24));
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="halder_sablon.xlsx"' });
  await wb.xlsx.write(res);
  res.end();
});
const hucre = v => {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') return v.text ?? v.result ?? (v.richText ? v.richText.map(t => t.text).join('') : '');
  return v;
};
app.post('/api/excel/onizle', girisli, kom, express.raw({ type: () => true, limit: '5mb' }), async (req, res) => {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(req.body); } catch { return hata(res, 400, 'Dosya okunamadı. Lütfen .xlsx formatında yükleyin.'); }
  const ws = wb.worksheets[0];
  if (!ws) return hata(res, 400, 'Sayfa bulunamadı');
  const bas = ws.getRow(1).values.map(v => String(hucre(v)).trim().toLocaleLowerCase('tr'));
  const sutun = ad => bas.indexOf(ad.toLocaleLowerCase('tr'));
  const idx = { tuccar: sutun('Tüccar'), tutar: sutun('Tutar'), aciklama: sutun('Açıklama') };
  if (idx.tuccar < 0 || idx.tutar < 0) return hata(res, 400, 'Başlık satırı hatalı. Şablonu kullanın.');
  const satirlar = [];
  const gorulen = new Set();
  ws.eachRow((row, n) => {
    if (n === 1 || satirlar.length >= 2000) return;
    const r = {};
    for (const [k, i] of Object.entries(idx)) r[k] = i > 0 ? hucre(row.getCell(i).value) : '';
    if (typeof r.tutar === 'string') r.tutar = r.tutar.replace(/[₺\s]/g, '');
    const { k, e } = alacakDogrula(r, req.user.id);
    const tekrar = `${k.tuccar_key}|${k.tutar_kurus}`;
    if (!e.length && gorulen.has(tekrar)) e.push('Dosyada tekrar eden satır');
    gorulen.add(tekrar);
    satirlar.push({ satir: n, ...k, hatalar: e });
  });
  // Ayrıştırılan satırlar sunucuda bekletilir; istemciye tutar gönderilmez.
  const token = randomBytes(16).toString('hex');
  yuklemeler.set(token, { uid: req.user.id, t: Date.now(), satirlar: satirlar.filter(r => !r.hatalar.length) });
  res.json({ token, satirlar: satirlar.map(r => ({ satir: r.satir, tuccar: r.tuccar, aciklama: r.aciklama, hatalar: r.hatalar })) });
});
app.post('/api/excel/aktar', girisli, kom, (req, res) => {
  const y = yuklemeler.get(String(req.body.token || ''));
  if (!y || y.uid !== req.user.id || Date.now() - y.t > 30 * 60_000) return hata(res, 400, 'Önizleme süresi doldu, dosyayı tekrar yükleyin');
  yuklemeler.delete(req.body.token);
  const gelen = y.satirlar;
  let eklenen = 0;
  const atlanan = [];
  db.exec('BEGIN');
  try {
    for (const r of gelen) {
      const { k, e } = alacakDogrula({ ...r, tutar: r.tutar_kurus / 100 }, req.user.id);
      if (e.length) { atlanan.push({ satir: r.satir, hatalar: e }); continue; }
      ekleKayit(req.user.id, k);
      eklenen++;
    }
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  logYaz(req.user.id, `Excel'den ${eklenen} kayıt yüklendi`);
  res.json({ eklenen, atlanan });
});

// ---------- admin ----------
app.get('/api/admin/ayar', girisli, admin, (req, res) => res.json(ayarGetir()));
app.put('/api/admin/ayar', girisli, admin, (req, res) => {
  const { gun, saat, sure, aktif, goster_kom, goster_arama } = req.body;
  if (!Number.isInteger(gun) || gun < 0 || gun > 6 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(saat) || !Number.isInteger(sure) || sure < 5 || sure > 720)
    return hata(res, 400, 'Geçersiz ayar');
  const a = { ...ayarGetir(), gun, saat, sure, aktif: !!aktif, goster_kom: !!goster_kom, goster_arama: !!goster_arama, kapat_bitis: null };
  ayarKaydet(a);
  logYaz(req.user.id, `Yayın ayarı: gün=${gun} saat=${saat} süre=${sure}dk otomatik=${a.aktif ? 'açık' : 'kapalı'} komisyoncu sayısı=${a.goster_kom ? 'göster' : 'gizle'} arama=${a.goster_arama ? 'açık' : 'kapalı'}`);
  res.json(a);
});
app.post('/api/admin/yayin', girisli, admin, (req, res) => {
  const a = ayarGetir();
  if (req.body.ac) {
    a.manuel_bitis = Date.now() + a.sure * 60_000;
    a.kapat_bitis = null;
  } else {
    const p = pencere(a);
    a.manuel_bitis = null;
    a.kapat_bitis = p.acik && !p.manuel ? p.bitis : null;
  }
  ayarKaydet(a);
  logYaz(req.user.id, req.body.ac ? `Manuel yayın başlatıldı (${a.sure} dk)` : 'Yayın manuel kapatıldı');
  res.json(pencere(a));
});
app.get('/api/admin/kullanicilar', girisli, admin, (req, res) =>
  res.json(db.prepare('SELECT id,ad,telefon,rol,durum,olusturma FROM users ORDER BY durum, id').all()));
app.patch('/api/admin/kullanicilar/:id', girisli, admin, (req, res) => {
  if (!['onayli', 'pasif', 'bekliyor'].includes(req.body.durum)) return hata(res, 400, 'Geçersiz durum');
  if (Number(req.params.id) === req.user.id) return hata(res, 400, 'Kendi hesabınızı değiştiremezsiniz');
  const r = db.prepare("UPDATE users SET durum=? WHERE id=? AND rol='kom'").run(req.body.durum, req.params.id);
  if (!r.changes) return hata(res, 404, 'Kullanıcı bulunamadı');
  if (req.body.durum !== 'onayli') db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.params.id);
  logYaz(req.user.id, `Kullanıcı #${req.params.id} durumu: ${req.body.durum}`);
  res.json({ ok: true });
});
app.get('/api/admin/alacak', girisli, admin, (req, res) =>
  res.json(db.prepare('SELECT a.*, u.ad kom_ad FROM alacak a JOIN users u ON u.id=a.kom_id ORDER BY a.id DESC').all()));
app.get('/api/admin/log', girisli, admin, (req, res) =>
  res.json(db.prepare('SELECT l.zaman, u.ad, l.islem FROM log l LEFT JOIN users u ON u.id=l.user_id ORDER BY l.id DESC LIMIT 500').all()));

app.use('/api', (req, res) => hata(res, 404, 'Bulunamadı'));
app.use((err, req, res, next) => { console.error(err); hata(res, 500, 'Sunucu hatası'); });

setInterval(() => db.prepare('DELETE FROM sessions WHERE bitis<?').run(Date.now()), 3600_000).unref();

if (process.env.NODE_ENV !== 'test') app.listen(PORT, () => console.log(`Halder çalışıyor: http://localhost:${PORT}`));
export default app;
