// Boot, routing and re-rendering. Everything renders from the local store, so tab switches are instant.
import * as db from './db.js';
import * as M from './model.js';
import * as sync from './sync.js';
import { setCycleStartDay, cycleLabel, currentCycle, fmtIDR } from './util.js';
import { $, toast, closeModal } from './ui.js';
import * as add from './pages/add.js';
import * as budget from './pages/budget.js';
import * as saving from './pages/saving.js';
import * as plan from './pages/plan.js';
import * as insight from './pages/insight.js';
import * as settings from './pages/settings.js';

const PAGES = {
  insight: { title: 'Insight', mod: insight },
  saving: { title: 'Tabungan', mod: saving },
  add: { title: 'Catat', mod: add },
  budget: { title: 'Budget', mod: budget },
  plan: { title: 'Rencana', mod: plan },
  settings: { title: 'Pengaturan', mod: settings },
};
const S = { page: 'add' };

function show(page) {
  S.page = page;
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  $('pageTitle').textContent = PAGES[page].title;
  localStorage.setItem('hub.page', page);
  paint();
  window.scrollTo(0, 0);
}
function paint() {
  const el = $('view');
  const y = window.scrollY;
  try { PAGES[S.page].mod.render(el, S); } catch (e) { console.error(e); el.innerHTML = `<div class="card">Terjadi kesalahan: ${e.message}</div>`; }
  window.scrollTo(0, y);
  const r = M.rateFor(currentCycle());
  $('rateLabel').textContent = r ? '₺1 = Rp ' + r : '';
}
let paintTimer = null;
const repaint = () => { if (document.querySelector('#overlay.show')) return; clearTimeout(paintTimer); paintTimer = setTimeout(paint, 30); };

async function boot() {
  await db.load();
  setCycleStartDay(db.setting('cycleStartDay', 15));
  document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => show(b.dataset.page)));
  $('gear').onclick = () => show('settings');
  $('overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  new MutationObserver(() => { if (!document.querySelector('#overlay.show')) repaint(); }).observe($('overlay'), { attributes: true, attributeFilter: ['class'] });
  db.onChange(repaint);
  sync.setSummaryBuilder(M.summaryTable);
  $('syncDot').onclick = () => {
    if (!sync.isConnected()) return show('settings');
    sync.syncNow({ interactive: true }).then(() => toast('Tersinkron ✓')).catch((e) => toast(e.message, 4000));
  };
  sync.onStatus((s) => {
    const d = $('syncDot');
    d.className = 'dot ' + s.state; d.title = s.msg;
    if (S.page === 'settings') repaint();
  });
  sync.startAutoSync();
  // dev helper: ?import=<same-origin url> loads an import file (only on localhost)
  const qp = new URLSearchParams(location.search);
  if (qp.get('import') && /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !db.all('transactions').length) {
    const data = await fetch(qp.get('import')).then((r) => r.json());
    await db.replaceAll(data.tables, { markDirty: false });
    setCycleStartDay(db.setting('cycleStartDay', 15));
  }
  const first = !db.all('transactions').length && !db.all('accounts').length;
  show(first ? 'settings' : (localStorage.getItem('hub.page') || 'add'));
  if (first) toast('Selamat datang! Impor data lama atau hubungkan Google Sheets di sini.', 5000);
  // back from a Google login by redirect (home-screen app): finish what the user started
  const back = sync.handleRedirect();
  if (back?.error) toast(back.error, 5000);
  else if (back?.after === 'connect') sync.connect().then(() => toast('Terhubung & tersinkron ✓')).catch((e) => toast(e.message, 5000));
  else if (sync.isConnected()) sync.syncNow({ interactive: !!back }).then(() => back && toast('Tersinkron ✓')).catch(() => {});
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot().catch((e) => { document.body.insertAdjacentHTML('beforeend', `<div class="card">Gagal memuat: ${e.message}</div>`); console.error(e); });
