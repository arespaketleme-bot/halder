import { DatabaseSync } from 'node:sqlite';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = process.env.DB_FILE || join(root, 'data', 'halder.db');
if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });

export const db = new DatabaseSync(file);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  ad TEXT NOT NULL,
  telefon TEXT NOT NULL UNIQUE,
  sifre_hash TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('admin','kom')),
  durum TEXT NOT NULL DEFAULT 'bekliyor' CHECK (durum IN ('bekliyor','onayli','pasif')),
  olusturma TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bitis INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS alacak (
  id INTEGER PRIMARY KEY,
  kom_id INTEGER NOT NULL REFERENCES users(id),
  tuccar TEXT NOT NULL,
  tuccar_key TEXT NOT NULL,
  tutar_kurus INTEGER NOT NULL CHECK (tutar_kurus > 0),
  aciklama TEXT,
  durum TEXT NOT NULL DEFAULT 'acik' CHECK (durum IN ('acik','kismi','tahsil')),
  olusturma TEXT NOT NULL DEFAULT (datetime('now')),
  guncelleme TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS alacak_key ON alacak(tuccar_key);
CREATE INDEX IF NOT EXISTS alacak_kom ON alacak(kom_id);
CREATE TABLE IF NOT EXISTS ayar (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS log (
  id INTEGER PRIMARY KEY,
  zaman TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER,
  islem TEXT NOT NULL
);
`);

const VARSAYILAN = { gun: 6, saat: '10:00', sure: 60, aktif: true, goster_kom: true, goster_arama: true, manuel_bitis: null, kapat_bitis: null };

export function ayarGetir() {
  const row = db.prepare("SELECT v FROM ayar WHERE k='yayin'").get();
  return { ...VARSAYILAN, ...(row ? JSON.parse(row.v) : {}) };
}
export function ayarKaydet(a) {
  db.prepare("INSERT INTO ayar(k,v) VALUES('yayin',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(JSON.stringify(a));
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

export function logYaz(userId, islem) {
  db.prepare('INSERT INTO log(user_id, islem) VALUES (?, ?)').run(userId ?? null, islem);
}
