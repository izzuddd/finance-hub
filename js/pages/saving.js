// Tabungan: pockets (+ saving log), talangan, core assets (gold/SDB/tanah), loans.
import * as db from '../db.js';
import * as M from '../model.js';
import { esc, fmtIDR, fmtTL, parseAmount, todayStr, currentCycle, cycleLabel, cycleOf, addMonths, uid, sum, pct, MONTHS } from '../util.js';
import { $, toast, openModal, tile, tiles, card, row, seg, bindSeg, bar, moneyCls, empty } from '../ui.js';

const st = { sub: 'pockets', open: null, logAll: false };

export function render(el, S) {
  let h = seg('sSeg', [['pockets', 'Kantong'], ['talangan', 'Talangan'], ['assets', 'Aset'], ['loans', 'Pinjaman']], st.sub);
  if (st.sub === 'pockets') h += pocketsView();
  if (st.sub === 'talangan') h += talanganView();
  if (st.sub === 'assets') h += assetsView();
  if (st.sub === 'loans') h += loansView();
  el.innerHTML = h;
  bindSeg(el, 'sSeg', (k) => { st.sub = k; render(el, S); });
  const on = (sel, fn) => el.querySelectorAll(sel).forEach((n) => n.addEventListener('click', (e) => { e.stopPropagation(); fn(n.dataset, n); }));
  on('[data-pocket]', (d) => { st.open = st.open === d.pocket ? null : d.pocket; render(el, S); });
  on('[data-cal]', (d) => calibrate(d.cal));
  on('[data-plan]', (d) => editPlan(d.plan));
  on('[data-phd]', (d) => editPhd(d.phd));
  on('[data-log]', (d) => editLog(d.log));
  on('#addLog', () => editLog(null));
  on('#logMore', () => { st.logAll = !st.logAll; render(el, S); });
  on('[data-tal]', (d) => editTalangan(d.tal));
  on('#addTal', () => editTalangan(null));
  on('#addGold', () => addGold());
  on('#fetchGold', () => fetchGold());
  on('#editSdb', () => editSdb());
  on('[data-loan]', (d) => editLoan(d.loan));
  on('#addLoan', () => editLoan(null));
  on('[data-inst]', (d) => editInstallment(d.inst));
  on('#addInst', () => editInstallment(null));
  el.querySelectorAll('[data-instpaid]').forEach((n) => n.addEventListener('change', () => { const r = db.get('installments', n.dataset.instpaid); db.put('installments', { ...r, paid: n.checked ? 1 : 0 }); }));
}

