// Catat: one tab-less form for all entries. The Kategori dropdown (grouped by Needs/Wants/… ) drives it —
// pick a Transfer category and the transfer fields appear; a small Keluar/Masuk switch sets the direction.
import * as db from '../db.js';
import * as M from '../model.js';
import { esc, fmtIDR, fmtTL, fmtMoney, parseAmount, todayStr, cycleOf, cycleLabel, uid } from '../util.js';
import { $, toast, openModal, row } from '../ui.js';

const st = { draft: {} };

const isTransfer = (cat) => M.categoryGroup(cat) === 'Transfer';
const defaultSide = (cat) => (M.categoryGroup(cat) === 'Income' ? 'in' : 'out'); // most categories are money out
const sideOf = (cat) => (isTransfer(cat) ? '' : (st.draft.sign || defaultSide(cat)));
const defaultCat = () => (M.categories().find((c) => c.group === 'Needs') || M.categories()[0] || {}).name || 'Needs - Food';

export function render(el, S) {
  document.body.removeAttribute('data-catat'); // single card with its own 2-column grid
  el.innerHTML = form(st.draft.category || defaultCat());
  bindForm(el, S);
}

// grouped Kategori dropdown: each big group is an <optgroup>, options show the short name
function catSelect(selected) {
  const ORDER = ['Income', 'Needs', 'Wants', 'Invest', 'Giving', 'Saving', 'Loan', 'Pulkam', 'Transfer'];
  const groups = {};
  M.categories().forEach((c) => { (groups[c.group] = groups[c.group] || []).push(c.name); });
  const keys = Object.keys(groups).sort((a, b) => ((ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99)));
  return `<select id="fCategory">${keys.map((g) => `<optgroup label="${esc(g)}">${groups[g]
    .map((n) => `<option value="${esc(n)}"${n === selected ? ' selected' : ''}>${esc(n.replace(g + ' - ', ''))}</option>`).join('')}</optgroup>`).join('')}</select>`;
}

