// Beranda — launcher home: greeting + period switcher, total-saldo hero (hide toggle),
// feature grid, Saldo Real Time (ATM-card tiles coloured per bank), and the budget Ringkasan.
import * as M from '../model.js';
import { fmtIDR, fmtMoney, BULAN, currentCycle, cycleLabel, cyclePeriod, addMonths, esc } from '../util.js';
import { card, bar, moneyCls, empty } from '../ui.js';

let homeCyc = null; // selected period; defaults to the current cycle

const S = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICON = {
  wallet: S('<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1H5.5A2.5 2.5 0 0 1 3 7.5Z"/><path d="M3 7.5V17a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3"/><path d="M20 10v4h-4a2 2 0 0 1 0-4Z"/>'),
  card: S('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 9.5h18"/><path d="M6.5 15h3"/>'),
  receipt: S('<path d="M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.5V3Z"/><path d="M9 8h6M9 12h6M9 16h3"/>'),
  chart: S('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  map: S('<path d="m9 4 6 2 6-2v14l-6 2-6-2-6 2V6l6-2Z"/><path d="M9 4v14M15 6v14"/>'),
  plane: S('<path d="M2 16.5 21 11a2 2 0 0 0-1.3-3.7l-4.2.9-5-4.7-2 .5 2.8 5.2-3.9.8-2-1.6-1.6.4 1.9 4"/>'),
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  gear: S('<circle cx="12" cy="12" r="3.2"/><path d="M19.4 12.9a7.6 7.6 0 0 0 0-1.8l1.8-1.4-1.8-3.1-2.2.7a7.4 7.4 0 0 0-1.6-.9L15 3h-6l-.3 2.4a7.4 7.4 0 0 0-1.6.9l-2.2-.7-1.8 3.1 1.8 1.4a7.6 7.6 0 0 0 0 1.8l-1.8 1.4 1.8 3.1 2.2-.7c.5.4 1 .7 1.6.9L9 21h6l.3-2.4c.6-.2 1.1-.5 1.6-.9l2.2.7 1.8-3.1-1.8-1.4Z"/>'),
  eye: S('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: S('<path d="m3 3 18 18"/><path d="M10.6 6.2A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a18.5 18.5 0 0 1-3.1 3.9M6.6 6.6A18.4 18.4 0 0 0 2 12s3.5 7 10 7a10.8 10.8 0 0 0 4-.8"/><path d="M9.5 9.6A3 3 0 0 0 14.4 14"/>'),
};

const FEATURES = [
  ['saving', 'Tabungan', 'wallet'], ['kredit', 'Kredit', 'card'], ['budget', 'Budget', 'receipt'], ['insight', 'Insight', 'chart'],
  ['plan', 'Rencana', 'map'], ['trip', 'Trip', 'plane'], ['add', 'Catat', 'plus'], ['settings', 'Pengaturan', 'gear'],
];

// Each bank's signature colour, ATM-card style. [background, text, muted-text]
const ACCT_THEME = {
  'AKBANK': ['linear-gradient(135deg,#e4002b,#9a0020)', '#ffffff', 'rgba(255,255,255,.72)'],
  'Mandiri': ['linear-gradient(135deg,#ffd14a,#e0a000)', '#2a2000', 'rgba(42,32,0,.6)'],
  'Kartu Kredit Mandiri': ['linear-gradient(135deg,#ffcf3f,#d59300)', '#2a2000', 'rgba(42,32,0,.62)'],
  'Bank Jago': ['linear-gradient(135deg,#ffd43b,#f1b000)', '#1a1400', 'rgba(26,20,0,.62)'],
  'Bank Jago Saver': ['linear-gradient(135deg,#2c2c2c,#0e0e0e)', '#ffd43b', 'rgba(255,212,59,.7)'],
  'DANA': ['linear-gradient(135deg,#2aa4f4,#1174d1)', '#ffffff', 'rgba(255,255,255,.78)'],
  'Gopay': ['linear-gradient(135deg,#00c4b4,#0096c7)', '#ffffff', 'rgba(255,255,255,.82)'],
  'Bibit': ['linear-gradient(135deg,#0f8a4e,#073a23)', '#eafff2', 'rgba(234,255,242,.72)'],
};
const DEFAULT_THEME = ['linear-gradient(135deg,#3a4663,#232c42)', '#eaf0fb', 'rgba(234,240,251,.6)'];
const KIND = { bank: 'Bank', cash: 'Tunai', ewallet: 'E-Wallet', investment: 'Investasi', credit: 'Kartu Kredit' };

function acctTheme(name) {
  if (ACCT_THEME[name]) return ACCT_THEME[name];
  const n = String(name).toLowerCase();
  if (n.includes('akbank')) return ACCT_THEME['AKBANK'];
  if (n.includes('jago') && (n.includes('sav') || n.includes('tabung'))) return ACCT_THEME['Bank Jago Saver'];
  if (n.includes('jago')) return ACCT_THEME['Bank Jago'];
  if (n.includes('mandiri')) return ACCT_THEME['Mandiri'];
  if (n.includes('dana')) return ACCT_THEME['DANA'];
  if (n.includes('gopay') || n.includes('gojek')) return ACCT_THEME['Gopay'];
  if (n.includes('bibit')) return ACCT_THEME['Bibit'];
  return DEFAULT_THEME;
}

const nav = (p) => window.__hub && window.__hub.nav(p);
// which accounts show immediately on Beranda; the rest hide behind "Lihat semua akun"
const PRIMARY = ['AKBANK', 'Mandiri', 'Bank Jago'];
// pin a card to a column for the landscape 2-column split (app.js reads data-col)
const pin = (html, col) => html.replace('<div class="card"', `<div class="card" data-col="${col}"`);

function acctCard(a, hide) {
  const [bg, fg, sub] = acctTheme(a.name);
  const bal = hide ? '••••••' : fmtMoney(a.value, a.currency);
  const line2 = a.currency === 'TRY' ? (hide ? '' : '≈ ' + fmtIDR(a.idr)) : (KIND[a.kind] || a.kind);
  return `<div class="acct-card" style="background:${bg};color:${fg}">
    <div class="ac-chip"></div>
    <div class="ac-top"><span class="ac-name">${esc(a.name)}</span><span class="ac-kind" style="color:${sub}">${esc(KIND[a.kind] || a.kind)}</span></div>
    <div class="ac-bal">${bal}</div>
    <div class="ac-sub" style="color:${sub}">${esc(line2)}</div>
  </div>`;
}

function ringkasan(cyc) {
  const s = M.cycleSummary(cyc), b = M.componentBudgets(cyc), inc = M.incomeTotal(cyc) || s.income;
  const sisa = inc - s.totalExpenses;
  const comps = [['Needs', s.needs, b.needs, M.subsOf(cyc, 'Needs')], ['Wants', s.wants, b.wants, M.subsOf(cyc, 'Wants')],
    ['Saving', s.saving, b.saving, []], ['Giving', s.giving, b.giving, []]];
  const body = `<div class="rk-sisa"><span>Sisa bulan ini</span><b class="${moneyCls(sisa)}">${fmtIDR(sisa)}</b></div>` +
    comps.map(([n, spent, bud, subs]) => `<details class="comp"><summary><div class="row1"><span>${n}</span><span>${fmtIDR(spent)}</span></div>
      <div class="row2"><span>dari ${fmtIDR(bud)}</span><span class="${bud - spent < 0 ? 'neg' : ''}">sisa ${fmtIDR(bud - spent)}</span></div>${bar(spent, bud, bud > 0 && spent > bud)}</summary>
      ${subs.filter((x) => x.spent).map((x) => `<div class="s"><span>${esc(x.name)}</span><span>${fmtIDR(x.spent)}</span></div>`).join('')}</details>`).join('');
  return card('Ringkasan · ' + cyclePeriod(cyc), body, `<button class="refresh" data-nav="budget">Atur budget ›</button>`);
}

export function render(el) {
  const cyc = homeCyc || currentCycle();
  const t = M.totals(cyc);
  const s = M.cycleSummary(cyc);
  const inc = M.incomeTotal(cyc) || s.income;
  // TOTAL SALDO = Pemasukan − Pengeluaran this cycle (real-time; drops as expenses are recorded).
  // fmtIDR rounds, so no decimals are ever shown.
  const net = inc - s.totalExpenses;
  const hide = localStorage.getItem('hub.hideBal') === '1';
  const money = (v) => (hide ? 'Rp ••••••' : fmtIDR(v));
  const h = new Date().getHours();
  const greet = h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 19 ? 'Selamat sore' : 'Selamat malam';
  const name = localStorage.getItem('hub.name') || 'Izud';

  // Saldo Real Time lives in the hero now (highlighted strip under the period switcher):
  // AKBANK / Mandiri / Bank Jago show first, the rest follow in the same horizontal swipe row.
  const prim = PRIMARY.map((n) => t.list.find((a) => a.name === n)).filter(Boolean);
  const ordered = [...prim, ...t.list.filter((a) => !prim.includes(a))];
  const strip = `<div class="hh-saldo-lbl">SALDO REAL TIME</div>
    <div class="hero-saldo">${ordered.map((a) => acctCard(a, hide)).join('')}</div>`;

  const hero = `<div class="hero home-hero">
    <div class="hh-top">
      <div><div class="hh-greet">${greet},</div><div class="hh-name">${esc(name)}!</div>
        <div class="hh-period"><button class="hp-btn" data-cyc="prev" aria-label="Bulan sebelumnya">‹</button><span class="hp-lbl">${cycleLabel(cyc, true)}</span><button class="hp-btn" data-cyc="next" aria-label="Bulan berikutnya">›</button></div>
      </div>
      <button class="hh-eye" data-eye aria-label="Sembunyikan / tampilkan saldo">${hide ? ICON.eyeOff : ICON.eye}</button>
    </div>
    ${strip}
    <div class="hh-label">TOTAL SALDO</div>
    <div class="hh-total">${money(net)}</div>
    <div class="hh-sub">
      <div class="hh-chip up"><span>▲ Pemasukan</span><b>${hide ? 'Rp ••••' : fmtIDR(inc)}</b></div>
      <div class="hh-chip down"><span>▼ Pengeluaran</span><b>${hide ? 'Rp ••••' : fmtIDR(s.totalExpenses)}</b></div>
    </div></div>`;

  const grid = card('', `<div class="hf-grid">${FEATURES.map(([pg, label, ic]) =>
    `<button class="hf" data-nav="${pg}"><span class="hf-ic">${ICON[ic]}</span><span class="hf-l">${esc(label)}</span></button>`).join('')}</div>`);

  // Landscape split: left column = menu, right column = ringkasan (hero + its saldo strip span the top).
  el.innerHTML = hero + pin(grid, 'l') + pin(ringkasan(cyc), 'r');

  el.querySelectorAll('[data-nav]').forEach((b) => (b.onclick = () => nav(b.dataset.nav)));
  const eye = el.querySelector('[data-eye]');
  if (eye) eye.onclick = () => { localStorage.setItem('hub.hideBal', hide ? '0' : '1'); window.__hub.refresh(); };
  el.querySelectorAll('[data-cyc]').forEach((b) => (b.onclick = () => { homeCyc = addMonths(cyc, b.dataset.cyc === 'next' ? 1 : -1); window.__hub.refresh(); }));
}
