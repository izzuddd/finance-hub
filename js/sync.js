// Google Sheets sync. The app never waits on the network: reads/writes hit the local store,
// and this module pushes dirty rows / pulls remote changes in the background.
//
// Auth: Google Identity Services token client, scope drive.file (the app can only see the
// spreadsheet it created — not the rest of your Drive).
import * as db from './db.js';
import { CONFIG } from './config.js';
import * as fb from './fb.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const HUB_TITLE = 'Izud Finance Hub';
let token = null, tokenExp = 0, tokenClient = null;
// The 1-hour access token is kept on this device so reopening the app (iOS kills home-screen apps
// in the background) doesn't force a new Google login every time.
try { const s = JSON.parse(localStorage.getItem('hub.tok') || 'null'); if (s && s.exp > Date.now()) { token = s.t; tokenExp = s.exp; } } catch { /* ignore */ }
function saveToken(t, expiresIn) {
  token = t; tokenExp = Date.now() + (Number(expiresIn) || 3600) * 1000;
  try { localStorage.setItem('hub.tok', JSON.stringify({ t: token, exp: tokenExp })); } catch { /* ignore */ }
}
function dropToken() { token = null; tokenExp = 0; try { localStorage.removeItem('hub.tok'); } catch { /* ignore */ } }
// Installed as a home-screen app (iOS especially), Google's login popup opens in a separate sheet
// that often never reports back — the app then waits forever. There we log in by redirect instead:
// the app navigates to Google and Google sends the token back to this same page.
const useRedirect = () => navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
export const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');
const newState = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
function authUrl(state, prompt) {
  const p = new URLSearchParams({ client_id: clientId(), redirect_uri: redirectUri(), response_type: 'token', scope: SCOPE,
    include_granted_scopes: 'true', state });
  if (prompt) p.set('prompt', prompt);
  const hint = localStorage.getItem('hub.email'); if (hint) p.set('login_hint', hint);
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + p;
}
function loginByRedirect(after) {
  const state = newState();
  localStorage.setItem('hub.oauth', JSON.stringify({ state, after }));
  location.assign(authUrl(state));
  return new Promise(() => {}); // the page is leaving
}

