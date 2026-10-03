// Domain logic: everything the sheets used to compute with formulas, computed from the tables.
import * as db from './db.js';
import { addMonths, cycleOf, currentCycle, monthsBetween, sum, groupBy, parseDate, todayStr } from './util.js';

// memo: derived values are recomputed only after the data changes
let VER = 0;
const CACHE = new Map();
db.onChange(() => { VER++; CACHE.clear(); });
function memo(key, fn) {
  if (CACHE.has(key)) return CACHE.get(key);
  const v = fn(); CACHE.set(key, v); return v;
}

// ------------------------------------------------------------------ accounts & rates
export const accounts = () => db.all('accounts').filter((a) => a.active !== 0).sort((a, b) => a.order - b.order);
export const accountNames = () => accounts().map((a) => a.name);
export const account = (name) => db.all('accounts').find((a) => a.name === name);
export const isTRY = (name) => memo('try|' + name, () => (account(name)?.currency || (/AKBANK|\(TL\)/i.test(name || '') ? 'TRY' : 'IDR')) === 'TRY');
export const categories = () => db.all('categories').filter((c) => c.active !== 0).sort((a, b) => a.order - b.order);
export const categoryNames = () => categories().map((c) => c.name);
export function categoryGroup(name) {
  const c = db.all('categories').find((x) => x.name === name);
  if (c) return c.group;
  if (!name) return '';
  return name.includes(' - ') ? name.split(' - ')[0] : name;
}

export function rateFor(cycle) { return memo('rate|' + cycle, () => rateFor_(cycle)); }
function rateFor_(cycle) {
  const rows = db.all('rates').filter((r) => r.cycle <= cycle && Number(r.rate) > 0).sort((a, b) => (a.cycle < b.cycle ? 1 : -1));
  return rows.length ? Number(rows[0].rate) : 0;
}
export const hasOwnRate = (cycle) => !!db.all('rates').find((r) => r.cycle === cycle && Number(r.rate) > 0);
export function setRate(cycle, rate) { db.put('rates', { id: cycle, cycle, rate: Number(rate) || 0 }); }
/** IDR value of a transaction: TRY accounts × the cycle rate (like the sheet's column G). */
export function txIDR(t) {
  if (t.idr !== '' && t.idr != null && !isNaN(Number(t.idr))) return Number(t.idr); // manual IDR override (per-row rate)
  return isTRY(t.account) ? Number(t.amount) * rateFor(t.cycle) : Number(t.amount);
}

// ------------------------------------------------------------------ transactions
export const txOfCycle = (cycle) => memo('tx|' + cycle, () => db.where('transactions', (t) => t.cycle === cycle));
export function txSorted(list) {
  return list.slice().sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : (b._u || 0) - (a._u || 0)));
}
export function cyclesWithData() { return memo('cycles', cyclesWithData_); }
function cyclesWithData_() {
  const s = new Set(db.all('transactions').map((t) => t.cycle));
  db.all('budget').forEach((b) => s.add(b.cycle));
  return [...s].filter(Boolean).sort();
}
export function saveTx(tx) {
  tx.cycle = cycleOf(tx.date);
  return db.put('transactions', tx);
}

// ------------------------------------------------------------------ balances (Cycle setup / Real-time saldo)
export function initialBalance(cycle, acc) {
  const r = db.get('balances', cycle + '|' + acc);
  return r ? Number(r.initial) || 0 : null;
}
export function balanceMovement(cycle, acc) {
  let m = 0;
  for (const t of txOfCycle(cycle)) {
    if (t.account === acc) m += Number(t.amount) || 0;
    if (t.to === acc) m -= Number(t.amount) || 0;
  }
  return m;
}
/** Real-time balance (native currency) of an account in a cycle. Falls back to the previous cycle's end
 *  as the opening balance when the initial balance was not filled in. */
export function balanceOf(cycle, acc, depth = 0) { return memo('bal|' + cycle + '|' + acc, () => balanceOf_(cycle, acc, depth)); }
function balanceOf_(cycle, acc, depth) {
  let init = initialBalance(cycle, acc);
  if (init == null) init = depth < 36 && cycle > '2000-01' && cyclesWithData().some((c) => c < cycle) ? balanceOf(addMonths(cycle, -1), acc, depth + 1) : 0;
  return init + balanceMovement(cycle, acc);
}
export function accountsNow(cycle = currentCycle()) {
  const rate = rateFor(cycle);
  return accounts().map((a) => {
    const v = balanceOf(cycle, a.name);
    return { ...a, value: v, idr: a.currency === 'TRY' ? v * rate : v };
  });
}
export function totals(cycle = currentCycle()) {
  const list = accountsNow(cycle);
  const total = sum(list.filter((a) => a.kind !== 'investment'), (a) => a.idr);
  const usable = sum(list.filter((a) => a.usable !== 0 && a.kind !== 'investment'), (a) => a.idr);
  return { total, usable, list };
}

