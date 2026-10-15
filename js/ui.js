// Small UI toolkit: toast, bottom-sheet form modal, cards, bars and SVG charts.
import { esc, fmtIDR, fmtShort, parseAmount } from './util.js';

export const $ = (id) => document.getElementById(id);
export const qs = (sel, el = document) => el.querySelector(sel);

export function toast(msg, ms = 2200) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms);
}

/**
 * Bottom-sheet form. fields: [{k, label, type: text|money|number|date|select|check|info|textarea|month,
 *   value, options: [str | [value,label]], note, onchange(val, api), allowEmpty, placeholder}]
 * onSave(values) may return a Promise; rejecting keeps the sheet open.
 */
export function openModal({ title, sub, fields, onSave, onDelete, saveLabel = 'Simpan', deleteLabel = 'Hapus' }) {
  const m = $('modal');
  const html = fields.map((f) => {
    const id = 'mf_' + f.k;
    const note = f.note ? `<div class="note">${f.note}</div>` : '';
    if (f.type === 'info') return `<div class="info" id="${id}">${f.value || ''}</div>`;
    if (f.type === 'check') return `<label class="checkline"><input type="checkbox" id="${id}"${f.value ? ' checked' : ''}><span>${esc(f.label)}</span></label>${note}`;
    let input;
    if (f.type === 'select') {
      const opts = (f.allowEmpty ? [['', '—']] : []).concat((f.options || []).map((o) => (Array.isArray(o) ? o : [o, o])));
      input = `<select id="${id}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(f.value ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    } else if (f.type === 'textarea') {
      input = `<textarea id="${id}" rows="3">${esc(f.value ?? '')}</textarea>`;
    } else {
      const type = f.type === 'date' ? 'date' : f.type === 'month' ? 'month' : 'text';
      const mode = f.type === 'money' || f.type === 'number' ? ' inputmode="decimal"' : '';
      input = `<input id="${id}" type="${type}"${mode} value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}">`;
    }
    return `<label for="${id}">${esc(f.label || '')}</label>${input}${note}`;
  }).join('');
  m.innerHTML = `<div class="grab"></div><h2>${esc(title)}</h2>${sub ? `<div class="sub">${sub}</div>` : ''}<div class="mbody">${html}</div>
    <div class="mbtns">${onDelete ? `<button class="btn danger" id="mDel">${esc(deleteLabel)}</button>` : ''}
    <button class="btn ghost" id="mCancel">Batal</button>${onSave ? `<button class="btn" id="mSave">${esc(saveLabel)}</button>` : ''}</div>`;
  $('overlay').classList.add('show');
  const read = () => {
    const v = {};
    fields.forEach((f) => {
      const el = $('mf_' + f.k);
      if (!el || f.type === 'info') return;
      if (f.type === 'check') v[f.k] = el.checked;
      else if (f.type === 'money' || f.type === 'number') v[f.k] = el.value.trim() === '' ? '' : parseAmount(el.value);
      else v[f.k] = el.value;
    });
    return v;
  };
  const api = { read, set: (k, val) => { const el = $('mf_' + k); if (!el) return; if (el.type === 'checkbox') el.checked = !!val; else if (el.tagName === 'DIV') el.innerHTML = val; else el.value = val; }, el: (k) => $('mf_' + k) };
  fields.forEach((f) => {
    if (!f.onchange) return;
    const el = $('mf_' + f.k);
    el?.addEventListener(f.type === 'select' || f.type === 'check' ? 'change' : 'input', () => f.onchange(f.type === 'check' ? el.checked : el.value, api));
  });
  $('mCancel').onclick = closeModal;
  const busy = (b, lbl) => { if (b) { b.disabled = true; b.dataset.l = b.textContent; b.textContent = lbl; } };
  const free = (b) => { if (b) { b.disabled = false; b.textContent = b.dataset.l || b.textContent; } };
  if (onSave) $('mSave').onclick = async () => {
    const b = $('mSave'); busy(b, 'Menyimpan…');
    try { await onSave(read(), api); closeModal(); } catch (e) { free(b); if (e && e.message) toast(e.message, 3500); }
  };
  if (onDelete) $('mDel').onclick = async () => {
    if (!confirm('Hapus data ini?')) return;
    const b = $('mDel'); busy(b, 'Menghapus…');
    try { await onDelete(); closeModal(); } catch (e) { free(b); if (e && e.message) toast(e.message, 3500); }
  };
  fields.forEach((f) => f.init && f.init(api));
  setTimeout(() => { const first = m.querySelector('input:not([type=checkbox]),select,textarea'); if (first && !('ontouchstart' in window)) first.focus(); }, 60);
  return api;
}
export function closeModal() { $('overlay').classList.remove('show'); }
export const fail = (msg) => { throw new Error(msg); };

