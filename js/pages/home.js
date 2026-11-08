// Beranda — a launcher home: greeting, total-saldo hero (with hide toggle),
// a grid of every feature, the daily "jatah aman" pulse, and recent transactions.
import * as M from '../model.js';
import { fmtIDR, BULAN, currentCycle, esc } from '../util.js';
import { card, row, moneyCls, empty } from '../ui.js';

const S = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICON = {
  wallet: S('<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1H5.5A2.5 2.5 0 0 1 3 7.5Z"/><path d="M3 7.5V17a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3"/><path d="M20 10v4h-4a2 2 0 0 1 0-4Z"/>'),
  card: S('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 9.5h18"/><path d="M6.5 15h3"/>'),
  receipt: S('<path d="M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.5V3Z"/><path d="M9 8h6M9 12h6M9 16h3"/>'),
  chart: S('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  map: S('<path d="m9 4 6 2 6-2v14l-6 2-6-2-6 2V6l6-2Z"/><path d="M9 4v14M15 6v14"/>'),
  plane: S('<path d="M10.5 2.5c.6-.6 1.4-.6 2 0 .5.6.5 1.4 0 2l-3 3 .8 7-1.7 1.2-2-5.3-2.6 2.6.2 2-1.2.9-1.2-2.7L-.4 11l.9-1.2 2 .2 2.6-2.6L-.2 5.4 1 4.2l7 .8 2.5-2.5Z" transform="translate(4 2)"/>'),
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  gear: S('<circle cx="12" cy="12" r="3.2"/><path d="M19.4 12.9a7.6 7.6 0 0 0 0-1.8l1.8-1.4-1.8-3.1-2.2.7a7.4 7.4 0 0 0-1.6-.9L15 3h-6l-.3 2.4a7.4 7.4 0 0 0-1.6.9l-2.2-.7-1.8 3.1 1.8 1.4a7.6 7.6 0 0 0 0 1.8l-1.8 1.4 1.8 3.1 2.2-.7c.5.4 1 .7 1.6.9L9 21h6l.3-2.4c.6-.2 1.1-.5 1.6-.9l2.2.7 1.8-3.1-1.8-1.4Z"/>'),
  eye: S('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: S('<path d="m3 3 18 18"/><path d="M10.6 6.2A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a18.5 18.5 0 0 1-3.1 3.9M6.6 6.6A18.4 18.4 0 0 0 2 12s3.5 7 10 7a10.8 10.8 0 0 0 4-.8"/><path d="M9.5 9.6A3 3 0 0 0 14.4 14"/>'),
};

const FEATURES = [
  ['saving', 'Tabungan', 'wallet'],
  ['kredit', 'Kredit', 'card'],
  ['budget', 'Budget', 'receipt'],
  ['insight', 'Insight', 'chart'],
  ['plan', 'Rencana', 'map'],
  ['trip', 'Trip', 'plane'],
  ['add', 'Catat', 'plus'],
  ['settings', 'Pengaturan', 'gear'],
];

const nav = (p) => window.__hub && window.__hub.nav(p);

function txRow(t) {
  const v = M.txIDR(t);
  const title = t.note || t.category || (t.to ? `${t.account} → ${t.to}` : t.account) || 'Transaksi';
  const sub = [t.category && t.category !== title ? t.category : '', t.account].filter(Boolean).join(' · ');
  return row(esc(title), esc(sub), `<span class="${moneyCls(v)}">${fmtIDR(v)}</span>`, '', ' role="button" data-txnav="1"');
}

export function render(el, St) {
  const cyc = currentCycle();
  const t = M.totals(cyc);
  const s = M.cycleSummary(cyc);
  const hide = localStorage.getItem('hub.hideBal') === '1';
  const money = (v) => (hide ? 'Rp ••••••' : fmtIDR(v));
  const now = new Date(), h = now.getHours();
  const greet = h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 19 ? 'Selamat sore' : 'Selamat malam';
  const name = localStorage.getItem('hub.name') || 'Izud';

  const hero = `<div class="hero home-hero">
    <div class="hh-top">
      <div><div class="hh-greet">${greet},</div><div class="hh-name">${esc(name)}!</div><div class="hh-month">${BULAN[now.getMonth()]} ${now.getFullYear()}</div></div>
      <button class="hh-eye" data-eye aria-label="Sembunyikan / tampilkan saldo">${hide ? ICON.eyeOff : ICON.eye}</button>
    </div>
    <div class="hh-label">TOTAL SALDO</div>
    <div class="hh-total">${money(t.total)}</div>
    <div class="hh-sub">
      <div class="hh-chip up"><span>▲ Pemasukan</span><b>${hide ? 'Rp ••••' : fmtIDR(s.income)}</b></div>
      <div class="hh-chip down"><span>▼ Pengeluaran</span><b>${hide ? 'Rp ••••' : fmtIDR(s.totalExpenses)}</b></div>
    </div></div>`;

  const grid = card('', `<div class="hf-grid">${FEATURES.map(([pg, label, ic]) =>
    `<button class="hf" data-nav="${pg}"><span class="hf-ic">${ICON[ic]}</span><span class="hf-l">${esc(label)}</span></button>`).join('')}</div>`);

  const recent = M.txSorted(M.txOfCycle(cyc)).slice(0, 6);
  const recentCard = card('Transaksi Terakhir', recent.length ? recent.map(txRow).join('') : empty('Belum ada transaksi bulan ini'));

  el.innerHTML = hero + grid + recentCard;

  el.querySelectorAll('.hf[data-nav]').forEach((b) => (b.onclick = () => nav(b.dataset.nav)));
  const eye = el.querySelector('[data-eye]');
  if (eye) eye.onclick = () => { localStorage.setItem('hub.hideBal', hide ? '0' : '1'); window.__hub.refresh(); };
  el.querySelectorAll('[data-txnav]').forEach((r) => (r.onclick = () => nav('add')));
}
