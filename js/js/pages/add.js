// Catat: expense / income / transfer entry, history, real-time balances, cycle overview.
import * as db from '../db.js';
import * as M from '../model.js';
import { esc, fmtIDR, fmtTL, fmtMoney, parseAmount, todayStr, cycleOf, currentCycle, cycleLabel, cyclePeriod, addMonths, uid, sum } from '../util.js';
import { $, toast, openModal, tile, tiles, card, row, bar, seg, bindSeg, moneyCls, empty } from '../ui.js';

const st = { kind: 'expense', histCycle: null, histAcc: '', histAll: false, draft: {} };

export function render(el, S) {
  const cur = currentCycle();
  st.histCycle = st.histCycle || cur;
  const k = st.kind;
  let h = seg('kindSeg', [['overview', 'Ringkasan'], ['accounts', 'Saldo'], ['expense', 'Keluar'], ['income', 'Masuk'], ['transfer', 'Transfer']], k);
  if (k === 'overview') h += overview(cur);
  else if (k === 'accounts') h += balances(cur);
  else h += form(k) + history();
  el.innerHTML = h;
  bindSeg(el, 'kindSeg', (v) => { saveDraft(); st.kind = v; render(el, S); });
  if (k === 'expense' || k === 'income' || k === 'transfer') bindForm(el, S);
  el.querySelectorAll('[data-tx]').forEach((n) => n.addEventListener('click', () => editTx(n.dataset.tx)));
  el.querySelectorAll('[data-rate]').forEach((n) => n.addEventListener('click', () => editRate(n.dataset.rate, Number(n.dataset.rec) || 0)));
  const hc = $('histCycle'), ha = $('histAcc'), hm = $('histMore');
  if (hc) hc.onchange = () => { st.histCycle = hc.value; render(el, S); };
  if (ha) ha.onchange = () => { st.histAcc = ha.value; render(el, S); };
  if (hm) hm.onclick = () => { st.histAll = !st.histAll; render(el, S); };
}

