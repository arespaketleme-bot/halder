// Veritabanı katmanı.
// DATABASE_URL tanımlıysa PostgreSQL (Supabase), değilse yerel geliştirme için SQLite.
// Sorgular "?" yer tutucusuyla yazılır; PostgreSQL için $1, $2... çevrilir.
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PG = !!process.env.DATABASE_URL;
let exec, tx;

if (PG) {
  const { default: pg } = await import('pg');
  pg.types.setTypeParser(20, Number);   // bigint (COUNT, BIGINT kolonlar)
  pg.types.setTypeParser(1700, Number); // numeric (SUM)
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false },
    max: 5,
  });
  const pgSql = s => { let i = 0; return s.replace(/\?/g, () => '$' + ++i); };
  const calistir = async (c, sql, p = []) => { const r = await c.query(pgSql(sql), p); return { rows: r.rows, changes: r.rowCount }; };
  exec = (sql, p) => calistir(pool, sql, p);
  tx = async fn => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const sonuc = await fn((sql, p) => calistir(c, sql, p));
      await c.query('COMMIT');
      return sonuc;
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  };
} else {
  const { DatabaseSync } = await import('node:sqlite');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const file = process.env.DB_FILE || join(root, 'data', 'halder.db');
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const sq = new DatabaseSync(file);
  sq.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  exec = async (sql, p = []) => {
    const st = sq.prepare(sql);
    if (/^\s*(select|with)\b/i.test(sql) || /\breturning\b/i.test(sql)) { const rows = st.all(...p); return { rows, changes: rows.length }; }
    const r = st.run(...p);
    return { rows: [], changes: Number(r.changes) };
  };
  tx = async fn => {
    sq.exec('BEGIN');
    try { const s = await fn(exec); sq.exec('COMMIT'); return s; } catch (e) { sq.exec('ROLLBACK'); throw e; }
  };
  exec.__sqlite = sq;
}

export const run = (sql, p) => exec(sql, p);
export const all = async (sql, p) => (await exec(sql, p)).rows;
export const get = async (sql, p) => (await exec(sql, p)).rows[0];
export { tx };

const ID = PG ? 'BIGSERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY';
const ZAMAN = PG ? 'TIMESTAMPTZ NOT NULL DEFAULT now()' : "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP";
const REF = PG ? 'BIGINT' : 'INTEGER';
const SEMA = `
CREATE TABLE IF NOT EXISTS halder_users (
  id ${ID},
  ad TEXT NOT NULL,
  telefon TEXT NOT NULL UNIQUE,
  sifre_hash TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('admin','kom')),
  durum TEXT NOT NULL DEFAULT 'bekliyor' CHECK (durum IN ('bekliyor','onayli','pasif')),
  olusturma ${ZAMAN}
);
CREATE TABLE IF NOT EXISTS halder_sessions (
  token TEXT PRIMARY KEY,
  user_id ${REF} NOT NULL REFERENCES halder_users(id) ON DELETE CASCADE,
  bitis BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS halder_alacak (
  id ${ID},
  kom_id ${REF} NOT NULL REFERENCES halder_users(id),
  tuccar TEXT NOT NULL,
  tuccar_key TEXT NOT NULL,
  tutar_kurus BIGINT NOT NULL CHECK (tutar_kurus > 0),
  aciklama TEXT,
  durum TEXT NOT NULL DEFAULT 'acik' CHECK (durum IN ('acik','kismi','tahsil')),
  olusturma ${ZAMAN},
  guncelleme ${ZAMAN}
);
CREATE INDEX IF NOT EXISTS halder_alacak_key ON halder_alacak(tuccar_key);
CREATE INDEX IF NOT EXISTS halder_alacak_kom ON halder_alacak(kom_id);
CREATE TABLE IF NOT EXISTS halder_ayar (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS halder_log (
  id ${ID},
  zaman ${ZAMAN},
  user_id ${REF},
  islem TEXT NOT NULL
);`;

// Supabase'de tablolar public şemada; Data API (anon/authenticated) erişemesin diye RLS açılır.
// Halder sunucusu tablo sahibi olarak doğrudan bağlandığı için RLS'ten etkilenmez.
const RLS = ['halder_users', 'halder_sessions', 'halder_alacak', 'halder_ayar', 'halder_log']
  .map(t => `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`).join('\n') + `
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON halder_users, halder_sessions, halder_alacak, halder_ayar, halder_log FROM anon, authenticated;
  END IF;
END $$;`;

// Demo kayıtları "demo" sütunuyla işaretlenir; demo ve gerçek veriler birbirini görmez.
async function demoKolonu(tablo) {
  try { await exec(`ALTER TABLE ${tablo} ADD COLUMN ${PG ? 'IF NOT EXISTS ' : ''}demo BOOLEAN NOT NULL DEFAULT FALSE`); }
  catch (e) { if (!/duplicate column/i.test(e.message)) throw e; }
}

