// Firebase sync: login once per device (email + password), then sync forever without logging in again.
// Firebase keeps a refresh token on the device and renews the 1-hour access token by itself.
//
// Data lives in Firestore as one document per row:  users/{uid}/rows/{table~id}
//   { t: table, ...row fields, _u (edited at, ms), _d (soft delete), _s (server time of the write) }
// A sync = push this device's dirty rows (batched) + pull every row written since the last `_s` seen.
// While the app is open a live listener applies changes from the other device within a second.
//
// The SDK is loaded lazily from gstatic (cached by the service worker), so the app still opens offline.
import * as db from './db.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
let F = null, app = null, auth = null, fs = null, user = null, readyP = null, unsub = null, live = null;

export const config = () => { try { return JSON.parse(localStorage.getItem('hub.firebase') || 'null'); } catch { return null; } };
export const configured = () => !!config()?.apiKey;
export const signedIn = () => !!user;
export const email = () => user?.email || '';
export const active = () => configured() && !!user;

/** Accepts the snippet copied from the Firebase console (`const firebaseConfig = {...}`) or plain JSON. */
export function parseConfig(text) {
  const pick = (k) => (new RegExp(k + '\\s*["\']?\\s*:\\s*["\']([^"\']+)["\']').exec(text) || [])[1];
  const c = { apiKey: pick('apiKey'), authDomain: pick('authDomain'), projectId: pick('projectId'), appId: pick('appId'), storageBucket: pick('storageBucket'), messagingSenderId: pick('messagingSenderId') };
  if (!c.apiKey || !c.projectId) throw new Error('Konfigurasi Firebase tidak lengkap — salin seluruh blok firebaseConfig dari Firebase console');
  if (!c.authDomain) c.authDomain = c.projectId + '.firebaseapp.com';
  return c;
}

async function load() {
  if (F) return F;
  if (window.__fbMock) { F = window.__fbMock; return F; } // tests
  const [a, au, f] = await Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js')]);
  F = { ...a, ...au, ...f };
  return F;
}
/** Start Firebase (if configured) and resolve once we know whether this device is signed in. */
export function ready() {
  if (readyP) return readyP;
  if (!configured()) return Promise.resolve(null);
  readyP = (async () => {
    await load();
    app = F.getApps().length ? F.getApp() : F.initializeApp(config());
    auth = F.getAuth(app);
    fs = F.getFirestore(app);
    // the first auth callback tells us whether this device is still signed in (persisted session)
    await new Promise((res) => { F.onAuthStateChanged(auth, (u) => { user = u; res(); }); });
    return user;
  })().catch((e) => { readyP = null; throw e; });
  return readyP;
}
export async function login(cfgText, mail, password) {
  const cfg = parseConfig(cfgText);
  const prev = config();
  localStorage.setItem('hub.firebase', JSON.stringify(cfg));
  if (prev && prev.projectId !== cfg.projectId) { const m = db.getMeta(); delete m.fbCursor; delete m.fbAdopted; await db.saveMeta(); }
  readyP = null;
  await ready();
  try {
    const cred = await F.signInWithEmailAndPassword(auth, mail.trim(), password);
    user = cred.user;
  } catch (e) {
    const c = e.code || '';
    throw new Error(/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c) ? 'Email atau password salah (akun dibuat di Firebase console → Authentication → Users)'
      : /network/.test(c) ? 'Tidak ada koneksi — coba lagi' : /too-many-requests/.test(c) ? 'Terlalu banyak percobaan — tunggu beberapa menit' : 'Login gagal: ' + (e.message || c));
  }
  const m = db.getMeta(); delete m.fbAdopted; await db.saveMeta(); // first sync on this device: merge local & cloud
  return user;
}
export async function logout() {
  stopLive();
  if (auth) await F.signOut(auth);
  user = null;
}
export function forget() { localStorage.removeItem('hub.firebase'); readyP = null; user = null; stopLive(); }

const rowsCol = () => F.collection(fs, 'users', user.uid, 'rows');
const keyOf = (t, id) => t + '~' + String(id).replace(/\//g, '∕');
function toDoc(t, row) {
  const o = { t };
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined || (typeof v === 'number' && !Number.isFinite(v))) continue;
    o[k] = v;
  }
  o.id = String(row.id);
  o._s = F.serverTimestamp();
  return o;
}
function fromDoc(d) {
  const o = { ...d };
  const t = o.t; delete o.t; delete o._s;
  o._d = Number(o._d) || 0; o._u = Number(o._u) || 0;
  return [t, o];
}
const tsMs = (ts) => (ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0);

