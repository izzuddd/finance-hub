// Budget per payroll cycle: income & payroll simulator, Needs/Wants/Giving lines, saving targets,
// transfer-among-balance (Mandiri / Bank Jago × mid / end payroll), TL top-up plan, cycle setup.
import * as db from '../db.js';
import * as M from '../model.js';
import { esc, fmtIDR, fmtTL, fmtMoney, parseAmount, currentCycle, cycleLabel, cyclePeriod, addMonths, uid, sum, pct } from '../util.js';
import { $, toast, openModal, tile, tiles, card, row, seg, bindSeg, collapsible, moneyCls, empty } from '../ui.js';

const st = { cycle: null, sub: 'budget', open: {} };
const PANELS = [['NEEDS', 'Needs'], ['WANTS', 'Wants'], ['GIVING', 'Giving']];

export function render(el, S) {
  st.cycle = st.cycle || currentCycle();
  const c = st.cycle;
  let h = `<div class="cyclebar"><button class="btn small ghost" data-cyc="-1">‹</button><div><b>${cycleLabel(c, true)}</b><div class="m">${cyclePeriod(c)}</div></div><button class="btn small ghost" data-cyc="1">›</button></div>`;
  h += seg('bSeg', [['budget', 'Budget'], ['gaji', 'Gaji'], ['transfer', 'Transfer & TL'], ['siklus', 'Saldo awal']], st.sub);
  const hasLines = M.budgetLines(c).length > 0;
  if (!hasLines && st.sub !== 'siklus') {
    const prev = M.cyclesWithData().filter((x) => x < c && M.budgetLines(x).length).pop();
    h += card('Belum ada budget untuk siklus ini', `<p class="note">Budget dibuat per siklus di satu database untuk semua tahun — tidak perlu file baru tiap tahun.</p>
      ${prev ? `<button class="btn" id="copyPrev">Salin dari ${cycleLabel(prev, true)}</button>` : ''}<button class="btn ghost" id="addFirst">+ Mulai dari kosong</button>`);
    el.innerHTML = h; bindTop(el, S);
    $('copyPrev') && ($('copyPrev').onclick = () => { const n = M.copyBudget(prev, c); toast(n + ' baris disalin ✓'); render(el, S); });
    $('addFirst').onclick = () => editLine(null, 'NEEDS');
    return;
  }
  if (st.sub === 'budget') h += budgetView(c);
  if (st.sub === 'gaji') h += incomeView(c);
  if (st.sub === 'transfer') h += transferView(c) + tlPlan(c);
  if (st.sub === 'siklus') h += cycleSetup(c);
  el.innerHTML = h;
  bindTop(el, S);
  el.querySelectorAll('[data-toggle]').forEach((n) => n.addEventListener('click', () => {
    const id = n.dataset.toggle; st.open[id] = !st.open[id]; n.parentElement.classList.toggle('open', st.open[id]);
  }));
  el.querySelectorAll('[data-line]').forEach((n) => n.addEventListener('click', (e) => { e.stopPropagation(); editLine(n.dataset.line); }));
  el.querySelectorAll('[data-addline]').forEach((n) => n.addEventListener('click', (e) => { e.stopPropagation(); editLine(null, n.dataset.addline, n.dataset.grp || ''); }));
  el.querySelectorAll('[data-paid]').forEach((n) => n.addEventListener('change', () => { const b = db.get('budget', n.dataset.paid); db.put('budget', { ...b, paid: n.checked ? 1 : 0 }); }));
  el.querySelectorAll('[data-ppaid]').forEach((n) => n.addEventListener('change', () => setTarget(n.dataset.ppaid, { paid: n.checked ? 1 : 0 })));
  el.querySelectorAll('[data-target]').forEach((n) => n.addEventListener('click', () => editTarget(n.dataset.target)));
  el.querySelectorAll('[data-inc]').forEach((n) => n.addEventListener('click', () => editIncome(n.dataset.inc)));
  const bind = (id, fn) => { const n = $(id); if (n) n.onclick = fn; };
  bind('addIncome', () => editIncome(null));
  bind('simBtn', () => simulator(c));
  bind('classify', () => classify(c));
  bind('tlBuffer', () => tlBuffer(c));
  bind('saveInit', () => saveInit(c));
  bind('copyNext', () => { const n = addMonths(c, 1); const k = M.copyBudget(c, n, { overwrite: M.budgetLines(n).length > 0 && confirm('Timpa budget ' + cycleLabel(n, true) + '?') }); toast(k ? k + ' baris disalin ke ' + cycleLabel(n, true) + ' ✓' : 'Siklus berikutnya sudah punya budget'); });
  el.querySelectorAll('[data-use]').forEach((n) => n.addEventListener('click', () => { $('ib_' + n.dataset.use).value = n.dataset.v; }));
}
function bindTop(el, S) {
  el.querySelectorAll('[data-cyc]').forEach((b) => b.addEventListener('click', () => { st.cycle = addMonths(st.cycle, Number(b.dataset.cyc)); render(el, S); }));
  bindSeg(el, 'bSeg', (k) => { st.sub = k; render(el, S); });
}

