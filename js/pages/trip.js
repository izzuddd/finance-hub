// Trips & events (mudik, liburan, hampers Lebaran…): plan items, agenda, gear, daily spending.
import * as db from '../db.js';
import * as M from '../model.js';
import { esc, fmtIDR, todayStr, uid, parseAmount, weekday } from '../util.js';
import { $, toast, openModal, tile, tiles, card, row, seg, bindSeg, moneyCls, empty } from '../ui.js';

const st = { ev: null, sub: 'plan' };
const CATS = ['TRANSPORT', 'HOTEL', 'FOOD', 'OLEH2', 'GIFT', 'OTHER'];

export function render(el, S) {
  const evs = M.events();
  st.ev = st.ev && db.get('events', st.ev) ? st.ev : (evs.find((e) => Number(e.active)) || evs[0])?.id;
  let h = `<div class="chips">${evs.map((e) => `<button data-ev="${e.id}" class="${e.id === st.ev ? 'active' : ''}">${esc(e.name)}</button>`).join('')}<button id="newEv">+ baru</button></div>`;
  if (!st.ev) { el.innerHTML = h + empty('Belum ada trip / acara'); $('newEv').onclick = () => editEvent(null); return; }
  const D = M.eventData(st.ev);
  const isTrip = D.ev.kind === 'trip';
  h += seg('tSeg', isTrip ? [['plan', 'Rencana'], ['agenda', 'Agenda'], ['gear', 'Barang'], ['jajan', 'Jajan']] : [['plan', 'Daftar']], isTrip ? st.sub : 'plan');
  const sub = isTrip ? st.sub : 'plan';
  if (sub === 'plan') h += planView(D);
  if (sub === 'agenda') h += agendaView(D);
  if (sub === 'gear') h += gearView(D);
  if (sub === 'jajan') h += jajanView(D);
  el.innerHTML = h;
  el.querySelectorAll('[data-ev]').forEach((b) => b.addEventListener('click', () => { st.ev = b.dataset.ev; render(el, S); }));
  $('newEv').onclick = () => editEvent(null);
  bindSeg(el, 'tSeg', (k) => { st.sub = k; render(el, S); });
  const on = (sel, fn) => el.querySelectorAll(sel).forEach((n) => n.addEventListener('click', (e) => { e.stopPropagation(); fn(n.dataset); }));
  on('[data-evedit]', () => editEvent(st.ev));
  on('[data-item]', (d) => editItem(d.item, D));
  on('[data-mv]', (d) => move('event_items', d.mv, Number(d.dir), D.items));
  on('[data-ag]', (d) => editAgenda(d.ag, D));
  on('[data-gr]', (d) => editGear(d.gr, D));
  on('[data-sp]', (d) => editSpend(d.sp));
  on('#addItem', () => editItem(null, D));
  on('#addAg', () => editAgenda(null, D));
  on('#addGr', () => editGear(null, D));
  el.querySelectorAll('[data-agchk]').forEach((n) => n.addEventListener('change', () => { const r = db.get('event_agenda', n.dataset.agchk); db.put('event_agenda', { ...r, checked: n.checked ? 1 : 0 }); }));
  el.querySelectorAll('[data-grchk]').forEach((n) => n.addEventListener('change', () => { const r = db.get('event_gear', n.dataset.grchk); db.put('event_gear', { ...r, checked: n.checked ? 1 : 0 }); }));
  const add = $('jAdd');
  if (add) {
    const info = () => { $('jInfo').innerHTML = dayInfo(D, $('jDay').value); };
    $('jDay').addEventListener('change', info); info();
    add.onclick = () => {
      const item = $('jItem').value.trim(), amt = parseAmount($('jAmt').value);
      if (!item || !amt) return toast('Isi apa & jumlah');
      db.put('event_spend', { id: uid('es-'), event: st.ev, date: $('jDay').value || todayStr(), item, amount: amt, note: $('jNote').value.trim() });
      toast('Ditambahkan ✓');
    };
  }
}