// ---- silent renewal: get a fresh 1-hour token WITHOUT any login screen or tap ----
// Google answers `prompt=none` with a token straight away when this browser is still signed in to
// Google and the app was approved before. Two ways to ask, whichever the browser allows:
//  * a hidden iframe (no page change) — works in desktop browsers that still share Google cookies;
//  * a full-page redirect at app start (home-screen apps / iPhone, where iframes can't see the cookie).
// If Google says the user must interact (signed out, consent withdrawn), we quietly fall back to the
// yellow dot; a tap then does the normal login.
let silentBusy = null, silentFailAt = 0;
const canSilent = () => !fb.configured() && !viaBridge() && isConnected() && !!clientId() && !!db.getMeta().consented;
export function silentRenew() {
  if (silentBusy) return silentBusy;
  if (!canSilent() || !navigator.onLine || Date.now() - silentFailAt < 5 * 60000) return Promise.resolve(false);
  silentBusy = new Promise((res) => {
    const state = newState();
    const f = document.createElement('iframe');
    f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
    f.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
    let done = false, timer = null;
    const finish = (ok) => {
      if (done) return; done = true;
      clearTimeout(timer); window.removeEventListener('message', on); f.remove();
      if (!ok) silentFailAt = Date.now();
      silentBusy = null; res(ok);
    };
    const on = (e) => {
      if (e.origin !== location.origin || !e.data || !e.data.hubOauth) return;
      const h = new URLSearchParams(String(e.data.hubOauth).replace(/^#/, ''));
      if (h.get('state') !== state) return;
      if (h.get('access_token')) { saveToken(h.get('access_token'), h.get('expires_in')); finish(true); } else finish(false);
    };
    window.addEventListener('message', on);
    timer = setTimeout(() => finish(false), 8000);
    f.src = authUrl(state, 'none');
    document.body.appendChild(f);
  });
  return silentBusy;
}
/** App start in a home-screen app with an expired token: renew by a quick redirect (~1 s). */
export function silentRedirectIfNeeded() {
  if (!canSilent() || hasToken() || !useRedirect() || !navigator.onLine) return false;
  const stale = Date.now() - (db.getMeta().lastSync || 0) > 3 * 60000;
  if (!db.dirtyCount() && !stale) return false;
  if (Date.now() - Number(localStorage.getItem('hub.silentAt') || 0) < 10 * 60000) return false; // no loops
  localStorage.setItem('hub.silentAt', String(Date.now()));
  const state = newState();
  localStorage.setItem('hub.oauth', JSON.stringify({ state, after: 'silent' }));
  location.assign(authUrl(state, 'none'));
  return true;
}
/** Inside the hidden iframe: hand the token Google put in the URL to the app that opened us. */
export function relayToParent() {
  if (window.parent === window || !/access_token=|error=/.test(location.hash)) return false;
  window.parent.postMessage({ hubOauth: location.hash }, location.origin);
  return true;
}
// Called once at boot: picks up the token Google put in the URL (#access_token=…) after a redirect login.
export function handleRedirect() {
  if (!/access_token=|error=/.test(location.hash)) return null;
  const h = new URLSearchParams(location.hash.slice(1));
  let saved = null; try { saved = JSON.parse(localStorage.getItem('hub.oauth') || 'null'); } catch { /* ignore */ }
  localStorage.removeItem('hub.oauth');
  history.replaceState(null, '', location.pathname + location.search);
  if (!saved || h.get('state') !== saved.state) return { error: 'Login Google tidak valid, coba lagi' };
  if (h.get('error')) return saved.after === 'silent' ? { silentFailed: true } : { error: 'Login Google gagal: ' + h.get('error') };
  saveToken(h.get('access_token'), h.get('expires_in'));
  return { after: saved.after };
}
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
// Firebase (when set up on this device) replaces the Google Sheets sync entirely
export const viaFirebase = () => fb.configured();
export const isConnected = () => viaFirebase() || !!spreadsheetId();

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
async function getToken(interactive, after = 'sync') {
  if (hasToken()) return token;
  // background syncs must not open a login popup (browsers block popups without a tap)
  if (!interactive && (await silentRenew())) return token;
  if (!interactive) { const e = new Error('Sesi Google habis — ketuk titik status untuk login & sinkron'); e.auth = true; throw e; }
  if (!clientId()) throw new Error('Google Client ID belum diisi (Pengaturan → Google Sheets)');
  if (useRedirect()) return loginByRedirect(after);
  await loadGis();
  return new Promise((res, rej) => {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId(), scope: SCOPE,
      hint: localStorage.getItem('hub.email') || undefined,
      callback: (r) => {
        if (r.error) return rej(new Error(r.error_description || r.error));
        saveToken(r.access_token, r.expires_in);
        res(token);
      },
      error_callback: (e) => rej(new Error(e?.message || e?.type || 'login dibatalkan')),
    });
    tokenClient.requestAccessToken({ prompt: interactive && !db.getMeta().consented ? 'consent' : '' });
    // if the login window never reports back, don't leave the app "syncing" forever
    setTimeout(() => rej(Object.assign(new Error('Login Google tidak kembali ke app — ketuk untuk coba lagi'), { auth: true })), 120000);
  });
}
// ------------------------------------------------------------ "sinkron tanpa login" (Apps Script bridge)
// tools/hub-bridge.gs, bound to the hub spreadsheet, answers the same few Sheets API calls this module
// makes, authenticated by a shared key instead of Google OAuth: no 1-hour sessions, no login popups
// (which iOS home-screen apps can't complete). Stored per device.
export const bridge = () => { try { return JSON.parse(localStorage.getItem('hub.bridge') || 'null'); } catch { return null; } };
export const viaBridge = () => !!bridge()?.url;
async function callBridge(req, b = bridge()) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 90000);
  let r, j;
  try {
    // text/plain body = "simple" request, so no CORS preflight (Apps Script can't answer one)
    r = await fetch(b.url, { method: 'POST', body: JSON.stringify({ ...req, key: b.key }), signal: ctl.signal, redirect: 'follow' });
    j = await r.json();
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'Apps Script terlalu lama menjawab (timeout) — coba lagi'
      : 'Apps Script tidak bisa dihubungi — cek URL /exec & akses "Anyone" (' + e.message + ')');
  } finally { clearTimeout(timer); }
  if (!j.ok) throw new Error('Apps Script: ' + j.error);
  return j;
}
// translate the Sheets API calls below into bridge ops
function bridgeApi(method, url, body) {
  const u = decodeURIComponent(url);
  if (/values:batchGet/.test(u)) return callBridge({ op: 'batchGet', ranges: [...u.matchAll(/ranges=([^&]+)/g)].map((m) => m[1]) });
  if (/values:batchUpdate$/.test(u)) return callBridge({ op: 'batchUpdate', data: body.data });
  if (/:append\?/.test(u)) return callBridge({ op: 'append', range: /\/values\/(.+):append/.exec(u)[1], values: body.values });
  if (method === 'PUT') return callBridge({ op: 'batchUpdate', data: [{ range: /\/values\/([^?]+)/.exec(u)[1], values: body.values }] });
  if (/fields=sheets\.properties\.title/.test(u)) return callBridge({ op: 'tabs' });
  if (/:batchUpdate$/.test(u)) return callBridge({ op: 'addSheets', titles: body.requests.map((x) => x.addSheet.properties.title) });
  return Promise.resolve({}); // Drive tagging etc.: not needed with the bridge
}
export async function enableBridge(url, key) {
  url = String(url || '').trim(); key = String(key || '').trim();
  if (!/^https:\/\/script\.google(usercontent)?\.com\/.+\/exec/.test(url)) throw new Error('URL harus URL Web app Apps Script yang berakhiran /exec');
  if (key.length < 16) throw new Error('Kunci terlalu pendek');
  setStatus('syncing', 'Menghubungi Apps Script…');
  let info;
  try { info = await callBridge({ op: 'info' }, { url, key }); } catch (e) { setStatus('error', e.message); throw e; }
  localStorage.setItem('hub.bridge', JSON.stringify({ url, key, direct: true }));
  dropToken();
  const meta = db.getMeta();
  if (meta.spreadsheetId !== info.id) { meta.rows = {}; meta.headers = {}; meta.adopt = true; }
  meta.spreadsheetId = info.id;
  await db.saveMeta();
  return syncNow({ interactive: true });
}
export async function disableBridge() { localStorage.removeItem('hub.bridge'); dropToken(); }
export const bridgeMode = () => (!viaBridge() ? '' : bridgeDirect() ? 'direct' : 'script');