// ------------------------------------------------------------------ pockets
function pocketsView() {
  const P = M.pockets();
  const g = M.gold(), tn = M.installments('Tanah');
  let h = tiles([tile('Total kantong', fmtIDR(sum(P, (p) => p.actual))), tile('Aset inti', fmtIDR(g.net + tn.paid), `<div class="m">emas bersih + tanah</div>`)], 'two');
  h += `<button class="btn fab-add ghost" id="addLog">+ Catat setoran / penarikan tabungan</button>`;
  h += card('Kantong — ketuk untuk rincian', P.map((p) => {
    const open = st.open === p.name, isEF = /emergency/i.test(p.name);
    let x = `<div class="comp${open ? ' open' : ''}"><div data-pocket="${esc(p.name)}" role="button" tabindex="0">
      <div class="row1"><span>${esc(p.name)}${p.talangan.length ? ` <span class="badge w">${p.talangan.length} talangan</span>` : ''}</span><span>${fmtIDR(p.actual)}</span></div>
      <div class="row2"><span>target ${currentCycle().slice(0, 4)}: ${fmtIDR(p.targetYear)}</span><span>${p.goal ? 'goal ' + fmtIDR(p.goal) : ''}</span></div>
      ${bar(p.goal ? p.ori : p.actual, p.goal || p.targetYear)}</div>`;
    if (open) {
      const checked = Number(p.calOri) || p.actual;
      x += `<div class="det"><div class="s"><span><b>Komposisi</b> <button class="refresh" data-cal="${esc(p.name)}">kalibrasi</button></span><span><b>${fmtIDR(checked)}</b></span></div>`;
      if (p.calDate) x += `<div class="s sub"><span>Dicek ${esc(p.calDate)} · selisih vs catatan ${fmtIDR(Number(p.calOri) - p.actual)}</span><span></span></div>`;
      x += `<div class="s sub"><span>Uang asli kantong (${pct(p.ori, checked)}%)</span><span><b>${fmtIDR(p.ori)}</b></span></div>
            <div class="s sub"><span>Cicilan talangan yang parkir di sini (${pct(p.borrowed, checked)}%)</span><span>${fmtIDR(p.borrowed)}</span></div>`;
      if (isEF) {
        const jmo = Number(p.calJmo) || 0, liquid = (Number(p.calLiquid) || (checked - jmo));
        x += `<div class="s"><span><b>Likuid vs JMO</b></span><span></span></div><div class="s sub"><span>JMO (sulit dicairkan)</span><span>${fmtIDR(jmo)}</span></div>
              <div class="s sub"><span>Likuid (Bibit)</span><span>${fmtIDR(liquid)}</span></div><div class="s sub2"><span>… uang asli</span><span>${fmtIDR(liquid - p.borrowed)}</span></div>`;
      }
      p.talangan.forEach((t) => { x += `<div class="s sub"><span>${esc(t.item)} <span class="badge w">sisa ${fmtIDR(t.sisa)}</span></span><span>${fmtIDR(t.collected)}</span></div>`; });
      x += `<div class="s"><span><b>Rencana target</b> <button class="refresh" data-plan="${esc(p.name)}">atur</button></span><span></span></div>` + planLines(p);
      if (Number(p.tuitionTL)) x += phdLines(p);
      x += '</div>';
    }
    return x + '</div>';
  }).join(''));
  const logs = M.savingLogSorted();
  h += card(`Log tabungan (${logs.length})`, (st.logAll ? logs : logs.slice(0, 15)).map((l) => row(esc(l.desc) + (l.talanganTo ? ' <span class="badge w">talangan</span>' : ''),
    `${esc(l.date)} · ${esc(l.pocket || '?')}${l.talanganTo ? ' → ' + esc(l.talanganTo) : ''}${Number(l.onBudget) ? '' : ' · di luar budget'}`,
    `<span class="${moneyCls(l.amount)}">${fmtIDR(l.amount)}</span>`, '', ` data-log="${l.id}" role="button"`)).join('') +
    `<button class="btn small ghost" id="logMore">${st.logAll ? 'Ringkas' : 'Tampilkan semua'}</button>`);
  return h;
}
function eta(months) { const c = addMonths(currentCycle(), months); return cycleLabel(c, true); }
function planLines(p) {
  if (!Number(p.goal)) return '<div class="s sub"><span>Belum ada goal — ketuk atur</span><span></span></div>';
  const rem = Math.max(p.goal - p.ori, 0);
  let h = `<div class="s sub"><span>Goal (uang asli)</span><span>${fmtIDR(p.goal)}</span></div><div class="s sub"><span>Kurang</span><span>${fmtIDR(rem)}</span></div>`;
  if (rem <= 0) h += '<div class="s sub"><span class="pos"><b>Goal tercapai 🎉</b></span><span></span></div>';
  else if (Number(p.monthly) > 0) { const n = Math.ceil(rem / p.monthly); h += `<div class="s sub"><span>Dengan ${fmtIDR(p.monthly)}/bln</span><span><b>${n} bln → ${eta(n)}</b></span></div>`; }
  return h;
}
function nextTuition() {
  const now = new Date(), y = now.getFullYear();
  const cands = [new Date(y, 1, 1), new Date(y, 8, 1), new Date(y + 1, 1, 1)].filter((d) => d > now);
  const d = cands[0];
  return { date: d, label: (d.getMonth() === 1 ? 'Spring 1 Feb ' : 'Fall 1 Sep ') + d.getFullYear() };
}
function phdLines(p) {
  const rate = Number(p.tuitionRate) || M.rateFor(currentCycle()) || 1;
  const due = nextTuition(), semTL = Number(p.tuitionTL) / 2, need = semTL * rate;
  const short = Math.max(need - p.ori, 0);
  let n = 0; for (let d = new Date(new Date().getFullYear(), new Date().getMonth() + (new Date().getDate() >= 15 ? 1 : 0), 15); d < due.date; d.setMonth(d.getMonth() + 1)) n++;
  n = Math.max(n, 1);
  return `<div class="s"><span><b>Rencana SPP PhD</b> <button class="refresh" data-phd="${esc(p.name)}">ubah</button></span><span></span></div>
    <div class="s sub"><span>SPP / tahun</span><span>${fmtTL(p.tuitionTL)}</span></div>
    <div class="s sub"><span>Semester berikut (${due.label})</span><span>${fmtTL(semTL)} ≈ <b>${fmtIDR(need)}</b></span></div>
    <div class="s sub"><span>Ada di kantong</span><span>${fmtIDR(p.ori)}</span></div>
    ${short <= 0 ? '<div class="s sub"><span class="pos"><b>SPP aman ✓</b></span><span></span></div>'
      : `<div class="s sub"><span>Kurang · ${n} gajian lagi</span><span class="neg">${fmtIDR(short)}</span></div><div class="s sub"><span><b>Sisihkan per gajian</b></span><span><b>${fmtIDR(short / n)}</b></span></div>`}`;
}
const pocketRow = (name) => db.all('pockets').find((p) => p.name === name);
function calibrate(name) {
  const p = M.pockets().find((x) => x.name === name), raw = pocketRow(name), isEF = /emergency/i.test(name);
  const fields = isEF
    ? [{ k: 'jmo', label: 'Saldo JMO (dicek)', type: 'money', value: raw.calJmo || '' }, { k: 'liquid', label: 'Saldo Bibit / likuid (dicek)', type: 'money', value: raw.calLiquid || '' }]
    : [{ k: 'ori', label: 'Saldo dicek (IDR)', type: 'money', value: raw.calOri || '', note: 'Tercatat di app: ' + fmtIDR(p.actual) }];
  openModal({ title: 'Kalibrasi — ' + name, sub: 'Isi saldo nyata dari rekening. Cicilan talangan tetap dilacak terpisah.', fields,
    onSave: (v) => {
      const patch = isEF ? { calJmo: v.jmo || 0, calLiquid: v.liquid || 0, calOri: (v.jmo || 0) + (v.liquid || 0) } : { calOri: v.ori || 0 };
      db.put('pockets', { ...raw, ...patch, calDate: todayStr() }); toast('Dikalibrasi ✓');
    } });
}
function editPlan(name) {
  const p = M.pockets().find((x) => x.name === name), raw = pocketRow(name);
  const calc = (a) => {
    const v = a.read(); const rem = Math.max((v.goal || 0) - p.ori, 0);
    let s = `Uang asli sekarang <b>${fmtIDR(p.ori)}</b> · kurang <b>${fmtIDR(rem)}</b>`;
    if (v.months) s += `<br>Selesai dalam ${v.months} bln → <b>${fmtIDR(rem / v.months)}</b>/bln`;
    if (v.monthly) s += `<br>Dengan ${fmtIDR(v.monthly)}/bln → <b>${Math.ceil(rem / v.monthly)} bln</b> (${eta(Math.ceil(rem / v.monthly))})`;
    a.set('calc', s);
  };
  openModal({ title: 'Rencana — ' + name, sub: 'Progres dihitung dari uang asli kantong (tanpa talangan).',
    fields: [{ k: 'goal', label: 'Goal total (IDR)', type: 'money', value: raw.goal || '', onchange: (_, a) => calc(a) },
      { k: 'monthly', label: 'Tabungan per bulan (IDR)', type: 'money', value: raw.monthly || '', onchange: (_, a) => calc(a) },
      { k: 'months', label: 'ATAU: selesai dalam berapa bulan?', type: 'number', value: '', onchange: (_, a) => calc(a) },
      { k: 'calc', type: 'info', init: calc },
      { k: 'apply', label: 'Tulis jumlah bulanan ke target budget (siklus ini s/d Desember)', type: 'check', value: false }],
    onSave: (v) => {
      if (!v.goal) throw new Error('Isi goal');
      const monthly = v.monthly || (v.months ? Math.max(v.goal - p.ori, 0) / v.months : 0);
      db.put('pockets', { ...raw, goal: v.goal, monthly });
      if (v.apply) for (let c = currentCycle(); c.slice(0, 4) === currentCycle().slice(0, 4); c = addMonths(c, 1)) {
        const id = c + '|' + name; const x = db.get('pocket_targets', id) || { id, cycle: c, pocket: name, paid: 0, timing: '', payfrom: '' };
        db.put('pocket_targets', { ...x, target: Math.round(monthly) });
      }
      toast('Rencana disimpan ✓');
    } });
}
function editPhd(name) {
  const raw = pocketRow(name);
  openModal({ title: 'Rencana SPP PhD', sub: 'Fall ±1 Sep, Spring ±1 Feb; semester = ½ SPP tahunan',
    fields: [{ k: 'tl', label: 'SPP per tahun (TL)', type: 'number', value: raw.tuitionTL || 33300 }, { k: 'rate', label: 'Kurs (kosong = kurs siklus ini)', type: 'number', value: raw.tuitionRate || '' }],
    onSave: (v) => { db.put('pockets', { ...raw, tuitionTL: v.tl || 0, tuitionRate: v.rate || 0 }); toast('Tersimpan ✓'); } });
}
function editLog(id) {
  const l = id ? db.get('saving_log', id) : { id: uid('sl-'), date: todayStr(), desc: '', amount: 0, onBudget: 1, pocket: M.pocketsList()[0]?.name || '', talanganTo: '', note: '', talangan: '' };
  const pockets = M.pocketsList().map((p) => p.name);
  const open = M.talanganOpen();
  openModal({ title: id ? 'Ubah log tabungan' : 'Setoran / penarikan tabungan', sub: 'Setoran bulanan = positif. Penarikan / pembayaran = negatif.',
    fields: [
      ...(id ? [] : [{ k: 'tal', label: 'Cicilan talangan (opsional — isi otomatis)', type: 'select', allowEmpty: true, options: open.map((t) => [t.id, t.item + ' · ' + fmtIDR(t.perMonth) + '/bln']), value: '',
        onchange: (v, a) => { const t = open.find((x) => x.id === v); if (!t) return; a.set('desc', 'Nabung ' + t.item); a.set('amount', Math.round(t.perMonth)); a.set('pocket', t.usage); a.set('pay', true); } }]),
      { k: 'date', label: 'Tanggal', type: 'date', value: l.date },
      { k: 'desc', label: 'Keterangan', type: 'text', value: l.desc },
      { k: 'amount', label: 'Jumlah (IDR, negatif = keluar)', type: 'money', value: l.amount || '' },
      { k: 'pocket', label: 'Kantong', type: 'select', options: pockets, value: l.pocket, allowEmpty: true,
        onchange: (v, a) => { if (!id) { const t = M.pocketTarget(currentCycle(), v); if (t && !a.read().amount) a.set('amount', t); } } },
      { k: 'onBudget', label: 'Hitung ke budget tabungan bulan ini', type: 'check', value: !!Number(l.onBudget) },
      { k: 'talanganTo', label: 'Talangan ke kantong lain (kalau uang ini sebenarnya untuk kantong lain)', type: 'select', options: pockets, value: l.talanganTo, allowEmpty: true },
      ...(id ? [] : [{ k: 'pay', label: 'Catat juga sebagai cicilan talangan bulan ini (mengurangi sisa utang)', type: 'check', value: false }]),
      { k: 'note', label: 'Catatan', type: 'text', value: l.note }],
    onSave: (v) => {
      if (!v.desc) throw new Error('Isi keterangan');
      if (!v.amount) throw new Error('Isi jumlah');
      db.put('saving_log', { ...l, date: v.date, desc: v.desc, amount: Number(v.amount), pocket: v.pocket, onBudget: v.onBudget ? 1 : 0, talanganTo: v.talanganTo, note: v.note, talangan: v.tal || l.talangan || '' });
      if (v.pay && v.tal) {
        const c = cycleOf(v.date), pid = v.tal + '|' + c;
        const ex = db.get('talangan_pay', pid);
        db.put('talangan_pay', { id: pid, talangan: v.tal, cycle: c, amount: (ex ? Number(ex.amount) : 0) + Math.abs(Number(v.amount)) });
      }
      toast('Tersimpan ✓');
    },
    onDelete: id ? () => db.del('saving_log', id) : null });
}

