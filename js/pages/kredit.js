// Kredit: Kartu Kredit (tracker + info penggunaan) dan Pinjaman / piutang.
// Kartu kredit dicatat sebagai akun (kind: 'credit') — belanja = saldo minus (tagihan berjalan),
// bayar tagihan = transfer dari Mandiri ke kartu (saldo kembali 0). Limit & jatuh tempo disimpan di akun.
import * as db from '../db.js';
import * as M from '../model.js';
import { esc, fmtIDR, currentCycle, cycleLabel, todayStr, uid, sum } from '../util.js';
import { $, toast, openModal, tile, tiles, card, row, seg, bindSeg, collapsible, moneyCls, empty } from '../ui.js';
import { txRow, editTx } from './add.js';

const st = { sub: 'kartu', open: { ccUse: true } };

export function render(el, S) {
  if (!['kartu', 'pinjaman'].includes(st.sub)) st.sub = 'kartu';
  let h = seg('kSeg', [['kartu', 'Kartu Kredit'], ['pinjaman', 'Pinjaman']], st.sub);
  if (st.sub === 'kartu') h += cardView();
  if (st.sub === 'pinjaman') h += pinjamanView();
  el.innerHTML = h;
  bindSeg(el, 'kSeg', (k) => { st.sub = k; render(el, S); });
  const on = (sel, fn) => el.querySelectorAll(sel).forEach((n) => n.addEventListener('click', (e) => { e.stopPropagation(); fn(n.dataset); }));
  el.querySelectorAll('[data-toggle]').forEach((n) => n.addEventListener('click', () => { const id = n.dataset.toggle; st.open[id] = !st.open[id]; n.parentElement.classList.toggle('open', st.open[id]); }));
  on('[data-cc]', (d) => editCard(d.cc));
  on('#addCc', () => editCard(null));
  on('[data-ccbuy]', (d) => addPurchase(d.ccbuy));
  on('[data-tx]', (d) => editTx(d.tx));
  on('[data-loan]', (d) => editLoan(d.loan));
  on('#addLoan', () => editLoan(null));
}

