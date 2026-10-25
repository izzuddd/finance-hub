// Beranda / Insight: headline numbers, income vs expenses per cycle (all years), drill-down,
// spending mix, obligations, plan snapshot and a plain-language reading.
import * as db from '../db.js';
import * as M from '../model.js';
import { esc, fmtIDR, fmtShort, currentCycle, cycleLabel, cyclePeriod, addMonths, sum } from '../util.js';
import { toast, tile, tiles, card, row, bar, columns, donut, moneyCls, empty, seg, bindSeg } from '../ui.js';

const st = { inv: null, year: null, tab: 'ringkasan' };

export function render(el, S) {
  const I = M.insight();
  if (!['ringkasan', 'strategi'].includes(st.tab)) st.tab = 'ringkasan';
  const segH = seg('iSeg', [['ringkasan', 'Ringkasan'], ['strategi', 'Strategi & nasihat']], st.tab);
  const bindTabs = () => bindSeg(el, 'iSeg', (k) => { st.tab = k; render(el, S); });
  if (st.tab === 'strategi') { el.innerHTML = segH + strategyView(I); bindTabs(); return; }
  const cur = I.cur;
  const years = [...new Set(I.months.map((m) => m.cycle.slice(0, 4)))];
  st.year = st.year || cur.slice(0, 4);
  const T = M.totals(cur);
  const s = M.cycleSummary(cur), incNow = M.incomeTotal(cur) || s.income;
  const past = I.months.filter((m) => !m.isFuture && (m.income > 0 || m.expenses > 0));
  const n = past.length || 1;
  const avgNeeds = sum(past, (m) => m.needsSpent) / n;
  const efLiquid = I.ef ? (Number(I.ef.calLiquid) || (I.ef.actual - I.efJmo)) : 0; // money physically liquid in the EF pocket (excl. JMO)
  const runway = avgNeeds > 0 ? efLiquid / avgNeeds : 0;
  let h = segH + `<div class="hero"><div class="m">Siklus ${cyclePeriod(cur)}</div><div class="big ${moneyCls(incNow - s.totalExpenses)}">${fmtIDR(incNow - s.totalExpenses)}</div><div class="m">sisa siklus ini (pemasukan ${fmtShort(incNow)} − pengeluaran ${fmtShort(s.totalExpenses)})</div></div>`;
  h += tiles([tile('Saldo bisa dipakai', fmtIDR(T.usable)), tile('Total tabungan', fmtIDR(sum(I.pockets, (p) => p.actual))), tile('Dana darurat', runway.toFixed(1) + ' bln', '<div class="m">likuid ÷ rata-rata Needs</div>')]);

  // income vs expenses per cycle for the chosen year
  const ym = I.months.filter((m) => m.cycle.startsWith(st.year) && (m.income > 0 || m.expenses > 0));
  h += card('Pemasukan vs pengeluaran', `<div class="chips small">${years.map((y) => `<button data-year="${y}" class="${y === st.year ? 'active' : ''}">${y}</button>`).join('')}</div>` +
    columns(ym.map((m) => ({ label: cycleLabel(m.cycle).split(' ')[0], key: m.cycle, values: [m.income, m.expenses], dim: m.isFuture, active: st.inv === m.cycle })),
      [{ name: 'Pemasukan', color: 'var(--good)' }, { name: 'Pengeluaran', color: 'var(--bad)' }]) +
    '<div class="note">Ketuk bulan untuk melihat apa yang paling banyak menyedot uang. Pemasukan = rencana/aktual di Budget → Gaji.</div>');
  if (st.inv) h += investigation(M.investigate(st.inv));

  // spending mix now
  h += donut('Komposisi pengeluaran — ' + cycleLabel(cur, true), [['Needs', s.needs], ['Wants', s.wants], ['Giving', s.giving], ['Saving', s.saving]].map(([name, value]) => ({ name, value })));
  const needSubs = M.subsOf(cur, 'Needs').map((x) => ({ name: x.name.replace('Needs - ', ''), value: x.spent }));
  h += donut('Needs — ' + cycleLabel(cur, true), needSubs);

  // habits
  const avgInc = sum(past, (m) => m.income) / n, avgExp = sum(past, (m) => m.expenses) / n, avgSave = sum(past, (m) => m.saving) / n;
  const rate = avgInc > 0 ? Math.round(avgSave / avgInc * 100) : 0;
  const surplusN = past.filter((m) => m.surplus >= 0).length;
  const adh = (k, b) => { const xs = past.filter((m) => m[b] > 0); return xs.length ? Math.round(sum(xs, (m) => m[k] / m[b]) / xs.length * 100) : 0; };
  const needsPct = adh('needsSpent', 'needsBudget'), wantsPct = adh('wantsSpent', 'wantsBudget');
  h += tiles([tile('Rata-rata nabung', rate + '%'), tile('Siklus surplus', surplusN + ' / ' + n), tile('Pemakaian Needs', `<span class="${needsPct > 100 ? 'neg' : ''}">${needsPct}%</span>`),
    tile('Pemakaian Wants', `<span class="${wantsPct > 100 ? 'neg' : ''}">${wantsPct}%</span>`), tile('Emas bersih', fmtIDR(I.gold.net)), tile('Tanah dibayar', fmtIDR(I.tanah.paid))]);

  // obligations & plan
  const trip = M.events().find((e) => Number(e.active) && e.kind === 'trip');
  const td = trip ? M.eventData(trip.id) : null;
  let ob = row('Talangan berjalan', I.talanganCount + ' item', `<span class="neg">${fmtIDR(I.talanganOutstanding)}</span>`, fmtIDR(sum(M.talanganOpen(), (t) => t.perMonth)) + '/bln') +
    row('Pinjaman / piutang', 'dari daftar Pinjaman', `<span class="${moneyCls(I.loans.outstanding)}">${fmtIDR(I.loans.outstanding)}</span>`);
  if (td) ob += row(esc(trip.name), 'budget vs rencana', fmtIDR(td.planned) + ' / ' + fmtIDR(trip.budget), `<span class="${moneyCls(td.available)}">${td.available >= 0 ? 'masih cukup' : 'lebih ' + fmtIDR(-td.available)}</span>`);
  const sc = db.all('scenarios').find((x) => Number(x.active) !== 0);
  let F = null;
  if (sc) {
    F = M.forecast(sc.id);
    if (F.project) ob += row('Rencana: ' + esc(F.project.project.name), esc(sc.name), `<span class="neg">pinjam ${fmtIDR(F.loanTotal)}</span>`, F.stage2Done ? 'semua lunas ±' + cycleLabel(F.stage2Done, true) : 'lanjutan belum lunas');
  }
  h += card('Kewajiban & rencana', ob);

  // reading
  const p = [];
  p.push(`Selama ${n} siklus, rata-rata pemasukan <b>${fmtIDR(avgInc)}</b> dan pengeluaran <b>${fmtIDR(avgExp)}</b>${surplusN >= n / 2 ? ' — sebagian besar siklus ditutup positif.' : ' — lebih dari separuh siklus minus, perlu perhatian.'}`);
  p.push(`Rata-rata <b>${rate}%</b> pemasukan masuk tabungan. ${rate >= 30 ? 'Kuat.' : rate >= 15 ? 'Lumayan, tapi di bawah target.' : 'Masih rendah — cicilan talangan kemungkinan menyerap sebagian.'}`);
  p.push(`Needs terpakai <b>${needsPct}%</b> dari budget dan Wants <b>${wantsPct}%</b>${needsPct > 100 || wantsPct > 100 ? ' — komponen di atas 100% itulah tempat budget bocor.' : ' — keduanya masih di dalam budget.'}`);
  p.push(`Dana darurat likuid <b>${fmtIDR(efLiquid)}</b> (tanpa JMO) cukup untuk sekitar <b>${runway.toFixed(1)} bulan</b> Needs.`);
  if (I.talanganOutstanding > 0) p.push(`Talangan terbuka <b>${fmtIDR(I.talanganOutstanding)}</b> — ini uang yang masih "dipinjam" dari kantongmu sendiri, jadi saldo kantong terlihat lebih besar dari yang benar-benar bebas.`);
  if (F && F.project) p.push(`Rencana ${esc(F.project.project.name)} (${esc(sc.name)}): tahap 1 ${fmtIDR(F.project.stage1)}, uang sendiri s/d ${cycleLabel(F.stage1End, true)} ${fmtIDR(F.ownFunds)}, jadi pinjam ${fmtIDR(F.loanTotal)} dicicil ${fmtIDR(F.repayEach)}/bln.`);
  h += card('Bacaan', p.map((x) => `<p class="insight-p">${x}</p>`).join(''));
  el.innerHTML = h;
  el.querySelectorAll('[data-year]').forEach((b) => b.addEventListener('click', () => { st.year = b.dataset.year; st.inv = null; render(el, S); }));
  el.querySelectorAll('[data-pt]').forEach((b) => b.addEventListener('click', () => { st.inv = st.inv === b.dataset.pt ? null : b.dataset.pt; render(el, S); setTimeout(() => document.getElementById('invCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30); }));
  bindTabs();
}
// ------------------------------------------------------------------ Strategi & nasihat (kesehatan arus kas + saran)
function strategyView(I) {
  const cur = I.cur;
  const past = I.months.filter((m) => !m.isFuture && (m.income > 0 || m.expenses > 0));
  const n = past.length || 1;
  const avgInc = sum(past, (m) => m.income) / n, avgExp = sum(past, (m) => m.expenses) / n, avgSave = sum(past, (m) => m.saving) / n;
  const rate = avgInc > 0 ? Math.round(avgSave / avgInc * 100) : 0;
  const surplusN = past.filter((m) => m.surplus >= 0).length;
  const avgNeeds = sum(past, (m) => m.needsSpent) / n;
  const efLiquid = I.ef ? (Number(I.ef.calLiquid) || (I.ef.actual - I.efJmo)) : 0;
  const runway = avgNeeds > 0 ? efLiquid / avgNeeds : 0;
  const sc = db.all('scenarios').find((x) => Number(x.active) !== 0);
  const F = sc ? M.forecast(sc.id) : null;
  const CF = sc ? M.cashflowProjection(sc.id) : { rows: [] };
  const afterLoan = F && F.repayEnd ? addMonths(F.repayEnd, 1) : cur;
  const futWin = CF.rows.filter((r) => r.month >= afterLoan).slice(0, 12);
  const pace = futWin.length ? sum(futWin, (r) => Math.max(0, r.afterKamar)) / futWin.length : 0;
  const minBal = F ? F.minBalance : 0;
  const dip = F ? (F.rows.reduce((m, r) => (!m || r.balance < m.balance ? r : m), null)) : null;

  const healthy = surplusN >= n * 0.6 && rate >= 15 && minBal > -3e6;
  const tight = !healthy && minBal > -1e7 && rate >= 5;
  const [vLabel, vCls] = healthy ? ['🟢 Sehat', 'pos'] : tight ? ['🟡 Ketat terkendali', ''] : ['🔴 Perlu perhatian', 'neg'];

  let h = tiles([
    tile('Status arus kas', `<span class="${vCls}">${vLabel}</span>`),
    tile('Nabung rata-rata', rate + '%', '<div class="m">target 20–30%</div>'),
    tile('Dana darurat', runway.toFixed(1) + ' bln', '<div class="m">likuid ÷ Needs</div>'),
    tile('Sisa gaji bebas', fmtShort(pace) + '/bln', `<div class="m">pasca-pinjaman (${cycleLabel(afterLoan, true)})</div>`),
  ]);

  const hp = [];
  hp.push(`${surplusN} dari ${n} siklus ditutup surplus, rata-rata nabung <b>${rate}%</b> dari pemasukan ${fmtShort(avgInc)} (pengeluaran ${fmtShort(avgExp)}).`);
  hp.push(`Saldo terendah proyeksi arus kas <b>${fmtIDR(minBal)}</b>${minBal < 0 ? ` — ada bulan mepet di ${dip ? cycleLabel(dip.month, true) : '±Nov 2026'} saat material kamar dibayar di muka. Siapkan buffer dana darurat untuk menambal.` : ' — tetap positif sepanjang rencana.'}`);
  h += card('Kesehatan arus kas — ' + vLabel, hp.map((x) => `<p class="insight-p">${x}</p>`).join(''));

  // beban bulanan
  const cbRaw = M.componentBudgets(cur);
  const cb = (cbRaw.needs || cbRaw.wants) ? cbRaw : (() => { const T = M.typicalBudget(cur); return { needs: T.needs, wants: T.wants, giving: T.giving, saving: T.saving }; })();
  const talM = sum(M.talanganOpen(), (t) => t.perMonth);
  let b = row('Kebutuhan (Needs)', 'rutin/bln', fmtIDR(cb.needs))
    + row('Keinginan (Wants)', 'rutin/bln', fmtIDR(cb.wants))
    + row('Giving', 'rutin/bln', fmtIDR(cb.giving))
    + row('Setoran kantong', 'tabungan terjadwal/bln (incl. Travelling)', fmtIDR(cb.saving))
    + (talM ? row('Talangan berjalan', `${M.talanganOpen().length} item, lunas ±2027`, `<span class="neg">${fmtIDR(talM)}/bln</span>`) : '');
  h += card('Beban bulanan sekarang', b);

  // komitmen besar ke depan
  let tl = '';
  if (F && F.loanTotal) tl += row('🏠 Pinjaman kamar (' + esc(F.project?.project.lender || 'keluarga') + ')', `cicil ${fmtIDR(F.repayEach)}/bln · ${cycleLabel(F.repayStart, true)}–${cycleLabel(F.repayEnd, true)}`, `<span class="neg">${fmtIDR(F.loanTotal)}</span>`);
  const umroh = db.all('events').find((e) => /umroh/i.test(e.name || ''));
  if (umroh) tl += row('🕋 ' + esc(umroh.name), `incar ${esc(umroh.start)} · ±${fmtShort((Number(umroh.budget) || 0) / 12)}/bln kalau nabung 12 bln`, fmtIDR(Number(umroh.budget) || 0));
  tl += row('✈️ Travelling rutin', 'mudik Lebaran + libur tengah tahun', '±80jt/th');
  const pots = db.all('events').filter((e) => Number(e.potential) === 1);
  if (pots.length) tl += row('💡 Potensial trip', pots.map((e) => esc(e.name.split(' —')[0].split(' (')[0])).join(' · '), fmtShort(sum(pots, (e) => Number(e.budget) || 0)));
  h += card('Komitmen besar ke depan', tl);

  // nasihat
  const adv = [];
  adv.push(runway >= 6
    ? `<b>Dana darurat ${runway.toFixed(1)} bln</b> sudah kuat (≥6 bln) — aman untuk fokus ke tujuan lain.`
    : `<b>Dana darurat ${runway.toFixed(1)} bln</b> masih di bawah ideal 6 bln. Setelah talangan lama lunas (±2027), isi EF dulu sebelum menambah target baru.`);
  if (F && F.loanTotal) adv.push(`<b>Pinjaman kamar ${fmtIDR(F.loanTotal)}</b> memang besar demi siap huni Lebaran 2027. Cicilan ${fmtIDR(F.repayEach)}/bln (${cycleLabel(F.repayStart, true)}–${cycleLabel(F.repayEnd, true)}) jalan bareng setoran Travelling 80jt/th — pastikan ${esc(F.project?.project.lender || 'pemberi pinjaman')} setuju tenor 2 thn, dan jaga buffer di ${dip ? cycleLabel(dip.month, true) : '±Nov 2026'} (bulan termepet).`);
  if (umroh) adv.push(`<b>Umroh Des 2027</b> jatuh di tengah masa cicilan. Biar tidak bentrok, sisihkan ±${fmtShort((Number(umroh.budget) || 0) / 12)}/bln dari sekarang di kantong khusus — atau geser ke 2028 kalau arus kas terasa berat.`);
  if (pots.length) adv.push(`<b>Potensial trip</b> paling pas <b>setelah pinjaman lunas (${cycleLabel(afterLoan, true)})</b>, saat sisa gaji bebas ±${fmtShort(pace)}/bln. Ambil satu per tahun, dahulukan yang termurah (wisata alam Indonesia, bisa digabung mudik). Ingat dana ini juga dipakai Kos Palu — pilih satu fokus tiap periode.`);
  adv.push(`Urutan sehat: <b>EF cukup → kamar siap (Feb 2027) → lunasi pinjaman (${F ? cycleLabel(F.repayEnd, true) : ''}) → umroh 2027 → trip & Kos Palu bergantian</b>. Jaga rasio nabung 20–30% dan Wants tetap di dalam budget.`);
  h += card('Nasihat untuk kondisimu', adv.map((x) => `<p class="insight-p">${x}</p>`).join(''));
  return h;
}
function investigation(v) {
  let h = `<div class="card focus" id="invCard"><h3><span>🔍 ${cycleLabel(v.cycle, true)}</span></h3>` +
    tiles([tile('Pemasukan', fmtIDR(v.income)), tile('Pengeluaran', fmtIDR(v.expenses)), tile('Selisih', `<span class="${moneyCls(v.gap)}">${fmtIDR(v.gap)}</span>`)]);
  if (v.driver && v.driver.delta > 0) h += `<div class="alloc"><div class="row"><b>Penyebab utama</b><span></span></div><div class="row big"><span>${esc(v.driver.name)}</span><span>${fmtIDR(v.driver.spent)}</span></div>
    <div class="row"><span>vs rata-rata ${v.compared} siklus lain ${fmtIDR(v.driver.avg)}</span><span class="neg"><b>+${fmtIDR(v.driver.delta)}</b></span></div></div>`;
  const mx = Math.max(1, ...v.categories.map((c) => c.spent));
  h += '<h4>Ke mana uangnya</h4>' + v.categories.filter((c) => c.spent > 0).map((c) => {
    const anom = c.avg > 0 && c.delta > c.avg * 0.25;
    return `<div class="comp"><div class="row1"><span>${esc(c.name)} ${c.avg > 0 ? `<span class="badge ${c.delta > 0 ? (anom ? 'r' : 'w') : 'g'}">${c.delta > 0 ? '+' : ''}${fmtShort(c.delta)} vs rata2</span>` : ''}</span><span>${fmtIDR(c.spent)}</span></div>${bar(c.spent, mx, anom)}</div>`;
  }).join('');
  if (v.topTx.length) h += '<h4>Transaksi terbesar</h4>' + v.topTx.map((t) => row(esc(t.desc), `${esc(t.date)} · ${esc(t.category)} · ${esc(t.account)}`, `<span class="neg">${fmtIDR(t.idr)}</span>`)).join('');
  return h + '</div>';
}
