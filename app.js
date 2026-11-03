'use strict';

/* ---------- State ---------- */
const KEY = 'examSeating.v1';
const defaults = () => ({
  school: '', classes: [], rooms: [], mode: 'mixed',
  arr: null,      // { roomId: [ [studentKey|null, ...] , ... ] }  (one inner array per bench)
  locks: {},      // "roomId:bench:seat" -> studentKey
  theme: null, uid: 1,
});
let S = load();
let ST = new Map();      // studentKey -> student (rebuilt on render)
let hl = new Set();      // highlighted student keys (lookup)

function load() {
  try { return Object.assign(defaults(), JSON.parse(localStorage.getItem(KEY) || '{}')); }
  catch (e) { return defaults(); }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

/* ---------- Helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => Math.max(0, parseInt(v, 10) || 0);
const newId = () => 'i' + (S.uid++);
const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
const hue = classId => {
  const i = Math.max(0, S.classes.findIndex(c => c.id === classId));
  return Math.round((i * 137.5) % 360);
};
const classById = id => S.classes.find(c => c.id === id);

/* ---------- Students ---------- */
function classStudents(c) {
  const out = [], seen = new Set();
  const add = (roll, name) => {
    roll = String(roll).trim();
    if (!roll || seen.has(roll)) return;
    seen.add(roll);
    out.push({ key: c.id + '::' + roll, roll, name: name || '', classId: c.id });
  };
  const f = parseInt(c.from, 10), t = parseInt(c.to, 10);
  if (!isNaN(f) && !isNaN(t) && t >= f && t - f < 5000) {
    const pad = /^0\d+$/.test(String(c.from).trim()) ? String(c.from).trim().length : 0;
    for (let i = f; i <= t; i++) add((c.prefix || '') + String(i).padStart(pad, '0'), '');
  }
  (c.extra || []).forEach(e => add(e.roll, e.name));
  return out;
}
function allStudents() {
  const all = [];
  S.classes.forEach(c => all.push(...classStudents(c).sort((a, b) => natural(a.roll, b.roll))));
  return all;
}
const benchesOf = r => num(r.b2) + num(r.b3);
const seatsOf = r => num(r.b2) * 2 + num(r.b3) * 3;

/* ---------- Classes editor ---------- */
function renderClasses() {
  const box = $('#classes');
  if (!S.classes.length) {
    box.innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400">No classes yet. Click “Add class” or “Load sample data”.</p>';
    return;
  }
  box.innerHTML = S.classes.map(c => `
    <div class="row-box" data-id="${c.id}" style="--h:${hue(c.id)}">
      <div class="grid gap-2 grid-cols-2 md:grid-cols-6">
        <div class="md:col-span-2"><label class="lbl"><span class="legend-dot"></span>Class name</label>
          <input class="inp" data-f="name" value="${esc(c.name)}" placeholder="e.g. 10-A" /></div>
        <div><label class="lbl">Roll prefix</label><input class="inp" data-f="prefix" value="${esc(c.prefix)}" placeholder="e.g. 10A" /></div>
        <div><label class="lbl">From</label><input class="inp" data-f="from" value="${esc(c.from)}" placeholder="1" /></div>
        <div><label class="lbl">To</label><input class="inp" data-f="to" value="${esc(c.to)}" placeholder="40" /></div>
        <div class="flex items-end justify-between gap-2">
          <span class="text-xs text-slate-500 dark:text-slate-400"><b data-count>${classStudents(c).length}</b> students</span>
          <button class="btn-danger" data-act="delClass">Remove</button>
        </div>
      </div>
      <div class="grid gap-2 grid-cols-2 md:grid-cols-6 mt-2">
        <div class="md:col-span-2"><label class="lbl">Exam</label><input class="inp" data-f="exam" value="${esc(c.exam)}" placeholder="e.g. Mathematics" /></div>
        <div><label class="lbl">Date</label><input type="date" class="inp" data-f="date" value="${esc(c.date)}" /></div>
        <div class="md:col-span-2"><label class="lbl">Time</label><input class="inp" data-f="time" value="${esc(c.time)}" placeholder="10:00 AM – 1:00 PM" /></div>
        <div class="flex items-end">${(c.extra || []).length
          ? `<button class="btn-ghost text-xs" data-act="clearExtra">Clear ${c.extra.length} uploaded</button>` : ''}</div>
      </div>
    </div>`).join('');
}

/* ---------- Rooms editor ---------- */
function renderRooms() {
  const box = $('#rooms');
  if (!S.rooms.length) {
    box.innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400">No rooms yet. Click “Add room”.</p>';
    return;
  }
  box.innerHTML = S.rooms.map(r => `
    <div class="row-box" data-id="${r.id}">
      <div class="grid gap-2 grid-cols-2 md:grid-cols-6">
        <div class="md:col-span-2"><label class="lbl">Room name</label><input class="inp" data-f="name" value="${esc(r.name)}" /></div>
        <div class="md:col-span-2"><label class="lbl">Invigilator</label><input class="inp" data-f="invigilator" value="${esc(r.invigilator)}" placeholder="Optional" /></div>
        <div><label class="lbl">2-seater benches</label><input type="number" min="0" class="inp" data-f="b2" value="${num(r.b2)}" /></div>
        <div><label class="lbl">3-seater benches</label><input type="number" min="0" class="inp" data-f="b3" value="${num(r.b3)}" /></div>
      </div>
      <div class="flex justify-between items-center mt-2">
        <span class="text-xs text-slate-500 dark:text-slate-400"><b data-cap>${benchesOf(r)}</b> benches · capacity <b data-seats>${seatsOf(r)}</b></span>
        <button class="btn-danger" data-act="delRoom">Remove</button>
      </div>
    </div>`).join('');
}

/* ---------- Summary ---------- */
function updateSummary() {
  const st = allStudents().length;
  const seats = S.rooms.reduce((n, r) => n + seatsOf(r), 0);
  const el = $('#summary');
  el.textContent = `${st} students · ${seats} seats`;
  el.className = 'text-sm ' + (st > seats ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-slate-600 dark:text-slate-300');
}

function invalidate() {
  S.arr = null; S.locks = {}; hl = new Set();
  save(); updateSummary(); renderResult();
}

/* ---------- Event wiring: editors ---------- */
const INVALIDATING_CLASS = new Set(['prefix', 'from', 'to']);
const INVALIDATING_ROOM = new Set(['b2', 'b3']);

$('#classes').addEventListener('input', e => {
  const f = e.target.dataset.f; if (!f) return;
  const c = classById(e.target.closest('[data-id]').dataset.id);
  c[f] = e.target.value;
  const cnt = e.target.closest('[data-id]').querySelector('[data-count]');
  if (cnt) cnt.textContent = classStudents(c).length;
  if (INVALIDATING_CLASS.has(f)) invalidate(); else { save(); renderResult(); }
  updateSummary();
});
$('#classes').addEventListener('click', e => {
  const act = e.target.dataset.act; if (!act) return;
  const id = e.target.closest('[data-id]').dataset.id;
  if (act === 'delClass') { S.classes = S.classes.filter(c => c.id !== id); renderClasses(); invalidate(); }
  if (act === 'clearExtra') { classById(id).extra = []; renderClasses(); invalidate(); }
});
$('#rooms').addEventListener('input', e => {
  const f = e.target.dataset.f; if (!f) return;
  const box = e.target.closest('[data-id]');
  const r = S.rooms.find(x => x.id === box.dataset.id);
  r[f] = INVALIDATING_ROOM.has(f) ? num(e.target.value) : e.target.value;
  box.querySelector('[data-cap]').textContent = benchesOf(r);
  box.querySelector('[data-seats]').textContent = seatsOf(r);
  if (INVALIDATING_ROOM.has(f)) invalidate(); else { save(); renderResult(); }
  updateSummary();
});
$('#rooms').addEventListener('click', e => {
  if (e.target.dataset.act !== 'delRoom') return;
  const id = e.target.closest('[data-id]').dataset.id;
  S.rooms = S.rooms.filter(r => r.id !== id); renderRooms(); invalidate();
});

$('#addClass').onclick = () => {
  S.classes.push({ id: newId(), name: 'Class ' + (S.classes.length + 1), prefix: '', from: '', to: '', exam: '', date: '', time: '', extra: [] });
  renderClasses(); invalidate();
};
$('#addRoom').onclick = () => {
  S.rooms.push({ id: newId(), name: 'Room ' + (S.rooms.length + 1), invigilator: '', b2: 0, b3: 0 });
  renderRooms(); invalidate();
};
$('#school').addEventListener('input', e => { S.school = e.target.value; save(); renderPrint(); });
document.querySelectorAll('input[name=mode]').forEach(r => {
  r.checked = r.value === S.mode;
  r.addEventListener('change', () => { S.mode = r.value; save(); });
});

/* ---------- CSV import ---------- */
function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = ''; if (row.some(x => x.trim())) rows.push(row); row = [];
    } else cur += ch;
  }
  row.push(cur); if (row.some(x => x.trim())) rows.push(row);
  return rows;
}
$('#csvFile').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  const rows = parseCSV(await file.text()); e.target.value = '';
  if (!rows.length) return toast('CSV is empty');
  let ri = 0, ni = 1, ci = 2;
  const head = rows[0].map(h => h.trim().toLowerCase());
  if (head.some(h => h.includes('roll'))) {
    ri = head.findIndex(h => h.includes('roll'));
    ni = head.findIndex(h => h.includes('name') && !h.includes('class'));
    ci = head.findIndex(h => h.includes('class') || h.includes('section') || h.includes('grade'));
    rows.shift();
  }
  let n = 0;
  rows.forEach(r => {
    const roll = (r[ri] || '').trim(); if (!roll) return;
    const cname = ci >= 0 ? (r[ci] || '').trim() || 'Imported' : 'Imported';
    let c = S.classes.find(x => x.name.trim().toLowerCase() === cname.toLowerCase());
    if (!c) { c = { id: newId(), name: cname, prefix: '', from: '', to: '', exam: '', date: '', time: '', extra: [] }; S.classes.push(c); }
    (c.extra = c.extra || []).push({ roll, name: ni >= 0 ? (r[ni] || '').trim() : '' });
    n++;
  });
  renderClasses(); invalidate(); toast(`Imported ${n} students`);
});

