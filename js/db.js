// Local-first store: every table lives in memory and in IndexedDB. Writes are instant;
// changed rows are marked dirty and pushed to Google Sheets by sync.js in the background.

// Column order = column order in the Google Sheet tab of the same name. Adding a column at the
// end is safe (sync writes the new header). `_u` = updated-at (ms), `_d` = deleted flag.
export const SCHEMA = {
  settings: ['id', 'value'],
  accounts: ['id', 'name', 'currency', 'kind', 'usable', 'order', 'active'],
  categories: ['id', 'name', 'group', 'order', 'active'],
  transactions: ['id', 'date', 'desc', 'category', 'amount', 'account', 'to', 'note', 'cycle', 'link', 'idr'],
  rates: ['id', 'cycle', 'rate'],
  balances: ['id', 'cycle', 'account', 'initial'],
  budget: ['id', 'cycle', 'panel', 'grp', 'label', 'idr', 'tl', 'paid', 'timing', 'payfrom', 'order'],
  income: ['id', 'cycle', 'leg', 'label', 'amount', 'source'],
  payroll: ['id', 'cycle', 'workDays', 'unpaid', 'absent', 'outDays', 'usdRate', 'overtime', 'mid', 'end', 'actualMid', 'actualEnd', 'thr'],
  pockets: ['id', 'name', 'order', 'goal', 'monthly', 'calOri', 'calJmo', 'calLiquid', 'calDate', 'tuitionTL', 'tuitionRate', 'active'],
  pocket_targets: ['id', 'cycle', 'pocket', 'target', 'paid', 'timing', 'payfrom'],
  saving_log: ['id', 'date', 'desc', 'amount', 'onBudget', 'pocket', 'talanganTo', 'note', 'talangan'],
  talangan: ['id', 'item', 'harga', 'duration', 'start', 'usage', 'done', 'note', 'order'],
  talangan_pay: ['id', 'talangan', 'cycle', 'amount'],
  loans: ['id', 'date', 'name', 'amount', 'pocket', 'paid', 'paidDate', 'note'],
  gold: ['id', 'date', 'antam', 'ubs', 'galeri', 'note'],
  installments: ['id', 'asset', 'date', 'value', 'paid'],
  events: ['id', 'name', 'kind', 'budget', 'start', 'end', 'active', 'note', 'leave'],
  event_items: ['id', 'event', 'agenda', 'item', 'category', 'orderDate', 'price', 'note', 'order'],
  event_agenda: ['id', 'event', 'day', 'date', 'city', 'what', 'where', 'note', 'checked', 'order'],
  event_gear: ['id', 'event', 'place', 'item', 'amount', 'checked', 'what', 'where', 'note', 'order'],
  event_spend: ['id', 'event', 'date', 'item', 'amount', 'note', 'category'],
  scenarios: ['id', 'name', 'note', 'active', 'projectOption'],
  plan_rules: ['id', 'scenario', 'label', 'group', 'amount', 'start', 'end', 'freq', 'growth', 'growthPart', 'note', 'active'],
  plan_items: ['id', 'scenario', 'month', 'label', 'group', 'amount', 'note'],
  projects: ['id', 'name', 'contPct', 'stage1End', 'lender', 'loanRepayStart', 'loanMonths', 'loanMarkupPct', 'note', 'loanMax', 'stage2On', 'trancheAmt', 'trancheStart', 'trancheMonths', 'repayAmount'],
  project_items: ['id', 'project', 'stage', 'section', 'kind', 'label', 'spec', 'qty', 'unit', 'price', 'month', 'opt1', 'opt2', 'cont', 'source', 'note', 'realized', 'opt3'],
};
export const META_COLS = ['_u', '_d'];
export const TABLES = Object.keys(SCHEMA);

const DB_NAME = 'finance-hub';
let idb = null;
const mem = {};          // table -> Map(id -> row) (includes soft-deleted rows)
let dirty = {};          // table -> Set(id)
let meta = {};           // sync bookkeeping (row numbers, spreadsheet id, last sync)
const listeners = new Set();

function openIDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('tables'); r.result.createObjectStore('meta'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function idbGet(store, key) {
  return new Promise((res, rej) => {
    const q = idb.transaction(store).objectStore(store).get(key);
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
}
function idbPut(store, key, val) {
  return new Promise((res, rej) => {
    const t = idb.transaction(store, 'readwrite');
    t.objectStore(store).put(val, key);
    t.oncomplete = () => res(); t.onerror = () => rej(t.error);
  });
}

export async function load() {
  idb = await openIDB();
  for (const t of TABLES) {
    const rows = (await idbGet('tables', t)) || [];
    mem[t] = new Map(rows.map((r) => [r.id, r]));
  }
  const d = (await idbGet('meta', 'dirty')) || {};
  dirty = {}; for (const t of TABLES) dirty[t] = new Set(d[t] || []);
  meta = (await idbGet('meta', 'sync')) || {};
}

// ---------------- persistence (debounced per table) ----------------
const pending = new Set();
let flushTimer = null;
function schedulePersist(t) {
  pending.add(t);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(persistNow, 250);
}
export async function persistNow() {
  clearTimeout(flushTimer);
  const ts = [...pending]; pending.clear();
  for (const t of ts) await idbPut('tables', t, [...mem[t].values()]);
  await saveDirty();
}
async function saveDirty() {
  const o = {}; for (const t of TABLES) o[t] = [...dirty[t]];
  await idbPut('meta', 'dirty', o);
}
export async function saveMeta() { await idbPut('meta', 'sync', meta); }
export const getMeta = () => meta;

// ---------------- reads ----------------
export const all = (t) => [...mem[t].values()].filter((r) => !r._d);
export const allRaw = (t) => [...mem[t].values()];
export const getRaw = (t, id) => mem[t].get(id) || null;
export const get = (t, id) => { const r = mem[t].get(id); return r && !r._d ? r : null; };
export const where = (t, f) => all(t).filter(f);
export function setting(key, def) {
  const r = get('settings', key);
  if (!r) return def;
  try { return JSON.parse(r.value); } catch { return def; }
}

// ---------------- writes ----------------
function emit(t) { listeners.forEach((fn) => fn(t)); }
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export function put(t, row, { silent } = {}) {
  if (!row.id) throw new Error('row without id');
  const prev = mem[t].get(row.id);
  const next = Object.assign({}, prev || {}, row, { _u: Date.now(), _d: 0 });
  mem[t].set(row.id, next);
  dirty[t].add(row.id);
  schedulePersist(t);
  if (!silent) emit(t);
  return next;
}
export function putMany(t, rows) { rows.forEach((r) => put(t, r, { silent: true })); emit(t); }
export function del(t, id) {
  const prev = mem[t].get(id);
  if (!prev) return;
  mem[t].set(id, Object.assign({}, prev, { _u: Date.now(), _d: 1 }));
  dirty[t].add(id);
  schedulePersist(t);
  emit(t);
}
export function setSetting(key, value) { put('settings', { id: key, value: JSON.stringify(value) }); }

// ---------------- sync helpers ----------------
export const dirtyCount = () => TABLES.reduce((a, t) => a + dirty[t].size, 0);
export const dirtyRows = (t) => [...dirty[t]].map((id) => mem[t].get(id)).filter(Boolean);
export function clearDirty(t, ids) { ids.forEach((id) => dirty[t].delete(id)); saveDirty(); }
/** Apply a row pulled from the sheet. Local unsynced edits win; otherwise the sheet wins. */
export function applyRemote(t, row) {
  if (dirty[t].has(row.id)) return false;
  const prev = mem[t].get(row.id);
  if (prev && JSON.stringify(strip(prev)) === JSON.stringify(strip(row))) return false;
  mem[t].set(row.id, row);
  schedulePersist(t);
  return true;
}
const strip = (r) => { const o = {}; for (const k of Object.keys(r).sort()) if (k !== '_u') o[k] = r[k] ?? ''; return o; };
export function markDirty(t, ids) { ids.forEach((id) => dirty[t].add(id)); saveDirty(); }
export function markAllDirty() { for (const t of TABLES) for (const id of mem[t].keys()) dirty[t].add(id); saveDirty(); }
export const emitAll = () => TABLES.forEach(emit);

/** Replace everything (import). Rows become dirty so a connected sheet receives them. */
export async function replaceAll(tables, { markDirty = true } = {}) {
  for (const t of TABLES) {
    const rows = (tables[t] || []).map((r) => Object.assign({ _u: Date.now(), _d: 0 }, r));
    mem[t] = new Map(rows.map((r) => [String(r.id), Object.assign(r, { id: String(r.id) })]));
    dirty[t] = markDirty ? new Set(mem[t].keys()) : new Set();
    pending.add(t);
  }
  await persistNow();
  emitAll();
}
export function exportAll() {
  const tables = {};
  for (const t of TABLES) tables[t] = all(t).map((r) => { const o = { ...r }; delete o._u; delete o._d; return o; });
  return { format: 'finance-hub', version: 1, exportedAt: new Date().toISOString(), tables };
}
export async function wipe() {
  for (const t of TABLES) { mem[t] = new Map(); dirty[t] = new Set(); pending.add(t); }
  meta = {}; await saveMeta(); await persistNow(); emitAll();
}