// ------------------------------------------------------------------ components
export const tile = (t, v, extra = '') => `<div class="tile"><div class="t">${t}</div><div class="v">${v}</div>${extra}</div>`;
export const tiles = (arr, cls = '') => `<div class="tiles ${cls}">${arr.join('')}</div>`;
export const card = (title, body, right = '') => `<div class="card">${title ? `<h3><span>${title}</span>${right}</h3>` : ''}${body}</div>`;
export const moneyCls = (n) => (n < 0 ? 'neg' : n > 0 ? 'pos' : '');
export function row(left, sub, right, rightSub = '', attrs = '') {
  return `<div class="tx"${attrs}><div class="l"><div class="d">${left}</div>${sub ? `<div class="m">${sub}</div>` : ''}</div><div class="r">${right}${rightSub ? `<div class="m">${rightSub}</div>` : ''}</div></div>`;
}
export function bar(value, max, over) {
  const p = max > 0 ? Math.min(value / max * 100, 100) : 0;
  return `<div class="bar"><i class="${over ? 'over' : ''}" style="width:${over ? 100 : p}%"></i></div>`;
}
export function seg(id, items, active) {
  return `<div class="seg" id="${id}">${items.map(([k, l]) => `<button data-k="${k}" class="${k === active ? 'active' : ''}">${l}</button>`).join('')}</div>`;
}
export function bindSeg(root, id, fn) {
  root.querySelectorAll(`#${id} button`).forEach((b) => b.addEventListener('click', () => fn(b.dataset.k)));
}
export function collapsible(id, head, body, open) {
  return `<div class="coll${open ? ' open' : ''}" data-coll="${id}"><div class="coll-hd" data-toggle="${id}">${head}<span class="chev">›</span></div><div class="coll-bd">${body}</div></div>`;
}