/* ---------- Generation ---------- */
function generate() {
  const students = allStudents();
  if (!students.length) return toast('Add some students first');
  if (!S.rooms.some(r => seatsOf(r) > 0)) return toast('Add rooms with benches first');
  const byKey = new Map(students.map(s => [s.key, s]));

  // Empty benches per room
  const arr = {};
  S.rooms.forEach(r => {
    arr[r.id] = [
      ...Array.from({ length: num(r.b2) }, () => [null, null]),
      ...Array.from({ length: num(r.b3) }, () => [null, null, null]),
    ];
  });

  // Re-apply locked seats
  const placed = new Set(), newLocks = {};
  Object.entries(S.locks).forEach(([k, sk]) => {
    const [rid, b, s] = k.split(':');
    const bench = arr[rid] && arr[rid][+b];
    if (bench && +s < bench.length && byKey.has(sk) && !placed.has(sk)) {
      bench[+s] = sk; placed.add(sk); newLocks[k] = sk;
    }
  });
  S.locks = newLocks;

  const classIndex = new Map(S.classes.map((c, i) => [c.id, i]));
  let pool = students.filter(s => !placed.has(s.key))
    .sort((a, b) => classIndex.get(a.classId) - classIndex.get(b.classId) || natural(a.roll, b.roll));
  const flat = [];
  S.rooms.forEach(r => arr[r.id].forEach(b => flat.push(b)));

  if (S.mode === 'sequential' || S.mode === 'random') {
    if (S.mode === 'random') pool = shuffle(pool);
    let p = 0;
    for (const bench of flat) for (let i = 0; i < bench.length && p < pool.length; i++) {
      if (!bench[i]) bench[i] = pool[p++].key;
    }
  } else { // mixed: all students on a bench from different classes
    const queues = new Map();
    pool.forEach(s => { if (!queues.has(s.classId)) queues.set(s.classId, []); queues.get(s.classId).push(s); });
    const left = () => [...queues.entries()].filter(([, q]) => q.length);
    for (const bench of flat) {
      for (let i = 0; i < bench.length; i++) {
        if (bench[i]) continue;
        const used = new Set(bench.filter(Boolean).map(k => byKey.get(k).classId));
        let cand = left().filter(([id]) => !used.has(id));
        if (!cand.length) cand = left();            // unavoidable clash, will be flagged
        if (!cand.length) break;
        const max = Math.max(...cand.map(([, q]) => q.length));
        const top = cand.filter(([, q]) => q.length === max);
        const [, q] = top[Math.floor(Math.random() * top.length)];
        bench[i] = q.shift().key;
      }
    }
  }
  S.arr = arr; hl = new Set(); save();
  renderResult();
  const w = computeWarnings();
  toast(w.unseated.length || w.conflicts.length ? 'Generated with warnings — see below' : 'Seating generated');
}