// ------------------------------------------------------------------ budget view
function budgetView(c) {
  const income = M.incomeTotal(c);
  const sb = M.savingBudget(c);
  const savingTotal = sum(sb, (s) => s.value);
  const totals = PANELS.map(([k]) => M.panelTotal(c, k));
  const allocated = sum(totals) + savingTotal;
  const delta = income - allocated;
  const leaves = allLeaves(c);
  const mid = M.incomeLeg(c, 'mid'), end = M.incomeLeg(c, 'end');
  const midA = sum(leaves.filter((l) => l.timing === 'mid'), (l) => l.idr), endA = sum(leaves.filter((l) => l.timing === 'end'), (l) => l.idr);
  const unassigned = leaves.filter((l) => !l.timing).length;
  let h = `<div class="alloc"><div class="row big"><span>Pemasukan</span><span>${fmtIDR(income)}</span></div>
    <div class="row"><span>Sudah dialokasikan</span><span>${fmtIDR(allocated)}</span></div>
    <div class="row"><span>Selisih</span><span class="${Math.abs(delta) < 1000 ? '' : moneyCls(delta)}"><b>${Math.abs(delta) < 1000 ? 'Pas teralokasi ✓' : delta > 0 ? fmtIDR(delta) + ' belum dialokasikan' : 'Lebih ' + fmtIDR(-delta)}</b></span></div>
    <div class="sep"></div>
    <div class="row"><span><b>Gaji mid</b> ${fmtIDR(mid)}</span><span>dipakai ${fmtIDR(midA)} → <b class="${moneyCls(mid - midA)}">${fmtIDR(mid - midA)}</b></span></div>
    <div class="row"><span><b>Gaji end</b> ${fmtIDR(end)}</span><span>dipakai ${fmtIDR(endA)} → <b class="${moneyCls(end - endA)}">${fmtIDR(end - endA)}</b></span></div>
    ${unassigned ? `<div class="row"><span class="m">${unassigned} baris belum diberi waktu bayar (mid/end)</span><button class="btn small ghost" id="classify">atur</button></div>` : ''}</div>`;
  PANELS.forEach(([k, name], i) => {
    const lines = M.panelLines(c, k);
    const groups = [];
    lines.forEach((l) => { const g = groups.find((x) => x.name === (l.grp || '')); if (g) g.items.push(l); else groups.push({ name: l.grp || '', items: [l] }); });
    const body = groups.map((g) => {
      const leavesH = g.items.map(lineRow).join('');
      return g.name ? `<div class="bgrp"><div class="gh"><span>${esc(g.name)}</span><span>${fmtIDR(sum(g.items, (x) => x.idr))}</span></div>${leavesH}</div>` : leavesH;
    }).join('') + `<button class="btn small ghost" data-addline="${k}">+ baris ${name}</button>`;
    h += collapsible(k, `<div class="nm">${name.toUpperCase()}<span class="amt">${fmtIDR(totals[i])}</span></div><div class="pct">${pct(totals[i], allocated)}%</div>`, body, st.open[k]);
  });
  const sbody = sb.map((s) => {
    const plan = s.target + s.talTotal;
    return `<div class="comp"><div class="row1"><label class="inl"><input type="checkbox" data-ppaid="${esc(s.name)}"${s.paid ? ' checked' : ''}><span class="${s.paid ? 'done' : ''}">${esc(s.name)}${s.talTotal ? ' <span class="badge">+ talangan</span>' : ''}</span></label>
      <span><b>${fmtIDR(s.value)}</b> <button class="edit-ico" data-target="${esc(s.name)}">✎</button></span></div>
      <div class="row2"><span>target ${fmtIDR(s.target)}${s.talTotal ? ' + cicilan ' + fmtIDR(s.talTotal) + ' = ' + fmtIDR(plan) : ''}</span><span>${s.actual ? 'tercatat ' + fmtIDR(s.actual) : 'belum disetor'}</span></div>
      ${s.talangan.map((t) => `<div class="s sub"><span>${esc(t.item)}</span><span>${fmtIDR(t.perMonth)}</span></div>`).join('')}</div>`;
  }).join('') + '<div class="note">Angka tebal = setoran tercatat di Log Tabungan bulan ini (sebelum ada setoran sama sekali, dipakai target). Baris abu-abu = rencana: target + cicilan talangan yang ditalangi kantong ini.</div>';
  h += collapsible('SAVING', `<div class="nm">SAVING<span class="amt">${fmtIDR(savingTotal)}</span></div><div class="pct">${pct(savingTotal, allocated)}%</div>`, sbody, st.open.SAVING);
  h += `<button class="btn ghost" id="copyNext">Salin budget ini ke ${cycleLabel(addMonths(c, 1), true)}</button>`;
  return h;
}
function lineRow(l) {
  return `<div class="tx leaf"><div class="l inl"><input type="checkbox" data-paid="${l.id}"${Number(l.paid) ? ' checked' : ''} aria-label="sudah dibayar">
    <div><div class="d ${Number(l.paid) ? 'done' : ''}">${esc(l.label)}</div><div class="m">${l.tl ? fmtTL(l.tl) + ' · ' : ''}${l.timing ? l.timing + (l.payfrom ? ' · ' + esc(l.payfrom) : '') : '—'}</div></div></div>
    <div class="r">${fmtIDR(l.idr)}<button class="edit-ico" data-line="${l.id}">✎</button></div></div>`;
}
function allLeaves(c) {
  const out = M.budgetLines(c).map((l) => ({ key: 'b:' + l.id, id: l.id, label: l.label, panel: l.panel, idr: Number(l.idr) || 0, tl: Number(l.tl) || 0, timing: l.timing, payfrom: l.payfrom }));
  M.savingBudget(c).forEach((s) => out.push({ key: 'p:' + s.name, id: s.name, label: s.name, panel: 'SAVING', idr: s.value, tl: 0, timing: s.timing, payfrom: s.payfrom }));
  return out;
}
function editLine(id, panel, grp) {
  const c = st.cycle;
  const l = id ? db.get('budget', id) : { id: uid('b-'), cycle: c, panel, grp: grp || '', label: '', idr: 0, tl: 0, paid: 0, timing: '', payfrom: '', order: M.panelLines(c, panel).length };
  const prevRate = M.rateFor(addMonths(c, -1)) || M.rateFor(c);
  const groups = [...new Set(M.panelLines(c, l.panel).map((x) => x.grp).filter(Boolean))];
  openModal({ title: id ? l.label : 'Baris budget baru', sub: `${l.panel} · ${cycleLabel(c, true)}`,
    fields: [
      { k: 'label', label: 'Nama', type: 'text', value: l.label },
      { k: 'grp', label: 'Grup (opsional, mis. Food)', type: 'text', value: l.grp, note: groups.length ? 'Grup yang ada: ' + groups.map(esc).join(', ') : '' },
      { k: 'tl', label: 'Jumlah TL (kosongkan kalau IDR)', type: 'number', value: l.tl || '', onchange: (v, api) => { const t = parseAmount(v), r = parseAmount(api.el('rate').value); if (t) api.set('idr', Math.round(t * r)); } },
      { k: 'rate', label: 'Kurs TL→IDR', type: 'number', value: prevRate, note: 'Default kurs siklus lalu, seperti rumus =kurs×TL di sheet' },
      { k: 'idr', label: 'Jumlah IDR', type: 'number', value: l.idr || '' },
      { k: 'timing', label: 'Dibayar dari gaji', type: 'select', options: [['', '—'], ['mid', 'Mid (tgl 15)'], ['end', 'End (akhir bulan)']], value: l.timing },
      { k: 'payfrom', label: 'Dibayar dari rekening', type: 'select', options: [['', '—'], ['Mandiri', 'Mandiri'], ['Bank Jago', 'Bank Jago'], ['AKBANK', 'AKBANK (TL)']], value: l.payfrom },
      { k: 'spread', label: 'Terapkan jumlah ini juga ke semua siklus berikutnya yang sudah ada', type: 'check', value: false }],
    onSave: (v) => {
      if (!v.label) throw new Error('Isi nama');
      const idr = v.tl ? Math.round(v.tl * (v.rate || prevRate)) : Number(v.idr) || 0;
      db.put('budget', { ...l, label: v.label, grp: v.grp, tl: Number(v.tl) || 0, idr, timing: v.timing, payfrom: v.payfrom });
      if (v.spread) db.where('budget', (x) => x.cycle > c && x.panel === l.panel && x.label === l.label).forEach((x) => db.put('budget', { ...x, idr, tl: Number(v.tl) || 0 }));
      toast('Tersimpan ✓ ' + fmtIDR(idr));
    },
    onDelete: id ? () => { db.del('budget', id); toast('Dihapus ✓'); } : null });
}
function setTarget(pocket, patch) {
  const id = st.cycle + '|' + pocket;
  const r = db.get('pocket_targets', id) || { id, cycle: st.cycle, pocket, target: 0, paid: 0, timing: '', payfrom: '' };
  db.put('pocket_targets', { ...r, ...patch });
}
function editTarget(pocket) {
  const r = db.get('pocket_targets', st.cycle + '|' + pocket) || {};
  openModal({ title: 'Target tabungan — ' + pocket, sub: cycleLabel(st.cycle, true),
    fields: [{ k: 'target', label: 'Target (IDR)', type: 'money', value: r.target || '' },
      { k: 'timing', label: 'Dibayar dari gaji', type: 'select', options: [['', '—'], ['mid', 'Mid'], ['end', 'End']], value: r.timing || '' },
      { k: 'payfrom', label: 'Dari rekening', type: 'select', options: [['', '—'], ['Mandiri', 'Mandiri'], ['Bank Jago', 'Bank Jago']], value: r.payfrom || '' },
      { k: 'fwd', label: 'Pakai target ini sampai Desember tahun ini', type: 'check', value: false }],
    onSave: (v) => {
      setTarget(pocket, { target: Number(v.target) || 0, timing: v.timing, payfrom: v.payfrom });
      if (v.fwd) for (let c = addMonths(st.cycle, 1); c.slice(0, 4) === st.cycle.slice(0, 4); c = addMonths(c, 1)) {
        const id = c + '|' + pocket; const x = db.get('pocket_targets', id) || { id, cycle: c, pocket, paid: 0, timing: '', payfrom: '' };
        db.put('pocket_targets', { ...x, target: Number(v.target) || 0 });
      }
      toast('Tersimpan ✓');
    } });
}