// ------------------------------------------------------------------ spending per cycle (the Stats sheet)
const GROUP_ORDER = ['Needs', 'Wants', 'Invest', 'Giving', 'Saving', 'Loan', 'Income', 'Pulkam', 'Transfer'];
export function cycleSummary(cycle) { return memo('sum|' + cycle, () => cycleSummary_(cycle)); }
function cycleSummary_(cycle) {
  const byCat = {}, byGroup = {};
  for (const t of txOfCycle(cycle)) {
    if (!t.category) continue;
    const v = txIDR(t);
    byCat[t.category] = (byCat[t.category] || 0) + v;
    const g = categoryGroup(t.category);
    byGroup[g] = (byGroup[g] || 0) + v;
  }
  const g = (k) => byGroup[k] || 0;
  const totalExpenses = g('Needs') + g('Wants') + g('Giving') + g('Saving') + g('Loan');
  const income = g('Income');
  return { cycle, byCat, byGroup, needs: -g('Needs'), wants: -g('Wants'), giving: -g('Giving'), saving: -g('Saving'),
    loan: g('Loan'), invest: -g('Invest'), income, totalExpenses: -totalExpenses, surplus: totalExpenses + income };
}
export function subsOf(cycle, group) {
  const s = cycleSummary(cycle);
  return categories().filter((c) => c.group === group).map((c) => ({ name: c.name, spent: -(s.byCat[c.name] || 0) }));
}

// ------------------------------------------------------------------ budget
export const budgetLines = (cycle) => db.where('budget', (b) => b.cycle === cycle).sort((a, b) => (a.panel === b.panel ? a.order - b.order : a.panel < b.panel ? -1 : 1));
export const panelLines = (cycle, panel) => budgetLines(cycle).filter((b) => b.panel === panel).sort((a, b) => a.order - b.order);
export const panelTotal = (cycle, panel) => sum(panelLines(cycle, panel), (b) => b.idr);
export const incomeLines = (cycle) => db.where('income', (i) => i.cycle === cycle).sort((a, b) => (a.id < b.id ? -1 : 1));
export function incomeTotal(cycle) { return sum(incomeLines(cycle), (i) => i.amount); }
export function incomeLeg(cycle, leg) { return sum(incomeLines(cycle).filter((i) => i.leg === leg), (i) => i.amount); }

export const pocketsList = () => db.all('pockets').filter((p) => p.active !== 0).sort((a, b) => a.order - b.order);
export function pocketTarget(cycle, pocket) { const r = db.get('pocket_targets', cycle + '|' + pocket); return r ? Number(r.target) || 0 : 0; }
/** On-budget saving deposited in a calendar month (the SAVING sheet's ACTUAL column). */
export function pocketMonthActual(cycle, pocket) {
  let v = 0;
  for (const l of db.all('saving_log')) {
    if (!l.onBudget || String(l.date).slice(0, 7) !== cycle) continue;
    if (l.pocket === pocket) v += Number(l.amount) || 0;
    if (l.talanganTo === pocket) v -= Number(l.amount) || 0;
  }
  return v;
}
export function savingBudget(cycle) {
  const anyDeposit = db.all('saving_log').some((l) => Number(l.onBudget) && String(l.date).slice(0, 7) === cycle);
  return pocketsList().map((p) => {
    const tr = db.get('pocket_targets', cycle + '|' + p.name) || {};
    const tal = talanganOpen().filter((t) => t.usage === p.name);
    const actual = pocketMonthActual(cycle, p.name);
    // like the sheet's SAVING panel: once deposits are logged for the cycle, the budget = actual deposits
    const value = anyDeposit ? actual : Number(tr.target) || 0;
    return { pocket: p, name: p.name, value, deposited: anyDeposit, target: Number(tr.target) || 0, actual, paid: tr.paid ? 1 : 0, timing: tr.timing || '', payfrom: tr.payfrom || '',
      talangan: tal, talTotal: sum(tal, (t) => t.perMonth) };
  });
}
export function componentBudgets(cycle) {
  const sb = savingBudget(cycle);
  return { needs: panelTotal(cycle, 'NEEDS'), wants: panelTotal(cycle, 'WANTS'), giving: panelTotal(cycle, 'GIVING'),
    saving: sum(sb, (s) => s.value) };
}
/** Copy budget lines, income lines and pocket targets of one cycle into another (next cycle / year rollover). */
export function copyBudget(from, to, { overwrite = false } = {}) {
  if (!overwrite && budgetLines(to).length) return 0;
  if (overwrite) budgetLines(to).forEach((b) => db.del('budget', b.id));
  const rows = budgetLines(from).map((b) => ({ ...b, id: 'b-' + to + '-' + b.id.split('-').pop() + '-' + Math.random().toString(36).slice(2, 6), cycle: to, paid: 0, _u: undefined, _d: undefined }));
  db.putMany('budget', rows);
  if (!incomeLines(to).length) db.putMany('income', incomeLines(from).map((i) => ({ ...i, id: 'inc-' + to + '-' + i.id.split('-').pop(), cycle: to, source: 'copy' })));
  pocketsList().forEach((p) => {
    if (!db.get('pocket_targets', to + '|' + p.name)) {
      const src = db.get('pocket_targets', from + '|' + p.name) || {};
      db.put('pocket_targets', { id: to + '|' + p.name, cycle: to, pocket: p.name, target: Number(src.target) || 0, paid: 0, timing: src.timing || '', payfrom: src.payfrom || '' });
    }
  });
  return rows.length;
}

