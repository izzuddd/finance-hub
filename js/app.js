// Boot, routing and re-rendering. Everything renders from the local store, so tab switches are instant.
import * as db from './db.js';
import * as M from './model.js';
import * as sync from './sync.js';
import { setCycleStartDay, cycleLabel, currentCycle, fmtIDR } from './util.js';
import { $, toast, closeModal, initMathBar } from './ui.js';
import { CONFIG } from './config.js';
import * as home from './pages/home.js';
import * as transaksi from './pages/transaksi.js';
import * as more from './pages/more.js';
import * as add from './pages/add.js';
import * as budget from './pages/budget.js';
import * as saving from './pages/saving.js';
import * as plan from './pages/plan.js';
import * as insight from './pages/insight.js';
import * as settings from './pages/settings.js';
import * as trip from './pages/trip.js';
import * as kredit from './pages/kredit.js';

const PAGES = {
  home: { title: 'Finance Hub', mod: home },
  transaksi: { title: 'Transaksi', mod: transaksi },
  more: { title: 'Menu Lain', mod: more },
  insight: { title: 'Insight', mod: insight },
  saving: { title: 'Tabungan', mod: saving },
  kredit: { title: 'Kredit', mod: kredit },
  add: { title: 'Catat', mod: add },
  budget: { title: 'Budget', mod: budget },
  plan: { title: 'Rencana', mod: plan },
  trip: { title: 'Trip & Acara', mod: trip },
  settings: { title: 'Pengaturan', mod: settings },
};
const S = { page: 'add' };

function show(page) {
  S.page = page;
  document.body.dataset.page = page;
  if (page !== 'add') document.body.removeAttribute('data-catat'); // only Catat uses the split layout
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  $('pageTitle').textContent = PAGES[page].title;
  localStorage.setItem('hub.page', page);
  paint();
  window.scrollTo(0, 0);
}
// feed the wide/landscape CSS the real header + nav heights so the split panes fit the viewport exactly
function syncLayout() {
  const header = document.querySelector('header'), nav = document.querySelector('nav'), sb = $('syncBar');
  if (!header || !nav) return;
  const top = header.offsetHeight + (sb && sb.classList.contains('show') ? sb.offsetHeight : 0) + 6;
  document.documentElement.style.setProperty('--main-top', top + 'px');
  document.documentElement.style.setProperty('--nav-h', nav.offsetHeight + 'px');
}
// wide screens: split a page's flat card stream into two independently-scrolling columns.
// Leading page controls (seg/cyclebar/tiles/…) stay full-width on top; the rest is balanced by height.
const wideMQ = matchMedia('(min-width: 720px)');
let lastWide = wideMQ.matches;
const TOPBAND = new Set(['seg', 'cyclebar', 'ratebar', 'hero', 'tiles', 'cal-bar', 'chips']);
function applyWideLayout(el) {
  const prebuilt = !!el.querySelector(':scope > .wide-cols'); // our own output, or a page that lays out its own columns (Trip)
  if (!wideMQ.matches) { document.body.removeAttribute('data-split'); return; }
  if (S.page === 'add' && document.body.dataset.catat === 'split') { document.body.removeAttribute('data-split'); return; } // Catat form builds its own split
  if (prebuilt) { document.body.dataset.split = 'cols'; return; } // just activate the fixed-height split layout
  const kids = [...el.children];
  let i = 0; const top = [];
  while (i < kids.length && [...kids[i].classList].some((c) => TOPBAND.has(c))) top.push(kids[i++]);
  const rest = kids.slice(i);
  if (rest.length < 2) { document.body.removeAttribute('data-split'); return; } // not worth splitting
  const heights = rest.map((n) => n.offsetHeight); // measure while still live
  const mk = (cls) => Object.assign(document.createElement('div'), { className: cls });
  const wrapTop = top.length ? mk('wide-top') : null;
  const cols = mk('wide-cols'), colL = mk('pane col-l'), colR = mk('pane col-r');
  cols.append(colL, colR);
  top.forEach((n) => wrapTop.appendChild(n));
  // a page can pin a card to a column with data-col="l|r"; otherwise balance the rest by height
  const forced = rest.some((n) => n.dataset.col);
  let hL = 0, hR = 0;
  rest.forEach((n, k) => {
    const c = forced ? (n.dataset.col || 'l') : (hL <= hR ? 'l' : 'r');
    if (c === 'r') { colR.appendChild(n); hR += heights[k] + 12; } else { colL.appendChild(n); hL += heights[k] + 12; }
  });
  if (wrapTop) el.appendChild(wrapTop);
  el.appendChild(cols);
  document.body.dataset.split = 'cols';
}
function paint() {
  const el = $('view');
  const y = window.scrollY;
  const paneScroll = [...el.querySelectorAll('.pane')].map((p) => p.scrollTop); // keep per-column scroll across repaints
  try { PAGES[S.page].mod.render(el, S); } catch (e) { console.error(e); el.innerHTML = `<div class="card">Terjadi kesalahan: ${e.message}</div>`; }
  applyWideLayout(el);
  el.querySelectorAll('.pane').forEach((p, i) => { if (paneScroll[i] != null) p.scrollTop = paneScroll[i]; });
  window.scrollTo(0, y);
  const r = M.rateFor(currentCycle());
  $('rateLabel').textContent = r ? '₺1 = Rp ' + r : '';
  syncLayout();
}
let paintTimer = null, slowTimer = null, syncStart = 0;
const repaint = () => { if (document.querySelector('#overlay.show')) return; clearTimeout(paintTimer); paintTimer = setTimeout(paint, 30); };