// ------------------------------------------------------------------ form
function form(cat) {
  const accs = M.accountNames();
  const d = st.draft;
  const transfer = isTransfer(cat);
  const side = sideOf(cat);
  const from = d.from || (transfer ? 'Mandiri' : 'AKBANK');
  const date = d.date || todayStr();

  // LEFT column: rate (TRY), amount, direction switch (non-transfer), date, from-account
  let left = rateCard(cycleOf(date));
  left += `<label>Jumlah — bisa rumus, mis. 1155.88-240-150</label><input id="fAmount" class="amount-input" inputmode="decimal" autocomplete="off" value="${esc(d.amount || '')}" placeholder="0"><div class="hint" id="convHint"></div>`;
  if (!transfer) {
    left += `<div class="seg dir-seg" id="dirSeg"><button data-dir="out" class="${side === 'out' ? 'active' : ''}">− Keluar</button><button data-dir="in" class="${side === 'in' ? 'active' : ''}">＋ Masuk</button></div>`;
  }
  left += `<div class="flex2"><div><label>Tanggal</label><input id="fDate" type="date" value="${date}"><div class="note" id="cycleNote"></div></div>
        <div><label>${side === 'in' ? 'Masuk ke akun' : 'Dari akun'}</label><select id="fFrom">${accs.map((a) => `<option${a === from ? ' selected' : ''}>${esc(a)}</option>`).join('')}</select></div></div>`;

  // RIGHT column: category dropdown, then transfer fields (if transfer) or a hint, then description & note
  let right = `<label>Kategori</label>${catSelect(cat)}`;
  if (transfer) {
    const to = d.to || 'AKBANK';
    right += `<label>Ke akun</label><select id="fTo">${accs.map((a) => `<option${a === to ? ' selected' : ''}>${esc(a)}</option>`).join('')}</select>
      <div class="flex2"><div><label>Biaya admin (IDR)</label><input id="fAdmin" inputmode="decimal" value="${esc(d.admin || '')}" placeholder="mis. 2500"></div>
      <div><label>TL diterima (top up)</label><input id="fTl" inputmode="decimal" value="${esc(d.tl || '')}" placeholder="mis. 5000"></div></div>
      <div class="flex2"><div><label>Flip biaya tetap</label><input id="fFlipFixed" inputmode="decimal" value="${db.setting('flip', {}).fixed ?? 68000}"></div>
      <div><label>Flip fee (%)</label><input id="fFlipPct" inputmode="decimal" value="${db.setting('flip', {}).pct ?? 1.5}"></div></div><div class="note" id="flipHint"></div>`;
  } else {
    right += `<div class="note" id="catHint">${catHint(cat)}</div>`;
  }
  right += `<label>Keterangan</label><input id="fDesc" list="descList" value="${esc(d.desc || '')}" placeholder="mis. Migros"><datalist id="descList">${recentDescs(side === 'in').map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
        <label>Catatan (opsional)</label><input id="fNote" value="${esc(d.note || '')}">`;

  return `<div class="card catat-card">
    <div class="catat-2col"><div class="c2col">${left}</div><div class="c2col">${right}</div></div>
    <button class="btn" id="btnSave">Simpan</button></div>`;
}
function recentDescs(income) {
  const seen = new Set();
  const list = M.txSorted(db.all('transactions')).filter((t) => (income ? t.amount > 0 : t.amount < 0));
  for (const t of list) { if (t.desc) seen.add(t.desc); if (seen.size > 40) break; }
  return [...seen];
}
function rateCard(cycle) {
  const r = M.rateFor(cycle), own = M.hasOwnRate(cycle), rec = M.rateRecommendation(cycle);
  return `<div class="ratebar"><div><b>Kurs ${cycleLabel(cycle)}:</b> ₺1 = Rp ${r ? r.toLocaleString('id-ID') : '–'}${own ? '' : ' <span class="badge w">dari siklus lalu</span>'}
    ${rec.recommended ? `<div class="m">Dari top-up siklus ini: <b>${rec.recommended}</b></div>` : ''}</div>
    <div><button class="btn small ghost" data-rate="${cycle}" data-rec="${rec.recommended}">ubah</button></div></div>`;
}
function editRate(cycle, rec) {
  openModal({ title: 'Kurs TL — siklus ' + cycleLabel(cycle, true), sub: 'Semua transaksi TL di siklus ini dikonversi dengan kurs ini (seperti sel L1).',
    fields: [{ k: 'rate', label: 'IDR per ₺1', type: 'number', value: M.rateFor(cycle) || '', note: rec ? 'Rekomendasi dari top-up: <b>' + rec + '</b>' : '' }],
    onSave: (v) => { if (!v.rate) throw new Error('Isi kurs'); M.setRate(cycle, v.rate); toast('Kurs disimpan ✓'); } });
}
function bindForm(el, S) {
  const upd = () => {
    const amt = parseAmount($('fAmount').value);
    const from = $('fFrom').value;
    const date = $('fDate').value || todayStr();
    const c = cycleOf(date);
    $('cycleNote').textContent = '→ siklus ' + cycleLabel(c, true);
    $('convHint').textContent = amt ? (M.isTRY(from) ? fmtTL(amt) + ' ≈ ' + fmtIDR(amt * M.rateFor(c)) : fmtIDR(amt)) : '';
    if ($('flipHint')) {
      const fixed = parseAmount($('fFlipFixed').value), p = parseAmount($('fFlipPct').value), tl = parseAmount($('fTl').value);
      const parts = [];
      const fi = (amt - fixed) / (1 + p / 100);
      if (amt && fi > 0) parts.push(`Input di Flip: <b>${fmtIDR(fi)}</b> (+ ${fmtIDR(fixed)} + ${p}% = ${fmtIDR(amt)})`);
      if (amt && tl > 0) parts.push(`Kurs efektif: <b>₺1 = Rp ${Math.round(amt / tl).toLocaleString('id-ID')}</b>`);
      $('flipHint').innerHTML = parts.join('<br>');
    }
  };
  ['fAmount', 'fDate', 'fFrom', 'fAdmin', 'fTl', 'fFlipFixed', 'fFlipPct'].forEach((id) => $(id) && $(id).addEventListener('input', upd));
  $('fFrom').addEventListener('change', upd);
  // changing category may switch to/from transfer and reset the natural direction → re-render
  $('fCategory').addEventListener('change', () => { saveDraft(); st.draft.category = $('fCategory').value; st.draft.sign = ''; render(el, S); });
  el.querySelectorAll('#dirSeg button').forEach((b) => (b.onclick = () => { saveDraft(); st.draft.sign = b.dataset.dir; render(el, S); }));
  el.querySelectorAll('[data-rate]').forEach((n) => n.addEventListener('click', () => editRate(n.dataset.rate, Number(n.dataset.rec) || 0)));
  upd();
  $('btnSave').onclick = () => save(el, S);
}
function saveDraft() {
  if (!$('fAmount')) return;
  st.draft = { ...st.draft, amount: $('fAmount').value, date: $('fDate').value, from: $('fFrom').value, desc: $('fDesc').value, note: $('fNote').value,
    category: $('fCategory')?.value, to: $('fTo')?.value, admin: $('fAdmin')?.value, tl: $('fTl')?.value };
}
// Trip / mudik spending (tickets, costs during the trip) is paid from the Travelling pocket: it lives in
// the saving domain, so the Pulkam group is kept out of the daily cash flow (Needs/Wants/… totals).
function catHint(c) {
  if (M.categoryGroup(c) === 'Pulkam') return '✈ Biaya trip/mudik (tiket, selama trip) — dibayar dari kantong <b>Travelling</b>, <b>tidak masuk</b> cashflow harian.';
  if (/Transport/i.test(c)) return 'Transport harian (Istanbul Kart, dll.). Tiket mudik/liburan pakai kategori ✈ Pulkam.';
  if (M.categoryGroup(c) === 'Loan') return 'Utang-piutang. Pakai <b>Keluar</b> saat meminjamkan/bayar, <b>Masuk</b> saat menerima.';
  return '';
}
function save(el, S) {
  const amt = parseAmount($('fAmount').value);
  const cat = $('fCategory').value;
  let desc = $('fDesc').value.trim();
  const date = $('fDate').value || todayStr();
  const from = $('fFrom').value, note = $('fNote').value.trim();
  if (!amt) return toast('Isi jumlah');
  if (isTransfer(cat)) {
    const to = $('fTo').value, admin = parseAmount($('fAdmin').value), tl = parseAmount($('fTl').value);
    if (!desc) desc = tl > 0 ? 'Top Up TL' : 'Transfer ' + from + ' to ' + to;
    const link = uid('lk-'), base = { date, category: '', note, link };
    // IDR out (To only for IDR→IDR), admin, +TL on the TL account
    M.saveTx({ ...base, id: uid('tx-'), desc, amount: -Math.abs(amt), account: from, to: tl > 0 ? '' : to });
    if (admin > 0) M.saveTx({ ...base, id: uid('tx-'), desc: 'Admin ' + desc, amount: -Math.abs(admin), account: from, to: '' });
    if (tl > 0) M.saveTx({ ...base, id: uid('tx-'), desc, amount: Math.abs(tl), account: to, to: '' });
    const f = db.setting('flip', {}); const fx = parseAmount($('fFlipFixed').value), fp = parseAmount($('fFlipPct').value);
    if (fx !== f.fixed || fp !== f.pct) db.setSetting('flip', { fixed: fx, pct: fp });
    toast('Transfer tersimpan ✓ (' + (1 + (admin > 0) + (tl > 0)) + ' baris)');
  } else {
    if (!desc) return toast('Isi keterangan');
    const income = (st.draft.sign || defaultSide(cat)) === 'in';
    M.saveTx({ id: uid('tx-'), date, desc, category: cat, amount: income ? Math.abs(amt) : -Math.abs(amt), account: from, to: '', note, link: '' });
    toast('Tersimpan ✓ ' + (income ? '▲ ' : '▼ ') + fmtMoney(amt, M.isTRY(from) ? 'TRY' : 'IDR'));
  }
  st.draft = { from, date, category: cat, sign: st.draft.sign, to: $('fTo')?.value };
  render(el, S);
}