// ------------------------------------------------------------------ TL rate recommendation & TL plan
export function rateRecommendation(cycle) {
  let idrOut = 0, tlIn = 0;
  for (const t of txOfCycle(cycle)) {
    if (!/top ?up tl/i.test(t.desc) || /admin/i.test(t.desc)) continue;
    if (!isTRY(t.account) && Number(t.amount) < 0) idrOut += Math.abs(Number(t.amount));
    if (isTRY(t.account) && Number(t.amount) > 0) tlIn += Number(t.amount);
  }
  return { idrOut, tlIn, recommended: tlIn > 0 ? Math.round((idrOut / tlIn) * 100) / 100 : 0 };
}

// ------------------------------------------------------------------ savings, talangan, loans, core assets
export function talanganAll() { return memo('tal', talanganAll_); }
function talanganAll_() {
  const pays = groupBy(db.all('talangan_pay'), (p) => p.talangan);
  return db.all('talangan').sort((a, b) => (a.order || 0) - (b.order || 0)).map((t) => {
    const ps = pays[t.id] || [];
    const paid = sum(ps, (p) => p.amount);
    const harga = Number(t.harga) || 0, dur = Number(t.duration) || 0;
    const sisa = harga - paid;
    const left = Math.max(dur - ps.length, 0);
    const perMonth = left > 0 ? sisa / left : 0;
    const doneIn = t.start ? addMonths(String(t.start).slice(0, 7), Math.max(dur - 1, 0)) : '';
    return { ...t, done: !!Number(t.done), payments: ps, paidTotal: paid, sisa, perMonth, monthsLeft: left, doneIn, collected: paid };
  });
}
export const talanganOpen = () => talanganAll().filter((t) => !t.done);
export function pockets() {
  const log = db.all('saving_log');
  const open = talanganOpen();
  const year = currentCycle().slice(0, 4);
  return pocketsList().map((p) => {
    let actual = 0;
    for (const l of log) {
      if (l.pocket === p.name) actual += Number(l.amount) || 0;
      if (l.talanganTo === p.name) actual -= Number(l.amount) || 0;
    }
    const tal = open.filter((t) => t.usage === p.name);
    const borrowed = sum(tal, (t) => t.collected);
    const targetYear = sum(db.where('pocket_targets', (x) => x.pocket === p.name && x.cycle.startsWith(year)), (x) => x.target);
    const monthlyTarget = pocketTarget(currentCycle(), p.name);
    const calOri = Number(p.calOri) || 0;
    const ori = calOri ? calOri - borrowed : actual - borrowed;
    return { ...p, actual, borrowed, ori, talangan: tal, targetYear, monthlyTarget };
  });
}
export function savingLogSorted() { return db.all('saving_log').sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); }

export function loans() {
  const list = db.all('loans').sort((a, b) => (a.date < b.date ? 1 : -1));
  const outstanding = sum(list.filter((l) => !Number(l.paid)), (l) => l.amount);
  const diary = txSorted(db.where('transactions', (t) => t.category === 'Loan'));
  return { list, outstanding, diary, diaryNet: sum(diary, (t) => txIDR(t)) };
}
export function gold() {
  const rows = db.all('gold').sort((a, b) => (a.date < b.date ? -1 : 1)).map((g) => ({ ...g, total: (Number(g.antam) || 0) + (Number(g.ubs) || 0) + (Number(g.galeri) || 0) }));
  const base = rows[0] ? rows[0].total : 0;
  rows.forEach((g) => { g.untung = g.total - base; g.ret = base ? g.untung / base : 0; });
  const sdb = db.setting('sdb', { keyFee: 750000, annualFee: 200000, ppnPct: 11, years: 1 });
  const annualWithPpn = sdb.annualFee * (1 + sdb.ppnPct / 100);
  const sdbTotal = (sdb.keyFee || 0) + annualWithPpn * (sdb.years || 0);
  const latest = rows[rows.length - 1] || null;
  return { rows, latest, sdb: { ...sdb, annualWithPpn, total: sdbTotal }, gross: latest ? latest.total : 0, net: (latest ? latest.total : 0) - sdbTotal };
}
export function installments(asset) {
  const rows = db.where('installments', (i) => !asset || i.asset === asset).sort((a, b) => (a.date < b.date ? -1 : 1));
  return { rows, paid: sum(rows.filter((r) => Number(r.paid)), (r) => r.value), unpaid: sum(rows.filter((r) => !Number(r.paid)), (r) => r.value) };
}

