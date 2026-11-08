// Transaksi — full transaction history with smart search + cycle / account filters.
import * as db from '../db.js';
import * as M from '../model.js';
import { esc, fmtIDR, currentCycle, cycleLabel } from '../util.js';
import { $, card, empty } from '../ui.js';
import { txRow, editTx } from './add.js';

const st = { cycle: null, acc: '', cat: '', all: false, search: '' };
const catMatch = (t) => !st.cat || t.category === st.cat;

const normalize = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
function matchTx(t, tokens) {
  const hay = normalize([t.desc, t.category, t.account, t.to, t.note, t.date, t.amount, Math.abs(t.amount), fmtIDR(Math.abs(M.txIDR(t))), t.link ? 'transfer' : ''].join(' '));
  return tokens.every((tok) => hay.includes(tok));
}
function listHTML() {
  const q = normalize(st.search), searching = !!q;
  let list, total;
  if (searching) {
    const tokens = q.split(' ');
    list = M.txSorted(db.all('transactions')).filter((t) => (!st.acc || t.account === st.acc || t.to === st.acc) && catMatch(t) && matchTx(t, tokens));
    total = list.length; list = list.slice(0, 100);
  } else {
    list = M.txSorted(M.txOfCycle(st.cycle)).filter((t) => (!st.acc || t.account === st.acc || t.to === st.acc) && catMatch(t));
    total = list.length; if (!st.all) list = list.slice(0, 20);
  }
  const head = searching ? `<div class="note" style="margin:0 0 6px">Cari di semua riwayat — <b>${total}</b> cocok${total > 100 ? ' (100 teratas)' : ''}</div>` : '';
  return head + (list.length ? list.map(txRow).join('') : empty(searching ? 'Tidak ada yang cocok' : 'Belum ada transaksi'));
}

export function render(el, S) {
  const cur = currentCycle();
  st.cycle = st.cycle || cur;
  const cycles = M.cyclesWithData().slice().reverse();
  if (!cycles.includes(st.cycle)) cycles.unshift(st.cycle);
  const searching = !!normalize(st.search);
  const cats = M.categoryNames();
  el.innerHTML = card('Riwayat Transaksi', `<div class="hist-controls">
      <input id="txSearch" type="search" inputmode="search" autocomplete="off" placeholder="🔍 Cari transaksi/transfer — mis. jago, migros, 150" value="${esc(st.search || '')}">
      <div class="flex3" style="margin-top:8px">
      <select id="txCycle">${cycles.map((c) => `<option value="${c}"${c === st.cycle ? ' selected' : ''}>${cycleLabel(c, true)}${c === cur ? ' (skr)' : ''}</option>`).join('')}</select>
      <select id="txAcc"><option value="">Semua akun</option>${M.accountNames().map((a) => `<option${a === st.acc ? ' selected' : ''}>${esc(a)}</option>`).join('')}</select></div>
      <div class="flex3">
      <select id="txCat"><option value="">Semua kategori</option>${cats.map((c) => `<option${c === st.cat ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <button class="btn small ghost" id="txMore"${searching ? ' style="display:none"' : ''}>${st.all ? 'Ringkas' : 'Semua'}</button></div></div>
    <div id="txList">${listHTML()}</div>`);

  el.querySelectorAll('[data-tx]').forEach((n) => n.addEventListener('click', () => editTx(n.dataset.tx)));
  $('txCycle').onchange = (e) => { st.cycle = e.target.value; render(el, S); };
  $('txAcc').onchange = (e) => { st.acc = e.target.value; render(el, S); };
  $('txCat').onchange = (e) => { st.cat = e.target.value; render(el, S); };
  $('txMore').onclick = () => { st.all = !st.all; render(el, S); };
  $('txSearch').addEventListener('input', (e) => {
    st.search = e.target.value;
    const ll = $('txList'); if (ll) ll.innerHTML = listHTML();
    ll.querySelectorAll('[data-tx]').forEach((n) => n.addEventListener('click', () => editTx(n.dataset.tx)));
    const m = $('txMore'); if (m) m.style.display = normalize(st.search) ? 'none' : '';
  });
}