// ------------------------------------------------------------------ kartu kredit
const creditAccounts = () => M.accountsNow().filter((a) => a.kind === 'credit');
function cardView() {
  const cards = creditAccounts();
  let h = '';
  if (cards.length) {
    const t = [];
    cards.forEach((a) => {
      const owe = Math.max(0, -a.value); // tagihan berjalan (saldo minus)
      const limit = Number(a.limit) || 0, avail = Math.max(0, limit - owe), util = limit ? Math.round(owe / limit * 100) : 0;
      t.push(tile(esc(a.name), fmtIDR(owe), `<div class="m">tagihan berjalan${a.dueDay ? ' · jatuh tempo tgl ' + esc(String(a.dueDay)) : ''}</div><button class="edit-ico corner" data-cc="${esc(a.name)}">✎</button>`));
      t.push(limit ? tile('Sisa limit', fmtIDR(avail), `<div class="m">limit ${fmtIDR(limit)} · pemakaian <b class="${util > 30 ? 'neg' : 'pos'}">${util}%</b></div>`)
        : tile('Limit', '<span class="m">belum diatur</span>', '<div class="m">ketuk ✎ untuk set</div>'));
    });
    h += tiles(t, 'two');
    h += `<div class="note">Belanja kartu dicatat di sini atau di <b>Catat</b> (akun kartu) → jadi tagihan berjalan. Bayar tagihan = <b>Transfer</b> dari Mandiri ke kartu → saldo kembali 0.</div>`;
    const cur = currentCycle();
    cards.forEach((a) => {
      const txs = M.txSorted(M.txOfCycle(cur)).filter((x) => x.account === a.name || x.to === a.name);
      const spent = sum(txs.filter((x) => x.account === a.name && Number(x.amount) < 0), (x) => Math.abs(Number(x.amount)));
      h += card(`Pembelian ${esc(a.name)} · ${cycleLabel(cur, true)}`,
        `<div class="btotal"><span>Total belanja siklus ini</span><span class="neg">${fmtIDR(spent)}</span></div>` +
        (txs.length ? txs.map(txRow).join('') : empty('Belum ada transaksi kartu')) +
        `<button class="btn fab-add ghost" data-ccbuy="${esc(a.name)}">+ Pembelian kartu</button>`);
    });
  } else {
    h += card('Belum ada kartu kredit aktif', `<div class="note">Rencana apply ada di <b>Trip → "Rencana: Apply Kartu Kredit Mandiri"</b>. Setelah kartu aktif, tambahkan di sini supaya muncul juga di menu Catat.</div><button class="btn small ghost" id="addCc">+ Tambah kartu (set limit & jatuh tempo)</button>`);
  }
  h += collapsible('ccUse', '<div class="nm">💳 Cara pakai yang sehat</div>', `
    <p class="insight-p">• Kartu = <b>alat float, bukan utang</b>. <b>Bayar LUNAS tiap bulan</b> (autodebet dari Mandiri). Jangan pernah revolving — bunga ±1,75%/bln (~26%/th).</p>
    <p class="insight-p">• Gesek <b>hanya yang sudah ada di budget</b> — jangan naikkan Wants.</p>
    <p class="insight-p">• Belanja harian Turki tetap pakai <b>AKBANK (TRY)</b>. Kartu untuk: tiket/booking IDR online, big-ticket + cicilan 0%, dan belanja saat traveling ke luar Turki.</p>
    <p class="insight-p">• Pengeluaran terencana: gesek kartu → bayar lunas dari kantong terkait → <b>EF tidak disentuh</b>.</p>`, st.open.ccUse ?? true);
  h += collapsible('ccTrack', '<div class="nm">📊 Cara tracking & target</div>', `
    <p class="insight-p">• Catat transaksi kartu di <b>Catat → Keluar</b>, pilih akun <b>${cards[0] ? esc(cards[0].name) : 'Kartu Kredit'}</b> → saldo kartu jadi tagihan berjalan (minus).</p>
    <p class="insight-p">• Bayar tagihan: <b>Catat → Transfer</b> dari Mandiri ke kartu → saldo kartu kembali 0.</p>
    <p class="insight-p">• Set <b>limit</b> & <b>tanggal jatuh tempo</b> (✎) → pantau <b>% pemakaian</b> (idealnya &lt; 30% limit).</p>
    <p class="insight-p">• Target: tagihan tiap bulan <b>≤ kemampuan bayar lunas</b>. Cicilan 0% hanya untuk item yang dananya sudah dialokasikan di kantong.</p>`, st.open.ccTrack);
  h += collapsible('ccApply', '<div class="nm">📝 Checklist apply</div>', `
    <p class="insight-p">Checklist lengkap ada di <b>Trip → "Rencana: Apply Kartu Kredit Mandiri"</b>: apply saat mudik Lebaran 2027 (cabang Jakarta, nasabah payroll), minta waiver annual fee + limit, tanya virtual card, alamat kirim ke keluarga, bawa dokumen.</p>`, st.open.ccApply);
  return h;
}
function editCard(name) {
  const raw = name ? db.all('accounts').find((x) => x.name === name)
    : { id: uid('acc-'), name: 'Kartu Kredit Mandiri', currency: 'IDR', kind: 'credit', usable: 0, active: 1, order: db.all('accounts').length, limit: 0, dueDay: '', note: '' };
  openModal({ title: name ? 'Kartu — ' + raw.name : 'Kartu kredit baru', sub: 'Limit & jatuh tempo untuk tracking',
    fields: [
      { k: 'name', label: 'Nama kartu', type: 'text', value: raw.name },
      { k: 'limit', label: 'Limit kartu (IDR, kosong = belum diatur)', type: 'money', value: raw.limit || '' },
      { k: 'dueDay', label: 'Tanggal jatuh tempo (1–28)', type: 'number', value: raw.dueDay || '' },
      { k: 'note', label: 'Catatan', type: 'text', value: raw.note || '' }],
    onSave: (v) => {
      db.put('accounts', { ...raw, name: v.name || raw.name, currency: 'IDR', kind: 'credit', usable: 0, active: 1, limit: Number(v.limit) || 0, dueDay: v.dueDay || '', note: v.note || '' });
      toast('Tersimpan ✓');
    } });
}