// ------------------------------------------------------------------ talangan
function talanganView() {
  const all = M.talanganAll(), open = all.filter((t) => !t.done);
  let h = tiles([tile('Talangan aktif', open.length + ' item'), tile('Total sisa utang', fmtIDR(sum(open, (t) => t.sisa))), tile('Cicilan / bln', fmtIDR(sum(open, (t) => t.perMonth)))]);
  h += card('Daftar talangan', all.map((t) => row((t.done ? '✅ ' : '') + esc(t.item) + ` <span class="badge">${esc(t.usage)}</span>`,
    `${fmtIDR(t.harga)} · ${t.duration} bln · ${fmtIDR(t.perMonth)}/bln${t.start ? ' · ' + esc(String(t.start).slice(0, 7)) + ' → ' + esc(t.doneIn) : ''}<br>dibayar ${fmtIDR(t.paidTotal)} (${t.payments.length}×) · sisa <b>${fmtIDR(t.sisa)}</b>`,
    `<button class="edit-ico" data-tal="${t.id}">✎</button>`, '', t.done ? ' style="opacity:.55"' : '')).join('') + '<button class="btn fab-add ghost" id="addTal">+ Talangan baru</button>');
  h += '<div class="note">Talangan = kantong yang menalangi dulu, lalu dicicil balik tiap bulan. Cicilan otomatis masuk ke Rencana (proyeksi arus kas).</div>';
  return h;
}
function editTalangan(id) {
  const t = id ? db.get('talangan', id) : { id: uid('tal-'), item: '', harga: 0, duration: 12, start: todayStr(), usage: M.pocketsList()[0]?.name || '', done: 0, note: '', order: db.all('talangan').length + 1 };
  const pays = db.where('talangan_pay', (p) => p.talangan === t.id);
  const cur = currentCycle();
  openModal({ title: id ? t.item : 'Talangan baru', sub: 'Pembayaran cicilan dicatat per siklus',
    fields: [
      { k: 'item', label: 'Item', type: 'text', value: t.item },
      { k: 'harga', label: 'Harga (IDR)', type: 'money', value: t.harga || '' },
      { k: 'duration', label: 'Durasi (bulan)', type: 'number', value: t.duration },
      { k: 'start', label: 'Mulai cicil', type: 'date', value: String(t.start || '').slice(0, 10) },
      { k: 'usage', label: 'Kantong yang menalangi', type: 'select', options: M.pocketsList().map((p) => p.name), value: t.usage },
      { k: 'payCycle', label: 'Catat / ubah pembayaran untuk siklus', type: 'select', options: Array.from({ length: 30 }, (_, i) => addMonths(cur, 6 - i)).map((c) => [c, cycleLabel(c, true)]), value: cur },
      { k: 'payVal', label: 'Jumlah dibayar (kosongkan = lewati, 0 = hapus)', type: 'money', value: '' },
      { k: 'info', type: 'info', value: pays.length ? 'Sudah dibayar: ' + pays.sort((a, b) => (a.cycle < b.cycle ? -1 : 1)).map((p) => cycleLabel(p.cycle) + ' ' + fmtIDR(p.amount)).join(' · ') : 'Belum ada pembayaran' },
      { k: 'done', label: 'Lunas', type: 'check', value: !!Number(t.done) },
      { k: 'note', label: 'Catatan', type: 'text', value: t.note }],
    onSave: (v) => {
      if (!v.item) throw new Error('Isi nama item');
      db.put('talangan', { ...t, item: v.item, harga: v.harga || 0, duration: v.duration || 1, start: v.start, usage: v.usage, done: v.done ? 1 : 0, note: v.note });
      if (v.payVal !== '') {
        const pid = t.id + '|' + v.payCycle;
        if (Number(v.payVal) === 0) db.del('talangan_pay', pid);
        else db.put('talangan_pay', { id: pid, talangan: t.id, cycle: v.payCycle, amount: v.payVal });
      }
      toast('Tersimpan ✓');
    },
    onDelete: id ? () => { db.del('talangan', id); pays.forEach((p) => db.del('talangan_pay', p.id)); } : null });
}

