// Rencana: long-range cash-flow forecast per scenario (to 2029+), project RAB (Kamar Tinggede),
// family-loan schedule, recurring rules & one-offs. Trips/events live in trip.js.
import * as db from '../db.js';
import * as M from '../model.js';
import { esc, fmtIDR, fmtShort, currentCycle, cycleLabel, addMonths, uid, sum, groupBy } from '../util.js';
import { $, toast, openModal, tile, tiles, card, row, seg, bindSeg, collapsible, lineChart, columns, moneyCls, empty } from '../ui.js';
import * as trip from './trip.js';

const st = { sub: 'proyeksi', sc: null, open: {}, section: {} };
const GROUPS = [['income', 'Pemasukan'], ['needs', 'Needs'], ['wants', 'Wants'], ['giving', 'Giving'], ['saving', 'Tabungan'], ['lifestyle', 'Liburan & gaya hidup'], ['buffer', 'Dana cadangan'], ['other', 'Lainnya']];
const FREQ = [['monthly', 'tiap bulan'], ['spread', 'per tahun, dicicil 12×'], ['yearly', 'sekali setahun (bulan mulai)'], ['lebaran', 'sekali setahun di siklus Lebaran'], ['once', 'sekali (bulan mulai)']];

export function render(el, S) {
  const scs = db.all('scenarios').filter((s) => Number(s.active) !== 0);
  st.sc = st.sc && db.get('scenarios', st.sc) ? st.sc : scs[0]?.id;
  let h = seg('pSeg', [['proyeksi', 'Proyeksi'], ['proyek', 'RAB Kamar'], ['aturan', 'Asumsi'], ['acara', 'Trip & acara']], st.sub);
  if (st.sub === 'acara') { el.innerHTML = h + '<div id="tripRoot"></div>'; bindSeg(el, 'pSeg', (k) => { st.sub = k; render(el, S); }); return trip.render($('tripRoot'), S); }
  if (!scs.length) { el.innerHTML = h + card('Belum ada skenario', '<button class="btn" id="newSc">+ Buat skenario</button>'); bindSeg(el, 'pSeg', (k) => { st.sub = k; render(el, S); }); $('newSc').onclick = () => editScenario(null); return; }
  if (st.sub !== 'proyek') h += `<div class="chips">${scs.map((s) => `<button data-sc="${s.id}" class="${s.id === st.sc ? 'active' : ''}">${esc(s.name)}</button>`).join('')}<button data-scedit="1">✎</button></div>`;
  if (st.sub === 'proyeksi') h += forecastView();
  if (st.sub === 'proyek') h += projectView();
  if (st.sub === 'aturan') h += rulesView();
  el.innerHTML = h;
  bindSeg(el, 'pSeg', (k) => { st.sub = k; render(el, S); });
  el.querySelectorAll('[data-sc]').forEach((b) => b.addEventListener('click', () => { st.sc = b.dataset.sc; render(el, S); }));
  el.querySelectorAll('[data-scedit]').forEach((b) => b.addEventListener('click', () => editScenario(st.sc)));
  el.querySelectorAll('[data-toggle]').forEach((n) => n.addEventListener('click', () => { const id = n.dataset.toggle; st.open[id] = !st.open[id]; n.parentElement.classList.toggle('open', st.open[id]); }));
  el.querySelectorAll('[data-month]').forEach((n) => n.addEventListener('click', () => monthDetail(n.dataset.month)));
  el.querySelectorAll('[data-rule]').forEach((n) => n.addEventListener('click', () => editRule(n.dataset.rule)));
  el.querySelectorAll('[data-oneoff]').forEach((n) => n.addEventListener('click', () => editOneOff(n.dataset.oneoff)));
  el.querySelectorAll('[data-pi]').forEach((n) => n.addEventListener('click', () => editItem(n.dataset.pi)));
  el.querySelectorAll('[data-popt]').forEach((b) => b.addEventListener('click', () => { st.opt = Number(b.dataset.popt); render(el, S); }));
  const bind = (id, fn) => { const n = $(id); if (n) n.onclick = fn; };
  bind('addRule', () => editRule(null));
  bind('addOneOff', () => editOneOff(null));
  bind('newSc', () => editScenario(null));
  bind('copySc', () => copyScenario());
  bind('editPrj', () => editProject());
  bind('addPi', () => editItem(null));
}