// ------------------------------------------------------------------ payroll simulator (INCOME_SIMUL model)
export function terLookup(table, gross) {
  let rate = 0;
  for (const [lo, r] of table) { if (gross >= lo) rate = r; else break; }
  return rate;
}
export function simulatePayroll(P, ter, inp) {
  const div = P.unpaidDivisor || 21;
  const maAdj = P.ma * Math.max(30 - (inp.outDays || 0), 0) / 30;
  const la = P.usdPerDay * (inp.usdRate || P.usdRate) * Math.max((inp.workDays || 0) - (inp.absent || 0) - (inp.unpaid || 0), 0);
  const allowance = maAdj + la + P.pa;
  const basic = P.basicBase;
  const unpaidCut = basic / div * (inp.unpaid || 0);
  let taxAllow = 0, rate = 0, gross = 0;
  for (let i = 0; i < 25; i++) {
    gross = basic + allowance + taxAllow + (inp.overtime || 0) + P.jkk - unpaidCut;
    rate = terLookup(ter, gross);
    taxAllow = rate < 1 ? allowance * rate / (1 - rate) : 0;
  }
  const pph = rate * gross;
  const deductions = pph + P.jht * basic + P.jp + P.health + P.jkk;
  const takeHome = gross - deductions;
  return { ma: maAdj, la, pa: P.pa, mid: allowance, basic, ter: rate, gross, pph, deductions, takeHome, end: takeHome - allowance };
}

// ------------------------------------------------------------------ insight
export function insight() {
  const cur = currentCycle();
  const cycles = cyclesWithData();
  const months = cycles.map((c) => {
    const s = cycleSummary(c);
    const b = componentBudgets(c);
    const plan = incomeTotal(c);
    return { cycle: c, isFuture: c > cur, needsSpent: s.needs, needsBudget: b.needs, wantsSpent: s.wants, wantsBudget: b.wants,
      saving: s.saving, giving: s.giving, income: plan > 0 ? plan : s.income, incomeActual: s.income, incomePlan: plan,
      expenses: s.totalExpenses, surplus: (plan > 0 ? plan : s.income) - s.totalExpenses };
  });
  const pk = pockets();
  const ef = pk.find((p) => /emergency/i.test(p.name));
  const tal = talanganOpen();
  return { cur, months, pockets: pk, ef, efJmo: ef ? Number(ef.calJmo) || 0 : 0,
    talanganOutstanding: sum(tal, (t) => t.sisa), talanganCount: tal.length, loans: loans(), gold: gold(), tanah: installments('Tanah') };
}
export function investigate(cycle) {
  const s = cycleSummary(cycle);
  const cur = currentCycle();
  const others = cyclesWithData().filter((c) => c !== cycle && c <= cur && cycleSummary(c).totalExpenses > 0);
  const oSums = others.map(cycleSummary);
  const cats = categories().filter((c) => !['Income', 'Transfer'].includes(c.group)).map((c) => {
    const spent = -(s.byCat[c.name] || 0);
    const avg = oSums.length ? sum(oSums, (o) => -(o.byCat[c.name] || 0)) / oSums.length : 0;
    return { name: c.name, group: c.group, spent, avg, delta: spent - avg };
  }).filter((c) => c.spent !== 0 || c.avg !== 0).sort((a, b) => b.spent - a.spent);
  const driver = cats.reduce((d, c) => (!d || c.delta > d.delta ? c : d), null);
  const topTx = txOfCycle(cycle).map((t) => ({ ...t, idr: txIDR(t) })).filter((t) => t.idr < 0 && t.category && t.category !== 'Transfer')
    .sort((a, b) => a.idr - b.idr).slice(0, 10);
  const inc = incomeTotal(cycle) || s.income;
  return { cycle, income: inc, expenses: s.totalExpenses, gap: inc - s.totalExpenses, categories: cats, driver, topTx, compared: others.length };
}

// ------------------------------------------------------------------ events (trips, hampers, …)
export const events = () => db.all('events').sort((a, b) => (a.start < b.start ? 1 : -1));
export function eventData(id) {
  const ev = db.get('events', id);
  if (!ev) return null;
  const items = db.where('event_items', (x) => x.event === id).sort((a, b) => a.order - b.order);
  const agenda = db.where('event_agenda', (x) => x.event === id).sort((a, b) => a.order - b.order);
  const gear = db.where('event_gear', (x) => x.event === id).sort((a, b) => a.order - b.order);
  const spend = db.where('event_spend', (x) => x.event === id).sort((a, b) => (a.date < b.date ? 1 : -1));
  const planned = sum(items, (x) => x.price);
  const available = (Number(ev.budget) || 0) - planned;
  // food/jajan budget = SUMIF(category = "FOOD"): only items whose category is exactly FOOD
  // (not "budget − other items", which also counted leftover room from unbooked non-food items)
  const foodBudget = sum(items.filter((x) => String(x.category || '').trim().toUpperCase() === 'FOOD'), (x) => Number(x.price) || 0);
  const spent = sum(spend, (x) => x.amount);
  const days = agenda.filter((a) => a.day);
  const daysLeft = days.filter((a) => !Number(a.checked)).length;
  return { ev, items, agenda, gear, spend, planned, available, foodBudget, spent, days, perDay: (foodBudget - spent) / Math.max(daysLeft, 1) };
}