// ------------------------------------------------------------------ assets
function assetsView() {
  const g = M.gold(), tn = M.installments('Tanah');
  let h = tiles([tile('Emas bersih (− SDB)', fmtIDR(g.net), `<div class="m">bruto ${fmtIDR(g.gross)}</div>`), tile('Tanah dibayar', fmtIDR(tn.paid), `<div class="m">dari ${fmtIDR(tn.paid + tn.unpaid)}</div>`)], 'two');
  const units = db.setting('goldUnits', { antam: 40, ubs: 5, galeri: 5 });
  h += card('Emas', (g.latest ? row('Terakhir: ' + esc(g.latest.date), `ANTAM ${fmtIDR(g.latest.antam)} · UBS ${fmtIDR(g.latest.ubs)} · Galeri24 ${fmtIDR(g.latest.galeri)}`,
    '<b>' + fmtIDR(g.latest.total) + '</b>', `<span class="${moneyCls(g.latest.ret)}">${(g.latest.ret * 100).toFixed(1)}%</span> · ${fmtIDR(Math.round(g.latest.total / (units.antam + units.ubs + units.galeri)))}/g`) : '') +
    g.rows.slice(0, -1).reverse().slice(0, 10).map((x) => row(esc(x.date), '', fmtIDR(x.total), (x.ret * 100).toFixed(1) + '%', ' style="opacity:.7"')).join('') +
    `<div class="flex2"><button class="btn small ghost" id="addGold">+ Catat harga</button><button class="btn small ghost" id="fetchGold">⟳ Ambil harga buyback</button></div>
     <div class="note">Emas tidak dijual — dicatat untuk nilai kekayaan. Harga otomatis butuh endpoint kecil (lihat SETUP.md), selain itu isi manual dari galeri24.co.id.</div>`);
  h += card('Biaya Safe Deposit Box', row('Jaminan kunci (sekali)', '', fmtIDR(g.sdb.keyFee)) + row(`Sewa tahunan + PPN ${g.sdb.ppnPct}%`, fmtIDR(g.sdb.annualWithPpn) + ' × ' + g.sdb.years + ' th', fmtIDR(g.sdb.annualWithPpn * g.sdb.years)) +
    `<div class="btotal"><span>Total biaya SDB</span><span class="neg">${fmtIDR(g.sdb.total)}</span></div><button class="btn small ghost" id="editSdb">ubah</button>`);
  h += card('Tanah — cicilan', `<div class="note">Dibayar ${fmtIDR(tn.paid)} · sisa ${fmtIDR(tn.unpaid)}</div>` + tn.rows.map((r) => `<div class="chk${Number(r.paid) ? ' done' : ''}"><input type="checkbox" data-instpaid="${r.id}"${Number(r.paid) ? ' checked' : ''}>
    <div class="t" data-inst="${r.id}">${esc(r.date)}</div><div class="r">${fmtIDR(r.value)}</div></div>`).join('') + '<button class="btn fab-add small ghost" id="addInst">+ cicilan</button>');
  return h;
}
function addGold(prefill) {
  const calc = (a) => { const v = a.read(); a.set('tot', 'Total: <b>' + fmtIDR((v.antam || 0) + (v.ubs || 0) + (v.galeri || 0)) + '</b>'); };
  openModal({ title: 'Catat harga emas', sub: 'Nilai total per merek (bukan per gram)',
    fields: [{ k: 'date', label: 'Tanggal', type: 'date', value: todayStr() },
      { k: 'antam', label: 'ANTAM (IDR)', type: 'money', value: prefill?.antam || '', onchange: (_, a) => calc(a) },
      { k: 'ubs', label: 'UBS (IDR)', type: 'money', value: prefill?.ubs || '', onchange: (_, a) => calc(a) },
      { k: 'galeri', label: 'Galeri24 (IDR)', type: 'money', value: prefill?.galeri || '', onchange: (_, a) => calc(a) },
      { k: 'tot', type: 'info', init: calc }],
    onSave: (v) => { if (!v.antam && !v.ubs && !v.galeri) throw new Error('Isi minimal satu'); db.put('gold', { id: uid('gold-'), date: v.date, antam: v.antam || 0, ubs: v.ubs || 0, galeri: v.galeri || 0, note: prefill ? 'otomatis' : '' }); toast('Tercatat ✓'); } });
}
async function fetchGold() {
  const url = db.setting('goldEndpoint', '');
  if (!url) { toast('Endpoint harga emas belum diatur (Pengaturan). Buka galeri24.co.id lalu catat manual.', 4500); return window.open('https://galeri24.co.id/harga-emas', '_blank'); }
  try {
    toast('Mengambil harga…');
    const r = await fetch(url).then((x) => x.json());
    if (!r.ok) throw new Error('parse gagal');
    const u = db.setting('goldUnits', { antam: 40, ubs: 5, galeri: 5 });
    addGold({ antam: r.antamPerGram * u.antam, ubs: r.ubsPerGram * u.ubs, galeri: r.galeriPerGram * u.galeri });
  } catch (e) { toast('Gagal ambil harga: ' + e.message, 4000); }
}
function editSdb() {
  const s = db.setting('sdb', { keyFee: 750000, annualFee: 200000, ppnPct: 11, years: 1 });
  openModal({ title: 'Biaya Safe Deposit Box', sub: 'Dikurangkan dari nilai emas',
    fields: [{ k: 'keyFee', label: 'Jaminan kunci (sekali)', type: 'money', value: s.keyFee }, { k: 'annualFee', label: 'Sewa tahunan sebelum PPN', type: 'money', value: s.annualFee },
      { k: 'ppnPct', label: 'PPN (%)', type: 'number', value: s.ppnPct }, { k: 'years', label: 'Sudah berapa tahun', type: 'number', value: s.years }],
    onSave: (v) => { db.setSetting('sdb', { keyFee: v.keyFee || 0, annualFee: v.annualFee || 0, ppnPct: v.ppnPct || 0, years: v.years || 0 }); toast('Tersimpan ✓'); } });
}
function editInstallment(id) {
  const r = id ? db.get('installments', id) : { id: uid('inst-'), asset: 'Tanah', date: todayStr(), value: 0, paid: 0 };
  openModal({ title: id ? 'Cicilan ' + r.asset : 'Cicilan baru', fields: [{ k: 'asset', label: 'Aset', type: 'text', value: r.asset }, { k: 'date', label: 'Tanggal', type: 'date', value: r.date },
    { k: 'value', label: 'Jumlah', type: 'money', value: r.value || '' }, { k: 'paid', label: 'Sudah dibayar', type: 'check', value: !!Number(r.paid) }],
    onSave: (v) => { db.put('installments', { ...r, ...v, paid: v.paid ? 1 : 0 }); }, onDelete: id ? () => db.del('installments', id) : null });
}

// ------------------------------------------------------------------ loans
function loansView() {
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