// ------------------------------------------------------------------ income & payroll simulator
function incomeView(c) {
  const lines = M.incomeLines(c);
  const p = db.get('payroll', c);
  let h = card('Pemasukan ' + cycleLabel(c, true), lines.map((i) => row(esc(i.label) + ` <span class="badge">${esc(i.leg)}</span>` + (i.source === 'actual' ? ' <span class="badge g">aktual</span>' : i.source === 'sim' ? ' <span class="badge w">simulasi</span>' : ''),
    '', fmtIDR(i.amount) + `<button class="edit-ico" data-inc="${i.id}">✎</button>`)).join('') +
    `<div class="btotal"><span>Total take-home</span><span>${fmtIDR(M.incomeTotal(c))}</span></div>
     <div class="flex2"><button class="btn small ghost" id="addIncome">+ pemasukan lain</button><button class="btn small" id="simBtn">🧮 Simulasi gaji</button></div>
     <div class="note">Mid = gaji tgl 15 (MA + PA + lunch). End = gaji akhir bulan (pokok − pajak). Setelah uang masuk, ✎ lalu isi jumlah <b>aktual</b> — siklus ini dikalibrasi ke angka nyata.</div>`);
  if (p) {
    h += card('Data payroll', row('Hari kerja', '', String(p.workDays || '–')) + row('Cuti tidak dibayar', '', String(p.unpaid || 0)) +
      row('Hari absen (lunch tidak dibayar)', '', String(p.absent || 0)) + row('Hari di luar Turki (MA prorata)', '', String(p.outDays || 0)) +
      (p.actualMid ? row('Aktual gaji mid', '', fmtIDR(p.actualMid)) : '') + (p.actualEnd ? row('Aktual gaji end', '', fmtIDR(p.actualEnd)) : ''));
  }
  return h;
}
function editIncome(id) {
  const c = st.cycle;
  const i = id ? db.get('income', id) : { id: uid('inc-'), cycle: c, leg: 'other', label: '', amount: 0, source: 'manual' };
  openModal({ title: id ? i.label : 'Pemasukan baru', sub: cycleLabel(c, true),
    fields: [{ k: 'label', label: 'Nama', type: 'text', value: i.label },
      { k: 'leg', label: 'Jenis', type: 'select', options: [['mid', 'Gaji mid (tgl 15)'], ['end', 'Gaji end'], ['thr', 'THR'], ['other', 'Lainnya (bonus, sisa bulan lalu)']], value: i.leg },
      { k: 'amount', label: 'Jumlah (IDR)', type: 'money', value: i.amount || '' },
      { k: 'actual', label: 'Ini angka aktual yang sudah diterima (kalibrasi)', type: 'check', value: i.source === 'actual' }],
    onSave: (v) => {
      db.put('income', { ...i, label: v.label || (v.leg === 'mid' ? 'Gaji mid' : v.leg === 'end' ? 'Gaji end' : 'Pemasukan'), leg: v.leg, amount: Number(v.amount) || 0, source: v.actual ? 'actual' : 'manual' });
      if (v.actual && (v.leg === 'mid' || v.leg === 'end')) {
        const p = db.get('payroll', c) || { id: c, cycle: c };
        db.put('payroll', { ...p, [v.leg === 'mid' ? 'actualMid' : 'actualEnd']: Number(v.amount) || 0 });
      }
      toast('Tersimpan ✓');
    },
    onDelete: id ? () => db.del('income', id) : null });
}
function simulator(c) {
  const P = db.setting('incomeSim', {});
  const ter = db.setting('terTable', []);
  const p = db.get('payroll', c) || {};
  const calc = (api) => {
    const v = api.read();
    const r = M.simulatePayroll(P, ter, { workDays: v.workDays || 0, unpaid: v.unpaid || 0, absent: v.absent || 0, outDays: v.outDays || 0, usdRate: v.usdRate || P.usdRate, overtime: v.overtime || 0 });
    api.set('out', `Mid (MA ${fmtIDR(r.ma)} + lunch ${fmtIDR(r.la)} + PA ${fmtIDR(r.pa)}) = <b>${fmtIDR(r.mid)}</b><br>End (take-home − mid) = <b>${fmtIDR(r.end)}</b><br>Bruto ${fmtIDR(r.gross)} · TER ${(r.ter * 100).toFixed(2)}% · PPh ${fmtIDR(r.pph)}<br><b>Take-home ${fmtIDR(r.takeHome)}</b>`);
    return r;
  };
  let last = null;
  openModal({ title: 'Simulasi gaji — ' + cycleLabel(c, true), sub: 'Model INCOME_SIMUL: MA prorata hari di luar Turki (÷30), lunch USD × hari kerja dibayar, pajak TER gross-up.',
    fields: [
      { k: 'workDays', label: 'Hari kerja (kalender Turki)', type: 'number', value: p.workDays || 21, onchange: (_, a) => (last = calc(a)) },
      { k: 'absent', label: 'Hari absen / cuti di Indonesia (lunch tidak dibayar)', type: 'number', value: p.absent || 0, onchange: (_, a) => (last = calc(a)) },
      { k: 'outDays', label: 'Hari di luar Turki (MA prorata)', type: 'number', value: p.outDays || 0, onchange: (_, a) => (last = calc(a)) },
      { k: 'unpaid', label: 'Cuti tidak dibayar (potong pokok/21)', type: 'number', value: p.unpaid || 0, onchange: (_, a) => (last = calc(a)) },
      { k: 'usdRate', label: 'Kurs USD/IDR', type: 'number', value: p.usdRate || P.usdRate || 18130, onchange: (_, a) => (last = calc(a)) },
      { k: 'overtime', label: 'Lembur (IDR)', type: 'number', value: p.overtime || 0, onchange: (_, a) => (last = calc(a)) },
      { k: 'out', type: 'info', value: '', init: (a) => (last = calc(a)) }],
    saveLabel: 'Pakai untuk siklus ini',
    onSave: (v) => {
      const r = last;
      db.put('payroll', { ...p, id: c, cycle: c, workDays: v.workDays, absent: v.absent, outDays: v.outDays, unpaid: v.unpaid, usdRate: v.usdRate, overtime: v.overtime, mid: Math.round(r.mid), end: Math.round(r.end) });
      for (const leg of ['mid', 'end']) {
        const ex = M.incomeLines(c).find((i) => i.leg === leg);
        if (ex && ex.source === 'actual') continue;
        db.put('income', { ...(ex || { id: uid('inc-'), cycle: c, leg, label: leg === 'mid' ? 'MA + PA (gaji mid)' : 'Payroll minus pajak (gaji end)' }), amount: Math.round(leg === 'mid' ? r.mid : r.end), source: 'sim' });
      }
      toast('Take-home ' + fmtIDR(r.takeHome) + ' ✓');
    } });
}