// ------------------------------------------------------------------ long-range plan / forecast
// Lebaran (Idul Fitri) dates → the payroll cycle in which THR & Lebaran giving land.
const LEBARAN = { 2026: '2026-03-20', 2027: '2027-03-10', 2028: '2028-02-27', 2029: '2029-02-15', 2030: '2030-02-05', 2031: '2031-01-25' };
// ------------------------------------------------------------------ cuti ke Indonesia → potongan gaji
// The office follows the Turkish holiday calendar (May 2026 had 16 working days). While in Indonesia:
//  * meal allowance (MA) is prorated by the days outside Turkey (÷30),
//  * the USD lunch allowance isn't paid for absent working days.
// From the Jul–Aug 2026 mudik (28 Jul → 13 Aug: payroll shows 11 absent, 15 days out): the departure
// and return days don't count, and the cut lands in the NEXT payroll cycle (paid on the 15th).
const TR_FIXED = ['01-01', '04-23', '05-01', '05-19', '07-15', '08-30', '10-29'];
const KURBAN = { 2026: '2026-05-27', 2027: '2027-05-16', 2028: '2028-05-05', 2029: '2029-04-24', 2030: '2030-04-13', 2031: '2031-04-02' };
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plusDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return isoDay(d); };
const inRange = (s, from, days) => from && s >= from && s <= plusDays(from, days - 1);
/** Turkish public holiday (approx. ±1 day for the bayrams: Ramazan 3 days, Kurban 4 days). */
export function trHoliday(s) {
  const y = Number(s.slice(0, 4));
  return TR_FIXED.includes(s.slice(5)) || inRange(s, LEBARAN[y], 3) || inRange(s, KURBAN[y], 4);
}
export const isLeaveTrip = (ev) => ev && ev.kind === 'trip' && (Number(ev.leave) === 1 || ((ev.leave === '' || ev.leave == null) && /^ev-cuti-/.test(ev.id)));
/** Days that count for payroll, per payroll cycle that pays them: { cycle: { absent, outDays, trips } }. */
export function leaveDaysByCycle() {
  return memo('leaveDays', () => {
    const out = {};
    for (const ev of db.all('events').filter(isLeaveTrip)) {
      if (!ev.start || !ev.end || ev.end <= ev.start) continue;
      for (let d = plusDays(ev.start, 1); d < ev.end; d = plusDays(d, 1)) {
        const c = addMonths(cycleOf(d), 1);
        const o = (out[c] = out[c] || { absent: 0, outDays: 0, trips: [] });
        o.outDays++;
        const wd = new Date(d + 'T00:00:00').getDay();
        if (wd !== 0 && wd !== 6 && !trHoliday(d)) o.absent++;
        if (!o.trips.includes(ev.name)) o.trips.push(ev.name);
      }
    }
    return out;
  });
}
/** Take-home lost in a payroll cycle because of leave in Indonesia (MA prorata + lunch), incl. TER gross-up effect. */
export function leaveCut(cycle) {
  const L = leaveDaysByCycle()[cycle];
  if (!L) return null;
  const P = db.setting('incomeSim', {});
  if (!P.ma && !P.usdPerDay) return null;
  const ter = db.setting('terTable', []);
  const base = simulatePayroll(P, ter, { workDays: 21, absent: 0, outDays: 0, usdRate: P.usdRate });
  const less = simulatePayroll(P, ter, { workDays: 21, absent: Math.min(L.absent, 21), outDays: Math.min(L.outDays, 30), usdRate: P.usdRate });
  return { ...L, cut: Math.max(0, base.takeHome - less.takeHome), maCut: base.ma - less.ma, lunchCut: base.la - less.la };
}
export const lebaranCycle = (y) => (LEBARAN[y] ? cycleOf(LEBARAN[y]) : y + '-02');
export const lebaranDate = (y) => LEBARAN[y] || '';