// "Perangkat tepercaya": the bridge hands out the script owner's short-lived Google access token
// (ScriptApp.getOAuthToken), fetched in the background about once an hour. The app then talks to the
// Sheets API directly — as fast as the Google-login mode, but never asks to log in again.
// If the direct route isn't possible (old script / Sheets API off), it falls back to bridge-only sync.
const bridgeDirect = () => viaBridge() && bridge().direct !== false;
function setBridgeDirect(on) { const b = bridge(); if (b) { b.direct = on; localStorage.setItem('hub.bridge', JSON.stringify(b)); } }
async function bridgeToken(force) {
  if (hasToken() && !force) return token;
  const r = await callBridge({ op: 'token' });
  if (!r.token) throw Object.assign(new Error('no token'), { noDirect: true });
  saveToken(r.token, 40 * 60); // the script's token may be partly used already; refresh early
  return token;
}

async function api(method, url, body, interactive, retried) {
  if (viaBridge()) {
    if (/googleapis\.com\/drive\//.test(url)) return {}; // Drive tagging/search: not needed in this mode
    if (!bridgeDirect()) return bridgeApi(method, url, body);
    try { await bridgeToken(); } catch (e) {
      if (!e.noDirect && !/op tidak dikenal/.test(e.message)) throw e;
      setBridgeDirect(false); // script without the 'token' op: keep syncing through the script
      return bridgeApi(method, url, body);
    }
  }
  const t = viaBridge() ? token : await getToken(interactive || interactiveFlag);
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
  if (r.status === 401) {
    dropToken();
    if (viaBridge() && !retried) return api(method, url, body, interactive, true); // expired early: fetch a fresh one
    const e = new Error('Sesi Google berakhir — ketuk titik status untuk login lagi'); e.auth = true; throw e;
  }
  if (!r.ok) {
    const text = await r.text();
    if (viaBridge() && r.status === 403 && /has not been used|is disabled|SERVICE_DISABLED|insufficient/i.test(text)) {
      setBridgeDirect(false);
      return bridgeApi(method, url, body);
    }
    throw new Error('Google API ' + r.status + ': ' + text.slice(0, 200));
  }
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
  await getToken(true, 'connect');
  const meta = db.getMeta();
  meta.consented = true;
  if (!meta.spreadsheetId) {
    const found = await findExisting();
    if (found) return useSheet(found);
    setStatus('syncing', 'Membuat spreadsheet…');
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
// Another device may already have created the hub sheet. Search by tag AND by title (the tag is
// optional), and never silently fall through to creating a second spreadsheet when the search fails
// — that splits the data across two sheets. With several candidates, take the oldest (the original).
async function findExisting() {
  setStatus('syncing', 'Mencari spreadsheet yang sudah ada…');
  const qq = encodeURIComponent(`(appProperties has { key='financeHub' and value='1' } or name='${HUB_TITLE}') and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
  let r;
  try {
    r = await api('GET', `https://www.googleapis.com/drive/v3/files?q=${qq}&fields=files(id,name,createdTime)&orderBy=createdTime`);
  } catch (e) {
    if (e.auth) throw e;
    throw new Error('Tidak bisa mencari spreadsheet lama di Drive (aktifkan Google Drive API di Google Cloud). ' + e.message);
  }
  return r.files && r.files[0] ? r.files[0].id : null;
}
/** Point this device at an existing hub spreadsheet (found automatically or pasted in Pengaturan).
 *  Remote rows are pulled first; rows that exist only on this device are then sent to it. */
export async function useSheet(idOrUrl) {
  const id = (/\/d\/([\w-]+)/.exec(idOrUrl) || [])[1] || String(idOrUrl).trim();
  if (!/^[\w-]{20,}$/.test(id)) throw new Error('Link / ID spreadsheet tidak valid');
  const meta = db.getMeta();
  meta.spreadsheetId = id; meta.rows = {}; meta.headers = {}; meta.adopt = true; meta.consented = true;
  await db.saveMeta();
  await tagFile(id);
  return syncNow({ interactive: true });
}
export async function disconnect() {
  localStorage.removeItem('hub.bridge');
  const meta = db.getMeta();
  delete meta.spreadsheetId; delete meta.rows; delete meta.headers;
  await db.saveMeta();
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
  dropToken();
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
let running = null, runningSince = 0, retries = 0;
let interactiveFlag = false;
export function syncNow({ interactive = false } = {}) {
  if (!isConnected()) return Promise.resolve();
  // a tap must never be swallowed by an old attempt that got stuck (e.g. a login that never came back)
  if (running && !(interactive && Date.now() - runningSince > 20000)) return running;
  const since = runningSince = Date.now();
  interactiveFlag = interactive;
  running = (async () => {
    // yield first: an early return (offline / login needed) would otherwise run `finally` before
    // `running` is assigned, leaving a finished promise in `running` that swallows every later tap
    await null;
    try {
      if (!navigator.onLine) { setStatus('offline', 'Offline — perubahan disimpan & dikirim nanti'); return; }
      if (viaFirebase()) {
        await fb.ready();
        if (!fb.signedIn()) { setStatus('auth', 'Login Firebase sekali di Pengaturan (' + db.dirtyCount() + ' perubahan menunggu)'); return; }
        await fb.sync(setStatus);
        db.getMeta().lastSync = Date.now(); await db.saveMeta();
        retries = 0;
        setStatus('ok', 'Tersinkron (Firebase)');
        return;
      }
      if (!viaBridge()) {
        if (!interactive && !hasToken()) await silentRenew();
        if (!interactive && !hasToken()) { setStatus('auth', 'Ketuk titik status untuk login Google & sinkron (' + db.dirtyCount() + ' perubahan menunggu)'); return; }
        if (interactive) await getToken(true);
      }
      let fast = false;
      if (canFastSync()) {
        try { await fastSync(); fast = true; } catch (e) {
          if (!/Unable to parse range/.test(e.message)) throw e;
          db.getMeta().headers = {}; // a tab was renamed/removed in the sheet: rebuild via the full path
        }
      }
      if (!fast) {
        setStatus('syncing', 'Sinkron: menarik data dari Google Sheet…');
        await pull();
        await Promise.all([push(), writeSummary()]); // independent: RINGKASAN comes from local data
      }
      db.getMeta().lastSync = Date.now();
      await db.saveMeta();
      retries = 0;
      setStatus('ok', 'Tersinkron');
    } catch (e) {
      setStatus(e.auth ? 'auth' : 'error', e.message || String(e));
      // passing hiccups (busy script, timeout, flaky network): retry by itself, up to 3 times
      if (!e.auth && retries < 3 && /lock|timeout|terlalu lama|tidak bisa dihubungi|Gagal menghubungi|Google API 5\d\d|rate|quota|unavailable|network|koneksi/i.test(e.message || e.code || '')) {
        retries++;
        setTimeout(() => syncNow().catch(() => {}), retries * 15000);
      }
      throw e;
    } finally { if (runningSince === since) running = null; }
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
  const needHeader = applyValueRanges(res.valueRanges);
  if (needHeader.length) await writeHeadersMerged(needHeader);
  if (meta.adopt) { // first sync with a sheet: send rows the sheet doesn't have yet
    for (const t of db.TABLES) {
      const missing = db.allRaw(t).map((r) => r.id).filter((id) => !meta.rows[t][id]);
      if (missing.length) db.markDirty(t, missing);
    }
    delete meta.adopt;
  }
  await db.saveMeta();
}
// Apply pulled tabs (in db.TABLES order) to the local store; returns tables whose header row needs fixing.
function applyValueRanges(valueRanges) {
  const meta = db.getMeta();
  meta.digest = meta.digest || {};
  let changed = false;
  const needHeader = [];
  valueRanges.forEach((vr, i) => {
    const t = db.TABLES[i];
    if (vr.digest) meta.digest[t] = vr.digest;
    if (vr.same) return; // unchanged since last sync
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
  if (changed) db.emitAll();
  return needHeader;
}

// Apps Script mode: the whole sync (send changes + RINGKASAN + receive changed tabs) in ONE request,
// instead of 3+ sequential requests that each pay Apps Script's ~1-2 s overhead.
const canFastSync = () => {
  const meta = db.getMeta();
  return viaBridge() && !bridgeDirect() && !meta.adopt && db.TABLES.every((t) => meta.headers?.[t] && meta.rows?.[t]);
};
async function fastSync() {
  const meta = db.getMeta();
  const writes = [], appends = [], sent = [];
  for (const t of db.TABLES) {
    const rows = db.dirtyRows(t);
    if (!rows.length) continue;
    const header = meta.headers[t];
    const fresh = [];
    rows.forEach((r) => {
      sent.push([t, r.id, r._u]);
      const n = meta.rows[t][r.id];
      if (n) writes.push({ range: `${q(t)}!A${n}:${colLetter(header.length - 1)}${n}`, values: [toLine(t, r)] });
      else fresh.push(r);
    });
    if (fresh.length) appends.push({ t, fresh, range: `${q(t)}!A1`, values: fresh.map((r) => toLine(t, r)) });
  }
  const summary = summaryFn ? summaryFn() : null;
  if (summary && summary.length) writes.push({ range: `${q('RINGKASAN')}!A1`, values: summary });
  if (sent.length) setStatus('syncing', `Sinkron: mengirim ${sent.length} perubahan…`);
  const res = await callBridge({ op: 'sync', writes, appends: appends.map(({ range, values }) => ({ range, values })),
    ranges: db.TABLES.map((t) => `${q(t)}!A1:AZ`), digests: db.TABLES.map((t) => meta.digest?.[t] || '') });
  appends.forEach((a, k) => {
    const m = /![A-Z]+(\d+)/.exec(res.appended[k] || '');
    if (m) a.fresh.forEach((r, j) => { meta.rows[a.t][r.id] = Number(m[1]) + j; });
  });
  // rows edited again while the request was in flight stay dirty (they go out next time)
  sent.forEach(([t, id, u]) => { if (db.getRaw(t, id)?._u === u) db.clearDirty(t, [id]); });
  const needHeader = applyValueRanges(res.valueRanges);
  if (needHeader.length) await writeHeadersMerged(needHeader);
  await db.saveMeta();
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
    editTimer = setTimeout(() => syncNow().catch(() => {}), 500);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isConnected()) syncNow().catch(() => {});
  });
  window.addEventListener('online', () => isConnected() && syncNow().catch(() => {}));
  setInterval(() => document.visibilityState === 'visible' && isConnected() && syncNow().catch(() => {}), 5 * 60 * 1000);
  // fast mode: renew the access ticket BEFORE it runs out, so a sync never waits on Apps Script
  const warm = () => {
    if (viaFirebase() || document.visibilityState !== 'visible' || !navigator.onLine) return;
    if (!token || tokenExp - Date.now() < 10 * 60000) {
      if (bridgeDirect()) bridgeToken(true).catch(() => {});
      else silentRenew();
    }
  };
  warm();
  document.addEventListener('visibilitychange', warm);
  setInterval(warm, 60000);
  if (isConnected()) setStatus('idle', viaFirebase() ? 'Firebase' : 'Terhubung');
}
export { fb };
export const sheetUrl = () => spreadsheetId() ? `https://docs.google.com/spreadsheets/d/${spreadsheetId()}/edit` : '';