// ------------------------------------------------------------------ transfer among balances + TL plan
function transferView(c) {
  const leaves = allLeaves(c);
  const mid = M.incomeLeg(c, 'mid'), end = M.incomeLeg(c, 'end');
  const section = (title, payroll, timing) => {
    const mand = leaves.filter((l) => l.timing === timing && l.payfrom === 'Mandiri');
    const jago = leaves.filter((l) => l.timing === timing && l.payfrom === 'Bank Jago');
    const tm = sum(mand, (l) => l.idr), tj = sum(jago, (l) => l.idr);
    const tr = payroll - tm, rem = tr - tj;
    const det = (ls) => ls.map((l) => `<div class="s sub"><span>${esc(l.label)} <span class="m">· ${esc(l.panel)}</span></span><span>${fmtIDR(l.idr)}</span></div>`).join('');
    return `<div class="btotal"><span>${title}</span><span>gaji ${fmtIDR(payroll)}</span></div>
      ${row('Tagihan di Mandiri', 'tetap di Mandiri', '<b>' + fmtIDR(tm) + '</b>')}${det(mand)}
      ${row('→ Transfer ke Bank Jago', 'gaji − tagihan Mandiri', `<b class="${moneyCls(tr)}">${fmtIDR(tr)}</b>`)}
      ${row('Tagihan di Bank Jago', 'dibayar dari Jago', '<b>' + fmtIDR(tj) + '</b>')}${det(jago)}
      ${row('Sisa di Bank Jago', 'transfer − tagihan Jago', `<b class="${Math.abs(rem) < 1000 ? '' : moneyCls(rem)}">${fmtIDR(rem)}</b>`)}`;
  };
  const n = leaves.filter((l) => l.timing && l.payfrom).length;
  return card('Pembagian transfer antar rekening', section('GAJI MID', mid, 'mid') + section('GAJI END', end, 'end') +
    `<div class="note">${n} dari ${leaves.length} baris sudah diberi waktu & rekening.</div><button class="btn small ghost" id="classify">Atur waktu & rekening</button>`);
}
function classify(c) {
  const leaves = allLeaves(c);
  const m = $('modal');
  const sel = (kind, l, val, opts) => `<select data-${kind}="${esc(l.key)}">${opts.map(([v, t]) => `<option value="${v}"${val === v ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
  m.innerHTML = `<div class="grab"></div><h2>Waktu & rekening per baris</h2><div class="sub">Gaji mid/end × Mandiri/Bank Jago. Berlaku untuk ${cycleLabel(c, true)}; centang di bawah untuk menyalin ke siklus lain.</div>
    <div class="mbody">${leaves.map((l) => `<div class="tx"><div class="l"><div class="d">${esc(l.label)}</div><div class="m">${esc(l.panel)} · ${fmtIDR(l.idr)}</div></div>
    <div class="r flexr">${sel('t', l, l.timing || '', [['', '—'], ['mid', 'Mid'], ['end', 'End']])}${sel('a', l, l.payfrom || '', [['', '—'], ['Mandiri', 'Mandiri'], ['Bank Jago', 'Jago']])}</div></div>`).join('')}
    <label class="checkline"><input type="checkbox" id="clsAll"><span>Terapkan juga ke semua siklus berikutnya (berdasarkan nama baris)</span></label></div>
    <div class="mbtns"><button class="btn ghost" id="clsCancel">Batal</button><button class="btn" id="clsSave">Simpan</button></div>`;
  $('overlay').classList.add('show');
  $('clsCancel').onclick = () => $('overlay').classList.remove('show');
  $('clsSave').onclick = () => {
    const fwd = $('clsAll').checked;
    leaves.forEach((l) => {
      const t = m.querySelector(`select[data-t="${CSS.escape(l.key)}"]`).value, a = m.querySelector(`select[data-a="${CSS.escape(l.key)}"]`).value;
      if (l.key.startsWith('b:')) {
        const b = db.get('budget', l.id);
        if (b.timing !== t || b.payfrom !== a) db.put('budget', { ...b, timing: t, payfrom: a });
        if (fwd) db.where('budget', (x) => x.cycle > c && x.label === b.label && x.panel === b.panel).forEach((x) => db.put('budget', { ...x, timing: t, payfrom: a }));
      } else {
        setTarget(l.id, { timing: t, payfrom: a });
        if (fwd) db.where('pocket_targets', (x) => x.cycle > c && x.pocket === l.id).forEach((x) => db.put('pocket_targets', { ...x, timing: t, payfrom: a }));
      }
    });
    $('overlay').classList.remove('show'); toast('Tersimpan ✓');
  };
}
function tlLeaves(c) { return M.budgetLines(c).filter((l) => Number(l.tl) > 0); }
function tlPlan(c) {
  const leaves = tlLeaves(c);
  const totalTL = sum(leaves, (l) => l.tl);
  if (totalTL <= 0) return '';
  const rate = M.rateFor(c) || M.rateFor(addMonths(c, -1));
  const f = db.setting('flip', { fixed: 68000, pct: 1.5 });
  const idr = totalTL * rate, rounded = Math.ceil(idr / 100000) * 100000;
  const flip = (rounded - f.fixed) / (1 + f.pct / 100), eff = rate ? rounded / rate : 0;
  return card('Rencana top-up TL', `<div class="btotal"><span>Total budget TL</span><span>${fmtTL(totalTL)}</span></div>
    ${row('Kurs ₺1 = Rp ' + rate, '= ' + fmtIDR(idr), '')}${row('Transfer ke AKBANK (dibulatkan 100rb)', '', '<b>' + fmtIDR(rounded) + '</b>')}
    ${row('Input di Flip', `(dibulatkan − ${fmtIDR(f.fixed)}) ÷ ${1 + f.pct / 100}`, '<b>' + fmtIDR(flip) + '</b>')}
    ${row('TL yang diterima', 'buffer +' + fmtTL(eff - totalTL), '<b>' + fmtTL(eff) + '</b>')}
    <button class="btn small ghost" id="tlBuffer">Tambah buffer +${fmtTL(eff - totalTL)} ke satu baris TL</button>`);
}
function tlBuffer(c) {
  const leaves = tlLeaves(c);
  const rate = M.rateFor(c) || M.rateFor(addMonths(c, -1));
  const totalTL = sum(leaves, (l) => l.tl), eff = Math.ceil(totalTL * rate / 100000) * 100000 / rate, buf = eff - totalTL;
  if (buf <= 0.01) return toast('Sudah bulat, tidak ada buffer');
  openModal({ title: 'Tambah buffer TL', sub: `+${fmtTL(buf)} supaya total TL = hasil transfer yang dibulatkan`,
    fields: [{ k: 'line', label: 'Baris TL', type: 'select', options: leaves.map((l) => [l.id, l.label + ' (' + fmtTL(l.tl) + ')']), value: leaves[0].id }],
    onSave: (v) => { const l = db.get('budget', v.line); const tl = Number(l.tl) + buf; db.put('budget', { ...l, tl, idr: Math.round(tl * rate) }); toast('Buffer ditambahkan ✓'); } });
}

// ------------------------------------------------------------------ cycle setup (initial balances)
function cycleSetup(c) {
  const prev = addMonths(c, -1);
  let h = `<div class="card"><h3><span>Saldo awal — ${cycleLabel(c, true)}</span></h3><div class="note">Isi tanggal 15 (gaji pertama). "Akhir lalu" = saldo akhir hitungan siklus sebelumnya; selisih ditandai sebagai anomali.</div>`;
  M.accounts().forEach((a) => {
    const v = M.initialBalance(c, a.name);
    const pe = M.balanceOf(prev, a.name);
    const diff = v == null ? 0 : v - pe;
    h += `<label>${esc(a.name)} (${a.currency})</label><input id="ib_${esc(a.id)}" inputmode="decimal" value="${v == null ? '' : v}" placeholder="${Math.round(pe * 100) / 100}">
      <div class="note">Akhir lalu: ${fmtMoney(pe, a.currency)} <button class="refresh" data-use="${esc(a.id)}" data-v="${Math.round(pe * 100) / 100}">pakai</button>
      ${v != null && Math.abs(diff) > 0.005 ? ` · <span class="${moneyCls(diff)}">selisih ${fmtMoney(diff, a.currency)}</span> ⚠` : v != null ? ' · cocok ✓' : ''}</div>`;
  });
  return h + '<button class="btn" id="saveInit">Simpan saldo awal</button></div>';
}
function saveInit(c) {
  M.accounts().forEach((a) => {
    const raw = $('ib_' + a.id).value.trim();
    const id = c + '|' + a.name;
    if (raw === '') { if (db.get('balances', id)) db.del('balances', id); return; }
    db.put('balances', { id, cycle: c, account: a.name, initial: parseAmount(raw) });
  });
  toast('Saldo awal disimpan ✓');
}