export function ruleAmount(r, month) {
  if (Number(r.active) === 0) return 0;
  if (r.start && month < r.start) return 0;
  if (r.end && month > r.end) return 0;
  const years = Math.max(Number(month.slice(0, 4)) - Number((r.start || month).slice(0, 4)), 0);
  const growth = Math.pow(1 + (Number(r.growth) || 0) / 100 * (r.growthPart === '' || r.growthPart == null ? 1 : Number(r.growthPart)), years);
  const amt = (Number(r.amount) || 0) * growth;
  switch (r.freq) {
    case 'monthly': return amt;
    case 'spread': return amt / 12;
    case 'yearly': return month.slice(5) === (r.start || month).slice(5) ? amt : 0;
    case 'lebaran': return lebaranCycle(Number(month.slice(0, 4))) === month ? amt : 0;
    case 'once': return month === r.start ? amt : 0;
    default: return amt;
  }
}
/** Remaining talangan instalments per month from the talangan table (open items only). */
export function talanganSchedule(from, to) {
  const out = {};
  for (const t of talanganOpen()) {
    if (t.sisa <= 0 || t.monthsLeft <= 0) continue;
    const paidCycles = new Set(t.payments.map((p) => p.cycle));
    let m = t.start ? String(t.start).slice(0, 7) : from;
    let left = t.monthsLeft;
    for (let guard = 0; left > 0 && guard < 240; guard++, m = addMonths(m, 1)) {
      if (paidCycles.has(m)) continue;
      if (m < from) { continue; }
      if (m > to) break;
      out[m] = out[m] || [];
      out[m].push({ item: t.item, amount: t.perMonth });
      left--;
    }
  }
  return out;
}
export function projectCost(it, contPct) { return (Number(it.qty) || 0) * (Number(it.price) || 0) * (1 + (Number(it.cont) ? (Number(contPct) || 0) / 100 : 0)); }
export function projectSummary(projectId, option) {
  const p = db.get('projects', projectId);
  if (!p) return null;
  const items = db.where('project_items', (x) => x.project === projectId && (option === 2 ? Number(x.opt2) : Number(x.opt1)));
  const c = (x) => projectCost(x, p.contPct);
  const s1 = items.filter((x) => String(x.stage) === '1'), s2 = items.filter((x) => String(x.stage) !== '1');
  const byMonth = {};
  s1.forEach((x) => { const m = x.month || p.stage1End; byMonth[m] = (byMonth[m] || 0) + c(x); });
  return { project: p, items, stage1: sum(s1, c), stage2: sum(s2, c), material1: sum(s1.filter((x) => x.kind === 'material'), c),
    upah1: sum(s1.filter((x) => x.kind === 'upah'), c), byMonth, realized: sum(items, (x) => x.realized) };
}
/** Month-by-month cash-flow forecast of one scenario, including the project, family loan and talangan. */
export function forecast(scenarioId, { from = currentCycle(), to } = {}) {
  // plan at least through 2030 (the leave schedule & cash-flow projection run to Dec 2030)
  to = to || [db.setting('planHorizon', '2030-12'), '2030-12'].sort().pop();
  const sc = db.get('scenarios', scenarioId);
  const rules = db.where('plan_rules', (r) => r.scenario === scenarioId);
  const items = db.where('plan_items', (r) => r.scenario === scenarioId);
  const prj = db.all('projects')[0];
  const ps = prj ? projectSummary(prj.id, Number(sc?.projectOption) || 1) : null;
  const tal = talanganSchedule(from, to);
  const months = [];
  let bal = 0, loanTotal = 0, rem2 = ps ? ps.stage2 : 0;
  const stage1End = prj?.stage1End || '2027-03';
  // pass 1: loan draws (need total before repayment months)
  const rows = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) {
    const lines = rules.map((r) => ({ r, v: ruleAmount(r, m) })).filter((x) => x.v);
    const income = sum(lines.filter((x) => x.r.group === 'income'), (x) => x.v) + sum(items.filter((i) => i.month === m && i.group === 'income'), (i) => i.amount);
    const out = sum(lines.filter((x) => x.r.group !== 'income'), (x) => x.v) + sum(items.filter((i) => i.month === m && i.group !== 'income'), (i) => i.amount);
    const talM = sum(tal[m] || [], (x) => x.amount);
    const lc = leaveCut(m);
    const cut = lc ? lc.cut : 0;
    if (cut) lines.push({ r: { label: `Potongan cuti ke Indonesia (${lc.absent} hari absen, ${lc.outDays} hari di luar Turki)`, group: 'income' }, v: -cut });
    rows.push({ month: m, income: income - cut, out, talangan: talM, net: income - cut - out - talM, lines, talItems: tal[m] || [], cost1: ps ? (ps.byMonth[m] || 0) : 0, leaveCut: cut });
  }
  for (const row of rows) {
    const inStage1 = row.month <= stage1End;
    row.draw = inStage1 ? Math.max(0, row.cost1 - (bal + row.net)) : 0;
    loanTotal += row.draw;
    bal = bal + row.net + row.draw - row.cost1;
    row.balAfterStage1 = bal;
  }
  const repayStart = prj?.loanRepayStart || addMonths(stage1End, 1);
  const n = Number(prj?.loanMonths) || 24;
  const repayEach = loanTotal * (1 + (Number(prj?.loanMarkupPct) || 0) / 100) / n;
  bal = 0;
  let loanLeft = loanTotal * (1 + (Number(prj?.loanMarkupPct) || 0) / 100), stage2Done = '', stage1Done = '';
  let cum = 0;
  for (const row of rows) {
    row.repay = row.month >= repayStart && monthsBetween(repayStart, row.month) < n ? repayEach : 0;
    loanLeft -= row.repay;
    const avail = bal + row.net + row.draw - row.cost1 - row.repay;
    row.pay2 = row.month > stage1End && rem2 > 0 ? Math.max(0, Math.min(avail, rem2)) : 0;
    rem2 -= row.pay2;
    bal = avail - row.pay2;
    row.balance = bal; row.loanLeft = Math.max(loanLeft, 0); row.rem2 = rem2;
    cum += row.net;
    row.cumNet = cum;
    if (!stage1Done && row.month >= stage1End) stage1Done = row.month;
    if (!stage2Done && ps && rem2 <= 0.5 && row.month > stage1End) stage2Done = row.month;
  }
  const st1Months = rows.filter((r) => r.month <= stage1End);
  return { scenario: sc, project: ps, rows, leaveCutTotal: sum(rows, (r) => r.leaveCut || 0), loanTotal, repayEach, repayStart, loanMonths: n, stage1End,
    ownFunds: sum(st1Months, (r) => r.net), stage2Done, minBalance: Math.min(...rows.map((r) => r.balance)) };
}