function computeWarnings() {
  const unseated = [], conflicts = [];
  if (!S.arr) return { unseated, conflicts };
  const seated = new Set();
  S.rooms.forEach(r => (S.arr[r.id] || []).forEach((bench, bi) => {
    const seen = new Map();
    bench.forEach(k => { if (k && ST.has(k)) { seated.add(k); const c = ST.get(k).classId; seen.set(c, (seen.get(c) || 0) + 1); } });
    if ([...seen.values()].some(n => n > 1)) conflicts.push({ room: r, bench: bi });
  }));
  ST.forEach((s, k) => { if (!seated.has(k)) unseated.push(s); });
  return { unseated, conflicts };
}

$('#genBtn').onclick = generate;
$('#clearBtn').onclick = () => { S.arr = null; S.locks = {}; hl = new Set(); save(); renderResult(); };

/* ---------- Result rendering ---------- */
function seatLabelParts(k) {
  const st = ST.get(k); return st;
}
function renderRoomCard(r, conflictSet) {
  const benches = S.arr[r.id] || [];
  let no = 0, filled = 0, cap = 0;
  const html = benches.map((bench, bi) => {
    const isConf = conflictSet.has(r.id + ':' + bi);
    const seats = bench.map((k, si) => {
      no++; cap++;
      const key = `${r.id}:${bi}:${si}`;
      const st = k && ST.get(k);
      if (!st) return `<div class="seat empty" data-k="${key}"><span class="no">${no}</span>empty</div>`;
      filled++;
      const locked = !!S.locks[key];
      const cls = classById(st.classId);
      return `<div class="seat${locked ? ' locked' : ''}${hl.has(k) ? ' hl' : ''}" data-k="${key}" draggable="${!locked}" style="--h:${hue(st.classId)}"
        title="${esc(st.name)} · ${esc(cls ? cls.name : '')}">
        <span class="no">${no}</span><div class="roll">${esc(st.roll)}</div>
        <div class="nm">${esc(st.name || (cls ? cls.name : ''))}</div>
        <button class="lk" data-lock="${key}" title="${locked ? 'Unlock' : 'Lock'} seat">${locked ? '🔒' : '🔓'}</button></div>`;
    }).join('');
    return `<div><div class="text-[10px] text-slate-500 dark:text-slate-400 mb-0.5">Bench ${bi + 1} · ${bench.length}-seat</div>
      <div class="bench${isConf ? ' conflict' : ''}">${seats}</div></div>`;
  }).join('');
  return `<div class="row-box mb-4">
    <div class="flex flex-wrap justify-between gap-2 mb-2">
      <h3 class="font-semibold">${esc(r.name)}${r.invigilator ? ` <span class="font-normal text-sm text-slate-500 dark:text-slate-400">· Invigilator: ${esc(r.invigilator)}</span>` : ''}</h3>
      <span class="text-xs text-slate-500 dark:text-slate-400">${filled} / ${cap} seats filled</span>
    </div>
    <div class="flex flex-wrap gap-3">${html || '<span class="text-sm text-slate-500">No benches in this room.</span>'}</div>
  </div>`;
}