// Catat satu pembelian di kartu (bisa diulang untuk beberapa item). Tersimpan sbg transaksi akun kartu.
function addPurchase(cardName) {
  const cats = M.categoryNames().filter((c) => c !== 'Income' && c !== 'Transfer');
  openModal({ title: 'Pembelian kartu', sub: cardName + ' · ulangi untuk tiap item',
    fields: [
      { k: 'desc', label: 'Item / keterangan', type: 'text', value: '' },
      { k: 'amount', label: 'Harga (IDR)', type: 'money', value: '' },
      { k: 'date', label: 'Tanggal', type: 'date', value: todayStr() },
      { k: 'category', label: 'Kategori', type: 'select', options: cats, value: cats[0] },
      { k: 'tenor', label: 'Cicilan 0% (bulan, kosong = bayar penuh)', type: 'number', value: '' },
      { k: 'note', label: 'Catatan', type: 'text', value: '' }],
    onSave: (v) => {
      if (!v.desc) throw new Error('Isi item');
      if (!v.amount) throw new Error('Isi harga');
      const n = Number(v.tenor) || 0;
      const note = [v.note, n > 1 ? `cicilan ${n}x @ ${fmtIDR(Math.round(Number(v.amount) / n))}` : ''].filter(Boolean).join(' · ');
      M.saveTx({ id: uid('tx-'), date: v.date, desc: v.desc, category: v.category, amount: -Math.abs(Number(v.amount)), account: cardName, to: '', note, link: '' });
      toast('Pembelian dicatat ✓');
    } });
}

// ------------------------------------------------------------------ pinjaman / piutang (dipindah dari Tabungan)
function pinjamanView() {
  const L = M.loans();
  let h = tiles([tile('Sisa pinjaman (daftar)', `<span class="${moneyCls(L.outstanding)}">${fmtIDR(L.outstanding)}</span>`), tile('Kategori "Loan" di catatan', `<span class="${moneyCls(L.diaryNet)}">${fmtIDR(L.diaryNet)}</span>`)], 'two');
  h += card('Pinjaman / piutang', L.list.map((l) => row((Number(l.paid) ? '✅ ' : '') + esc(l.name) + (l.pocket ? ` <span class="badge">${esc(l.pocket)}</span>` : ''),
    `${esc(l.date)}${Number(l.paid) && l.paidDate ? ' · lunas ' + esc(l.paidDate) : ''}${l.note ? ' · ' + esc(l.note) : ''}`,
    `<span class="${moneyCls(l.amount)}">${fmtIDR(l.amount)}</span><button class="edit-ico" data-loan="${l.id}">✎</button>`, '', Number(l.paid) ? ' style="opacity:.55"' : '')).join('') +
    '<button class="btn fab-add ghost" id="addLoan">+ Pinjaman baru</button><div class="note">Negatif = uang keluar (dipinjamkan). Positif = kamu meminjam.</div>');
  h += card('Cek silang: transaksi kategori "Loan"', L.diary.slice(0, 30).map((t) => row(esc(t.desc), `${esc(t.date)} · ${esc(t.account)}`, `<span class="${moneyCls(t.amount)}">${fmtIDR(M.txIDR(t))}</span>`)).join('') || empty('Tidak ada'));
  return h;
}
function editLoan(id) {
  const l = id ? db.get('loans', id) : { id: uid('loan-'), date: todayStr(), name: '', amount: 0, pocket: '', paid: 0, paidDate: '', note: '' };
  openModal({ title: id ? l.name : 'Pinjaman baru', sub: 'Negatif = dipinjamkan (uang keluar)',
    fields: [{ k: 'name', label: 'Nama', type: 'text', value: l.name }, { k: 'date', label: 'Tanggal', type: 'date', value: l.date },
      { k: 'amount', label: 'Jumlah (IDR)', type: 'money', value: l.amount || '' }, { k: 'pocket', label: 'Kantong', type: 'select', allowEmpty: true, options: M.pocketsList().map((p) => p.name), value: l.pocket },
      { k: 'paid', label: 'Lunas', type: 'check', value: !!Number(l.paid) }, { k: 'paidDate', label: 'Tanggal lunas', type: 'date', value: l.paidDate }, { k: 'note', label: 'Catatan', type: 'text', value: l.note }],
    onSave: (v) => { if (!v.name) throw new Error('Isi nama'); db.put('loans', { ...l, ...v, amount: Number(v.amount) || 0, paid: v.paid ? 1 : 0 }); toast('Tersimpan ✓'); },
    onDelete: id ? () => db.del('loans', id) : null });
}