/** One sync round: push dirty rows, then pull everything newer than our cursor. */
export async function sync(setStatus) {
  try { await syncRound(setStatus); } catch (e) {
    const c = e.code || '';
    if (/permission-denied/.test(c)) throw new Error('Akses Firestore ditolak — cek Rules (panduan langkah 8) dan pastikan login dengan akun yang sama');
    if (/unavailable|deadline-exceeded/.test(c)) throw new Error('Firebase tidak bisa dihubungi (koneksi) — dicoba lagi otomatis');
    if (/not-found/.test(c)) throw new Error('Database Firestore belum dibuat (panduan langkah 7)');
    throw e;
  }
}
async function syncRound(setStatus) {
  await ready();
  if (!user) { const e = new Error('Belum login Firebase — buka Pengaturan'); e.auth = true; throw e; }
  const meta = db.getMeta();
  // first sync on this device: if the cloud is empty, upload everything; else download first, then upload what's only here
  if (!meta.fbAdopted) {
    setStatus('syncing', 'Firebase: memeriksa data di cloud…');
    const probe = await F.getDocs(F.query(rowsCol(), F.limit(1)));
    if (probe.empty) db.markAllDirty();
    else {
      const seen = await pull(setStatus, true);
      for (const t of db.TABLES) {
        const missing = db.allRaw(t).map((r) => r.id).filter((id) => !seen.has(keyOf(t, id)));
        if (missing.length) db.markDirty(t, missing);
      }
    }
    meta.fbAdopted = true; await db.saveMeta();
  }
  await push(setStatus);
  await pull(setStatus);
  startLive();
}
async function push(setStatus) {
  const jobs = [];
  for (const t of db.TABLES) db.dirtyRows(t).forEach((r) => jobs.push([t, r]));
  if (!jobs.length) return;
  let sent = 0;
  for (let i = 0; i < jobs.length; i += 400) {
    const chunk = jobs.slice(i, i + 400);
    setStatus('syncing', `Firebase: mengirim ${sent}/${jobs.length} perubahan…`);
    const b = F.writeBatch(fs);
    chunk.forEach(([t, r]) => b.set(F.doc(rowsCol(), keyOf(t, r.id)), toDoc(t, r)));
    await b.commit();
    // rows edited again while the batch was in flight stay dirty (they go out next time)
    chunk.forEach(([t, r]) => { if (db.getRaw(t, r.id)?._u === r._u) db.clearDirty(t, [r.id]); });
    sent += chunk.length;
  }
}
async function pull(setStatus, collectKeys) {
  const meta = db.getMeta();
  const since = F.Timestamp.fromMillis(collectKeys ? 0 : meta.fbCursor || 0);
  setStatus('syncing', 'Firebase: menarik perubahan…');
  const snap = await F.getDocs(F.query(rowsCol(), F.where('_s', '>', since), F.orderBy('_s')));
  const seen = new Set();
  let changed = false, max = meta.fbCursor || 0;
  snap.forEach((d) => {
    seen.add(d.id);
    const data = d.data();
    const [t, row] = fromDoc(data);
    if (db.TABLES.includes(t) && db.applyRemote(t, row)) changed = true;
    max = Math.max(max, tsMs(data._s));
  });
  meta.fbCursor = max; await db.saveMeta();
  if (changed) db.emitAll();
  return seen;
}
// live updates from the other device while the app is open
function startLive() {
  if (live || !user) return;
  const meta = db.getMeta();
  live = F.onSnapshot(F.query(rowsCol(), F.where('_s', '>', F.Timestamp.fromMillis(meta.fbCursor || 0))), (snap) => {
    let changed = false, max = db.getMeta().fbCursor || 0;
    snap.docChanges().forEach((ch) => {
      if (ch.type === 'removed' || ch.doc.metadata.hasPendingWrites) return;
      const data = ch.doc.data();
      const [t, row] = fromDoc(data);
      if (db.TABLES.includes(t) && db.applyRemote(t, row)) changed = true;
      max = Math.max(max, tsMs(data._s));
    });
    db.getMeta().fbCursor = max; db.saveMeta();
    if (changed) db.emitAll();
  }, () => stopLive());
}
export function stopLive() { if (live) { try { live(); } catch { /* ignore */ } live = null; } }