function renderResult() {
  ST = new Map(allStudents().map(s => [s.key, s]));
  const res = $('#result'), warn = $('#warnings');
  if (!S.arr) {
    res.innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400">No arrangement yet. Set up classes and rooms, choose a rule, then click “Generate seating”.</p>';
    warn.innerHTML = ''; $('#lookupOut').innerHTML = ''; $('#lookupCount').textContent = '';
    renderPrint(); return;
  }
  const w = computeWarnings();
  const conflictSet = new Set(w.conflicts.map(c => c.room.id + ':' + c.bench));
  const msgs = [];
  if (w.unseated.length) msgs.push(`<div class="warn bad">⚠ ${w.unseated.length} student(s) have no seat — add rooms/benches. First few: ${w.unseated.slice(0, 8).map(s => esc(s.roll)).join(', ')}${w.unseated.length > 8 ? '…' : ''}</div>`);
  if (w.conflicts.length) msgs.push(`<div class="warn">⚠ ${w.conflicts.length} bench(es) have two students from the same class (outlined in red). ${S.mode === 'mixed' ? 'There are not enough different classes to avoid it.' : 'Use the “Mixed classes” rule to avoid this.'}</div>`);
  if (!msgs.length) msgs.push('<div class="warn ok">✔ Everyone is seated' + (S.mode === 'mixed' ? ' and no bench has two students from the same class.' : '.') + '</div>');
  warn.innerHTML = msgs.join('');

  const legend = S.classes.map(c => `<span class="text-xs mr-3" style="--h:${hue(c.id)}"><span class="legend-dot"></span>${esc(c.name)}</span>`).join('');
  res.innerHTML = `<div class="mb-3">${legend}</div>` + S.rooms.map(r => renderRoomCard(r, conflictSet)).join('');
  runLookup(false);
  renderPrint();
}

