// Google Sheets sync. The app never waits on the network: reads/writes hit the local store,
// and this module pushes dirty rows / pulls remote changes in the background.
//
// Auth: Google Identity Services token client, scope drive.file (the app can only see the
// spreadsheet it created — not the rest of your Drive).
import * as db from './db.js';
import { CONFIG } from './config.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const HUB_TITLE = 'Izud Finance Hub';
let token = null, tokenExp = 0, tokenClient = null;
let status = { state: 'local', msg: 'Belum terhubung ke Google Sheets', last: 0 };
const statusListeners = new Set();
export const onStatus = (fn) => { statusListeners.add(fn); fn(status); };
function setStatus(state, msg) {
  status = { state, msg, last: state === 'ok' ? Date.now() : status.last };
  statusListeners.forEach((f) => f(status));
}
export const getStatus = () => status;
export const clientId = () => localStorage.getItem('hub.clientId') || CONFIG.GOOGLE_CLIENT_ID || '';
export const spreadsheetId = () => db.getMeta().spreadsheetId || '';
export const isConnected = () => !!spreadsheetId();

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = res; s.onerror = () => rej(new Error('Tidak bisa memuat Google Sign-In (offline?)'));
    document.head.appendChild(s);
  });
}
const hasToken = () => token && Date.now() < tokenExp - 60000;
async function getToken(interactive) {
  if (hasToken()) return token;
  // background syncs must not open a login popup (browsers block popups without a tap)
  if (!interactive) { const e = new Error('Sesi Google habis — ketuk titik status untuk login & sinkron'); e.auth = true; throw e; }
  if (!clientId()) throw new Error('Google Client ID belum diisi (Pengaturan → Google Sheets)');
  await loadGis();
  return new Promise((res, rej) => {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId(), scope: SCOPE,
      hint: localStorage.getItem('hub.email') || undefined,
      callback: (r) => {
        if (r.error) return rej(new Error(r.error_description || r.error));
        token = r.access_token; tokenExp = Date.now() + (Number(r.expires_in) || 3600) * 1000;
        res(token);
      },
      error_callback: (e) => rej(new Error(e?.message || e?.type || 'login dibatalkan')),
    });
    tokenClient.requestAccessToken({ prompt: interactive && !db.getMeta().consented ? 'consent' : '' });
  });
}
async function api(method, url, body, interactive) {
  const t = await getToken(interactive || interactiveFlag);
  // never hang forever on a stalled connection: give up after 45 s (next sync retries)
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 45000);
  let r;
  try {
    r = await fetch(url, {
      method, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: ctl.signal,
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'Koneksi ke Google terlalu lama (timeout) — coba lagi' : 'Gagal menghubungi Google: ' + e.message);
  } finally { clearTimeout(timer); }
  if (r.status === 401) { token = null; const e = new Error('Sesi Google berakhir — ketuk titik status untuk login lagi'); e.auth = true; throw e; }
  if (!r.ok) throw new Error('Google API ' + r.status + ': ' + (await r.text()).slice(0, 200));
  return r.json();
}
const q = (s) => "'" + s.replace(/'/g, "''") + "'";

// ------------------------------------------------------------ connect / create
export async function connect() {
  setStatus('syncing', 'Menghubungkan ke Google…');
  try { return await connectInner(); } catch (e) {
    // otherwise the dot would stay blue ("syncing") forever after a failed connect
    setStatus(e.auth ? 'auth' : 'error', e.message || String(e));
    throw e;
  }
}
async function connectInner() {
  await getToken(true);
  const meta = db.getMeta();
  meta.consented = true;
  if (!meta.spreadsheetId) {
    const found = await findExisting();
    setStatus('syncing', 'Membuat spreadsheet…');
    if (found) { meta.spreadsheetId = found; meta.rows = {}; await db.saveMeta(); await syncNow({ interactive: true }); return found; }
    const created = await api('POST', API, {
      properties: { title: HUB_TITLE, timeZone: 'Europe/Istanbul' },
      sheets: [{ properties: { title: 'README' } }, { properties: { title: 'RINGKASAN' } },
        ...db.TABLES.map((t) => ({ properties: { title: t, gridProperties: { frozenRowCount: 1 } } }))],
    });
    meta.spreadsheetId = created.spreadsheetId;
    meta.rows = {};
    await db.saveMeta();
    await tagFile(created.spreadsheetId);
    await writeHeaders(db.TABLES);
    await writeReadme();
    db.markAllDirty();
  }
  await db.saveMeta();
  return syncNow({ interactive: true });
}
async function tagFile(id) {
  try { await api('PATCH', `https://www.googleapis.com/drive/v3/files/${id}`, { appProperties: { financeHub: '1' } }); } catch { /* optional */ }
}
async function findExisting() {
  try {
    const qq = encodeURIComponent("appProperties has { key='financeHub' and value='1' } and trashed=false");
    const r = await api('GET', `https://www.googleapis.com/drive/v3/files?q=${qq}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc`);
    return r.files && r.files[0] ? r.files[0].id : null;
  } catch { return null; }
}
export async function disconnect() {
  const meta = db.getMeta();
  delete meta.spreadsheetId; delete meta.rows; delete meta.headers;
  await db.saveMeta();
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
  token = null;
  setStatus('local', 'Terputus — data tetap ada di perangkat ini');
}
async function writeHeaders(tables) {
  const meta = db.getMeta();
  meta.headers = meta.headers || {};
  await api('POST', `${API}/${spreadsheetId()}/values:batchUpdate`, {
    valueInputOption: 'RAW',
    data: tables.map((t) => ({ range: `${q(t)}!A1`, values: [db.SCHEMA[t].concat(db.META_COLS)] })),
  });
  tables.forEach((t) => { meta.headers[t] = db.SCHEMA[t].concat(db.META_COLS); });
}
async function writeReadme() {
  const lines = [
    ['Izud Finance Hub — database'],
    ['Spreadsheet ini diisi otomatis oleh app Finance Hub. Satu tab = satu tabel, semua tahun jadi satu.'],
    ['Aman untuk dilihat, difilter, dibuat pivot/grafik. Boleh edit sel biasa; app akan menarik perubahan saat sinkron.'],
    ['JANGAN: ubah nama tab, ubah/urutkan ulang baris 1 (header), hapus baris, atau sort tab (app mengingat nomor baris).'],
    ['Menghapus data: lakukan dari app (kolom _d = 1 artinya terhapus).'],
    ['Kolom _u = waktu terakhir diubah (ms). RINGKASAN = ringkasan per siklus, ditulis ulang tiap sinkron.'],
  ];
  await api('PUT', `${API}/${spreadsheetId()}/values/${encodeURIComponent('README!A1')}?valueInputOption=RAW`, { values: lines });
}

// ------------------------------------------------------------ sync
let running = null;
let interactiveFlag = false;
export function syncNow({ interactive = false } = {}) {
  if (!isConnected()) return Promise.resolve();
  if (running) return running;
  interactiveFlag = interactive;
  running = (async () => {
    try {
      if (!navigator.onLine) { setStatus('offline', 'Offline — perubahan disimpan & dikirim nanti'); return; }
      if (!interactive && !hasToken()) { setStatus('auth', 'Ketuk titik status untuk login Google & sinkron (' + db.dirtyCount() + ' perubahan menunggu)'); return; }
      if (interactive) await getToken(true);
      setStatus('syncing', 'Sinkron: menarik data dari Google Sheet…');
      await pull();
      await push();
      setStatus('syncing', 'Sinkron: menulis RINGKASAN…');
      await writeSummary();
      db.getMeta().lastSync = Date.now();
      await db.saveMeta();
      setStatus('ok', 'Tersinkron');
    } catch (e) {
      setStatus(e.auth ? 'auth' : 'error', e.message || String(e));
      throw e;
    } finally { running = null; }
  })();
  return running;
}

function coerce(col, v) {
  if (v === '' || v == null) return '';
  return v;
}
async function pull() {
  const meta = db.getMeta();
  meta.rows = meta.rows || {}; meta.headers = meta.headers || {};
  const ranges = db.TABLES.map((t) => `ranges=${encodeURIComponent(q(t) + '!A1:AZ')}`).join('&');
  let res;
  try {
    res = await api('GET', `${API}/${spreadsheetId()}/values:batchGet?${ranges}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`);
  } catch (e) {
    if (/Unable to parse range/.test(e.message)) { await ensureTabs(); return pull(); }
    throw e;
  }
  let changed = false;
  const needHeader = [];
  res.valueRanges.forEach((vr, i) => {
    const t = db.TABLES[i];
    const values = vr.values || [];
    const header = values[0] || [];
    const want = db.SCHEMA[t].concat(db.META_COLS);
    if (!header.length || want.some((c) => header.indexOf(c) < 0)) needHeader.push(t);
    meta.headers[t] = header.length ? header.concat(want.filter((c) => header.indexOf(c) < 0)) : want;
    const idx = {}; meta.headers[t].forEach((c, k) => { idx[c] = k; });
    const rows = {};
    for (let r = 1; r < values.length; r++) {
      const line = values[r];
      const id = line[idx.id];
      if (id === '' || id == null) continue;
      const o = {};
      for (const c of want) o[c] = coerce(c, line[idx[c]]);
      o.id = String(id);
      o._d = Number(o._d) || 0;
      o._u = Number(o._u) || 0;
      rows[o.id] = r + 1; // sheet row number
      if (db.applyRemote(t, o)) changed = true;
    }
    meta.rows[t] = rows;
  });
  if (needHeader.length) await writeHeadersMerged(needHeader);
  await db.saveMeta();
  if (changed) db.emitAll();
}
async function ensureTabs() {
  const info = await api('GET', `${API}/${spreadsheetId()}?fields=sheets.properties.title`);
  const have = new Set(info.sheets.map((s) => s.properties.title));
  const add = db.TABLES.concat(['README', 'RINGKASAN']).filter((t) => !have.has(t));
  if (add.length) {
    await api('POST', `${API}/${spreadsheetId()}:batchUpdate`, {
      requests: add.map((t) => ({ addSheet: { properties: { title: t, gridProperties: { frozenRowCount: 1 } } } })),
    });
    await writeHeaders(add.filter((t) => db.SCHEMA[t]));
  }
}
async function writeHeadersMerged(tables) {
  const meta = db.getMeta();
  await api('POST', `${API}/${spreadsheetId()}/values:batchUpdate`, {
    valueInputOption: 'RAW',
    data: tables.map((t) => ({ range: `${q(t)}!A1`, values: [meta.headers[t]] })),
  });
}
const colLetter = (n) => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
function toLine(t, row) {
  const header = db.getMeta().headers[t] || db.SCHEMA[t].concat(db.META_COLS);
  return header.map((c) => {
    const v = row[c];
    if (v === undefined || v === null) return '';
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  });
}
async function push() {
  const meta = db.getMeta();
  const updates = [];
  const appends = [];
  const knownIds = [];
  let total = 0;
  for (const t of db.TABLES) {
    const rows = db.dirtyRows(t);
    if (!rows.length) continue;
    total += rows.length;
    const known = rows.filter((r) => meta.rows?.[t]?.[r.id]);
    const fresh = rows.filter((r) => !meta.rows?.[t]?.[r.id]);
    const header = meta.headers[t];
    known.forEach((r) => {
      const n = meta.rows[t][r.id];
      updates.push({ range: `${q(t)}!A${n}:${colLetter(header.length - 1)}${n}`, values: [toLine(t, r)] });
    });
    if (known.length) knownIds.push([t, known.map((r) => r.id)]);
    if (fresh.length) appends.push({ t, fresh });
  }
  if (!total) return;
  // new rows: one append per tab, 4 tabs in parallel; each tab is marked clean as soon as it lands,
  // so an interrupted first sync resumes where it stopped instead of starting over
  let sent = 0;
  const report = () => setStatus('syncing', `Sinkron: mengirim ${sent}/${total} baris…`);
  report();
  const queue = appends.slice();
  const worker = async () => {
    for (let job; (job = queue.shift());) {
      const { t, fresh } = job;
      const res = await api('POST', `${API}/${spreadsheetId()}/values/${encodeURIComponent(q(t) + '!A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        { values: fresh.map((r) => toLine(t, r)) });
      const m = /![A-Z]+(\d+)/.exec(res.updates?.updatedRange || '');
      if (m) {
        const start = Number(m[1]);
        meta.rows[t] = meta.rows[t] || {};
        fresh.forEach((r, k) => { meta.rows[t][r.id] = start + k; });
      }
      db.clearDirty(t, fresh.map((r) => r.id));
      await db.saveMeta();
      sent += fresh.length; report();
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  for (let i = 0; i < updates.length; i += 400) {
    const chunk = updates.slice(i, i + 400);
    await api('POST', `${API}/${spreadsheetId()}/values:batchUpdate`, { valueInputOption: 'RAW', data: chunk });
    sent += chunk.length; report();
  }
  knownIds.forEach(([t, ids]) => db.clearDirty(t, ids));
  await db.saveMeta();
}

// RINGKASAN tab: a human-readable per-cycle summary, rewritten on every sync.
let summaryFn = null;
export const setSummaryBuilder = (fn) => { summaryFn = fn; };
async function writeSummary() {
  if (!summaryFn) return;
  const values = summaryFn();
  if (!values || !values.length) return;
  await api('POST', `${API}/${spreadsheetId()}/values:batchUpdate`, {
    valueInputOption: 'RAW', data: [{ range: `${q('RINGKASAN')}!A1`, values }],
  }).catch(() => {});
}

// background: sync after edits (debounced), when the app comes back to the foreground, and every 5 min
let editTimer = null;
export function startAutoSync() {
  db.onChange(() => {
    if (!isConnected()) return;
    clearTimeout(editTimer);
    editTimer = setTimeout(() => syncNow().catch(() => {}), 2500);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isConnected()) syncNow().catch(() => {});
  });
  window.addEventListener('online', () => isConnected() && syncNow().catch(() => {}));
  setInterval(() => document.visibilityState === 'visible' && isConnected() && syncNow().catch(() => {}), 5 * 60 * 1000);
  if (isConnected()) setStatus('idle', 'Terhubung');
}
export const sheetUrl = () => spreadsheetId() ? `https://docs.google.com/spreadsheets/d/${spreadsheetId()}/edit` : '';
