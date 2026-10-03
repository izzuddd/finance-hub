// Rencana: two tabs — Trip & acara (trip.js) and Planning Kamar Tinggede: the room project's
// forecast (cash flow, family loan, stage 2), leave-in-Indonesia cuts and the RAB, each in a
// collapsible section so the page stays calm. The plan's assumptions are stored data (no editor).
import * as db from '../db.js';
import * as M from '../model.js';
import { esc, fmtIDR, fmtShort, currentCycle, cycleLabel, addMonths, uid, sum, groupBy } from '../util.js';
import { $, toast, openModal, tile, tiles, card, row, seg, bindSeg, collapsible, lineChart, columns, moneyCls, empty } from '../ui.js';
import * as trip from './trip.js';

const st = { sub: 'acara', sc: null, open: { kCash: false, kRab: false }, section: {} };
const GROUPS = [['income', 'Pemasukan'], ['needs', 'Needs'], ['wants', 'Wants'], ['giving', 'Giving'], ['saving', 'Tabungan'], ['lifestyle', 'Liburan & gaya hidup'], ['buffer', 'Dana cadangan'], ['other', 'Lainnya']];
const FREQ = [['monthly', 'tiap bulan'], ['spread', 'per tahun, dicicil 12×'], ['yearly', 'sekali setahun (bulan mulai)'], ['lebaran', 'sekali setahun di siklus Lebaran'], ['once', 'sekali (bulan mulai)']];

export function render(el, S) {
  if (st.sub !== 'acara' && st.sub !== 'kamar') st.sub = 'kamar';
  const scs = db.all('scenarios').filter((s) => Number(s.active) !== 0);
  st.sc = st.sc && db.get('scenarios', st.sc) ? st.sc : scs[0]?.id;
  let h = seg('pSeg', [['acara', 'Trip & acara'], ['kamar', 'Planning Kamar Tinggede']], st.sub);
  if (st.sub === 'acara') { el.innerHTML = h + '<div id="tripRoot"></div>'; bindSeg(el, 'pSeg', (k) => { st.sub = k; render(el, S); }); return trip.render($('tripRoot'), S); }
  if (!scs.length) { el.innerHTML = h + card('Belum ada skenario', '<div class="note">Skenario dibuat dari file impor (tools/migrate_to_hub.py).</div>'); bindSeg(el, 'pSeg', (k) => { st.sub = k; render(el, S); }); return; }
  h += `<div class="chips">${scs.map((s) => `<button data-sc="${s.id}" class="${s.id === st.sc ? 'active' : ''}">${esc(s.name)}</button>`).join('')}</div>`;
  h += kamarView();
  el.innerHTML = h;
  bindSeg(el, 'pSeg', (k) => { st.sub = k; render(el, S); });
  el.querySelectorAll('[data-sc]').forEach((b) => b.addEventListener('click', () => { st.sc = b.dataset.sc; render(el, S); }));
  el.querySelectorAll('[data-toggle]').forEach((n) => n.addEventListener('click', (e) => { e.stopPropagation(); const id = n.dataset.toggle; st.open[id] = !st.open[id]; n.parentElement.classList.toggle('open', st.open[id]); }));
  el.querySelectorAll('[data-month]').forEach((n) => n.addEventListener('click', () => monthDetail(n.dataset.month)));
  el.querySelectorAll('[data-pi]').forEach((n) => n.addEventListener('click', () => editItem(n.dataset.pi)));
  const bind = (id, fn) => { el.querySelectorAll('#' + id).forEach((n) => { n.onclick = (e) => { e.stopPropagation(); fn(); }; }); };
  bind('editPrj', () => editProject());
  bind('addPi', () => editItem(null));
}

