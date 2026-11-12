// Yayın penceresi hesabı. Türkiye saati sabit UTC+3 (2016'dan beri yaz saati yok).
const OFF = 3 * 3600_000;
const GUN = 86_400_000;

/**
 * @returns {{acik:boolean, bitis?:number, sonraki?:number|null, manuel?:boolean}}
 */
export function pencere(a, now = Date.now()) {
  if (a.manuel_bitis && a.manuel_bitis > now) return { acik: true, bitis: a.manuel_bitis, manuel: true };
  if (!a.aktif) return { acik: false, sonraki: null };

  const [h, m] = a.saat.split(':').map(Number);
  const ist = new Date(now + OFF);
  const fark = (a.gun - ist.getUTCDay() + 7) % 7;
  let bas = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), h, m) - OFF + fark * GUN;
  const sure = a.sure * 60_000;

  for (const b of [bas - 7 * GUN, bas]) {
    if (now >= b && now < b + sure) {
      // Admin bu pencereyi elle kapattıysa kapalı say.
      if (a.kapat_bitis && a.kapat_bitis >= b + sure) break;
      return { acik: true, bitis: b + sure };
    }
  }
  if (now >= bas) bas += 7 * GUN;
  return { acik: false, sonraki: bas };
}