// ------------------------------------------------------------------ form
function form(k) {
  const accs = M.accountNames(), cats = M.categoryNames();
  const d = st.draft;
  const from = d.from || (k === 'transfer' ? 'Mandiri' : 'AKBANK');
  const date = d.date || todayStr();
  let h = '<div class="card">';
  h += rateCard(cycleOf(date));
  h += `<label>Jumlah — bisa rumus, mis. 1155.88-240-150</label><input id="fAmount" class="amount-input" inputmode="decimal" autocomplete="off" value="${esc(d.amount || '')}" placeholder="0"><div class="hint" id="convHint"></div>`;
  h += `<div class="flex2"><div><label>Tanggal</label><input id="fDate" type="date" value="${date}"><div class="note" id="cycleNote"></div></div>
        <div><label>${k === 'income' ? 'Masuk ke akun' : 'Dari akun'}</label><select id="fFrom">${accs.map((a) => `<option${a === from ? ' selected' : ''}>${esc(a)}</option>`).join('')}</select></div></div>`;
  if (k !== 'transfer') {
    const def = d.category || (k === 'income' ? 'Income' : 'Needs - Food');
    h += `<label>Kategori</label><div class="chips" id="catChips">${cats.filter((c) => (k === 'income' ? /Income|Loan|Saving|Transfer/.test(c) : c !== 'Income'))
      .map((c) => `<button type="button" data-cat="${esc(c)}" class="${c === def ? 'active' : ''}">${esc(c.replace('Needs - ', '').replace('Wants - ', '♥ '))}</button>`).join('')}</div>
      <input type="hidden" id="fCategory" value="${esc(def)}">`;
  } else {
    const to = d.to || 'AKBANK';
    h += `<label>Ke akun</label><select id="fTo">${accs.map((a) => `<option${a === to ? ' selected' : ''}>${esc(a)}</option>`).join('')}</select>
      <div class="flex2"><div><label>Biaya admin (IDR)</label><input id="fAdmin" inputmode="decimal" value="${esc(d.admin || '')}" placeholder="mis. 2500"></div>
      <div><label>TL diterima (top up)</label><input id="fTl" inputmode="decimal" value="${esc(d.tl || '')}" placeholder="mis. 5000"></div></div>
      <div class="flex2"><div><label>Flip biaya tetap</label><input id="fFlipFixed" inputmode="decimal" value="${db.setting('flip', {}).fixed ?? 68000}"></div>
      <div><label>Flip fee (%)</label><input id="fFlipPct" inputmode="decimal" value="${db.setting('flip', {}).pct ?? 1.5}"></div></div><div class="note" id="flipHint"></div>`;
  }
  h += `<label>Keterangan</label><input id="fDesc" list="descList" value="${esc(d.desc || '')}" placeholder="mis. Migros"><datalist id="descList">${recentDescs(k).map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
        <label>Catatan (opsional)</label><input id="fNote" value="${esc(d.note || '')}">
        <button class="btn" id="btnSave">Simpan</button></div>`;
  return h;
}
function recentDescs(k) {
  const seen = new Set();
  const list = M.txSorted(db.all('transactions')).filter((t) => (k === 'income' ? t.amount > 0 : t.amount < 0));
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
  el.querySelectorAll('#catChips button').forEach((b) => b.addEventListener('click', () => {
    el.querySelectorAll('#catChips button').forEach((x) => x.classList.toggle('active', x === b));
    $('fCategory').value = b.dataset.cat;
  }));
  upd();
  $('btnSave').onclick = () => save(el, S);
}
function saveDraft() {
  if (!$('fAmount')) return;
  st.draft = { amount: $('fAmount').value, date: $('fDate').value, from: $('fFrom').value, desc: $('fDesc').value, note: $('fNote').value,
    category: $('fCategory')?.value, to: $('fTo')?.value, admin: $('fAdmin')?.value, tl: $('fTl')?.value };
}
function save(el, S) {
  const amt = parseAmount($('fAmount').value);
  let desc = $('fDesc').value.trim();
  const date = $('fDate').value || todayStr();
  const from = $('fFrom').value, note = $('fNote').value.trim();
  if (!amt) return toast('Isi jumlah');
  if (st.kind === 'transfer') {
    const to = $('fTo').value, admin = parseAmount($('fAdmin').value), tl = parseAmount($('fTl').value);
    if (!desc) desc = tl > 0 ? 'Top Up TL' : 'Transfer ' + from + ' to ' + to;
    const link = uid('lk-'), base = { date, category: '', note, link };
    // same 3-row pattern as the old diary: IDR out (To only for IDR→IDR), admin, +TL on the TL account
    M.saveTx({ ...base, id: uid('tx-'), desc, amount: -Math.abs(amt), account: from, to: tl > 0 ? '' : to });
    if (admin > 0) M.saveTx({ ...base, id: uid('tx-'), desc: 'Admin ' + desc, amount: -Math.abs(admin), account: from, to: '' });
    if (tl > 0) M.saveTx({ ...base, id: uid('tx-'), desc, amount: Math.abs(tl), account: to, to: '' });
    const f = db.setting('flip', {}); const fx = parseAmount($('fFlipFixed').value), fp = parseAmount($('fFlipPct').value);
    if (fx !== f.fixed || fp !== f.pct) db.setSetting('flip', { fixed: fx, pct: fp });
    toast('Transfer tersimpan ✓ (' + (1 + (admin > 0) + (tl > 0)) + ' baris)');
  } else {
    if (!desc) return toast('Isi keterangan');
    const category = $('fCategory').value;
    M.saveTx({ id: uid('tx-'), date, desc, category, amount: st.kind === 'income' ? Math.abs(amt) : -Math.abs(amt), account: from, to: '', note, link: '' });
    toast('Tersimpan ✓ ' + fmtMoney(amt, M.isTRY(from) ? 'TRY' : 'IDR'));
  }
  st.draft = { from, date, category: $('fCategory')?.value, to: $('fTo')?.value };
  st.histCycle = cycleOf(date);
  render(el, S);
}

