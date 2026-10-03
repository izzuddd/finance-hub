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
  if (!['acara', 'kamar', 'kos'].includes(st.sub)) st.sub = 'kamar';
  const main = M.activeScenario();
  const scs = db.all('scenarios').filter((s) => Number(s.active) !== 0).sort((a, b) => (a.id === main?.id ? -1 : b.id === main?.id ? 1 : 0));
  st.sc = st.sc && db.get('scenarios', st.sc) ? st.sc : main?.id || scs[0]?.id;
  let h = seg('pSeg', [['acara', 'Trip & acara'], ['kamar', 'Kamar Tinggede'], ['kos', 'Kos Palu']], st.sub);
  if (st.sub === 'acara') { el.innerHTML = h + '<div id="tripRoot"></div>'; bindSeg(el, 'pSeg', (k) => { st.sub = k; render(el, S); }); return trip.render($('tripRoot'), S); }
  if (st.sub === 'kos') {
    el.innerHTML = h + kosView(); bindSeg(el, 'pSeg', (k) => { st.sub = k; render(el, S); });
    el.querySelectorAll('[data-toggle]').forEach((n) => n.addEventListener('click', () => { const id = n.dataset.toggle; st.open[id] = !st.open[id]; n.parentElement.classList.toggle('open', st.open[id]); }));
    el.querySelectorAll('[data-kostipe]').forEach((b) => b.addEventListener('click', () => { db.setSetting('kosPlan', { ...db.setting('kosPlan', {}), tipe: b.dataset.kostipe }); }));
    $('kosEdit').onclick = editKos;
    return;
  }
  if (!scs.length) { el.innerHTML = h + card('Belum ada skenario', '<div class="note">Skenario dibuat dari file impor (tools/migrate_to_hub.py).</div>'); bindSeg(el, 'pSeg', (k) => { st.sub = k; render(el, S); }); return; }
  h += `<div class="chips">${scs.map((s) => `<button data-sc="${s.id}" class="${s.id === st.sc ? 'active' : ''}">${s.id === main?.id ? '★ ' : ''}${esc(s.name)}</button>`).join('')}</div>`;
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
      tile('Tahap 1 lunas', F.stage1Done ? cycleLabel(F.stage1Done, true) : '<span class="neg">belum s/d ' + cycleLabel(rows[rows.length - 1].month, true) + '</span>', `<div class="m">uang sendiri ${fmtShort(F.ownFunds)}${F.firstOwnMonth ? ' · mulai nabung kamar ' + cycleLabel(F.firstOwnMonth, true) : ''}</div>`),
      tile('Dana dari ' + esc(p.project.lender || 'keluarga'), `<b class="${F.loanTotal ? 'neg' : 'pos'}">${fmtIDR(F.loanTotal)}</b>`,
        (F.tranche ? `<div class="m">${fmtShort(F.tranche.amount)} uang kami: ${fmtShort(F.tranche.each)}/bln × ${F.tranche.months} mulai ${cycleLabel(F.tranche.start, true)}</div>` : '') +
        (F.familyLoan ? `<div class="m">pinjaman ${fmtShort(F.familyLoan)}: ${fmtShort(F.repayEach)}/bln × ${F.loanMonths} mulai ${cycleLabel(F.repayStart, true)}</div>` : '')),
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
    row('Pemberi pinjaman', '', esc(prj.lender || '–')) + row('Tahap 1 lunas (proyeksi)', 'jadwal RAB awal ' + cycleLabel(prj.stage1End || '2027-03', true), F.stage1Done ? cycleLabel(F.stage1Done, true) : '–') +
    row('Batas dana dari ' + esc(prj.lender || 'keluarga'), '', Number(prj.loanMax) ? fmtIDR(prj.loanMax) : 'tanpa batas') +
    (Number(prj.trancheAmt) ? row('Bagian uang kami', `dicicil ${prj.trancheMonths || 12} bln mulai ${cycleLabel(prj.trancheStart || '2027-03', true)}`, fmtIDR(prj.trancheAmt)) : '') + row('Pinjaman mulai dicicil', prj.loanRepayStart ? 'tanggal tetap' : 'sebulan setelah tahap 1 lunas', F.repayStart ? cycleLabel(F.repayStart, true) : '–') +
    (F.familyLoan ? row('Cicilan pinjaman', `${F.loanMonths} bulan, lunas ${cycleLabel(addMonths(F.repayStart, F.loanMonths - 1), true)}`, fmtIDR(F.repayEach) + '/bln') : '') +
    row('Lama cicilan', '', (prj.loanMonths || 24) + ' bulan') + row('Tambahan / terima kasih', '', (prj.loanMarkupPct || 0) + '%') + row('Tahap lanjutan', '', Number(prj.stage2On) ? 'ikut direncanakan' : 'tidak (fokus tahap 1)') +
    '<button class="btn small ghost" id="editPrj">✎ Ubah proyek & pinjaman</button>', st.open.kLoan);
  h += collapsible('kHelp', '<div class="nm">ℹ️ Cara membaca</div>', `<p class="insight-p">Satu hitungan dengan Budget: sisa budget tiap bulan membayar tahap 1 sesuai jadwal RAB. Kalau kurang, <b>pinjaman ke ${esc(p?.project.lender || 'keluarga')}</b> menutup sampai batasnya${F.loanCap < Infinity ? ' (' + fmtShort(F.loanCap) + ')' : ''}; kalau masih kurang, pekerjaan menunggu bulan berikutnya — tanpa jual emas, tanpa pinjam antar kantong. Pinjaman dicicil ${F.loanMonths} bulan mulai ${F.repayStart ? cycleLabel(F.repayStart, true) : 'sebulan setelah tahap 1 lunas'}.</p>
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
// ------------------------------------------------------------------ Kos Palu (tanah 6×30 m, Vatu Gusu)
function kosView() {
  const P = M.kosPlan(), K = P.K;
  const pick = P.pick, isKos = K.tipe === 'kos';
  const fund1 = M.kosFunding(P.fase1.capex), fundAll = M.kosFunding(pick.capex);
  let h = `<div class="chips"><button data-kostipe="kos" class="${isKos ? 'active' : ''}">Kos-kosan</button><button data-kostipe="kontrakan" class="${!isKos ? 'active' : ''}">Kontrakan</button><button id="kosEdit">✎ asumsi</button></div>`;
  h += tiles([
    tile('Unit prospektif', `<b>${pick.units} ${isKos ? 'kamar' : 'unit'}</b>`, `<div class="m">${K.lantai} lantai · tapak ${P.tapak.toFixed(0)} m² · luas bangunan ${P.gfa.toFixed(0)} m²</div>`),
    tile('Biaya bangun (lengkap)', fmtShort(pick.capex), `<div class="m">${fmtShort(K.biayaM2)}/m² + ${isKos ? 'perabot, ' : ''}utilitas, izin, ${K.kontinjensi}% cadangan</div>`),
    tile('Bersih / bulan', `<span class="pos">${fmtShort(pick.perMonth)}</span>`, `<div class="m">sewa ${fmtShort(pick.rent)} × okupansi ${isKos ? K.okupansiKos : K.okupansiKontrakan}% − operasional ${isKos ? K.opexKos : K.opexKontrakan}%</div>`),
    tile('Imbal hasil', `${pick.yieldPct.toFixed(1)}%/th`, `<div class="m">balik modal ±${pick.payback.toFixed(1)} th</div>`),
  ], 'two');
  h += collapsible('kosUnits', '<div class="nm">📐 Berapa unit muat di 6×30 m?<span class="amt">kos vs kontrakan</span></div>', `
    <p class="insight-p">Lahan ${K.lebar}×${K.panjang} m = ${P.luas} m². Dengan KDB ${K.kdb}% (perkiraan), sempadan depan ${K.gsbDepan} m (parkir motor) dan ±2 m ruang terbuka belakang, bangunan bisa ±<b>${K.lebar} × ${P.panjangBangun.toFixed(0)} m</b>.</p>
    <div class="tbl"><div class="th"><span></span><span>Kos</span><span>Kontrakan</span></div>
      <div class="tr"><span>Ukuran unit</span><span>${K.kamarLebar}×${(K.lebar - K.koridor).toFixed(1)} m + KM dalam</span><span>±${K.unitKontrakanM2} m² (1 KT, R. tamu, dapur, KM)</span></div>
      <div class="tr"><span>Per lantai</span><span>${P.perLantaiKos}</span><span>${P.perLantaiKtr}</span></div>
      <div class="tr"><span>${K.lantai} lantai (−1 untuk tangga)</span><span><b>${P.kos.units} kamar</b></span><span><b>${P.ktr.units} unit</b></span></div>
      <div class="tr"><span>Sewa (asumsi)</span><span>${fmtShort(K.sewaKos)}/bln</span><span>${fmtShort(K.sewaKontrakan)}/bln</span></div>
      <div class="tr"><span>Bersih / tahun</span><span>${fmtShort(P.kos.net)}</span><span>${fmtShort(P.ktr.net)}</span></div>
      <div class="tr"><span>Biaya bangun</span><span>${fmtShort(P.kos.capex)}</span><span>${fmtShort(P.ktr.capex)}</span></div>
      <div class="tr"><span>Imbal hasil</span><span>${P.kos.yieldPct.toFixed(1)}%</span><span>${P.ktr.yieldPct.toFixed(1)}%</span></div></div>
    <div class="note">Lahan selebar 6 m paling efisien untuk kamar berderet dengan koridor samping. Kos memberi pendapatan per m² lebih tinggi; kontrakan lebih sedikit pergantian penyewa & pengelolaan. Jangan 3 lantai: Palu zona gempa tinggi, biaya struktur naik tajam.</div>`, st.open.kosUnits ?? true);
  h += collapsible('kosFase', `<div class="nm">🏗️ Bangun bertahap<span class="amt">fase 1 ${fmtShort(P.fase1.capex)}</span></div>`, `
    ${row('Fase 1 — lantai 1, struktur siap 2 lantai', `${P.fase1.units} ${isKos ? 'kamar' : 'unit'} · fondasi & kolom dihitung +${K.strukturPlus}% untuk lantai 2`, fmtIDR(P.fase1.capex))}
    ${row('Fase 2 — lantai 2', `+${pick.units - P.fase1.units} ${isKos ? 'kamar' : 'unit'}, dibangun dari hasil sewa + tabungan`, fmtIDR(Math.max(0, pick.capex - P.fase1.capex)))}
    ${row('Fase 1 menghasilkan', `±${fmtShort(P.fase1.perMonth)}/bln bersih`, `${P.fase1.yieldPct.toFixed(1)}%/th`)}`, st.open.kosFase ?? true);
  const when = (f) => (f.hit ? cycleLabel(f.hit, true) : '> 15 th lagi');
  h += collapsible('kosDana', `<div class="nm">💰 Kapan dananya cukup?<span class="amt">fase 1 ±${when(fund1)}</span></div>`, `
    <p class="insight-p">Tanpa jual emas & tanpa utang: semua sisa bulanan setelah budget, kamar dan cicilan Tante Muli masuk kantong <b>Kos Palu</b> mulai <b>${cycleLabel(fund1.from, true)}</b> (sebulan setelah tahap 1 kamar lunas)${fund1.loanFree ? `; setelah pinjaman lunas ${cycleLabel(fund1.loanFree, true)} sisanya makin besar` : ''}. Setelah 2030 ±${fmtShort(fund1.pace)}/bln.</p>
    ${row('Dana fase 1 cukup', fmtIDR(P.fase1.capex), `<b>${when(fund1)}</b>`)}${row('Dana bangun lengkap cukup', fmtIDR(pick.capex), `<b>${when(fundAll)}</b>`)}
    <div class="note">Setelah 2030 dihitung dengan laju sisa rata-rata 2030 (gaji naik & inflasi biaya belum dimasukkan). Mempercepat: mulai dari 1 lantai lebih kecil, KPR/pinjaman bank untuk sebagian (hasil sewa ikut membayar cicilan), atau patungan keluarga.</div>`, st.open.kosDana ?? true);
  h += collapsible('kosCek', '<div class="nm">✅ Wajib dicek sebelum mulai</div>', `
    <p class="insight-p">• <b>Zona rawan bencana (ZRB) Palu</b>: pastikan lahan di Tanamodindi bukan zona terlarang (sesar Palu-Koro / likuefaksi) — cek di Dinas Tata Ruang/PUPR Kota Palu. Struktur wajib tahan gempa (SNI 1726).</p>
    <p class="insight-p">• <b>PBG</b> (dulu IMB): KDB/KLB/GSB pasti untuk Jl. Vatu Gusu, dan aturan rumah kos.</p>
    <p class="insight-p">• <b>Harga sewa</b>: survei 10–15 kos/kontrakan di Tanamodindi & sekitar Untad (Mamikos/99.co + datang langsung). Angka sewa & biaya di sini asumsi.</p>
    <p class="insight-p">• <b>Air & listrik</b>: sumur/PDAM, token listrik per kamar, septic tank komunal.</p>`, st.open.kosCek);
  return h;
}
function editKos() {
  const K = M.kosSettings();
  const f = (k, label, type = 'number') => ({ k, label, type, value: K[k] });
  openModal({ title: 'Asumsi kos / kontrakan', sub: 'Tanah Vatu Gusu, Palu — ubah sesuai survei', fields: [
    f('lebar', 'Lebar tanah (m)'), f('panjang', 'Panjang tanah (m)'), f('kdb', 'KDB (%)'), f('gsbDepan', 'Sempadan depan (m)'), f('lantai', 'Jumlah lantai'),
    f('kamarLebar', 'Lebar kamar kos (m)'), f('koridor', 'Lebar koridor (m)'), f('unitKontrakanM2', 'Luas 1 unit kontrakan (m²)'),
    f('biayaM2', 'Biaya bangun per m² (IDR)', 'money'), f('strukturPlus', 'Tambahan struktur fase 1 untuk lantai 2 (%)'), f('perabotKos', 'Perabot per kamar kos (IDR)', 'money'),
    f('utilitas', 'Utilitas: listrik, air, septic (IDR)', 'money'), f('perizinan', 'PBG, gambar, sertifikat (IDR)', 'money'), f('kontinjensi', 'Cadangan biaya (%)'),
    f('sewaKos', 'Sewa kos per kamar/bln (IDR)', 'money'), f('okupansiKos', 'Okupansi kos (%)'), f('opexKos', 'Operasional kos (% pendapatan)'),
    f('sewaKontrakan', 'Sewa kontrakan per unit/bln (IDR)', 'money'), f('okupansiKontrakan', 'Okupansi kontrakan (%)'), f('opexKontrakan', 'Operasional kontrakan (%)')],
    onSave: (v) => { const o = {}; Object.keys(v).forEach((k) => { o[k] = Number(v[k]) || 0; }); db.setSetting('kosPlan', { ...db.setting('kosPlan', {}), ...o }); toast('Tersimpan ✓'); } });
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
    { k: 'loanRepayStart', label: 'Mulai cicil pinjaman (kosong = sebulan setelah tahap 1 lunas)', type: 'month', value: p.loanRepayStart },
    { k: 'loanMonths', label: 'Lama cicilan (bulan)', type: 'number', value: p.loanMonths },
    { k: 'loanMarkupPct', label: 'Tanda terima kasih (%)', type: 'number', value: p.loanMarkupPct || 0 },
    { k: 'loanMax', label: 'Batas dana dari pemberi pinjaman (IDR, kosong = tanpa batas)', type: 'money', value: p.loanMax || '' },
    { k: 'trancheAmt', label: 'Bagian uang kami di dalamnya (IDR)', type: 'money', value: p.trancheAmt || '' },
    { k: 'trancheStart', label: 'Bagian uang kami dicicil mulai', type: 'month', value: p.trancheStart || '' },
    { k: 'trancheMonths', label: 'Lama cicilan bagian uang kami (bulan)', type: 'number', value: p.trancheMonths || 12 },
    { k: 'stage2On', label: 'Rencanakan juga tahap lanjutan', type: 'check', value: Number(p.stage2On) === 1 }],
    onSave: (v) => { db.put('projects', { ...p, ...v, loanMax: Number(v.loanMax) || 0, trancheAmt: Number(v.trancheAmt) || 0, trancheMonths: Number(v.trancheMonths) || 12, stage2On: v.stage2On ? 1 : 0 }); toast('Tersimpan ✓'); } });
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