async function boot() {
  await db.load();
  setCycleStartDay(db.setting('cycleStartDay', 15));
  initMathBar();
  window.__hub = { nav: show, refresh: paint }; // Beranda tiles & toggles navigate / re-render through this bridge
  $('verLabel').textContent = 'v' + CONFIG.APP_VERSION;
  $('verLabel').onclick = () => show('settings');
  document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => show(b.dataset.page)));
  const onResize = () => { syncLayout(); if (wideMQ.matches !== lastWide) { lastWide = wideMQ.matches; paint(); } };
  addEventListener('resize', onResize); addEventListener('orientationchange', () => setTimeout(onResize, 140));
  $('gear').onclick = () => show('settings');
  $('overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  new MutationObserver(() => { if (!document.querySelector('#overlay.show')) repaint(); }).observe($('overlay'), { attributes: true, attributeFilter: ['class'] });
  // pages re-render themselves on sub-tab clicks (bypassing paint): re-run the split whenever #view's children change
  new MutationObserver(() => applyWideLayout($('view'))).observe($('view'), { childList: true });
  db.onChange(repaint);
  sync.setSummaryBuilder(M.summaryTable);
  $('syncBar').onclick = () => $('syncDot').click();
  $('syncDot').onclick = () => {
    if (!sync.isConnected()) return show('settings');
    sync.syncNow({ interactive: true }).then(() => toast('Tersinkron ✓')).catch((e) => toast(e.message, 4000));
  };
  sync.onStatus((s) => {
    const d = $('syncDot');
    d.className = 'dot ' + s.state; d.title = s.msg;
    // iPhone has no hover tooltips: show what sync is doing right under the header
    const bar = $('syncBar');
    // a normal background sync stays quiet (just the dot): the entry is already saved on the device.
    // The text line only appears for problems, or once a sync has been running for more than 4 s.
    clearTimeout(slowTimer);
    if (s.state !== 'syncing') syncStart = 0; else if (!syncStart) syncStart = Date.now();
    const showBar = () => {
      const cur = sync.getStatus();
      const vis = ['error', 'auth'].includes(cur.state) || (cur.state === 'syncing' && Date.now() - syncStart >= 4000);
      bar.className = vis ? 'show ' + cur.state : '';
      bar.textContent = vis ? (cur.state === 'syncing' ? '⟳ ' : cur.state === 'error' ? '⚠ ' : '🔑 ') + cur.msg + '  · v' + CONFIG.APP_VERSION : '';
    };
    showBar();
    if (s.state === 'syncing') slowTimer = setTimeout(showBar, Math.max(0, 4000 - (Date.now() - syncStart)) + 20);
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
  show(first ? 'settings' : (localStorage.getItem('hub.page') || 'home'));
  if (first) toast('Selamat datang! Impor data lama atau hubungkan Google Sheets di sini.', 5000);
  // back from a Google login by redirect (home-screen app): finish what the user started
  const back = sync.handleRedirect();
  if (back?.error) toast(back.error, 5000);
  else if (back?.silentFailed) sync.syncNow().catch(() => {}); // Google wants a real login: yellow dot, tap to log in
  else if (back?.after === 'silent') sync.syncNow().catch(() => {});
  else if (back?.after === 'connect') sync.connect().then(() => toast('Terhubung & tersinkron ✓')).catch((e) => toast(e.message, 5000));
  else if (sync.isConnected()) sync.syncNow({ interactive: !!back }).then(() => back && toast('Tersinkron ✓')).catch(() => {});
  // home-screen app opened with an expired Google session: renew it by a ~1 s redirect (no login screen)
  if (!back && sync.isConnected()) setTimeout(() => sync.silentRedirectIfNeeded(), 400);
  // updateViaCache:'none' → the browser revalidates sw.js (and its precache list) on every load instead of
  // trusting its HTTP cache, so a new VERSION is picked up on the next reload. Also nudge an update check,
  // and reload once when a freshly-activated worker takes over so the new files show without manual hard-refresh.
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    const hadController = !!navigator.serviceWorker.controller; // false on first-ever install
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!reloaded && hadController) { reloaded = true; location.reload(); } // a new version just took over → load its files
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => reg.update().catch(() => {})).catch(() => {});
  }
}
// the hidden iframe used for silent token renewal lands on this page: pass the token up and stop
if (!sync.relayToParent()) boot().catch((e) => { document.body.insertAdjacentHTML('beforeend', `<div class="card">Gagal memuat: ${e.message}</div>`); console.error(e); });