// ------------------------------------------------------------------ shared with the Transaksi page
export function txRow(t) {
  const tl = M.isTRY(t.account);
  return row(esc(t.desc) + (t.link ? ' <span class="badge">transfer</span>' : ''),
    `${esc(t.date)}${t.category ? ' · ' + esc(t.category) : ''}${t.to ? ' · → ' + esc(t.to) : ''}${t.note ? ' · ' + esc(t.note) : ''}`,
    `<span class="${t.amount > 0 ? 'pos' : ''}">${fmtMoney(t.amount, tl ? 'TRY' : 'IDR')}</span>`,
    (tl ? '≈ ' + fmtIDR(M.txIDR(t)) + ' · ' : '') + esc(t.account), ` data-tx="${esc(t.id)}" role="button" tabindex="0"`);
}
export function editTx(id) {
  const t = db.get('transactions', id);
  if (!t) return;
  openModal({ title: 'Ubah: ' + t.desc, sub: 'Siklus ' + cycleLabel(t.cycle, true) + ' · jumlah bertanda (negatif = keluar)',
    fields: [
      { k: 'date', label: 'Tanggal', type: 'date', value: t.date },
      { k: 'desc', label: 'Keterangan', type: 'text', value: t.desc },
      { k: 'amount', label: 'Jumlah (mata uang akun)', type: 'number', value: t.amount },
      { k: 'category', label: 'Kategori', type: 'select', options: M.categoryNames(), value: t.category, allowEmpty: true },
      { k: 'account', label: 'Akun', type: 'select', options: M.accountNames(), value: t.account },
      { k: 'to', label: 'Ke akun (transfer)', type: 'select', options: M.accountNames(), value: t.to, allowEmpty: true },
      { k: 'note', label: 'Catatan', type: 'text', value: t.note },
      { k: 'idr', label: 'Nilai IDR manual (opsional — kosong = pakai kurs siklus)', type: 'number', value: t.idr ?? '' }],
    onSave: (v) => { M.saveTx({ ...t, ...v, amount: Number(v.amount) || 0, idr: v.idr === '' ? '' : Number(v.idr) }); toast('Diperbarui ✓'); },
    onDelete: () => { db.del('transactions', id); toast('Dihapus ✓'); } });
}