/* Drag & drop + lock (event delegation) */
const resEl = $('#result');
let dragKey = null;
const getSeat = k => { const [r, b, s] = k.split(':'); return S.arr[r][+b][+s]; };
const setSeat = (k, v) => { const [r, b, s] = k.split(':'); S.arr[r][+b][+s] = v; };
resEl.addEventListener('dragstart', e => {
  const seat = e.target.closest && e.target.closest('.seat'); if (!seat) return;
  dragKey = seat.dataset.k; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragKey);
  seat.classList.add('dragging');
});
resEl.addEventListener('dragend', () => { dragKey = null; resEl.querySelectorAll('.dragging,.over').forEach(x => x.classList.remove('dragging', 'over')); });
resEl.addEventListener('dragover', e => {
  const seat = e.target.closest('.seat'); if (!seat || !dragKey) return;
  e.preventDefault(); resEl.querySelectorAll('.over').forEach(x => x.classList.remove('over')); seat.classList.add('over');
});
resEl.addEventListener('drop', e => {
  const seat = e.target.closest('.seat'); if (!seat || !dragKey) return;
  e.preventDefault();
  const from = dragKey, to = seat.dataset.k; dragKey = null;
  if (from === to) return renderResult();
  if (S.locks[from] || S.locks[to]) { toast('Locked seat — unlock it first'); return renderResult(); }
  const a = getSeat(from), b = getSeat(to);
  setSeat(from, b); setSeat(to, a);
  save(); renderResult();
});
resEl.addEventListener('click', e => {
  const k = e.target.dataset && e.target.dataset.lock; if (!k) return;
  if (S.locks[k]) delete S.locks[k]; else { const v = getSeat(k); if (v) S.locks[k] = v; }
  save(); renderResult();
});

