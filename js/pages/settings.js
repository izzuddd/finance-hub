// Pengaturan: Google Sheets sync, import/export, accounts, categories, pockets, parameters.
import * as db from '../db.js';
import * as M from '../model.js';
import * as sync from '../sync.js';
import { CONFIG } from '../config.js';
import { esc, fmtIDR, uid, setCycleStartDay } from '../util.js';
import { $, toast, openModal, card, row, empty } from '../ui.js';

export function render(el, S) {
  const s = sync.getStatus();
  const last = db.getMeta().lastSync;
  let h = card('Google Sheets', `
    <div class="syncbox ${s.state}"><b>${esc(s.msg)}</b>${last ? `<div class="m">Terakhir sinkron ${new Date(last).toLocaleString('id-ID')}</div>` : ''}
    <div class="m">${db.dirtyCount()} perubahan menunggu dikirim</div></div>
    ${sync.isConnected() ? `<div class="flex2"><button class="btn small" id="syncNow">Sinkron sekarang</button><a class="btn small ghost" href="${sync.sheetUrl()}" target="_blank" rel="noopener">Buka spreadsheet</a></div>
      <div class="m" style="margin:6px 0">Spreadsheet ID: <code>…${esc(sync.spreadsheetId().slice(-6))}</code> — harus sama di laptop & HP.</div>
      <div class="flex2"><button class="btn small ghost" id="swap">Pakai spreadsheet lain…</button><button class="btn small ghost" id="disc">Putuskan perangkat ini</button></div>`
      : `<button class="btn" id="conn">Hubungkan Google Sheets</button>`}
    <label>Google OAuth Client ID</label><input id="cid" value="${esc(sync.clientId())}" placeholder="xxxx.apps.googleusercontent.com">
    <div class="note">Lihat SETUP.md langkah 2. Disimpan di perangkat ini saja${CONFIG.GOOGLE_CLIENT_ID ? ' (default dari config.js sudah terisi)' : ''}. Data selalu tersimpan di perangkat dulu — app tetap jalan offline, lalu sinkron otomatis.</div>
    <div class="note">Untuk app di layar utama HP (iPhone), login Google memakai <i>redirect</i>. Daftarkan alamat ini di Google Cloud → Client ID → <b>Authorized redirect URIs</b>: <code style="user-select:all">${esc(sync.redirectUri())}</code></div>`);
  const B = sync.bridge();
  h += card('Sinkron tanpa login (disarankan untuk iPhone)', B ? `
    <div class="note">Aktif — perangkat tepercaya, tidak perlu login Google. ${sync.bridgeMode() === 'direct'
      ? 'Mode cepat: data langsung ke Google Sheets API.'
      : 'Mode lambat (lewat skrip, ±2-4 dtk). Untuk mode cepat: perbarui skrip ke versi terbaru + Services → tambah Google Sheets API, deploy New version, lalu Matikan & Aktifkan lagi di sini.'}</div>
    <button class="btn small ghost" id="brOff">Matikan (kembali ke login Google)</button>` : `
    <div class="note">Login Google di app layar utama iPhone sering tidak kembali ke app dan sesinya habis tiap 1 jam. Dengan Apps Script kecil di spreadsheet-mu, sinkron jalan terus tanpa login. Cara pasang: SETUP.md → "Sinkron tanpa login".</div>
    <label>URL Web app Apps Script (…/exec)</label><input id="brUrl" placeholder="https://script.google.com/macros/s/…/exec">
    <label>Kunci (sama dengan KEY di skrip)</label><input id="brKey" placeholder="minimal 16 karakter">
    <div class="flex2"><button class="btn small ghost" id="brGen">Buat kunci acak</button><button class="btn small" id="brOn">Aktifkan</button></div>`);
  h += card('Cadangan & impor', `<div class="flex2"><button class="btn small ghost" id="exp">⬇ Ekspor cadangan (JSON)</button><label class="btn small ghost filebtn">⬆ Impor JSON<input type="file" id="imp" accept=".json,application/json"></label></div>
    <div class="note">Impor = pindahan dari spreadsheet lama (file dari tools/migrate_to_hub.py) atau cadangan. Isi di perangkat ini diganti, lalu dikirim ke Google Sheets kalau terhubung.</div>`);
  h += card('Akun / rekening', M.accounts().map((a) => row(esc(a.name), `${a.currency} · ${esc(a.kind)}${a.usable === 0 ? ' · tabungan' : ''}`, `<button class="edit-ico" data-acc="${a.id}">✎</button>`)).join('') + '<button class="btn small ghost" id="addAcc">+ akun</button>');
  h += card('Kategori', M.categories().map((c) => row(esc(c.name), esc(c.group), `<button class="edit-ico" data-cat="${c.id}">✎</button>`)).join('') + '<button class="btn small ghost" id="addCat">+ kategori</button>');
  h += card('Kantong tabungan', M.pocketsList().map((p) => row(esc(p.name), '', `<button class="edit-ico" data-pk="${p.id}">✎</button>`)).join('') + '<button class="btn small ghost" id="addPk">+ kantong</button>');
  const P = db.setting('incomeSim', {});
  h += card('Parameter', row('Siklus mulai tanggal', 'gaji pertama', String(db.setting('cycleStartDay', 15))) + row('Simulasi gaji', `pokok ${fmtIDR(P.basicBase)} · MA ${fmtIDR(P.ma)} · PA ${fmtIDR(P.pa)} · lunch $${P.usdPerDay}/hari`, '') +
    row('Endpoint harga emas', db.setting('goldEndpoint', '') ? 'terisi' : 'kosong (isi manual)', '') + row('Horizon rencana', '', esc(db.setting('planHorizon', '2030-12'))) +
    '<button class="btn small ghost" id="params">Ubah parameter</button>');
  h += card('Tentang', `<div class="note">Izud Finance Hub v${CONFIG.APP_VERSION} · local-first PWA. Semua data di perangkat (IndexedDB) + 1 Google Sheet. <br><button class="btn small ghost danger" id="wipe">Hapus data di perangkat ini</button></div>`);
  el.innerHTML = h;
  const on = (id, fn) => { const n = $(id); if (n) n.onclick = fn; };
  $('cid').onchange = () => { localStorage.setItem('hub.clientId', $('cid').value.trim()); toast('Client ID disimpan'); };
  on('conn', async () => { localStorage.setItem('hub.clientId', $('cid').value.trim()); try { await sync.connect(); toast('Terhubung & tersinkron ✓'); } catch (e) { toast(e.message, 5000); } render(el, S); });
  on('syncNow', async () => { try { await sync.syncNow({ interactive: true }); toast('Tersinkron ✓'); } catch (e) { toast(e.message, 5000); } render(el, S); });
  on('brGen', () => {
    const k = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');
    $('brKey').value = k;
    navigator.clipboard?.writeText(k).then(() => toast('Kunci disalin — tempel ke KEY di skrip'), () => {});
  });
  on('brOn', async () => {
    try { await sync.enableBridge($('brUrl').value, $('brKey').value); toast('Sinkron tanpa login aktif ✓'); } catch (e) { toast(e.message, 6000); }
    render(el, S);
  });
  on('brOff', async () => { await sync.disableBridge(); toast('Mode Apps Script dimatikan'); render(el, S); });
  on('swap', async () => {
    const v = prompt('Tempel link spreadsheet "Izud Finance Hub" yang dipakai perangkat lain (dari tombol "Buka spreadsheet" di sana):');
    if (!v) return;
    try { await sync.useSheet(v); toast('Tersambung ke spreadsheet itu ✓'); } catch (e) { toast(e.message, 5000); } render(el, S);
  });
  on('disc', async () => { if (confirm('Putuskan Google Sheets di perangkat ini? Data lokal tetap ada.')) { await sync.disconnect(); render(el, S); } });
  on('exp', () => {
    const blob = new Blob([JSON.stringify(db.exportAll())], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'finance-hub-backup-' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
  });
  $('imp').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { await importJSON(JSON.parse(await f.text())); toast('Impor selesai ✓'); render(el, S); } catch (err) { toast('Impor gagal: ' + err.message, 5000); }
  };
  on('wipe', async () => { if (confirm('Hapus SEMUA data di perangkat ini? (Google Sheet tidak ikut terhapus)')) { await db.wipe(); location.reload(); } });
  el.querySelectorAll('[data-acc]').forEach((n) => (n.onclick = () => editAccount(n.dataset.acc)));
  el.querySelectorAll('[data-cat]').forEach((n) => (n.onclick = () => editCategory(n.dataset.cat)));
  el.querySelectorAll('[data-pk]').forEach((n) => (n.onclick = () => editPocket(n.dataset.pk)));
  on('addAcc', () => editAccount(null)); on('addCat', () => editCategory(null)); on('addPk', () => editPocket(null)); on('params', editParams);
}
export async function importJSON(data) {
  if (!data || data.format !== 'finance-hub' || !data.tables) throw new Error('bukan file Finance Hub');
  if (data.merge) { // add-on file (e.g. a leave schedule): adds/updates these rows only, keeps everything else
    const n = Object.values(data.tables).reduce((a, rows) => a + rows.length, 0);
    const nd = Object.values(data.deletes || {}).reduce((a, ids) => a + ids.length, 0);
    if (!confirm(`Terapkan ${n} baris${nd ? ` & hapus ${nd} baris` : ''} dari file ini${data.title ? ' (' + data.title + ')' : ''}? Data lain tidak diubah.`)) throw new Error('dibatalkan');
    for (const [t, rows] of Object.entries(data.tables)) if (db.TABLES.includes(t) && rows.length) db.putMany(t, rows);
    for (const [t, ids] of Object.entries(data.deletes || {})) if (db.TABLES.includes(t)) ids.forEach((id) => db.del(t, id));
    return;
  }
  if (db.all('transactions').length && !confirm(`Ganti data di perangkat ini dengan isi file (${(data.tables.transactions || []).length} transaksi)?`)) throw new Error('dibatalkan');
  await db.replaceAll(data.tables);
  setCycleStartDay(db.setting('cycleStartDay', 15));
  if (sync.isConnected()) sync.syncNow().catch(() => {});
}
function editAccount(id) {
  const a = id ? db.get('accounts', id) : { id: uid('acc-'), name: '', currency: 'IDR', kind: 'bank', usable: 1, order: M.accounts().length, active: 1 };
  openModal({ title: id ? a.name : 'Akun baru', sub: id ? 'Mengganti nama tidak mengubah transaksi lama — pakai nama yang sama persis.' : '',
    fields: [{ k: 'name', label: 'Nama', type: 'text', value: a.name }, { k: 'currency', label: 'Mata uang', type: 'select', options: [['IDR', 'IDR'], ['TRY', 'TL (TRY)']], value: a.currency },
      { k: 'kind', label: 'Jenis', type: 'select', options: [['bank', 'Bank'], ['cash', 'Tunai'], ['ewallet', 'E-wallet'], ['investment', 'Investasi']], value: a.kind },
      { k: 'usable', label: 'Uang bisa dipakai harian (bukan tabungan)', type: 'check', value: a.usable !== 0 }, { k: 'order', label: 'Urutan', type: 'number', value: a.order },
      { k: 'active', label: 'Aktif', type: 'check', value: a.active !== 0 }],
    onSave: (v) => { if (!v.name) throw new Error('Isi nama'); db.put('accounts', { ...a, ...v, usable: v.usable ? 1 : 0, active: v.active ? 1 : 0 }); } });
}
function editCategory(id) {
  const c = id ? db.get('categories', id) : { id: uid('cat-'), name: '', group: 'Needs', order: M.categories().length, active: 1 };
  openModal({ title: id ? c.name : 'Kategori baru', fields: [{ k: 'name', label: 'Nama (mis. Needs - Food)', type: 'text', value: c.name },
    { k: 'group', label: 'Komponen', type: 'select', options: ['Needs', 'Wants', 'Invest', 'Giving', 'Saving', 'Loan', 'Income', 'Pulkam', 'Transfer'], value: c.group },
    { k: 'order', label: 'Urutan', type: 'number', value: c.order }, { k: 'active', label: 'Aktif', type: 'check', value: c.active !== 0 }],
    onSave: (v) => { if (!v.name) throw new Error('Isi nama'); db.put('categories', { ...c, ...v, active: v.active ? 1 : 0 }); } });
}
function editPocket(id) {
  const p = id ? db.get('pockets', id) : { id: uid('pk-'), name: '', order: M.pocketsList().length, goal: 0, monthly: 0, calOri: 0, calJmo: 0, calLiquid: 0, calDate: '', tuitionTL: 0, tuitionRate: 0, active: 1 };
  openModal({ title: id ? p.name : 'Kantong baru', fields: [{ k: 'name', label: 'Nama', type: 'text', value: p.name }, { k: 'order', label: 'Urutan', type: 'number', value: p.order },
    { k: 'active', label: 'Aktif', type: 'check', value: p.active !== 0 }],
    onSave: (v) => { if (!v.name) throw new Error('Isi nama'); db.put('pockets', { ...p, ...v, active: v.active ? 1 : 0 }); } });
}
function editParams() {
  const P = db.setting('incomeSim', {});
  openModal({ title: 'Parameter', fields: [
    { k: 'csd', label: 'Siklus mulai tanggal', type: 'number', value: db.setting('cycleStartDay', 15) },
    { k: 'basicBase', label: 'Gaji pokok', type: 'money', value: P.basicBase }, { k: 'ma', label: 'Meal allowance / bln', type: 'money', value: P.ma },
    { k: 'pa', label: 'Prolong allowance / bln', type: 'money', value: P.pa }, { k: 'usdPerDay', label: 'Lunch USD / hari kerja', type: 'number', value: P.usdPerDay },
    { k: 'usdRate', label: 'Kurs USD/IDR default', type: 'number', value: P.usdRate }, { k: 'jht', label: 'JHT karyawan (desimal)', type: 'number', value: P.jht },
    { k: 'jp', label: 'JP karyawan (IDR)', type: 'money', value: P.jp }, { k: 'health', label: 'BPJS Kesehatan (IDR)', type: 'money', value: P.health }, { k: 'jkk', label: 'JKK+JKM+BPJS perusahaan (IDR)', type: 'money', value: P.jkk },
    { k: 'gold', label: 'Endpoint harga emas (opsional)', type: 'text', value: db.setting('goldEndpoint', '') },
    { k: 'horizon', label: 'Horizon rencana', type: 'month', value: db.setting('planHorizon', '2030-12') }],
    onSave: (v) => {
      db.setSetting('cycleStartDay', v.csd || 15); setCycleStartDay(v.csd || 15);
      db.setSetting('incomeSim', { ...P, basicBase: v.basicBase, ma: v.ma, pa: v.pa, usdPerDay: v.usdPerDay, usdRate: v.usdRate, jht: v.jht, jp: v.jp, health: v.health, jkk: v.jkk });
      db.setSetting('goldEndpoint', v.gold.trim()); db.setSetting('planHorizon', v.horizon || '2030-12'); toast('Tersimpan ✓');
    } });
}