export async function init() {
  if (PG) { await exec(SEMA); await exec(RLS); } else exec.__sqlite.exec(SEMA);
  await demoKolonu('halder_users');
  await demoKolonu('halder_alacak');
  // Admin hesabı ortam değişkenlerinden yönetilir: ADMIN_TELEFON'lu admin yoksa oluşturulur,
  // varsa ve şifresi farklıysa ADMIN_SIFRE ile eşitlenir (şifreyi Render'dan değiştirmek yeter).
  const { ADMIN_TELEFON, ADMIN_SIFRE, ADMIN_AD } = process.env;
  if (ADMIN_TELEFON && ADMIN_SIFRE) {
    const tel = ADMIN_TELEFON.replace(/\D/g, '').replace(/^90/, '').replace(/^(?!0)/, '0');
    const mevcut = await get('SELECT id, rol, sifre_hash, demo FROM halder_users WHERE telefon=?', [tel]);
    if (!mevcut) {
      await run("INSERT INTO halder_users(ad,telefon,sifre_hash,rol,durum) VALUES (?,?,?,'admin','onayli')",
        [ADMIN_AD || 'Admin', tel, hashle(ADMIN_SIFRE)]);
      console.log('Admin hesabı oluşturuldu.');
    } else if (mevcut.rol === 'admin' && !mevcut.demo) {
      if (!dogrula(ADMIN_SIFRE, mevcut.sifre_hash)) {
        await run("UPDATE halder_users SET sifre_hash=?, durum='onayli' WHERE id=?", [hashle(ADMIN_SIFRE), mevcut.id]);
        await run('DELETE FROM halder_sessions WHERE user_id=?', [mevcut.id]);
        console.log('Admin şifresi ADMIN_SIFRE ile eşitlendi.');
      }
    } else {
      console.error('ADMIN_TELEFON bir komisyoncu ya da demo hesabına ait; admin yapılmadı.');
    }
  }
}

// Demo hesapları ve demo alacaklarını yükler (zaten varsa dokunmaz).
export async function demoYukle() {
  const { DEMO_HESAPLAR, DEMO_TUCCARLAR } = await import('./seed-data.js');
  for (const u of DEMO_HESAPLAR)
    await run('INSERT INTO halder_users(ad,telefon,sifre_hash,rol,durum,demo) VALUES (?,?,?,?,?,TRUE) ON CONFLICT (telefon) DO NOTHING',
      [u.ad, u.telefon, hashle(u.sifre), u.rol, u.durum]);
  if ((await get('SELECT COUNT(*) n FROM halder_alacak WHERE demo=TRUE')).n) return;
  const komlar = (await all("SELECT id FROM halder_users WHERE rol='kom' AND durum='onayli' AND demo=TRUE ORDER BY id")).map(r => r.id);
  if (!komlar.length) return;
  const ekle = (kid, ad, kurus, durum) => run(
    'INSERT INTO halder_alacak(kom_id,tuccar,tuccar_key,tutar_kurus,durum,demo) VALUES (?,?,?,?,?,TRUE)',
    [kid, ad, ad.toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim(), kurus, durum]);
  // Sabit tohumlu basit rastgele sayı üreteci: her yüklemede aynı veri.
  let s = 42;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (const [ti, [ad, hedef]] of DEMO_TUCCARLAR.entries()) {
    const n = 1 + Math.floor(rnd() * 6);
    const secilen = [...komlar].sort(() => rnd() - 0.5).slice(0, n);
    const paylar = secilen.map(() => 0.5 + rnd());
    const top = paylar.reduce((x, y) => x + y, 0);
    for (const [i, kid] of secilen.entries()) await ekle(kid, ad, Math.round((hedef * paylar[i]) / top / 100) * 100 * 100, 'acik');
    if (ti % 4 === 0) await ekle(secilen[0], ad, 150_000 * 100, 'tahsil');
  }
}

const VARSAYILAN = { gun: 6, saat: '10:00', sure: 60, aktif: true, goster_kom: true, goster_arama: true, demo_modu: false, manuel_bitis: null, kapat_bitis: null };

export async function ayarGetir() {
  const row = await get("SELECT v FROM halder_ayar WHERE k='yayin'");
  return { ...VARSAYILAN, ...(row ? JSON.parse(row.v) : {}) };
}
export async function ayarKaydet(a) {
  await run("INSERT INTO halder_ayar(k,v) VALUES('yayin',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", [JSON.stringify(a)]);
}

export function hashle(sifre) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(sifre, salt, 64).toString('hex');
}
export function dogrula(sifre, kayitli) {
  const [salt, h] = kayitli.split(':');
  const a = Buffer.from(h, 'hex');
  const b = scryptSync(sifre, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function logYaz(userId, islem) {
  await run('INSERT INTO halder_log(user_id, islem) VALUES (?, ?)', [userId ?? null, islem]);
}