// ------------------------------------------------------------------ forecast
function kamarView() {
  const F = M.forecast(st.sc);
  const p = F.project;
  const rows = F.rows;
  let h = '';
  if (p) {
    h += tiles([
      tile('Biaya tahap 1', fmtIDR(p.stage1), `<div class="m">material ${fmtShort(p.material1)} · upah ${fmtShort(p.upah1)}</div>`),
      tile('Tahap 1 lunas', F.stage1Done ? cycleLabel(F.stage1Done, true) : '<span class="neg">belum s/d ' + cycleLabel(rows[rows.length - 1].month, true) + '</span>', `<div class="m">uang sendiri ${fmtShort(F.ownFunds)}${F.stage1Done && F.stage1Done > (p.project.stage1End || '') ? ' · mundur dari jadwal RAB ' + cycleLabel(p.project.stage1End || '2027-03', true) : ''}</div>`),
      tile('Pinjam ' + esc(p.project.lender || 'keluarga'), `<b class="${F.loanTotal ? 'neg' : 'pos'}">${fmtIDR(F.loanTotal)}</b>`, (F.loanCap < Infinity ? `<div class="m">maks ${fmtShort(F.loanCap)}</div>` : '') + (F.loanTotal ? `<div class="m">${fmtIDR(F.repayEach)}/bln × ${F.loanMonths} mulai ${cycleLabel(F.repayStart, true)}</div>` : '<div class="m">tidak perlu pinjam</div>')),
      F.stage2On ? tile('Tahap lanjutan', fmtIDR(p.stage2), `<div class="m">${F.stage2Done ? 'lunas ±' + cycleLabel(F.stage2Done, true) : 'belum lunas s/d ' + cycleLabel(rows[rows.length - 1].month, true)}</div>`)
        : tile('Tahap lanjutan', '<span class="m">tidak direncanakan</span>', `<div class="m">fokus tahap 1 · RAB lanjutan ${fmtShort(p.stage2)} disimpan</div>`),
    ], 'two');
  }
  const cuts = rows.filter((r) => r.leaveCut);
  if (cuts.length) {
    h += collapsible('leavecuts', `<div class="nm">✈️ Potongan gaji saat cuti<span class="amt">${fmtShort(F.leaveCutTotal)}</span></div>`,
      cuts.map((r) => { const L = M.leaveCut(r.month); return row(cycleLabel(r.month, true), `${esc(L.trips.join(', '))} · ${L.absent} hari absen (lunch) · ${L.outDays} hari di luar Turki (MA)`, `<span class="neg">−${fmtIDR(r.leaveCut)}</span>`, '', ` data-month="${r.month}" role="button"`); }).join('') +
      '<div class="note">Dari jadwal di Trip & acara yang ditandai "cuti ke Indonesia". MA dipotong prorata hari di luar Turki (÷30), lunch USD tidak dibayar di hari kerja yang absen. Hari berangkat & pulang tidak dihitung, potongan masuk di gaji siklus berikutnya (tgl 15) — sama seperti mudik Jul–Agu 2026. Sudah dikurangkan dari proyeksi, pinjaman & tahap lanjutan RAB.</div>', st.open.leavecuts);
  }
  // tip: talangan that starts during stage 1 competes with the build money (e.g. Libur Lebaran)
  const early = M.talanganOpen().filter((t) => t.start && String(t.start).slice(0, 7) >= currentCycle() && String(t.start).slice(0, 7) <= F.stage1End);
  if (early.length && F.loanTotal > 0) {
    const inStage1 = sum(rows.filter((r) => r.month <= F.stage1End), (r) => sum(r.talItems.filter((x) => early.some((t) => t.item === x.item)), (x) => x.amount));
    h += `<div class="alloc"><div class="row"><b>💡 Tips</b><span></span></div><div class="row"><span>${early.map((t) => esc(t.item)).join(', ')} mulai dicicil ${cycleLabel(String(early[0].start).slice(0, 7), true)} — di tengah tahap 1. Geser mulai cicilnya ke ${cycleLabel(addMonths(F.stage1End, 1), true)} (Tabungan → Talangan) dan pinjaman ke ${esc(p?.project.lender || 'keluarga')} berkurang ±<b>${fmtIDR(inStage1)}</b>.</span></div></div>`;
  }
  const lbl = rows.map((r) => cycleLabel(r.month));
  const chart = lineChart(lbl, [
    { name: 'Sisa untuk bangun / nabung', color: '#189a5c', values: rows.map((r) => r.net), area: true },
    { name: 'Sisa pinjaman', color: '#d64545', values: rows.map((r) => r.loanLeft) },
    { name: F.stage2On ? 'Sisa biaya tahap 1 / lanjutan' : 'Sisa biaya tahap 1', color: '#c98a12', values: rows.map((r) => r.rem2) },
  ]) + '<div class="note">Hijau = sisa budget bulan itu (pemasukan − Needs/Wants/Giving − setoran kantong − talangan), sama persis dengan Budget → Proyeksi cashflow. Sisa ini yang membayar tahap 1; kalau kurang, pinjaman menutup sampai batasnya, sisanya menunggu bulan berikutnya.</div>';
  const years = groupBy(rows, (r) => r.month.slice(0, 4));
  let t = '';
  for (const [y, rs] of Object.entries(years)) {
    const body = `<div class="tbl"><div class="th"><span>Bln</span><span>Masuk</span><span>Keluar</span><span>Sisa</span><span>Proyek</span><span>Pinjam</span><span>Saldo</span></div>` +
      rs.map((r) => `<div class="tr" data-month="${r.month}" role="button"><span>${cycleLabel(r.month)}</span><span>${fmtShort(r.income)}</span><span>${fmtShort(r.out + r.talangan)}</span>
        <span class="${moneyCls(r.net)}">${fmtShort(r.net)}</span><span>${r.cost1 ? fmtShort(r.cost1) : r.pay2 ? fmtShort(r.pay2) : ''}</span>
        <span class="${r.draw ? 'pos' : r.repay ? 'neg' : ''}">${r.draw ? '+' + fmtShort(r.draw) : r.repay ? '−' + fmtShort(r.repay) : ''}</span><span class="${moneyCls(r.balance)}">${fmtShort(r.balance)}</span></div>`).join('') + '</div>';
    t += collapsible('y' + y, `<div class="nm">${y}<span class="amt">sisa ${fmtShort(sum(rs, (r) => r.net))}</span></div>`, body, st.open['y' + y] ?? y === currentCycle().slice(0, 4));
  }
  h += collapsible('kCash', `<div class="nm">📈 Arus kas & pinjaman<span class="amt">s/d ${cycleLabel(rows[rows.length - 1].month, true)}</span></div>`, chart + t, st.open.kCash);
  h += collapsible('kPocket', '<div class="nm">👛 Strategi kantong<span class="amt">tanpa cross-kantong</span></div>', pocketStrategy(), st.open.kPocket);
  const opt = Number(F.scenario?.projectOption) || 1;
  const prj = db.all('projects')[0];
  h += collapsible('kRab', `<div class="nm">🧱 RAB kamar<span class="amt">${p ? fmtShort(p.stage1 + p.stage2) + ' · Opsi ' + opt : ''}</span></div>`, projectBody(opt), st.open.kRab);
  if (prj) h += collapsible('kLoan', `<div class="nm">🤝 Skema pinjaman<span class="amt">${esc(prj.lender || '–')} · ${prj.loanMonths || 24} bln</span></div>`,
    row('Pemberi pinjaman', '', esc(prj.lender || '–')) + row('Tahap 1 selesai', '', cycleLabel(prj.stage1End || '2027-03', true)) +
    row('Batas pinjaman', '', Number(prj.loanMax) ? fmtIDR(prj.loanMax) : 'tanpa batas') + row('Mulai cicil', 'sebulan setelah tahap 1 lunas', F.repayStart ? cycleLabel(F.repayStart, true) : '–') +
    row('Lama cicilan', '', (prj.loanMonths || 24) + ' bulan') + row('Tambahan / terima kasih', '', (prj.loanMarkupPct || 0) + '%') + row('Tahap lanjutan', '', Number(prj.stage2On) ? 'ikut direncanakan' : 'tidak (fokus tahap 1)') +
    '<button class="btn small ghost" id="editPrj">✎ Ubah proyek & pinjaman</button>', st.open.kLoan);
  h += collapsible('kHelp', '<div class="nm">ℹ️ Cara membaca</div>', `<p class="insight-p">Satu hitungan dengan Budget: sisa budget tiap bulan membayar tahap 1 sesuai jadwal RAB. Kalau kurang, <b>pinjaman ke ${esc(p?.project.lender || 'keluarga')}</b> menutup sampai batasnya${F.loanCap < Infinity ? ' (' + fmtShort(F.loanCap) + ')' : ''}; kalau masih kurang, pekerjaan menunggu bulan berikutnya — tanpa jual emas, tanpa pinjam antar kantong. Pinjaman dicicil ${F.loanMonths} bulan mulai sebulan setelah tahap 1 lunas.</p>
    <p class="insight-p">Pilih Opsi 1 / Opsi 2 di atas. Potongan gaji saat cuti ikut jadwal di Trip & acara. Arus kas bulanan versi budget ada di <b>Budget → Proyeksi cashflow</b>.</p>`, st.open.kHelp);
  return h;
}
// ------------------------------------------------------------------ pocket strategy (one pocket per goal)
function pocketStrategy() {
  const T = M.typicalBudget(addMonths(currentCycle(), 4));
  const rows = M.pocketsList().map((pk) => {
    const t = T.targets.find((x) => x.pocket === pk.name);
    const [role, note] = M.POCKET_ROLE[pk.name] || ['', ''];
    return row(esc(pk.name) + (role ? ` <span class="badge">${role}</span>` : ''), esc(note), t && t.target ? fmtIDR(t.target) + '/bln' : '—');
  }).join('');
  const tr = M.pocketPlan('Travelling');
  const trips = tr.rows.filter((r) => r.trips.length);
  const trH = trips.map((r) => row(cycleLabel(r.month, true), r.spends.map((x) => esc(x.ev.name.replace(/ \(sementara\)/, '')) + ': ' + esc(x.what.toLowerCase()) + ' ' + fmtShort(x.amount)).join(' · '), `<span class="${moneyCls(r.balance)}">${fmtShort(r.balance)}</span>`)).join('');
  return `<p class="insight-p"><b>Aturan:</b> satu tujuan = satu kantong, disetor rutin tiap gajian. Pengeluaran yang sudah direncanakan selalu dibayar dari kantongnya sendiri — <b>tidak ada pinjam antar kantong</b>, jadi tidak ada cicilan balik yang bisa terlupa.</p>
    ${rows}
    <h4 class="subh">Kantong Travelling vs jadwal liburan</h4>
    <div class="note">Saldo sekarang tercatat ${fmtIDR(tr.start)}. Tiket dibeli ±${M.TICKET_LEAD} bulan sebelum berangkat (perkiraan ${Math.round(M.TICKET_SHARE * 100)}% budget trip, atau persis kalau di trip ada item TIKET bertanggal pesan); sisanya dipakai saat trip. Saldo setelah tiap pengeluaran:</div>${trH || empty('Belum ada trip berbudget')}
    ${tr.low && tr.low.balance < 0 ? `<div class="alloc"><div class="row"><span>⚠ Kantong Travelling minus ${fmtIDR(-tr.low.balance)} di ${cycleLabel(tr.low.month, true)}. Pastikan saldo tercatat memang ada di rekening; kalau kurang, kecilkan budget trip itu atau geser setoran kamar 1–2 bulan.</span></div></div>` : ''}
    <div class="note">Talangan lama (7 cicilan ke Emergency Fund & Wifey's Specialist) tetap jalan sampai lunas ±pertengahan 2027 — sudah dihitung di budget. Setelah itu tidak ada talangan baru.</div>`;
}
function monthDetail(m) {
  const F = M.forecast(st.sc);
  const r = F.rows.find((x) => x.month === m);
  const lines = r.lines.map((x) => `${x.r.group === 'income' ? '+' : '−'} ${esc(x.r.label)}: <b>${fmtIDR(x.v)}</b>`).join('<br>');
  const tal = r.talItems.map((x) => `− Talangan ${esc(x.item)}: ${fmtIDR(x.amount)}`).join('<br>');
  openModal({ title: 'Rincian ' + cycleLabel(m, true), sub: 'Proyeksi skenario ' + esc(F.scenario?.name || ''),
    fields: [{ k: 'i', type: 'info', value: `${lines}${tal ? '<br>' + tal : ''}<hr><b>Sisa: ${fmtIDR(r.net)}</b>${r.cost1 ? '<br>Biaya tahap 1: ' + fmtIDR(r.cost1) : ''}${r.draw ? '<br>Pinjam: ' + fmtIDR(r.draw) : ''}${r.repay ? '<br>Cicil pinjaman: ' + fmtIDR(r.repay) : ''}${r.pay2 ? '<br>Bayar tahap lanjutan: ' + fmtIDR(r.pay2) : ''}<br>Saldo akhir: <b>${fmtIDR(r.balance)}</b>` }] });
}