/* ---------- Lookup ---------- */
function locate(sk) {
  for (const r of S.rooms) {
    const benches = (S.arr && S.arr[r.id]) || []; let no = 0;
    for (let bi = 0; bi < benches.length; bi++) for (let si = 0; si < benches[bi].length; si++) {
      no++; if (benches[bi][si] === sk) return { room: r, bench: bi + 1, seat: si + 1, no };
    }
  }
  return null;
}
function runLookup(rerender = true) {
  const q = $('#lookup').value.trim().toLowerCase();
  const out = $('#lookupOut'); hl = new Set();
  if (!q || !S.arr) { out.innerHTML = ''; $('#lookupCount').textContent = ''; if (rerender) renderResult(); return; }
  const matches = [...ST.values()].filter(s => s.roll.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
  matches.forEach(s => hl.add(s.key));
  $('#lookupCount').textContent = `${matches.length} match(es)`;
  out.innerHTML = matches.slice(0, 15).map(s => {
    const loc = locate(s.key), c = classById(s.classId);
    return `<li class="warn ok"><b>${esc(s.roll)}</b> ${esc(s.name)} (${esc(c ? c.name : '')}) → ` +
      (loc ? `<b>${esc(loc.room.name)}</b>, bench ${loc.bench}, seat ${loc.seat} (seat no. ${loc.no})` : '<b>not seated</b>') + '</li>';
  }).join('') + (matches.length > 15 ? '<li class="text-xs">…refine your search to see more</li>' : '');
  if (rerender) {
    document.querySelectorAll('#result .seat').forEach(el => {
      const [r, b, s] = el.dataset.k.split(':'); el.classList.toggle('hl', hl.has(S.arr[r][+b][+s]));
    });
  } else {
    document.querySelectorAll('#result .seat').forEach(el => {
      const [r, b, s] = el.dataset.k.split(':'); el.classList.toggle('hl', hl.has(S.arr[r][+b][+s]));
    });
  }
}
$('#lookup').addEventListener('input', () => runLookup(true));

/* ---------- Print ---------- */
function renderPrint() {
  const pa = $('#printArea');
  if (!S.arr) { pa.innerHTML = ''; return; }
  pa.innerHTML = S.rooms.map(r => {
    const benches = S.arr[r.id] || []; let no = 0;
    const rows = [], classesIn = new Set();
    const diagram = benches.map((bench, bi) => {
      const seats = bench.map((k, si) => {
        no++; const st = k && ST.get(k);
        if (!st) return `<div class="pseat empty">${no}<br>—</div>`;
        classesIn.add(st.classId); const c = classById(st.classId);
        rows.push({ no, bench: bi + 1, st, cname: c ? c.name : '' });
        return `<div class="pseat"><b>${esc(st.roll)}</b><br>${esc(st.name || (c ? c.name : ''))}</div>`;
      }).join('');
      return `<div class="pbench" title="Bench ${bi + 1}">${seats}</div>`;
    }).join('');
    const sched = [...classesIn].map(id => classById(id)).filter(Boolean).map(c =>
      `<tr><td>${esc(c.name)}</td><td>${esc(c.exam)}</td><td>${esc(c.date)}</td><td>${esc(c.time)}</td></tr>`).join('');
    return `<div class="room-page">
      <div style="text-align:center">
        <div style="font-size:20px;font-weight:700">${esc(S.school || 'Exam Seating Plan')}</div>
        <div style="font-size:15px;margin-top:2px"><b>${esc(r.name)}</b>${r.invigilator ? ` — Invigilator: ${esc(r.invigilator)}` : ''}</div>
      </div>
      <table class="ptable"><tr><th>Class</th><th>Exam</th><th>Date</th><th>Time</th></tr>${sched || '<tr><td colspan="4">No students seated</td></tr>'}</table>
      <div style="margin:10px 0 4px;font-size:12px"><b>Bench layout</b> (numbers are seat numbers)</div>
      <div>${diagram}</div>
      <table class="ptable"><tr><th>Seat</th><th>Bench</th><th>Roll no.</th><th>Name</th><th>Class</th><th style="width:25%">Signature</th></tr>
      ${rows.map(x => `<tr><td>${x.no}</td><td>${x.bench}</td><td>${esc(x.st.roll)}</td><td>${esc(x.st.name)}</td><td>${esc(x.cname)}</td><td></td></tr>`).join('')}</table>
    </div>`;
  }).join('');
}
$('#printBtn').onclick = () => {
  if (!S.arr) return toast('Generate a seating plan first');
  renderPrint(); window.print();
};

/* ---------- CSV export ---------- */
$('#csvBtn').onclick = () => {
  if (!S.arr) return toast('Generate a seating plan first');
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = [['Room', 'Invigilator', 'Bench', 'Seat in bench', 'Seat no', 'Roll', 'Name', 'Class', 'Exam', 'Date', 'Time'].map(q).join(',')];
  S.rooms.forEach(r => {
    let no = 0;
    (S.arr[r.id] || []).forEach((bench, bi) => bench.forEach((k, si) => {
      no++; const st = k && ST.get(k); if (!st) return;
      const c = classById(st.classId) || {};
      lines.push([r.name, r.invigilator, bi + 1, si + 1, no, st.roll, st.name, c.name, c.exam, c.date, c.time].map(q).join(','));
    }));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'seating-arrangement.csv';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

/* ---------- Theme ---------- */
function applyTheme() {
  const dark = document.documentElement.classList.contains('dark');
  $('#themeBtn').textContent = dark ? '☀️' : '🌙';
}
$('#themeBtn').onclick = () => {
  const dark = document.documentElement.classList.toggle('dark');
  S.theme = dark ? 'dark' : 'light'; save(); applyTheme();
};

/* ---------- Sample data ---------- */
$('#sampleBtn').onclick = () => {
  if ((S.classes.length || S.rooms.length) && !confirm('Replace current classes and rooms with sample data?')) return;
  S.classes = [
    { id: newId(), name: '10-A', prefix: '10A', from: '1', to: '30', exam: 'Mathematics', date: '', time: '10:00 AM – 1:00 PM', extra: [] },
    { id: newId(), name: '10-B', prefix: '10B', from: '1', to: '30', exam: 'Mathematics', date: '', time: '10:00 AM – 1:00 PM', extra: [] },
    { id: newId(), name: '9-A', prefix: '9A', from: '1', to: '25', exam: 'Science', date: '', time: '10:00 AM – 12:00 PM', extra: [] },
  ];
  S.rooms = [
    { id: newId(), name: 'Hall 1', invigilator: '', b2: 10, b3: 12 },
    { id: newId(), name: 'Hall 2', invigilator: '', b2: 8, b3: 6 },
  ];
  initUI(); invalidate();
};

/* ---------- Init ---------- */
function initUI() {
  $('#school').value = S.school || '';
  document.querySelectorAll('input[name=mode]').forEach(r => r.checked = r.value === S.mode);
  renderClasses(); renderRooms(); updateSummary(); renderResult(); applyTheme();
}
initUI();
