// Formatting, parsing, dates & payroll cycles. No DOM, no state.
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function fmtIDR(n) {
  if (n == null || isNaN(n)) return '–';
  const neg = n < 0;
  return (neg ? '-' : '') + 'Rp ' + Math.round(Math.abs(n)).toLocaleString('id-ID');
}
export function fmtTL(n) {
  if (n == null || isNaN(n)) return '–';
  return '₺' + Number(n).toLocaleString('tr-TR', { maximumFractionDigits: 2 });
}
export function fmtShort(n) {
  n = Number(n) || 0;
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'M';
  if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'jt';
  if (a >= 1e3) return Math.round(n / 1e3) + 'rb';
  return String(Math.round(n));
}
export const fmtMoney = (n, cur) => (cur === 'TRY' ? fmtTL(n) : fmtIDR(n));
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

/** Amount fields accept arithmetic: "1155.88-240-150", "(150*2)+200". Comma = decimal point. */
export function parseAmount(s) {
  s = String(s == null ? '' : s).replace(/\s/g, '').replace(/,/g, '.');
  if (!s) return 0;
  if (/^-?[0-9.]+$/.test(s)) return parseFloat(s) || 0;
  if (!/^[0-9+\-*/().]+$/.test(s)) return 0;
  try {
    const v = Function('"use strict";return (' + s + ')')();
    return typeof v === 'number' && isFinite(v) ? v : 0;
  } catch { return 0; }
}

export const uid = (p = '') => p + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  : Math.random().toString(36).slice(2, 14));

// ---- dates (local, 'YYYY-MM-DD') ----
export function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export const parseDate = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
export function weekday(s) { return ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'][parseDate(s).getDay()]; }

// ---- payroll cycles: cycle 'YYYY-MM' runs from day `startDay` of that month to startDay-1 of the next ----
let START_DAY = 15;
export const setCycleStartDay = (d) => { START_DAY = Number(d) || 15; };
export function cycleOf(dateStr) {
  const d = parseDate(dateStr);
  let y = d.getFullYear(), m = d.getMonth();
  if (d.getDate() < START_DAY) { m -= 1; if (m < 0) { m = 11; y -= 1; } }
  return y + '-' + String(m + 1).padStart(2, '0');
}
export const currentCycle = () => cycleOf(todayStr());
export function addMonths(cycle, n) {
  let [y, m] = cycle.split('-').map(Number);
  m += n;
  y += Math.floor((m - 1) / 12);
  m = ((m - 1) % 12 + 12) % 12 + 1;
  return y + '-' + String(m).padStart(2, '0');
}
export function monthsBetween(a, b) { // b - a in months
  const [ya, ma] = a.split('-').map(Number), [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}
export function cycleLabel(c, long) {
  const [y, m] = c.split('-').map(Number);
  return BULAN[m - 1] + (long ? ' ' + y : " '" + String(y).slice(2));
}
export function cyclePeriod(c) {
  const n = addMonths(c, 1);
  const [y, m] = c.split('-').map(Number), [y2, m2] = n.split('-').map(Number);
  return `${START_DAY} ${BULAN[m - 1]} ${y} – ${START_DAY - 1} ${BULAN[m2 - 1]} ${y2}`;
}
export function cycleRange(from, to) {
  const out = [];
  for (let c = from; c <= to; c = addMonths(c, 1)) out.push(c);
  return out;
}
export const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
export const groupBy = (arr, f) => arr.reduce((m, x) => { const k = f(x); (m[k] = m[k] || []).push(x); return m; }, {});
export const debounce = (fn, ms) => { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; };
