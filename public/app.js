'use strict';
const DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const tl = k => (k / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
const tarih = ms => new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' });

async function api(yol, { method = 'GET', body, raw } = {}) {
  const h = { 'X-Halder': '1' };
  if (body !== undefined && !raw) h['Content-Type'] = 'application/json';
  const r = await fetch('/api' + yol, { method, headers: h, body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined });
  const d = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  if (r.status === 401 && yol !== '/giris') { ben = null; ciz(); }
  if (!r.ok) throw new Error(d?.hata || 'Hata ' + r.status);
  return d;
}

let ben = null, tab = null, durum = null, saatFark = 0;
const kisa = n => n >= 1e6 ? (n / 1e6).toLocaleString('tr-TR') + ' milyon' : n.toLocaleString('tr-TR');
const seviyeAd = (S, i) => i === 0 ? `0 – ${kisa(S[0])} ₺` : i >= S.length ? `${kisa(S[S.length - 1])} ₺ ve üzeri` : `${kisa(S[i - 1])} – ${kisa(S[i])} ₺`;
const lejant = S => `<div class="lejant">${[...S, 0].map((_, i) => `<span><i class="sev s${i}"></i>${seviyeAd(S, i)}</span>`).join('')}</div>`;
const durumP = d => d === 'acik' ? '<span class="pill r">Açık</span>' : d === 'kismi' ? '<span class="pill w">Kısmi</span>' : '<span class="pill">Tahsil edildi</span>';

async function basla() {
  try { ben = await api('/ben'); } catch { ben = null; }
  ciz();
}

function ciz() {
  $('#kim').innerHTML = ben ? `${esc(ben.ad)} <button onclick="cikis()">Çıkış</button>` : '';
  if (!ben) { $('#nav').innerHTML = ''; $('#banner').hidden = true; return girisEkrani(); }
  const tabs = ben.rol === 'admin'
    ? [['yayin', 'Yayın Listesi'], ['ayar', 'Yayın Ayarları'], ['kullanici', 'Kullanıcılar'], ['tum', 'Tüm Kayıtlar'], ['log', 'İşlem Geçmişi']]
    : [['kayit', 'Alacaklarım'], ['yukle', 'Excel Yükle'], ['yayin', 'Yayın Listesi']];
  if (!tabs.some(t => t[0] === tab)) tab = tabs[0][0];
  $('#nav').innerHTML = tabs.map(t => `<button class="${t[0] === tab ? 'on' : ''}" data-t="${t[0]}">${t[1]}</button>`).join('');
  $('#nav').onclick = e => { if (e.target.dataset.t) { tab = e.target.dataset.t; ciz(); } };
  durumYenile();
  V[tab]().catch(e => ($('#view').innerHTML = `<div class="card err">${esc(e.message)}</div>`));
}

async function durumYenile() {
  try { durum = await api('/yayin/durum'); saatFark = durum.simdi - Date.now(); } catch { return; }
  bannerCiz();
}
function bannerCiz() {
  const b = $('#banner'); if (!durum || !ben) return;
  b.hidden = false;
  if (durum.acik) {
    const k = Math.max(0, durum.bitis - (Date.now() + saatFark));
    if (k === 0) { durumYenile(); if (tab === 'yayin') ciz(); }
    const mm = Math.floor(k / 60000), ss = Math.floor(k % 60000 / 1000);
    b.className = 'banner on';
    b.innerHTML = `🟢 Liste YAYINDA — kapanmasına: <span class="cd">${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}</span>`;
  } else {
    b.className = 'banner off';
    b.textContent = durum.sonraki ? `🔒 Liste kapalı. Sonraki yayın: ${tarih(durum.sonraki)}` : '🔒 Otomatik yayın admin tarafından durduruldu.';
  }
}
setInterval(bannerCiz, 1000);
setInterval(durumYenile, 30000);

function girisEkrani(kayit = false) {
  $('#view').innerHTML = `<div class="card narrow stack"><h2>${kayit ? 'Komisyoncu kaydı' : 'Giriş'}</h2>
    ${kayit ? '<div><label>Firma / ad soyad</label><input id="g_ad"></div>' : ''}
    <div><label>Cep telefonu</label><input id="g_tel" inputmode="tel" placeholder="05xx xxx xx xx"></div>
    <div><label>Şifre${kayit ? ' (en az 8 karakter)' : ''}</label><input id="g_sifre" type="password"></div>
    <p id="g_msg" class="err"></p>
    <button class="btn p" id="g_btn">${kayit ? 'Kayıt ol' : 'Giriş yap'}</button>
    ${kayit ? '' : '<div id="g_demo"></div>'}
    <p class="mut"><a href="#" id="g_sw">${kayit ? 'Hesabım var, giriş yap' : 'Hesabım yok, kayıt ol'}</a></p></div>`;
  if (!kayit) fetch('/api/dev/demo').then(r => r.ok ? r.json() : []).then(L => {
    if (!L.length) return;
    $('#g_demo').innerHTML = '<p class="mut">Demo hesaplar (sadece geliştirme):</p><div class="row">' +
      L.map((u, i) => `<button class="btn" data-i="${i}">${esc(u.ad)}${u.durum !== 'onayli' ? ' (onaysız)' : ''}</button>`).join('') + '</div>';
    $('#g_demo').onclick = e => { const u = L[e.target.dataset.i]; if (u) { $('#g_tel').value = u.telefon; $('#g_sifre').value = u.sifre; } };
  }).catch(() => {});
  $('#g_sw').onclick = e => { e.preventDefault(); girisEkrani(!kayit); };
  const gonder = async () => {
    try {
      if (kayit) {
        const r = await api('/kayit', { method: 'POST', body: { ad: $('#g_ad').value, telefon: $('#g_tel').value, sifre: $('#g_sifre').value } });
        girisEkrani(false); $('#g_msg').className = 'ok'; $('#g_msg').textContent = r.mesaj;
      } else {
        await api('/giris', { method: 'POST', body: { telefon: $('#g_tel').value, sifre: $('#g_sifre').value } });
        basla();
      }
    } catch (e) { $('#g_msg').className = 'err'; $('#g_msg').textContent = e.message; }
  };
  $('#g_btn').onclick = gonder;
  $('#g_sifre').onkeydown = e => e.key === 'Enter' && gonder();
}
async function cikis() { await api('/cikis', { method: 'POST', body: {} }); ben = null; ciz(); }

const V = {
  async kayit() {
    const L = await api('/alacak');
    const top = L.filter(k => k.durum !== 'tahsil').reduce((a, k) => a + k.tutar_kurus, 0);
    $('#view').innerHTML = `<div class="card"><h2>Yeni alacak ekle</h2><div class="grid">
      <div><label>Tüccar adı *</label><input id="f_t"></div><div><label>Tutar (₺) *</label><input id="f_a" inputmode="decimal" placeholder="15000,50"></div>
      <div><label>Açıklama</label><input id="f_n"></div></div>
      <p id="f_e" class="err"></p><button class="btn p" id="f_btn">Kaydet</button></div>
      <div class="card"><h2>Alacaklarım — açık toplam ${tl(top)}</h2><div class="tw"><table>
      <tr><th>Tüccar</th><th>Tutar</th><th>Durum</th><th></th></tr>
      ${L.map(k => `<tr><td>${esc(k.tuccar)}${k.aciklama ? `<div class="mut">${esc(k.aciklama)}</div>` : ''}</td><td>${tl(k.tutar_kurus)}</td><td>${durumP(k.durum)}</td>
        <td><select data-id="${k.id}" class="dsel" style="width:auto"><option value="">Değiştir…</option><option value="acik">Açık</option><option value="kismi">Kısmi</option><option value="tahsil">Tahsil edildi</option></select>
        <button class="btn d" data-sil="${k.id}">Sil</button></td></tr>`).join('') || '<tr><td colspan=4 class="mut">Kayıt yok</td></tr>'}
      </table></div></div>`;
    $('#f_btn').onclick = async () => {
      try {
        await api('/alacak', { method: 'POST', body: { tuccar: $('#f_t').value, tutar: $('#f_a').value, aciklama: $('#f_n').value } });
        ciz();
      } catch (e) { $('#f_e').textContent = e.message; }
    };
    document.querySelectorAll('.dsel').forEach(s => (s.onchange = async () => { if (s.value) { await api('/alacak/' + s.dataset.id, { method: 'PATCH', body: { durum: s.value } }); ciz(); } }));
    document.querySelectorAll('[data-sil]').forEach(b => (b.onclick = async () => { if (confirm('Kayıt silinsin mi?')) { await api('/alacak/' + b.dataset.sil, { method: 'DELETE', body: {} }); ciz(); } }));
  },

  async yukle() {
    $('#view').innerHTML = `<div class="card"><h2>Excel'den toplu yükleme</h2>
      <p class="mut">Sütunlar: <b>Tüccar, Tutar, Açıklama</b>. Önce şablonu indirip doldurun.</p>
      <div class="row"><a class="btn" href="/api/excel/sablon">📄 Şablonu indir</a><input type="file" id="x_f" accept=".xlsx" style="width:auto"></div>
      <p id="x_e" class="err"></p><div id="onizle"></div></div>`;
    $('#x_f').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      $('#x_e').textContent = '';
      try {
        const { satirlar } = await api('/excel/onizle', { method: 'POST', body: f, raw: true });
        const gecerli = satirlar.filter(r => !r.hatalar.length);
        $('#onizle').innerHTML = `<h2 style="margin-top:16px">Önizleme: ${gecerli.length} geçerli / ${satirlar.length - gecerli.length} hatalı</h2>
          <div class="tw"><table><tr><th>Satır</th><th>Tüccar</th><th>Tutar</th><th>Kontrol</th></tr>
          ${satirlar.map(r => `<tr><td>${r.satir}</td><td>${esc(r.tuccar)}</td><td>${r.tutar_kurus > 0 ? tl(r.tutar_kurus) : '-'}</td>
            <td>${r.hatalar.length ? `<span class="err">${esc(r.hatalar.join(', '))}</span>` : '<span class="pill">OK</span>'}</td></tr>`).join('')}</table></div>
          <p><button class="btn p" id="x_ok" ${gecerli.length ? '' : 'disabled'}>Geçerli ${gecerli.length} kaydı içe aktar</button></p>`;
        $('#x_ok').onclick = async () => {
          const r = await api('/excel/aktar', { method: 'POST', body: { satirlar: gecerli } });
          alert(`${r.eklenen} kayıt eklendi${r.atlanan.length ? `, ${r.atlanan.length} atlandı` : ''}.`);
          tab = 'kayit'; ciz();
        };
      } catch (err) { $('#x_e').textContent = err.message; }
    };
  },

  async yayin() {
    let d;
    try { d = await api('/yayin/liste'); }
    catch (e) {
      $('#view').innerHTML = `<div class="card lock"><b>🔒</b>Liste şu an yayında değil.<br>Yalnızca admin tarafından belirlenen yayın saatinde görüntülenebilir.</div>`;
      return;
    }
    $('#view').innerHTML = `<div class="card"><h2>Haftalık veresiye listesi ${!d.acik ? '<span class="pill w">Admin önizleme — yayında değil</span>' : ''}</h2>
      ${d.goster_arama ? '<input id="ara" placeholder="Tüccar ara…" style="margin-bottom:10px">' : ''}
      ${lejant(d.seviyeler)}
      <div class="tw"><table id="yt"></table></div></div>`;
    // sira: null = borca göre (sunucu sırası), 1 = A→Z, -1 = Z→A
    let sira = null, q = '';
    const tablo = () => {
      const L = sira ? [...d.liste].sort((a, b) => sira * a.tuccar.localeCompare(b.tuccar, 'tr')) : d.liste;
      const ok = sira === 1 ? ' ▲' : sira === -1 ? ' ▼' : ' ⇅';
      const sut = d.goster_kom ? 3 : 2;
      const gorunen = L.filter(x => x.tuccar.toLocaleLowerCase('tr').includes(q));
      $('#yt').innerHTML = `<tr><th class="sirala" title="Alfabetik sırala">Tüccar${ok}</th><th>Toplam borç</th>${d.goster_kom ? '<th>Komisyoncu sayısı</th>' : ''}</tr>
        ${gorunen.map(x => `<tr><td>${esc(x.tuccar)}</td><td><span class="sev s${x.seviye}" title="${esc(seviyeAd(d.seviyeler, x.seviye))}"></span></td>${d.goster_kom ? `<td>${x.kom_sayisi}</td>` : ''}</tr>`).join('')
          || `<tr><td colspan=${sut} class="mut">${d.liste.length ? 'Eşleşen tüccar yok' : 'Açık alacak yok'}</td></tr>`}`;
      $('#yt .sirala').onclick = () => { sira = sira === 1 ? -1 : sira === -1 ? null : 1; tablo(); };
    };
    tablo();
    if (d.goster_arama) $('#ara').oninput = e => { q = e.target.value.toLocaleLowerCase('tr').trim(); tablo(); };
  },

  async ayar() {
    const a = await api('/admin/ayar');
    $('#view').innerHTML = `<div class="card"><h2>Yayın ayarları <span class="pill">Sadece admin</span></h2><div class="grid">
      <div><label>Gün</label><select id="a_g">${DAYS.map((d, i) => `<option value="${i}" ${i === a.gun ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
      <div><label>Başlangıç saati (TR)</label><input id="a_s" type="time" value="${esc(a.saat)}"></div>
      <div><label>Süre (dakika)</label><input id="a_d" type="number" min="5" max="720" value="${a.sure}"></div>
      <div><label>Otomatik yayın</label><select id="a_a"><option value="1" ${a.aktif ? 'selected' : ''}>Açık</option><option value="0" ${!a.aktif ? 'selected' : ''}>Kapalı</option></select></div></div>
      <h2 style="margin-top:16px">Yayın listesinde göster</h2>
      <label class="chk"><input type="checkbox" id="a_kom" ${a.goster_kom ? 'checked' : ''}> Komisyoncu sayısı</label>
      <label class="chk"><input type="checkbox" id="a_ara" ${a.goster_arama ? 'checked' : ''}> Tüccar arama kutusu</label>
      <p id="a_m" class="ok"></p><button class="btn p" id="a_k">Kaydet</button></div>
      <div class="card"><h2>Manuel kontrol</h2><div class="row"><button class="btn p" id="a_ac">Şimdi yayınla (${a.sure} dk)</button><button class="btn d" id="a_kp">Yayını hemen kapat</button></div></div>`;
    $('#a_k').onclick = async () => {
      try {
        await api('/admin/ayar', { method: 'PUT', body: { gun: +$('#a_g').value, saat: $('#a_s').value, sure: +$('#a_d').value, aktif: $('#a_a').value === '1', goster_kom: $('#a_kom').checked, goster_arama: $('#a_ara').checked } });
        $('#a_m').className = 'ok'; $('#a_m').textContent = 'Kaydedildi'; durumYenile();
      } catch (e) { $('#a_m').className = 'err'; $('#a_m').textContent = e.message; }
    };
    $('#a_ac').onclick = async () => { await api('/admin/yayin', { method: 'POST', body: { ac: true } }); durumYenile(); };
    $('#a_kp').onclick = async () => { if (confirm('Yayın hemen kapatılsın mı?')) { await api('/admin/yayin', { method: 'POST', body: { ac: false } }); durumYenile(); } };
  },

  async kullanici() {
    const L = await api('/admin/kullanicilar');
    const etiket = { bekliyor: '<span class="pill w">Onay bekliyor</span>', onayli: '<span class="pill">Onaylı</span>', pasif: '<span class="pill r">Pasif</span>' };
    $('#view').innerHTML = `<div class="card"><h2>Kullanıcılar</h2><div class="tw"><table><tr><th>Ad</th><th>Telefon</th><th>Rol</th><th>Durum</th><th></th></tr>
      ${L.map(u => `<tr><td>${esc(u.ad)}</td><td>${esc(u.telefon)}</td><td>${u.rol === 'admin' ? 'Admin' : 'Komisyoncu'}</td><td>${etiket[u.durum]}</td>
        <td>${u.rol === 'kom' ? (u.durum === 'onayli' ? `<button class="btn d" data-u="${u.id}" data-d="pasif">Pasif yap</button>` : `<button class="btn p" data-u="${u.id}" data-d="onayli">Onayla</button>`) : ''}</td></tr>`).join('')}
      </table></div></div>`;
    document.querySelectorAll('[data-u]').forEach(b => (b.onclick = async () => { await api('/admin/kullanicilar/' + b.dataset.u, { method: 'PATCH', body: { durum: b.dataset.d } }); ciz(); }));
  },

  async tum() {
    const L = await api('/admin/alacak');
    $('#view').innerHTML = `<div class="card"><h2>Tüm kayıtlar (${L.length})</h2><div class="tw"><table><tr><th>Komisyoncu</th><th>Tüccar</th><th>Tutar</th><th>Durum</th></tr>
      ${L.map(k => `<tr><td>${esc(k.kom_ad)}</td><td>${esc(k.tuccar)}</td><td>${tl(k.tutar_kurus)}</td><td>${durumP(k.durum)}</td></tr>`).join('')}
      </table></div></div>`;
  },

  async log() {
    const L = await api('/admin/log');
    $('#view').innerHTML = `<div class="card"><h2>İşlem geçmişi</h2><div class="tw"><table><tr><th>Zaman (UTC)</th><th>Kullanıcı</th><th>İşlem</th></tr>
      ${L.map(l => `<tr><td>${esc(l.zaman)}</td><td>${esc(l.ad || '-')}</td><td>${esc(l.islem)}</td></tr>`).join('') || '<tr><td colspan=3 class="mut">Kayıt yok</td></tr>'}
      </table></div></div>`;
  },
};

basla();
