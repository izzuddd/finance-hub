// More — menu for the pages that aren't in the bottom nav.
import { esc } from '../util.js';
import { card } from '../ui.js';

const S = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICON = {
  chart: S('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  wallet: S('<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1H5.5A2.5 2.5 0 0 1 3 7.5Z"/><path d="M3 7.5V17a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3"/><path d="M20 10v4h-4a2 2 0 0 1 0-4Z"/>'),
  card: S('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 9.5h18"/><path d="M6.5 15h3"/>'),
  map: S('<path d="m9 4 6 2 6-2v14l-6 2-6-2-6 2V6l6-2Z"/><path d="M9 4v14M15 6v14"/>'),
  plane: S('<path d="M2 16.5 21 11a2 2 0 0 0-1.3-3.7l-4.2.9-5-4.7-2 .5 2.8 5.2-3.9.8-2-1.6-1.6.4 1.9 4"/>'),
  gear: S('<circle cx="12" cy="12" r="3.2"/><path d="M19.4 12.9a7.6 7.6 0 0 0 0-1.8l1.8-1.4-1.8-3.1-2.2.7a7.4 7.4 0 0 0-1.6-.9L15 3h-6l-.3 2.4a7.4 7.4 0 0 0-1.6.9l-2.2-.7-1.8 3.1 1.8 1.4a7.6 7.6 0 0 0 0 1.8l-1.8 1.4 1.8 3.1 2.2-.7c.5.4 1 .7 1.6.9L9 21h6l.3-2.4c.6-.2 1.1-.5 1.6-.9l2.2.7 1.8-3.1-1.8-1.4Z"/>'),
};
const MENU = [
  ['insight', 'Insight', 'Grafik, distribusi & cerita keuangan', 'chart'],
  ['saving', 'Tabungan', 'Kantong, talangan, target menabung', 'wallet'],
  ['kredit', 'Kredit', 'Kartu kredit & pinjaman', 'card'],
  ['plan', 'Rencana', 'Proyeksi cashflow & skenario', 'map'],
  ['trip', 'Trip & Acara', 'Trip, mudik, budget per acara', 'plane'],
  ['settings', 'Pengaturan', 'Google Sheets, impor/ekspor, kurs', 'gear'],
];
const nav = (p) => window.__hub && window.__hub.nav(p);

export function render(el) {
  el.innerHTML = card('Menu Lain', `<div class="more-list">${MENU.map(([pg, label, desc, ic]) =>
    `<button class="more-row" data-nav="${pg}"><span class="mr-ic">${ICON[ic]}</span>
      <span class="mr-txt"><span class="mr-l">${esc(label)}</span><span class="mr-d">${esc(desc)}</span></span>
      <span class="mr-chev">›</span></button>`).join('')}</div>`);
  el.querySelectorAll('[data-nav]').forEach((b) => (b.onclick = () => nav(b.dataset.nav)));
}