// ------------------------------------------------------------------ forecast
function forecastView() {
  const F = M.forecast(st.sc);
  const p = F.project;
  const rows = F.rows;
  let h = '';
  if (p) {
    h += tiles([
      tile('Biaya tahap 1', fmtIDR(p.stage1), `<div class="m">material ${fmtShort(p.material1)} · upah ${fmtShort(p.upah1)}</div>`),
      tile('Uang sendiri s/d ' + cycleLabel(F.stage1End), fmtIDR(F.ownFunds)),
      tile('Pinjam ' + esc(p.project.lender || 'keluarga'), `<b class="${F.loanTotal ? 'neg' : 'pos'}">${fmtIDR(F.loanTotal)}</b>`, F.loanTotal ? `<div class="m">${fmtIDR(F.repayEach)}/bln × ${F.loanMonths} mulai ${cycleLabel(F.repayStart, true)}</div>` : '<div class="m">tidak perlu pinjam</div>'),
      tile('Tahap lanjutan', fmtIDR(p.stage2), `<div class="m">${F.stage2Done ? 'lunas ±' + cycleLabel(F.stage2Done, true) : 'belum lunas s/d ' + cycleLabel(rows[rows.length - 1].month, true)}</div>`),
    ], 'two');
  }
  // tip: talangan that starts during stage 1 competes with the build money (e.g. Libur Lebaran)
  const early = M.talanganOpen().filter((t) => t.start && String(t.start).slice(0, 7) >= currentCycle() && String(t.start).slice(0, 7) <= F.stage1End);
  if (early.length && F.loanTotal > 0) {
    const inStage1 = sum(rows.filter((r) => r.month <= F.stage1End), (r) => sum(r.talItems.filter((x) => early.some((t) => t.item === x.item)), (x) => x.amount));
    h += `<div class="alloc"><div class="row"><b>💡 Tips</b><span></span></div><div class="row"><span>${early.map((t) => esc(t.item)).join(', ')} mulai dicicil ${cycleLabel(String(early[0].start).slice(0, 7), true)} — di tengah tahap 1. Geser mulai cicilnya ke ${cycleLabel(addMonths(F.stage1End, 1), true)} (Tabungan → Talangan) dan pinjaman ke ${esc(p?.project.lender || 'keluarga')} berkurang ±<b>${fmtIDR(inStage1)}</b>.</span></div></div>`;
  }
  const lbl = rows.map((r) => cycleLabel(r.month));
  h += card('Arus kas per bulan', lineChart(lbl, [
    { name: 'Sisa untuk bangun / nabung', color: '#189a5c', values: rows.map((r) => r.net), area: true },
    { name: 'Sisa pinjaman', color: '#d64545', values: rows.map((r) => r.loanLeft) },
    { name: 'Sisa biaya lanjutan', color: '#c98a12', values: rows.map((r) => r.rem2) },
  ]) + '<div class="note">Hijau = pemasukan dikurangi semua pengeluaran rutin, talangan, liburan & cadangan. Proyek dan pinjaman dihitung terpisah di tabel.</div>');
  const years = groupBy(rows, (r) => r.month.slice(0, 4));
  let t = '';
  for (const [y, rs] of Object.entries(years)) {
    const body = `<div class="tbl"><div class="th"><span>Bln</span><span>Masuk</span><span>Keluar</span><span>Sisa</span><span>Proyek</span><span>Pinjam</span><span>Saldo</span></div>` +
      rs.map((r) => `<div class="tr" data-month="${r.month}" role="button"><span>${cycleLabel(r.month)}</span><span>${fmtShort(r.income)}</span><span>${fmtShort(r.out + r.talangan)}</span>
        <span class="${moneyCls(r.net)}">${fmtShort(r.net)}</span><span>${r.cost1 ? fmtShort(r.cost1) : r.pay2 ? fmtShort(r.pay2) : ''}</span>
        <span class="${r.draw ? 'pos' : r.repay ? 'neg' : ''}">${r.draw ? '+' + fmtShort(r.draw) : r.repay ? '−' + fmtShort(r.repay) : ''}</span><span class="${moneyCls(r.balance)}">${fmtShort(r.balance)}</span></div>`).join('') + '</div>';
    t += collapsible('y' + y, `<div class="nm">${y}<span class="amt">sisa ${fmtShort(sum(rs, (r) => r.net))}</span></div>`, body, st.open['y' + y] ?? y === currentCycle().slice(0, 4));
  }
  h += `<div class="card"><h3><span>Tabel bulanan — ketuk bulan untuk rincian</span></h3>${t}</div>`;
  h += card('Cara membaca', `<p class="insight-p">Tahap 1 dibayar sesuai jadwal RAB. Kalau uang bulan itu kurang, sisanya otomatis dicatat sebagai <b>pinjaman ke ${esc(p?.project.lender || 'keluarga')}</b> (tanpa jual emas). Pinjaman dicicil tetap mulai ${cycleLabel(F.repayStart, true)} selama ${F.loanMonths} bulan. Tahap lanjutan dibayar sebisanya dari sisa uang tiap bulan.</p>
    <p class="insight-p">Ubah asumsi (gaji, liburan, dll.) di tab <b>Asumsi</b>, RAB & skema pinjaman di tab <b>RAB Kamar</b>.</p>`);
  return h;
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
function projectView() {
  const prj = db.all('projects')[0];
  if (!prj) return card('Belum ada proyek', '<button class="btn" id="editPrj">+ Buat proyek</button>');
  st.opt = st.opt || 1;
  const P = M.projectSummary(prj.id, st.opt);
  let h = `<div class="chips"><button data-popt="1" class="${st.opt === 1 ? 'active' : ''}">Opsi 1 · tanpa mezanine</button><button data-popt="2" class="${st.opt === 2 ? 'active' : ''}">Opsi 2 · + mezanine & tangga</button></div>`;
  h += tiles([tile('Tahap 1', fmtIDR(P.stage1)), tile('Material', fmtIDR(P.material1)), tile('Upah tukang', fmtIDR(P.upah1)), tile('Tahap lanjutan', fmtIDR(P.stage2)),
    tile('Sudah terpakai', fmtIDR(P.realized), `<div class="m">${Math.round(P.realized / Math.max(P.stage1 + P.stage2, 1) * 100)}% dari total</div>`),
    tile('Kontinjensi', (prj.contPct || 0) + '%', '<button class="edit-ico" id="editPrj">✎</button>')], 'two');
  h += card('Jadwal bayar tahap 1', columns(Object.entries(P.byMonth).sort().map(([m, v]) => ({ label: cycleLabel(m), values: [v] })), [{ name: 'Biaya per bulan (+ kontinjensi)', color: '#2f6fed' }], { height: 110 }));
  const secs = groupBy(P.items, (x) => (String(x.stage) === '1' ? '1 · ' : '2 · ') + (x.kind === 'upah' && String(x.stage) === '1' ? 'UPAH TUKANG' : x.section));
  let body = '';
  for (const [s, items] of Object.entries(secs).sort()) {
    const tot = sum(items, (x) => M.projectCost(x, prj.contPct));
    const inner = items.map((x) => row(esc(x.label) + (x.kind === 'upah' ? ' <span class="badge w">upah</span>' : '') + (x.source === 'TUKANG' ? ' <span class="badge g">tukang</span>' : ''),
      `${Number(x.qty).toLocaleString('id-ID')} ${esc(x.unit)} × ${fmtIDR(x.price)}${x.month ? ' · ' + cycleLabel(x.month) : ''}${x.note ? ' · ' + esc(x.note) : ''}`,
      fmtIDR(M.projectCost(x, prj.contPct)), Number(x.realized) ? 'terpakai ' + fmtIDR(x.realized) : '', ` data-pi="${x.id}" role="button"`)).join('');
    body += collapsible('ps' + s, `<div class="nm">${esc(s.replace(/^\d · /, ''))}<span class="amt">${fmtIDR(tot)}</span></div><div class="pct">tahap ${s[0]}</div>`, inner, st.open['ps' + s]);
  }
  h += `<div class="card"><h3><span>RAB — ${esc(prj.name)}</span></h3>${body}<button class="btn small ghost" id="addPi">+ item</button>
    <div class="note">Material dan upah tukang dipisah. Tanda "tukang" = harga/upah dari survei tukang. Isi <b>terpakai</b> di tiap item saat sudah dibayar untuk memantau realisasi.</div></div>`;
  h += card('Skema pinjaman', row('Pemberi pinjaman', '', esc(prj.lender || '–')) + row('Tahap 1 selesai', '', cycleLabel(prj.stage1End || '2027-03', true)) +
    row('Mulai cicil', '', cycleLabel(prj.loanRepayStart || '2027-04', true)) + row('Lama cicilan', '', (prj.loanMonths || 24) + ' bulan') + row('Tambahan / terima kasih', '', (prj.loanMarkupPct || 0) + '%'));
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
    { k: 'loanMarkupPct', label: 'Tanda terima kasih (%)', type: 'number', value: p.loanMarkupPct || 0 }],
    onSave: (v) => { db.put('projects', { ...p, ...v }); toast('Tersimpan ✓'); } });
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