// ------------------------------------------------------------------ typical budget & cash-flow projection
// Future cycles that have no budget of their own are projected from the latest budget you set up
// (2026 pattern): recurring lines only (one-offs that appear in a single cycle are left out), the
// latest saving targets, income from the plan's salary assumptions (raise each January, THR in the
// Lebaran cycle) minus the leave-in-Indonesia cut, plus the Lebaran extras from the plan.
export const activeScenario = () => db.all('scenarios').find((s) => Number(s.active) !== 0) || null;
const lineKey = (l) => l.panel + '|' + (l.grp || '') + '|' + l.label;
export function templateCycle(cycle) {
  return memo('tplc|' + cycle, () => [...new Set(db.all('budget').map((b) => b.cycle))].filter((c) => c <= cycle).sort().pop() || '');
}
export function typicalBudget(cycle) {
  return memo('typ|' + cycle, () => {
    const src = templateCycle(cycle);
    const recent = [...new Set(db.all('budget').map((b) => b.cycle))].filter((c) => c <= src).sort().slice(-12);
    const seen = {};
    db.all('budget').filter((b) => recent.includes(b.cycle)).forEach((b) => { (seen[lineKey(b)] = seen[lineKey(b)] || new Set()).add(b.cycle); });
    const lines = src ? budgetLines(src).filter((l) => (seen[lineKey(l)]?.size || 0) >= 2 || recent.length < 2)
      .map((l) => ({ panel: l.panel, grp: l.grp || '', label: l.label, idr: Number(l.idr) || 0, tl: Number(l.tl) || 0, timing: l.timing || '', payfrom: l.payfrom || '', order: l.order })) : [];
    const sc = activeScenario();
    if (sc) db.where('plan_rules', (r) => r.scenario === sc.id && r.freq === 'lebaran' && r.group !== 'income').forEach((r) => {
      const v = ruleAmount(r, cycle);
      if (v) lines.push({ panel: 'GIVING', grp: '', label: r.label, idr: Math.round(v), tl: 0, timing: '', payfrom: '', order: 999, extra: true });
    });
    const tsrc = [...new Set(db.all('pocket_targets').map((t) => t.cycle))].filter((c) => c <= cycle).sort().pop() || '';
    const targets = pocketsList().map((p) => { const t = db.get('pocket_targets', tsrc + '|' + p.name) || {};
      return { pocket: p.name, target: Number(t.target) || 0, timing: t.timing || '', payfrom: t.payfrom || '' }; });
    const panel = (k) => sum(lines.filter((l) => l.panel === k), (l) => l.idr);
    return { src, tsrc, lines, targets, needs: panel('NEEDS'), wants: panel('WANTS'), giving: panel('GIVING'), saving: sum(targets, (t) => t.target) };
  });
}
export function projectedIncome(cycle) {
  return memo('pinc|' + cycle, () => {
    const P = db.setting('incomeSim', {});
    const sim = P.basicBase ? simulatePayroll(P, db.setting('terTable', []), { workDays: 21, usdRate: P.usdRate }) : null;
    const sc = activeScenario();
    const rules = sc ? db.where('plan_rules', (r) => r.scenario === sc.id && r.group === 'income') : [];
    let salary = sum(rules.filter((r) => r.freq !== 'lebaran'), (r) => ruleAmount(r, cycle));
    const thr = sum(rules.filter((r) => r.freq === 'lebaran'), (r) => ruleAmount(r, cycle));
    if (!salary && sim) salary = sim.takeHome;
    const lc = leaveCut(cycle);
    const cut = lc ? lc.cut : 0;
    const mid0 = sim ? Math.min(sim.mid, salary) : salary / 2;
    return { mid: Math.round(mid0 - cut), end: Math.round(salary - mid0), thr: Math.round(thr), leaveCut: Math.round(cut), leave: lc, total: Math.round(salary - cut + thr) };
  });
}
/** Write the typical budget (+ projected income lines & saving targets) into an empty cycle. */
export function applyTypical(cycle) {
  if (budgetLines(cycle).length) return 0;
  const T = typicalBudget(cycle);
  db.putMany('budget', T.lines.map((l, i) => ({ id: 'b-' + cycle + '-t' + i + '-' + Math.random().toString(36).slice(2, 6), cycle, panel: l.panel, grp: l.grp, label: l.label,
    idr: l.idr, tl: l.tl, paid: 0, timing: l.timing, payfrom: l.payfrom, order: l.order ?? i })));
  T.targets.forEach((t) => { if (!db.get('pocket_targets', cycle + '|' + t.pocket)) db.put('pocket_targets', { id: cycle + '|' + t.pocket, cycle, pocket: t.pocket, target: t.target, paid: 0, timing: t.timing, payfrom: t.payfrom }); });
  if (!incomeLines(cycle).length) {
    const I = projectedIncome(cycle);
    const inc = [['mid', 'MA + PA (gaji mid)' + (I.leaveCut ? ' − potongan cuti' : ''), I.mid], ['end', 'Payroll minus pajak (gaji end)', I.end], ['thr', 'THR', I.thr]].filter(([, , v]) => v);
    db.putMany('income', inc.map(([leg, label, amount]) => ({ id: 'inc-' + cycle + '-' + leg, cycle, leg, label, amount, source: 'sim' })));
  }
  return T.lines.length;
}
/** Month-by-month cash flow to `to` (default Dec 2030): income − budget − talangan, then the room project (Planning Kamar). */
export function cashflowProjection(scenarioId, { from = currentCycle(), to = '2030-12' } = {}) {
  return memo('cf|' + scenarioId + '|' + from + '|' + to, () => {
    const F = scenarioId ? forecast(scenarioId, { from, to }) : null;
    const fr = {}; (F ? F.rows : []).forEach((r) => { fr[r.month] = r; });
    const tal = talanganSchedule(from, to);
    const rows = [];
    let cum = 0;
    for (let c = from; c <= to; c = addMonths(c, 1)) {
      const own = budgetLines(c).length > 0;
      const T = own ? null : typicalBudget(c);
      const hasInc = incomeLines(c).length > 0;
      const I = hasInc ? null : projectedIncome(c);
      const cb = own ? componentBudgets(c) : null;
      const hasTargets = pocketsList().some((p) => db.get('pocket_targets', c + '|' + p.name));
      const r = {
        month: c, projected: !own, incomeProjected: !hasInc,
        income: hasInc ? incomeTotal(c) : I.total, thr: hasInc ? incomeLeg(c, 'thr') : I.thr, leaveCut: hasInc ? 0 : I.leaveCut,
        needs: own ? cb.needs : T.needs, wants: own ? cb.wants : T.wants, giving: own ? cb.giving : T.giving,
        saving: own || hasTargets ? (cb ? cb.saving : componentBudgets(c).saving) : T.saving,
        talangan: sum(tal[c] || [], (x) => x.amount), talItems: tal[c] || [],
        kamarOwn: fr[c] ? Math.max(0, (fr[c].cost1 || 0) - (fr[c].draw || 0)) : 0, repay: fr[c] ? fr[c].repay || 0 : 0,
      };
      r.budget = r.needs + r.wants + r.giving + r.saving;
      r.net = r.income - r.budget - r.talangan;
      r.afterKamar = r.net - r.kamarOwn - r.repay;
      cum += r.afterKamar; r.cum = cum;
      rows.push(r);
    }
    return { rows, scenario: F?.scenario || null };
  });
}

// RINGKASAN tab for the spreadsheet (plain values)
export function summaryTable() {
  const head = [['Siklus', 'Mulai', 'Pemasukan (budget)', 'Pemasukan (tercatat)', 'Needs', 'Wants', 'Giving', 'Saving', 'Loan', 'Total pengeluaran', 'Surplus', 'Budget Needs', 'Budget Wants', 'Kurs TL']];
  const rows = cyclesWithData().map((c) => {
    const s = cycleSummary(c); const b = componentBudgets(c);
    return [c, c + '-15', incomeTotal(c), Math.round(s.income), Math.round(s.needs), Math.round(s.wants), Math.round(s.giving), Math.round(s.saving),
      Math.round(s.loan), Math.round(s.totalExpenses), Math.round((incomeTotal(c) || s.income) - s.totalExpenses), b.needs, b.wants, rateFor(c)];
  });
  return head.concat(rows, [[''], ['Ditulis ulang otomatis oleh app pada ' + new Date().toLocaleString('id-ID')]]);
}
export { todayStr, parseDate };