// ------------------------------------------------------------------ project RAB
function projectBody(opt) {
  const prj = db.all('projects')[0];
  if (!prj) return '<button class="btn" id="editPrj">+ Buat proyek</button>';
  const P = M.projectSummary(prj.id, opt);
  let h = tiles([tile('Tahap 1', fmtIDR(P.stage1)), tile('Material', fmtIDR(P.material1)), tile('Upah tukang', fmtIDR(P.upah1)), tile('Tahap lanjutan', fmtIDR(P.stage2)),
    tile('Sudah terpakai', fmtIDR(P.realized), `<div class="m">${Math.round(P.realized / Math.max(P.stage1 + P.stage2, 1) * 100)}% dari total</div>`),
    tile('Kontinjensi', (prj.contPct || 0) + '%', '<button class="edit-ico" id="editPrj">✎</button>')], 'two');
  h += '<h4 class="subh">Jadwal bayar tahap 1</h4>' + (columns(Object.entries(P.byMonth).sort().map(([m, v]) => ({ label: cycleLabel(m), values: [v] })), [{ name: 'Biaya per bulan (+ kontinjensi)', color: '#2f6fed' }], { height: 110 }));
  const secs = groupBy(P.items, (x) => (String(x.stage) === '1' ? '1 · ' : '2 · ') + (x.kind === 'upah' && String(x.stage) === '1' ? 'UPAH TUKANG' : x.section));
  let body = '';
  for (const [s, items] of Object.entries(secs).sort()) {
    const tot = sum(items, (x) => M.projectCost(x, prj.contPct));
    const inner = items.map((x) => row(esc(x.label) + (x.kind === 'upah' ? ' <span class="badge w">upah</span>' : '') + (x.source === 'TUKANG' ? ' <span class="badge g">tukang</span>' : ''),
      `${Number(x.qty).toLocaleString('id-ID')} ${esc(x.unit)} × ${fmtIDR(x.price)}${x.month ? ' · ' + cycleLabel(x.month) : ''}${x.note ? ' · ' + esc(x.note) : ''}`,
      fmtIDR(M.projectCost(x, prj.contPct)), Number(x.realized) ? 'terpakai ' + fmtIDR(x.realized) : '', ` data-pi="${x.id}" role="button"`)).join('');
    body += collapsible('ps' + s, `<div class="nm">${esc(s.replace(/^\d · /, ''))}<span class="amt">${fmtIDR(tot)}</span></div><div class="pct">tahap ${s[0]}</div>`, inner, st.open['ps' + s]);
  }
  h += `<h4 class="subh">${esc(prj.name)}</h4>${body}<button class="btn small ghost" id="addPi">+ item</button>
    <div class="note">Material dan upah tukang dipisah. Tanda "tukang" = harga/upah dari survei tukang. Isi <b>terpakai</b> di tiap item saat sudah dibayar untuk memantau realisasi.</div>`;
  return h;
}
function editProject() {
  const p = db.all('projects')[0] || { id: uid('prj-'), name: 'Proyek baru', contPct: 10, stage1End: '2027-03', lender: 'Tante Muli', loanRepayStart: '2027-04', loanMonths: 24, loanMarkupPct: 0, note: '' };
  openModal({ title: 'Pengaturan proyek & pinjaman', fields: [
    { k: 'name', label: 'Nama proyek', type: 'text', value: p.name },
    { k: 'contPct', label: 'Kontinjensi (%)', type: 'number', value: p.contPct },
    { k: 'stage1End', label: 'Tahap 1 selesai (bulan)', type: 'month', value: p.stage1End },
    { k: 'lender', label: 'Pinjam ke', type: 'text', value: p.lender },
    { k: 'loanRepayStart', label: 'Mulai cicil pinjaman', type: 'month', value: p.loanRepayStart },
    { k: 'loanMonths', label: 'Lama cicilan (bulan)', type: 'number', value: p.loanMonths },
    { k: 'loanMarkupPct', label: 'Tanda terima kasih (%)', type: 'number', value: p.loanMarkupPct || 0 },
    { k: 'loanMax', label: 'Batas pinjaman (IDR, kosong = tanpa batas)', type: 'money', value: p.loanMax || '' },
    { k: 'stage2On', label: 'Rencanakan juga tahap lanjutan', type: 'check', value: Number(p.stage2On) === 1 }],
    onSave: (v) => { db.put('projects', { ...p, ...v, loanMax: Number(v.loanMax) || 0, stage2On: v.stage2On ? 1 : 0 }); toast('Tersimpan ✓'); } });
}
function editItem(id) {
  const prj = db.all('projects')[0];
  const x = id ? db.get('project_items', id) : { id: uid('pi-'), project: prj.id, stage: '1', section: 'LAINNYA', kind: 'material', label: '', spec: '', qty: 1, unit: 'paket', price: 0, month: prj.stage1End, opt1: 1, opt2: 1, cont: 1, source: '', note: '', realized: 0 };
  openModal({ title: id ? x.label : 'Item RAB baru', sub: x.section,
    fields: [
      { k: 'label', label: 'Uraian', type: 'text', value: x.label },
      { k: 'kind', label: 'Jenis', type: 'select', options: [['material', 'Material'], ['upah', 'Upah tukang']], value: x.kind },
      { k: 'stage', label: 'Tahap', type: 'select', options: [['1', 'Tahap 1'], ['2', 'Tahap lanjutan']], value: String(x.stage) },
      { k: 'section', label: 'Bagian', type: 'text', value: x.section },
      { k: 'qty', label: 'Volume', type: 'number', value: x.qty },
      { k: 'unit', label: 'Satuan (sak, ret, batang, dus, m²…)', type: 'text', value: x.unit },
      { k: 'price', label: 'Harga satuan (IDR)', type: 'money', value: x.price },
      { k: 'month', label: 'Bulan bayar', type: 'month', value: x.month },
      { k: 'opt1', label: 'Masuk Opsi 1', type: 'check', value: !!Number(x.opt1) },
      { k: 'opt2', label: 'Masuk Opsi 2', type: 'check', value: !!Number(x.opt2) },
      { k: 'cont', label: 'Kena kontinjensi', type: 'check', value: !!Number(x.cont) },
      { k: 'realized', label: 'Sudah terpakai (IDR)', type: 'money', value: x.realized || '' },
      { k: 'note', label: 'Catatan / hitungan', type: 'text', value: x.note }],
    onSave: (v) => { if (!v.label) throw new Error('Isi uraian'); db.put('project_items', { ...x, ...v, opt1: v.opt1 ? 1 : 0, opt2: v.opt2 ? 1 : 0, cont: v.cont ? 1 : 0, realized: Number(v.realized) || 0 }); toast('Tersimpan ✓'); },
    onDelete: id ? () => db.del('project_items', id) : null });
}