function planView(D) {
  const e = D.ev;
  let h = tiles([tile('Budget', fmtIDR(e.budget), '<button class="edit-ico corner" data-evedit="1">✎</button>'), tile('Rencana', fmtIDR(D.planned)),
    tile('Sisa budget', `<span class="${moneyCls(D.available)}">${fmtIDR(D.available)}</span>`), tile(e.kind === 'trip' ? 'Untuk makan/jajan' : 'Terpakai', fmtIDR(e.kind === 'trip' ? D.foodBudget : D.planned))], 'two');
  let grp = '';
  h += card('Item', D.items.map((it) => {
    let g = '';
    if (it.agenda && it.agenda !== grp) { grp = it.agenda; g = `<div class="grp">${esc(grp)}</div>`; }
    return g + row(esc(it.item) + ` <span class="badge">${esc(it.category)}</span>`, [it.orderDate && 'dipesan ' + it.orderDate, it.note].filter(Boolean).map(esc).join(' · '),
      fmtIDR(it.price) + `<div class="mvs"><button class="mv" data-mv="${it.id}" data-dir="-1" aria-label="naik">↑</button><button class="mv" data-mv="${it.id}" data-dir="1" aria-label="turun">↓</button><button class="edit-ico" data-item="${it.id}">✎</button></div>`);
  }).join('') + '<button class="btn ghost" id="addItem">+ Item</button>');
  return h;
}
function agendaView(D) {
  let day = '', h = '';
  D.agenda.forEach((a) => {
    if (a.day && a.day !== day) { day = a.day; h += `<div class="grp">${esc(a.day)}${a.date ? ' · ' + esc(a.date) + ' ' + weekday(a.date) : ''}${a.city ? ' · ' + esc(a.city) : ''}</div>`; }
    h += `<div class="chk${Number(a.checked) ? ' done' : ''}">${a.day ? `<input type="checkbox" data-agchk="${a.id}"${Number(a.checked) ? ' checked' : ''} aria-label="hari selesai">` : '<span class="sp"></span>'}
      <div class="t">${esc(a.what)}${a.where || a.note ? `<div class="m">${[a.where, a.note].filter(Boolean).map(esc).join(' · ')}</div>` : ''}</div><button class="edit-ico" data-ag="${a.id}">✎</button></div>`;
  });
  return card('Itinerary — centang hari yang sudah lewat', (h || empty('Kosong')) + '<button class="btn ghost" id="addAg">+ Agenda</button>');
}
function gearView(D) {
  let place = '', h = '';
  D.gear.forEach((g) => {
    if (g.place && g.place !== place) { place = g.place; h += `<div class="grp">${esc(place)}</div>`; }
    const meta = [g.amount && '×' + g.amount, g.what, g.where && g.where !== '-' && 'beli: ' + g.where, g.note].filter(Boolean).map(esc).join(' · ');
    h += `<div class="chk${Number(g.checked) ? ' done' : ''}"><input type="checkbox" data-grchk="${g.id}"${Number(g.checked) ? ' checked' : ''}><div class="t">${esc(g.item)}${meta ? `<div class="m">${meta}</div>` : ''}</div><button class="edit-ico" data-gr="${g.id}">✎</button></div>`;
  });
  return card('Packing list', (h || empty('Kosong')) + '<button class="btn ghost" id="addGr">+ Barang</button>');
}
function dayInfo(D, v) {
  const days = D.days;
  if (!v || !days.length) return '';
  let idx = -1; days.forEach((d, i) => { if (d.date && d.date <= v) idx = i; });
  if (idx < 0) return 'Sebelum trip mulai (' + esc(days[0].date) + ')';
  const last = days[days.length - 1].date;
  if (last && v > last) return 'Setelah trip selesai (' + esc(last) + ')';
  const left = days.length - idx;
  return `<b>${esc(days[idx].day)}</b> · ${left} hari lagi termasuk hari ini → <b>${fmtIDR((D.foodBudget - D.spent) / left)}</b>/hari`;
}
function jajanView(D) {
  let h = tiles([tile('Terpakai', fmtIDR(D.spent)), tile('Budget makan/jajan', fmtIDR(D.foodBudget)), tile('Sisa', `<span class="${moneyCls(D.foodBudget - D.spent)}">${fmtIDR(D.foodBudget - D.spent)}</span>`), tile('Per hari (sisa hari)', fmtIDR(D.perDay))], 'two');
  h += card('Catat cepat', `<div class="flex2"><div><label>Apa</label><input id="jItem" placeholder="mis. Sate Rembiga"></div><div><label>Jumlah (Rp)</label><input id="jAmt" inputmode="decimal"></div></div>
    <div class="flex2"><div><label>Tanggal</label><input id="jDay" type="date" value="${todayStr()}"></div><div><label>Catatan</label><input id="jNote"></div></div><div class="note" id="jInfo"></div><button class="btn" id="jAdd">Tambah</button>`);
  h += card('Log — ketuk untuk ubah', D.spend.map((x) => row(esc(x.item), esc(x.date) + (x.date ? ' ' + weekday(x.date) : '') + (x.note ? ' · ' + esc(x.note) : ''), fmtIDR(x.amount), '', ` data-sp="${x.id}" role="button"`)).join('') || empty('Belum ada'));
  return h;
}
function move(t, id, dir, list) {
  const i = list.findIndex((x) => x.id === id), j = i + dir;
  if (j < 0 || j >= list.length) return toast('Sudah paling ' + (dir < 0 ? 'atas' : 'bawah'));
  const a = list[i], b = list[j];
  db.put(t, { ...a, order: b.order }); db.put(t, { ...b, order: a.order });
}
const nextOrder = (list, afterId) => {
  if (!afterId) return (list.length ? Math.max(...list.map((x) => Number(x.order) || 0)) : 0) + 1;
  const a = list.find((x) => x.id === afterId), i = list.indexOf(a), n = list[i + 1];
  return n ? (Number(a.order) + Number(n.order)) / 2 : Number(a.order) + 1;
};
function editEvent(id) {
  const e = id ? db.get('events', id) : { id: uid('ev-'), name: '', kind: 'trip', budget: 0, start: todayStr(), end: '', active: 1, note: '' };
  openModal({ title: id ? e.name : 'Trip / acara baru', fields: [{ k: 'name', label: 'Nama', type: 'text', value: e.name },
    { k: 'kind', label: 'Jenis', type: 'select', options: [['trip', 'Trip / mudik (agenda, barang, jajan)'], ['gift', 'Hampers / hadiah'], ['other', 'Acara lain']], value: e.kind },
    { k: 'budget', label: 'Budget (IDR)', type: 'money', value: e.budget || '' }, { k: 'start', label: 'Mulai', type: 'date', value: e.start }, { k: 'end', label: 'Selesai', type: 'date', value: e.end },
    { k: 'active', label: 'Tampilkan sebagai trip aktif', type: 'check', value: !!Number(e.active) }],
    onSave: (v) => { if (!v.name) throw new Error('Isi nama'); db.put('events', { ...e, ...v, budget: Number(v.budget) || 0, active: v.active ? 1 : 0 }); st.ev = e.id; },
    onDelete: id ? () => db.del('events', id) : null });
}
function editItem(id, D) {
  const it = id ? db.get('event_items', id) : { id: uid('ei-'), event: st.ev, agenda: '', item: '', category: 'TRANSPORT', orderDate: '', price: 0, note: '' };
  openModal({ title: id ? it.item : 'Item baru', fields: [
    { k: 'item', label: 'Item', type: 'text', value: it.item },
    { k: 'agenda', label: 'Judul grup (mis. Trip Bandung) — cukup di item pertama grup', type: 'text', value: it.agenda },
    { k: 'category', label: 'Kategori', type: 'select', options: CATS, value: it.category },
    { k: 'price', label: 'Harga (IDR)', type: 'money', value: it.price || '' },
    { k: 'orderDate', label: 'Tanggal pesan (opsional)', type: 'date', value: it.orderDate },
    { k: 'note', label: 'Catatan', type: 'text', value: it.note },
    ...(id ? [] : [{ k: 'after', label: 'Posisi', type: 'select', options: [['', 'paling bawah']].concat(D.items.map((x) => [x.id, 'setelah: ' + x.item])), value: '' }])],
    onSave: (v) => { if (!v.item) throw new Error('Isi item'); db.put('event_items', { ...it, ...v, price: Number(v.price) || 0, order: id ? it.order : nextOrder(D.items, v.after) }); },
    onDelete: id ? () => db.del('event_items', id) : null });
}
function editAgenda(id, D) {
  const a = id ? db.get('event_agenda', id) : { id: uid('ea-'), event: st.ev, day: '', date: '', city: '', what: '', where: '', note: '', checked: 0 };
  openModal({ title: id ? 'Ubah agenda' : 'Agenda baru', fields: [
    { k: 'what', label: 'Agenda', type: 'text', value: a.what }, { k: 'where', label: 'Lokasi', type: 'text', value: a.where },
    { k: 'day', label: 'Label hari (mis. DAY-3) — kosong = sub-agenda hari yang sama', type: 'text', value: a.day },
    { k: 'date', label: 'Tanggal (untuk hari baru)', type: 'date', value: a.date }, { k: 'city', label: 'Kota', type: 'text', value: a.city }, { k: 'note', label: 'Catatan', type: 'text', value: a.note },
    ...(id ? [] : [{ k: 'after', label: 'Posisi', type: 'select', options: [['', 'paling bawah']].concat(D.agenda.map((x) => [x.id, 'setelah: ' + (x.day ? x.day + ' — ' : '') + x.what])), value: '' }])],
    onSave: (v) => { db.put('event_agenda', { ...a, ...v, order: id ? a.order : nextOrder(D.agenda, v.after) }); },
    onDelete: id ? () => db.del('event_agenda', id) : null });
}
function editGear(id, D) {
  const g = id ? db.get('event_gear', id) : { id: uid('eg-'), event: st.ev, place: '', item: '', amount: '1', checked: 0, what: '', where: '', note: '' };
  openModal({ title: id ? 'Ubah barang' : 'Barang baru', fields: [
    { k: 'item', label: 'Barang', type: 'text', value: g.item }, { k: 'amount', label: 'Jumlah', type: 'text', value: g.amount },
    { k: 'place', label: 'Grup tempat (cukup di barang pertama)', type: 'text', value: g.place }, { k: 'what', label: 'Untuk apa', type: 'text', value: g.what },
    { k: 'where', label: 'Beli di mana', type: 'text', value: g.where }, { k: 'note', label: 'Catatan', type: 'text', value: g.note },
    ...(id ? [] : [{ k: 'after', label: 'Posisi', type: 'select', options: [['', 'paling bawah']].concat(D.gear.map((x) => [x.id, 'setelah: ' + x.item])), value: '' }])],
    onSave: (v) => { if (!v.item) throw new Error('Isi barang'); db.put('event_gear', { ...g, ...v, order: id ? g.order : nextOrder(D.gear, v.after) }); },
    onDelete: id ? () => db.del('event_gear', id) : null });
}
function editSpend(id) {
  const x = db.get('event_spend', id);
  openModal({ title: 'Ubah: ' + x.item, fields: [{ k: 'item', label: 'Apa', type: 'text', value: x.item }, { k: 'amount', label: 'Jumlah', type: 'money', value: x.amount },
    { k: 'date', label: 'Tanggal', type: 'date', value: x.date }, { k: 'note', label: 'Catatan', type: 'text', value: x.note }],
    onSave: (v) => { db.put('event_spend', { ...x, ...v, amount: Number(v.amount) || 0 }); }, onDelete: () => db.del('event_spend', id) });
}