// ------------------------------------------------------------------ rules (assumptions)
function rulesView() {
  const rules = db.where('plan_rules', (r) => r.scenario === st.sc);
  const now = currentCycle();
  let h = '';
  for (const [g, name] of GROUPS) {
    const rs = rules.filter((r) => (r.group || 'other') === g);
    if (!rs.length) continue;
    h += card(name, rs.map((r) => row(esc(r.label) + (Number(r.active) === 0 ? ' <span class="badge">nonaktif</span>' : ''),
      `${FREQ.find((f) => f[0] === r.freq)?.[1] || r.freq} · ${cycleLabel(r.start || now)}${r.end ? '–' + cycleLabel(r.end) : ' →'}${Number(r.growth) ? ' · naik ' + r.growth + '%/th' : ''}${r.note ? '<br>' + esc(r.note) : ''}`,
      fmtIDR(r.amount), 'bulan ini ' + fmtShort(M.ruleAmount(r, now)), ` data-rule="${r.id}" role="button"`)).join(''));
  }
  h += `<button class="btn ghost" id="addRule">+ Asumsi baru</button>`;
  const ones = db.where('plan_items', (r) => r.scenario === st.sc).sort((a, b) => (a.month < b.month ? -1 : 1));
  h += card('Pemasukan / pengeluaran sekali', (ones.map((r) => row(esc(r.label), cycleLabel(r.month, true) + ' · ' + esc(r.group), `<span class="${r.group === 'income' ? 'pos' : 'neg'}">${fmtIDR(r.amount)}</span>`, '', ` data-oneoff="${r.id}" role="button"`)).join('') || empty('Belum ada — mis. bonus, servis, pernikahan saudara')) +
    '<button class="btn small ghost" id="addOneOff">+ sekali</button>');
  h += card('Skenario', '<div class="flex2"><button class="btn small ghost" id="copySc">Duplikat skenario ini</button><button class="btn small ghost" id="newSc">+ Skenario kosong</button></div>' +
    '<div class="note">Talangan aktif (Tabungan → Talangan) otomatis ikut dihitung sesuai sisa cicilannya. Lebaran: THR & giving ekstra jatuh di siklus Lebaran tiap tahun (2027 ±10 Mar, 2028 ±27 Feb, 2029 ±15 Feb).</div>');
  return h;
}
function editRule(id) {
  const r = id ? db.get('plan_rules', id) : { id: uid('pr-'), scenario: st.sc, label: '', group: 'needs', amount: 0, start: currentCycle(), end: '', freq: 'monthly', growth: 0, growthPart: 1, note: '', active: 1 };
  openModal({ title: id ? r.label : 'Asumsi baru', sub: 'Dipakai untuk proyeksi skenario ini',
    fields: [
      { k: 'label', label: 'Nama', type: 'text', value: r.label },
      { k: 'group', label: 'Kelompok', type: 'select', options: GROUPS, value: r.group },
      { k: 'amount', label: 'Jumlah (IDR)', type: 'money', value: r.amount },
      { k: 'freq', label: 'Frekuensi', type: 'select', options: FREQ, value: r.freq },
      { k: 'start', label: 'Mulai', type: 'month', value: r.start },
      { k: 'end', label: 'Sampai (kosong = seterusnya)', type: 'month', value: r.end },
      { k: 'growth', label: 'Naik per tahun (%)', type: 'number', value: r.growth },
      { k: 'growthPart', label: 'Bagian yang naik (0–1, mis. 0,31 = hanya gaji pokok)', type: 'number', value: r.growthPart },
      { k: 'note', label: 'Catatan', type: 'text', value: r.note },
      { k: 'active', label: 'Aktif', type: 'check', value: Number(r.active) !== 0 },
      { k: 'all', label: 'Terapkan perubahan ini ke semua skenario (nama sama)', type: 'check', value: false }],
    onSave: (v) => {
      if (!v.label) throw new Error('Isi nama');
      const patch = { label: v.label, group: v.group, amount: Number(v.amount) || 0, freq: v.freq, start: v.start, end: v.end, growth: Number(v.growth) || 0, growthPart: v.growthPart === '' ? 1 : Number(v.growthPart), note: v.note, active: v.active ? 1 : 0 };
      db.put('plan_rules', { ...r, ...patch });
      if (v.all && id) db.where('plan_rules', (x) => x.label === r.label && x.id !== r.id).forEach((x) => db.put('plan_rules', { ...x, ...patch }));
      toast('Tersimpan ✓');
    },
    onDelete: id ? () => db.del('plan_rules', id) : null });
}
function editOneOff(id) {
  const r = id ? db.get('plan_items', id) : { id: uid('pit-'), scenario: st.sc, month: addMonths(currentCycle(), 1), label: '', group: 'other', amount: 0, note: '' };
  openModal({ title: id ? r.label : 'Sekali', fields: [{ k: 'label', label: 'Nama', type: 'text', value: r.label }, { k: 'group', label: 'Kelompok', type: 'select', options: GROUPS, value: r.group },
    { k: 'amount', label: 'Jumlah (IDR)', type: 'money', value: r.amount }, { k: 'month', label: 'Bulan', type: 'month', value: r.month }, { k: 'note', label: 'Catatan', type: 'text', value: r.note }],
    onSave: (v) => { if (!v.label) throw new Error('Isi nama'); db.put('plan_items', { ...r, ...v, amount: Number(v.amount) || 0 }); },
    onDelete: id ? () => db.del('plan_items', id) : null });
}
function editScenario(id) {
  const s = id ? db.get('scenarios', id) : { id: uid('sc-'), name: '', note: '', active: 1, projectOption: 1 };
  openModal({ title: id ? 'Skenario' : 'Skenario baru', fields: [{ k: 'name', label: 'Nama', type: 'text', value: s.name }, { k: 'projectOption', label: 'Opsi RAB kamar', type: 'select', options: [[1, 'Opsi 1 · tanpa mezanine'], [2, 'Opsi 2 · + mezanine & tangga']], value: s.projectOption },
    { k: 'note', label: 'Catatan', type: 'text', value: s.note }],
    onSave: (v) => { if (!v.name) throw new Error('Isi nama'); db.put('scenarios', { ...s, ...v, projectOption: Number(v.projectOption) }); st.sc = s.id; },
    onDelete: id ? () => { db.del('scenarios', id); db.where('plan_rules', (r) => r.scenario === id).forEach((r) => db.del('plan_rules', r.id)); } : null });
}
function copyScenario() {
  const s = db.get('scenarios', st.sc);
  const id = uid('sc-');
  db.put('scenarios', { ...s, id, name: s.name + ' (salinan)' });
  db.putMany('plan_rules', db.where('plan_rules', (r) => r.scenario === st.sc).map((r) => ({ ...r, id: uid('pr-'), scenario: id })));
  db.putMany('plan_items', db.where('plan_items', (r) => r.scenario === st.sc).map((r) => ({ ...r, id: uid('pit-'), scenario: id })));
  st.sc = id; toast('Skenario diduplikat ✓');
}
