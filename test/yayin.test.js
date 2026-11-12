import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pencere } from '../server/yayin.js';

const A = { gun: 6, saat: '10:00', sure: 60, aktif: true, manuel_bitis: null, kapat_bitis: null };
// 2026-11-14 Cumartesi. 10:00 TR = 07:00 UTC
const t = s => Date.parse(s);

test('cumartesi 10:30 TR açık', () => {
  const p = pencere(A, t('2026-11-14T07:30:00Z'));
  assert.equal(p.acik, true);
  assert.equal(p.bitis, t('2026-11-14T08:00:00Z'));
});
test('cumartesi 09:59 TR kapalı, sonraki aynı gün', () => {
  const p = pencere(A, t('2026-11-14T06:59:00Z'));
  assert.equal(p.acik, false);
  assert.equal(p.sonraki, t('2026-11-14T07:00:00Z'));
});
test('cumartesi 11:00 TR kapalı, sonraki gelecek hafta', () => {
  const p = pencere(A, t('2026-11-14T08:00:00Z'));
  assert.equal(p.acik, false);
  assert.equal(p.sonraki, t('2026-11-21T07:00:00Z'));
});
test('perşembe kapalı', () => {
  assert.equal(pencere(A, t('2026-11-12T07:30:00Z')).acik, false);
});
test('gece yarısını aşan pencere (Cuma 23:30, 60dk) Cumartesi 00:15 açık', () => {
  const a = { ...A, gun: 5, saat: '23:30' };
  assert.equal(pencere(a, t('2026-11-13T21:15:00Z')).acik, true); // Cumartesi 00:15 TR
});
test('otomatik kapalıysa açılmaz', () => {
  assert.equal(pencere({ ...A, aktif: false }, t('2026-11-14T07:30:00Z')).acik, false);
});
test('manuel yayın her zaman açar', () => {
  const now = t('2026-11-12T12:00:00Z');
  assert.equal(pencere({ ...A, aktif: false, manuel_bitis: now + 1000 }, now).acik, true);
});
test('admin pencereyi kapattıysa kapalı', () => {
  assert.equal(pencere({ ...A, kapat_bitis: t('2026-11-14T08:00:00Z') }, t('2026-11-14T07:30:00Z')).acik, false);
});