// ------------------------------------------------------------------ history
function history() {
  const cycles = M.cyclesWithData().slice().reverse();
  if (!cycles.includes(st.histCycle)) cycles.unshift(st.histCycle);
  let list = M.txSorted(M.txOfCycle(st.histCycle)).filter((t) => !st.histAcc || t.account === st.histAcc || t.to === st.histAcc);
  const total = list.length;
  if (!st.histAll) list = list.slice(0, 12);
  return card('Riwayat', `<div class="flex3">
      <select id="histCycle">${cycles.map((c) => `<option value="${c}"${c === st.histCycle ? ' selected' : ''}>${cycleLabel(c, true)}${c === currentCycle() ? ' (sekarang)' : ''}</option>`).join('')}</select>
      <select id="histAcc"><option value="">Semua akun</option>${M.accountNames().map((a) => `<option${a === st.histAcc ? ' selected' : ''}>${esc(a)}</option>`).join('')}</select>
      <button class="btn small ghost" id="histMore">${st.histAll ? 'Ringkas' : 'Semua (' + total + ')'}</button></div>
    ${list.length ? list.map(txRow).join('') : empty('Belum ada transaksi')}`);
}
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

// ------------------------------------------------------------------ balances
function balances(cur) {
  const T = M.totals(cur);
  let h = tiles([tile('Total saldo', fmtIDR(T.total)), tile('Bisa dipakai', fmtIDR(T.usable))], 'two');
  h += card('Saldo real-time · siklus ' + cycleLabel(cur, true), T.list.map((a) => row(esc(a.name) + (a.usable === 0 ? ' <span class="badge">tabungan</span>' : ''),
    a.currency === 'TRY' ? '≈ ' + fmtIDR(a.idr) : esc(a.kind), `<b class="${moneyCls(a.value)}">${fmtMoney(a.value, a.currency)}</b>`)).join('') +
    '<div class="note">Saldo awal siklus diisi di Budget → Siklus. Kalau kosong, dipakai saldo akhir siklus lalu.</div>');
  return h;
}

// ------------------------------------------------------------------ overview
function overview(cur) {
  const s = M.cycleSummary(cur), b = M.componentBudgets(cur), inc = M.incomeTotal(cur) || s.income;
  let h = `<div class="note" style="margin:2px 0 8px">Siklus ${cyclePeriod(cur)}</div>`;
  h += tiles([tile('Pemasukan', fmtIDR(inc)), tile('Pengeluaran', fmtIDR(s.totalExpenses)), tile('Sisa', `<span class="${moneyCls(inc - s.totalExpenses)}">${fmtIDR(inc - s.totalExpenses)}</span>`)]);
  const comps = [['Needs', s.needs, b.needs, M.subsOf(cur, 'Needs')], ['Wants', s.wants, b.wants, M.subsOf(cur, 'Wants')], ['Saving', s.saving, b.saving, []], ['Giving', s.giving, b.giving, []]];
  h += card('Budget vs aktual', comps.map(([n, spent, bud, subs]) => `<details class="comp"><summary><div class="row1"><span>${n}</span><span>${fmtIDR(spent)}</span></div>
      <div class="row2"><span>dari ${fmtIDR(bud)}</span><span class="${bud - spent < 0 ? 'neg' : ''}">sisa ${fmtIDR(bud - spent)}</span></div>${bar(spent, bud, bud > 0 && spent > bud)}</summary>
      ${subs.filter((x) => x.spent).map((x) => `<div class="s"><span>${esc(x.name)}</span><span>${fmtIDR(x.spent)}</span></div>`).join('')}</details>`).join(''));
  const recent = M.txSorted(M.txOfCycle(cur)).slice(0, 8);
  h += card('Transaksi terbaru', recent.length ? recent.map(txRow).join('') : empty('Belum ada'));
  return h;
}