export const PALETTE = ['#2f6fed', '#189a5c', '#d64545', '#c98a12', '#7c5cff', '#12a0b5', '#e0699b', '#8a94a6', '#e8873b'];
export function donut(title, items) {
  items = (items || []).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  const total = items.reduce((a, x) => a + x.value, 0);
  if (total <= 0) return '';
  const C = 282.743; let off = 0, segs = '';
  items.forEach((it, i) => {
    const len = (it.value / total) * C;
    segs += `<circle cx="60" cy="60" r="45" fill="none" stroke="${PALETTE[i % PALETTE.length]}" stroke-width="18" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 60 60)"><title>${esc(it.name)}: ${fmtIDR(it.value)}</title></circle>`;
    off += len;
  });
  const legend = items.map((it, i) => `<div class="pl"><span class="sw" style="background:${PALETTE[i % PALETTE.length]}"></span><span class="pn">${esc(it.name)}</span><span class="pv">${fmtIDR(it.value)} · ${Math.round(it.value / total * 100)}%</span></div>`).join('');
  return card(title, `<div class="donutwrap"><svg viewBox="0 0 120 120" class="donut" role="img" aria-label="${esc(title)}"><circle cx="60" cy="60" r="45" fill="none" stroke="var(--line)" stroke-width="18"></circle>${segs}<text x="60" y="58" text-anchor="middle" class="dc1">${fmtShort(total)}</text><text x="60" y="72" text-anchor="middle" class="dc2">total</text></svg><div class="plegend">${legend}</div></div>`);
}
/** Grouped column chart. series: [{name, color}], points: [{label, values:[...], onclick, dim}] */
export function columns(points, series, { height = 150, fmt = fmtShort } = {}) {
  const max = Math.max(1, ...points.flatMap((p) => p.values.map((v) => Math.abs(v))));
  const cols = points.map((p, i) => `<div class="cm${p.dim ? ' dim' : ''}${p.active ? ' act' : ''}"${p.key ? ` data-pt="${esc(p.key)}"` : ''}>
    <div class="bars" style="height:${height}px">${p.values.map((v, k) => `<div class="b" style="height:${Math.round(Math.abs(v) / max * 100)}%;background:${series[k].color}" title="${esc(series[k].name)} ${fmtIDR(v)}"></div>`).join('')}</div>
    <div class="lb">${esc(p.label)}</div></div>`).join('');
  return `<div class="ch">${cols}</div><div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;
}
/** Simple SVG line/area chart for the forecast. lines: [{name,color,values:[...],area}] */
export function lineChart(labels, lines, { height = 180, zero = true } = {}) {
  const W = 640, H = height, pad = 28;
  const all = lines.flatMap((l) => l.values);
  let min = Math.min(zero ? 0 : Infinity, ...all), max = Math.max(1, ...all);
  if (min === max) max = min + 1;
  const x = (i) => pad + (i * (W - pad - 6)) / Math.max(labels.length - 1, 1);
  const y = (v) => 6 + (H - 30) * (1 - (v - min) / (max - min));
  const grid = [min, (min + max) / 2, max].map((v) => `<line x1="${pad}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="gl"/><text x="2" y="${y(v) + 3}" class="gt">${fmtShort(v)}</text>`).join('');
  const zl = min < 0 ? `<line x1="${pad}" x2="${W}" y1="${y(0)}" y2="${y(0)}" class="zl"/>` : '';
  const paths = lines.map((l) => {
    const pts = l.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = l.area ? `<polygon points="${x(0)},${y(Math.max(min, 0))} ${pts} ${x(l.values.length - 1)},${y(Math.max(min, 0))}" fill="${l.color}" opacity=".12"/>` : '';
    return `${area}<polyline points="${pts}" fill="none" stroke="${l.color}" stroke-width="2.2" stroke-linejoin="round"/>`;
  }).join('');
  const step = Math.ceil(labels.length / 8);
  const xl = labels.map((l, i) => (i % step === 0 ? `<text x="${x(i)}" y="${H - 6}" class="gt" text-anchor="middle">${esc(l)}</text>` : '')).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="lchart" role="img">${grid}${zl}${paths}${xl}</svg><div class="legend">${lines.map((l) => `<span><i style="background:${l.color}"></i>${esc(l.name)}</span>`).join('')}</div>`;
}
export const skel = () => '<div class="skel"></div><div class="skel"></div>';
export const empty = (t) => `<div class="empty">${t}</div>`;

// Calculator bar for amount fields. iOS's decimal keypad (inputmode="decimal") has only digits and
// one separator, so formulas like 1155.88-240 can't be typed. While such a field is focused, a bar
// sits just above the keyboard with + − × ÷ ( ) . and a live result; "=" replaces the formula by it.
export function installCalcBar() {
  const bar = document.createElement('div');
  bar.id = 'calcBar'; bar.hidden = true;
  bar.innerHTML = ['+', '-', '*', '/', '(', ')', '.'].map((k) => `<button type="button" data-k="${k}">${{ '-': '−', '*': '×', '/': '÷' }[k] || k}</button>`).join('')
    + '<span class="res"></span><button type="button" data-k="=" class="eq">=</button>';
  document.body.appendChild(bar);
  const res = bar.querySelector('.res');
  let el = null;
  const isAmt = (n) => n && n.tagName === 'INPUT' && n.inputMode === 'decimal';
  const place = () => { // keep it on top of the keyboard (visualViewport shrinks when the keyboard opens)
    const vv = window.visualViewport;
    // bottom must go 'auto' with top set, or the bar stretches from `top` down to the hidden layout
    // bottom: a full-screen white box with its buttons behind the keyboard (the iOS "white screen")
    if (!vv) return;
    bar.style.bottom = 'auto';
    bar.style.top = Math.max(0, vv.offsetTop + vv.height - bar.offsetHeight) + 'px';
  };
  const preview = () => {
    const s = el.value.trim();
    res.textContent = /[+\-*/()]/.test(s.replace(/^-/, '')) ? '= ' + parseAmount(s).toLocaleString('id-ID', { maximumFractionDigits: 2 }) : '';
  };
  const press = (k) => {
    if (!el) return;
    if (k === '=') { const v = parseAmount(el.value); el.value = v ? String(Math.round(v * 100) / 100) : el.value; }
    else el.setRangeText(k, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  // act on pointerdown and cancel the default, so the field keeps focus and the keyboard stays open
  bar.addEventListener('pointerdown', (e) => { e.preventDefault(); const b = e.target.closest('button'); if (b) press(b.dataset.k); });
  ['mousedown', 'touchstart'].forEach((t) => bar.addEventListener(t, (e) => e.preventDefault(), { passive: false }));
  document.addEventListener('focusin', (e) => {
    if (!isAmt(e.target)) return;
    el = e.target; bar.hidden = false; preview(); place();
  });
  document.addEventListener('focusout', () => setTimeout(() => { if (!isAmt(document.activeElement)) { bar.hidden = true; el = null; } }, 0));
  document.addEventListener('input', (e) => { if (e.target === el) preview(); });
  window.visualViewport?.addEventListener('resize', () => !bar.hidden && place());
  window.visualViewport?.addEventListener('scroll', () => !bar.hidden && place());
  // iOS home-screen apps: leaving the app with the keyboard open and coming back can leave the page
  // unpainted (blank white, keyboard still up, bar gone). Close the keyboard when the app is left so
  // it always comes back in a normal state.
  const away = () => { const a = document.activeElement; if (a && /^(INPUT|TEXTAREA)$/.test(a.tagName)) a.blur(); bar.hidden = true; el = null; };
  document.addEventListener('visibilitychange', () => document.hidden && away());
  window.addEventListener('pagehide', away);
}
