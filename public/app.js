/* ============================================================
   I got you — frontend logic
   Talks to the backend API. No mock data. Real time.
   ============================================================ */

(() => {
  'use strict';

  /* ---------- CONSTANTS ---------- */
  const DAY_START = 9;
  const DAY_END   = 17;
  const HOUR_PX   = 60;
  const HEADER_PX = 44;
  const SNAP_MINS = 15;

  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DOW_SHORT   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  const CATEGORY_META = {
    deep:       { label: 'Deep Focus',      icon: '🧠', color: 'deep' },
    movement:   { label: 'Movement Break',  icon: '🤸', color: 'movement' },
    lunch:      { label: 'Protected Lunch', icon: '🍽️', color: 'lunch' },
    light:      { label: 'Light Admin',     icon: '✉️', color: 'light' },
    meeting:    { label: 'External Mtg',    icon: '👥', color: 'meeting' },
    buffer:     { label: 'Buffer',          icon: '⏳', color: 'buffer' },
    decompress: { label: 'Decompress',      icon: '🌿', color: 'decompress' },
  };

  // Keyword → category suggestions for title autocompletion.
  // Keep in sync with KEYWORDS in lib/scheduler.js (brain-dump parser).
  const SUGGEST_KEYWORDS = {
    meeting:  ['call', 'sync', 'meet', '1:1', 'standup', 'interview', 'client', 'vendor', 'catch up', 'demo'],
    light:    ['email', 'reply', 'slack', 'triage', 'inbox', 'admin', 'file', 'expense', 'schedule', 'book', 'update', 'log', 'review pr', 'merge', 'deploy'],
    movement: ['walk', 'stretch', 'gym', 'run', 'break', 'water', 'hydrate'],
    lunch:    ['lunch', 'eat', 'food'],
  };

  /* ---------- STATE ---------- */
  const state = {
    view: 'week',
    weekAnchor: startOfWeek(new Date()),
    energy: loadEnergy(),
    recovering: false,
    events: [],
    gcalConfigured: false,
    activeEvent: null,
    calendars: [],
    appCalendarId: null,
    hiddenCals: loadHiddenCals(),
    writeCalendar: localStorage.getItem('igb:writeCalendar') || null,
    deleteArmed: false,
    editCatTouched: false,
    quickCatTouched: false,
  };

  /* ---------- API HELPERS ---------- */
  async function api(method, path, body = null) {
    const opts = { method, headers: { 'Accept': 'application/json' } };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  /* ---------- DATE HELPERS ---------- */
  const $  = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const pad = (n) => String(n).padStart(2, '0');
  const fmtTime = (d) => { d = new Date(d); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmtDateInput = (d) => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

  function startOfWeek(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
    return d;
  }

  function sameDay(a, b) {
    a = new Date(a); b = new Date(b);
    return a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
  }

  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  function durMins(start, end) {
    return Math.round((new Date(end) - new Date(start)) / 60000);
  }

  function stars(n) {
    n = Math.max(0, Math.min(5, n));
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  }

  function statusOf(ev) {
    const now = new Date();
    if (now < new Date(ev.start)) return 'upcoming';
    if (now >= new Date(ev.start) && now < new Date(ev.end)) return 'in-progress';
    return 'completed';
  }

  function weekDays(anchor) {
    return Array.from({ length: 7 }, (_, i) => addDays(anchor, i));
  }

  const sameEvent = (a, b) => a && b && a.id === b.id && a.calendarId === b.calendarId;

  /* ---------- ENERGY (localStorage) ---------- */
  function loadEnergy() {
    const today = new Date().toDateString();
    const stored = localStorage.getItem('igb:energy');
    const storedDate = localStorage.getItem('igb:energyDate');
    if (!stored || storedDate !== today) {
      localStorage.setItem('igb:energy', '72');
      localStorage.setItem('igb:energyDate', today);
      return 72;
    }
    return parseInt(stored, 10);
  }

  function saveEnergy(pct) {
    state.energy = Math.max(0, Math.min(100, pct));
    localStorage.setItem('igb:energy', String(Math.round(state.energy)));
    localStorage.setItem('igb:energyDate', new Date().toDateString());
  }

  /* ---------- CALENDAR VISIBILITY / WRITE TARGET ---------- */
  function loadHiddenCals() {
    try {
      return new Set(JSON.parse(localStorage.getItem('igb:calHidden') || '[]'));
    } catch {
      return new Set();
    }
  }

  function saveHiddenCals() {
    localStorage.setItem('igb:calHidden', JSON.stringify([...state.hiddenCals]));
  }

  // Calendar IDs the user currently has visible (null = server default)
  function visibleCalIds() {
    if (!state.calendars.length) return null;
    const ids = state.calendars.filter(c => !state.hiddenCals.has(c.id)).map(c => c.id);
    return ids.length ? ids : null;
  }

  async function fetchCalendars() {
    try {
      const data = await api('GET', '/api/calendars');
      state.calendars = data.calendars || [];
      state.appCalendarId = data.appCalendarId || null;
      if (!state.writeCalendar || !state.calendars.some(c => c.id === state.writeCalendar)) {
        state.writeCalendar = state.appCalendarId || 'primary';
        localStorage.setItem('igb:writeCalendar', state.writeCalendar);
      }
    } catch (err) {
      log(`Couldn't load calendars: ${err.message}`, 'rescue');
      state.calendars = [];
    }
    renderCalPanel();
  }

  function renderCalPanel() {
    const list = $('#calList');
    list.innerHTML = '';
    if (!state.calendars.length) {
      const hint = el('div', 'panel__hint');
      hint.textContent = 'No calendars found.';
      list.appendChild(hint);
    }
    state.calendars.forEach(c => {
      const row = el('label', 'cal-row');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = !state.hiddenCals.has(c.id);
      cb.addEventListener('change', async () => {
        if (cb.checked) state.hiddenCals.delete(c.id);
        else state.hiddenCals.add(c.id);
        saveHiddenCals();
        await fetchEvents();
      });
      const dot = el('i', 'cal-dot');
      dot.style.background = c.backgroundColor || 'var(--accent)';
      const name = el('span', 'cal-name');
      name.textContent = c.summary;
      name.title = c.id;
      if (c.id === state.appCalendarId) {
        const badge = el('span', 'cal-badge');
        badge.textContent = 'app';
        name.appendChild(badge);
      }
      row.appendChild(cb);
      row.appendChild(dot);
      row.appendChild(name);
      list.appendChild(row);
    });

    // Write-target dropdown (writable calendars only)
    const sel = $('#writeCalendar');
    sel.innerHTML = '';
    state.calendars
      .filter(c => c.accessRole === 'owner' || c.accessRole === 'writer')
      .forEach(c => {
        const opt = el('option');
        opt.value = c.id;
        opt.textContent = c.summary;
        if (c.id === state.writeCalendar) opt.selected = true;
        sel.appendChild(opt);
      });
  }

  async function createCalendar() {
    const input = $('#newCalName');
    const name = input.value.trim();
    if (!name) { toast('Give the calendar a name first.'); return; }
    try {
      await api('POST', '/api/calendars', { summary: name });
      input.value = '';
      toast(`Calendar "${name}" created.`);
      await fetchCalendars();
    } catch (err) {
      log(`Couldn't create calendar: ${err.message}`, 'rescue');
      toast('Calendar creation failed');
    }
  }

  /* ---------- KEYWORD SUGGEST ---------- */
  function suggestCategory(text) {
    const low = (text || '').toLowerCase();
    if (!low.trim()) return null;
    if (SUGGEST_KEYWORDS.lunch.some(k => low.includes(k))) return 'lunch';
    if (SUGGEST_KEYWORDS.meeting.some(k => low.includes(k))) return 'meeting';
    if (SUGGEST_KEYWORDS.light.some(k => low.includes(k))) return 'light';
    if (SUGGEST_KEYWORDS.movement.some(k => low.includes(k))) return 'movement';
    return null;
  }

  function wireSuggestion(titleInput, catSelect, chip, isTouched) {
    titleInput.addEventListener('input', () => {
      if (isTouched()) { chip.classList.add('is-hidden'); return; }
      const cat = suggestCategory(titleInput.value);
      if (cat && cat !== catSelect.value) {
        const meta = CATEGORY_META[cat];
        chip.textContent = `Suggest: ${meta.icon} ${meta.label} — tap to apply`;
        chip.dataset.cat = cat;
        chip.classList.remove('is-hidden');
      } else {
        chip.classList.add('is-hidden');
      }
    });
    chip.addEventListener('click', () => {
      if (chip.dataset.cat) {
        catSelect.value = chip.dataset.cat;
        catSelect.dispatchEvent(new Event('change'));
      }
      chip.classList.add('is-hidden');
    });
  }

  /* ---------- RENDER: BATTERY ---------- */
  function renderBattery() {
    const fill = $('#batteryFill');
    const val = $('#batteryValue');
    const stLabel = $('#batteryState');
    const hint = $('#batteryHint');
    const wrap = $('#battery');
    const pct = Math.max(0, Math.min(100, state.energy));
    val.textContent = Math.round(pct);
    const C = 2 * Math.PI * 52;
    fill.style.strokeDasharray = C;
    fill.style.strokeDashoffset = C * (1 - pct / 100);

    let color, label, sub;
    if (state.recovering) {
      color = '#4fd6e8'; label = 'Recovering'; sub = 'taking it easy 💙';
      wrap.classList.add('is-recovering');
    } else {
      wrap.classList.remove('is-recovering');
      if (pct >= 70) { color = '#3ddc97'; label = 'Flow State'; sub = "you're cookin' 🔥"; }
      else if (pct >= 40) { color = '#ffb454'; label = 'Steady'; sub = "keep the rhythm 🫡"; }
      else { color = '#ff5d6c'; label = 'Running Hot'; sub = "maybe tap out soon 😮‍💨"; }
    }
    fill.style.stroke = color;
    stLabel.textContent = label;
    hint.textContent = sub;
  }

  /* ---------- RENDER: WEEKLY GRID ---------- */
  function renderWeek() {
    const grid = $('#weekGrid');
    grid.innerHTML = '';
    const days = weekDays(state.weekAnchor);

    // header row
    const corner = el('div', 'grid__corner');
    grid.appendChild(corner);
    days.forEach(d => {
      const h = el('div', 'grid__dayhead' + (sameDay(d, new Date()) ? ' is-today' : ''));
      h.innerHTML = `<div class="dow">${DOW_SHORT[d.getDay()]}</div><div class="dom">${d.getDate()}</div>`;
      grid.appendChild(h);
    });

    // hour rows + day cells
    for (let h = DAY_START; h < DAY_END; h++) {
      const label = el('div', 'grid__hour');
      label.textContent = `${pad(h)}:00`;
      grid.appendChild(label);
      days.forEach(d => {
        const cell = el('div', 'grid__cell' + (sameDay(d, new Date()) ? ' is-today-col' : ''));
        grid.appendChild(cell);
      });
    }

    // events
    state.events.forEach(ev => {
      const d = new Date(ev.start);
      const inWeek = days.some(wd => sameDay(wd, d));
      if (!inWeek) return;
      const colIdx = days.findIndex(wd => sameDay(wd, d)) + 1;
      placeEventInGrid(grid, ev, colIdx);
    });

    // now-line on today's column
    const todayIdx = days.findIndex(wd => sameDay(wd, new Date()));
    if (todayIdx >= 0) drawNowLine(grid, todayIdx + 1);

    // title
    const first = days[0], last = days[6];
    $('#rangeTitle').textContent =
      first.getMonth() === last.getMonth()
        ? `${MONTH_NAMES[first.getMonth()]} ${first.getDate()}–${last.getDate()}, ${first.getFullYear()}`
        : `${MONTH_NAMES[first.getMonth()]} ${first.getDate()} – ${MONTH_NAMES[last.getMonth()]} ${last.getDate()}, ${first.getFullYear()}`;
  }

  function placeEventInGrid(grid, ev, colIdx) {
    const start = new Date(ev.start);
    const end = new Date(ev.end);
    const startH = start.getHours() + start.getMinutes() / 60;
    const endH = end.getHours() + end.getMinutes() / 60;
    if (endH <= DAY_START || startH >= DAY_END) return;

    const topPx = (Math.max(startH, DAY_START) - DAY_START) * HOUR_PX;
    const heightPx = Math.max((Math.min(endH, DAY_END) - Math.max(startH, DAY_START)) * HOUR_PX, 18);

    // find the cell at the start hour row for this column
    const startRow = Math.floor(Math.max(startH, DAY_START)) - DAY_START;
    const cellRow = startRow + 1; // +1 for header row
    const cell = grid.children[cellRow * (7 + 1) + colIdx];
    if (!cell) return;

    const node = el('div', `ev ev--${ev.cat}`);
    const st = statusOf(ev);
    if (st === 'in-progress') node.classList.add('is-in-progress');
    if (st === 'completed') node.classList.add('is-completed');
    const meta = CATEGORY_META[ev.cat] || CATEGORY_META.deep;
    node.style.top = `${topPx - startRow * HOUR_PX}px`;
    node.style.height = `${heightPx}px`;
    node.innerHTML = `
      <div class="ev__tag">${meta.icon} ${meta.label}</div>
      <div class="ev__title">${escapeHtml(ev.title)}</div>
      <div class="ev__meta">
        <span>${fmtTime(ev.start)}–${fmtTime(ev.end)}</span>
        <span class="ev__stars">${stars(ev.effort)}</span>
      </div>`;

    attachDrag(node, ev);
    cell.appendChild(node);
  }

  /* ---------- DRAG TO RESCHEDULE (week grid) ---------- */
  function attachDrag(node, ev) {
    node.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const colW = node.parentElement.offsetWidth || 100;
      let dragging = false;
      let dayDelta = 0;
      let minDelta = 0;

      const onMove = (e2) => {
        const dx = e2.clientX - startX;
        const dy = e2.clientY - startY;
        if (!dragging && Math.hypot(dx, dy) > 5) {
          dragging = true;
          node.classList.add('is-dragging');
          try { node.setPointerCapture(e.pointerId); } catch { /* noop */ }
        }
        if (!dragging) return;
        // HOUR_PX=60 → 1px vertical = 1 minute; snap to SNAP_MINS
        minDelta = Math.round(dy / SNAP_MINS) * SNAP_MINS * (60 / HOUR_PX);
        dayDelta = Math.round(dx / colW);
        node.style.transform = `translate(${dayDelta * colW}px, ${minDelta * (HOUR_PX / 60)}px)`;
      };

      const onUp = () => {
        node.removeEventListener('pointermove', onMove);
        node.removeEventListener('pointerup', onUp);
        node.removeEventListener('pointercancel', onUp);
        if (!dragging) {
          openEventModal(ev);
          return;
        }
        node.classList.remove('is-dragging');
        node.style.transform = '';
        if (dayDelta === 0 && minDelta === 0) return;
        commitDrag(ev, dayDelta, minDelta);
      };

      node.addEventListener('pointermove', onMove);
      node.addEventListener('pointerup', onUp);
      node.addEventListener('pointercancel', onUp);
    });
  }

  async function commitDrag(ev, dayDelta, minDelta) {
    const oldStart = new Date(ev.start);
    const durMs = new Date(ev.end) - oldStart;

    let ns = new Date(oldStart);
    ns.setDate(ns.getDate() + dayDelta);
    ns.setMinutes(ns.getMinutes() + minDelta);

    // Clamp inside the displayed 9:00–17:00 window, preserving duration
    const winStart = new Date(ns); winStart.setHours(DAY_START, 0, 0, 0);
    const winEnd = new Date(ns); winEnd.setHours(DAY_END, 0, 0, 0);
    if (ns < winStart) ns = winStart;
    let ne = new Date(ns.getTime() + durMs);
    if (ne > winEnd) {
      ne = winEnd;
      ns = new Date(Math.max(ne.getTime() - durMs, winStart.getTime()));
    }

    const newStartIso = ns.toISOString();
    const newEndIso = ne.toISOString();

    // Optimistic update
    const target = state.events.find(e => sameEvent(e, ev));
    if (target) {
      target.start = newStartIso;
      target.end = newEndIso;
    }
    renderWeek();

    try {
      await api('PATCH', `/api/events/${encodeURIComponent(ev.id)}`, {
        start: newStartIso,
        end: newEndIso,
        calendarId: ev.calendarId,
      });
      toast(`Moved to ${DOW_SHORT[ns.getDay()]} ${fmtTime(ns)}.`);
      await fetchEvents();
    } catch (err) {
      log(`Couldn't move event: ${err.message}`, 'rescue');
      toast('Move failed — reverting');
      await fetchEvents();
    }
  }

  function drawNowLine(grid, colIdx) {
    const now = new Date();
    const nowH = now.getHours() + now.getMinutes() / 60;
    if (nowH < DAY_START || nowH > DAY_END) return;

    // Pure CSS positioning — no getBoundingClientRect.
    // The grid has a 56px corner column + 7 equal columns (1fr each).
    // The header row is ~44px tall; each hour row is 60px.
    const topPx = HEADER_PX + (nowH - DAY_START) * HOUR_PX;

    const line = el('div', 'now-line');
    line.style.position = 'absolute';
    line.style.top = `${topPx}px`;
    line.style.left = `calc(56px + ${(colIdx - 1)} * (100% - 56px) / 7)`;
    line.style.width = `calc((100% - 56px) / 7)`;
    line.style.height = '2px';
    line.style.zIndex = '5';
    line.style.pointerEvents = 'none';
    grid.appendChild(line);
  }

  /* ---------- RENDER: DAILY TIMELINE ---------- */
  function renderDay() {
    const wrap = $('#dayTimeline');
    wrap.innerHTML = '';
    const today = new Date();
    const title = el('div', 'timeline__date');
    title.textContent = `${DOW_SHORT[today.getDay()]} · ${MONTH_NAMES[today.getMonth()]} ${today.getDate()}, ${today.getFullYear()}`;
    wrap.appendChild(title);

    const dayEvs = state.events
      .filter(ev => sameDay(ev.start, today))
      .sort((a, b) => new Date(a.start) - new Date(b.start));

    if (!dayEvs.length) {
      const empty = el('div', 'panel__hint');
      empty.style.padding = '40px 0';
      empty.style.textAlign = 'center';
      empty.textContent = "Nothing scheduled today. Brain-dump some tasks and auto-schedule — I got you. 🌿";
      wrap.appendChild(empty);
      return;
    }

    dayEvs.forEach(ev => {
      const row = el('div', 'timeline__row');
      const time = el('div', 'timeline__time');
      time.innerHTML = `${fmtTime(ev.start)}<br>— ${fmtTime(ev.end)}`;
      const card = el('div', `timeline__ev ev--${ev.cat}`);
      const st = statusOf(ev);
      if (st === 'in-progress') card.classList.add('is-in-progress');
      if (st === 'completed') card.classList.add('is-completed');
      const meta = CATEGORY_META[ev.cat] || CATEGORY_META.deep;
      card.innerHTML = `
        <div class="ev__tag">${meta.icon} ${meta.label}</div>
        <div class="ev__title">${escapeHtml(ev.title)}</div>
        <div class="ev__meta">
          <span>${durMins(ev.start, ev.end)}m</span>
          <span class="ev__stars">${stars(ev.effort)}</span>
          <span>${st.replace('-', ' ')}</span>
        </div>`;
      card.addEventListener('click', () => openEventModal(ev));
      card.style.cursor = 'pointer';
      row.appendChild(time);
      row.appendChild(card);
      wrap.appendChild(row);
    });
  }

  /* ---------- MAIN RENDER ---------- */
  function showLoading(show) {
    $('#calendarState').classList.toggle('is-hidden', !show);
    $('#weekGrid').classList.toggle('is-hidden', show || state.view !== 'week');
    $('#dayTimeline').classList.toggle('is-hidden', show || state.view !== 'day');
  }

  function renderCalendar() {
    showLoading(false);
    if (state.view === 'week') {
      $('#weekGrid').classList.remove('is-hidden');
      $('#dayTimeline').classList.add('is-hidden');
      renderWeek();
    } else {
      $('#weekGrid').classList.add('is-hidden');
      $('#dayTimeline').classList.remove('is-hidden');
      renderDay();
    }
  }

  /* ---------- FETCH EVENTS ---------- */
  async function fetchEvents() {
    if (!state.gcalConfigured) {
      $('#authBanner').classList.remove('is-hidden');
      showLoading(false);
      $('#weekGrid').classList.add('is-hidden');
      $('#dayTimeline').classList.add('is-hidden');
      return;
    }
    $('#authBanner').classList.add('is-hidden');
    showLoading(true);

    try {
      const weekStart = state.weekAnchor.toISOString();
      const weekEnd = addDays(state.weekAnchor, 7).toISOString();
      let path = `/api/events?start=${encodeURIComponent(weekStart)}&end=${encodeURIComponent(weekEnd)}`;
      const ids = visibleCalIds();
      if (ids) path += `&calendars=${ids.map(encodeURIComponent).join(',')}`;
      const data = await api('GET', path);
      state.events = data.events || [];
      renderCalendar();
    } catch (err) {
      log(`Couldn't load calendar: ${err.message}`, 'rescue');
      showLoading(false);
    }
  }

  /* ---------- LOG ---------- */
  function log(msg, kind = 'info') {
    const wrap = $('#log');
    const node = el('div', `log__entry is-${kind}`);
    const time = new Date();
    node.innerHTML = `<span class="log__time">${fmtTime(time)}</span>${escapeHtml(msg)}`;
    wrap.prepend(node);
    while (wrap.children.length > 30) wrap.lastChild.remove();
  }

  /* ---------- TOAST ---------- */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('is-show'), 3000);
  }

  /* ---------- EMERGENCY RESCUE ---------- */
  async function imFried() {
    const btn = $('#friedBtn');
    btn.disabled = true;
    btn.style.opacity = '0.6';
    try {
      const data = await api('POST', '/api/rescue', { calendars: visibleCalIds() });
      saveEnergy(state.energy - data.energyDrain);
      state.recovering = true;
      renderBattery();

      setTimeout(() => {
        saveEnergy(state.energy + 18);
        state.recovering = false;
        renderBattery();
        log("Battery bouncing back. You're human. We'll hit it again tomorrow. 💪", 'info');
      }, 4200);

      log(data.message, 'rescue');
      const count = data.rescheduled.length;
      toast(`Rescued! ${count} heavy block${count === 1 ? '' : 's'} moved.`);
      await fetchEvents();
    } catch (err) {
      log(`Rescue failed: ${err.message}`, 'rescue');
      toast('Rescue failed — check console');
    } finally {
      btn.disabled = false;
      btn.style.opacity = '';
    }
  }

  /* ---------- EVENT MODAL (edit / delete / snooze) ---------- */
  function updateModalTag(cat) {
    const meta = CATEGORY_META[cat] || CATEGORY_META.deep;
    $('#modalTag').textContent = `${meta.icon} ${meta.label}`;
    $('#modalTag').style.color = `var(--c-${meta.color})`;
    $('#modalTag').style.background = `rgba(${cssRgb(meta.color)}, .15)`;
  }

  function openEventModal(ev) {
    state.activeEvent = ev;
    state.deleteArmed = false;
    state.editCatTouched = false;
    const delBtn = $('#modalDelete');
    delBtn.textContent = 'Delete';
    delBtn.classList.remove('is-armed');

    updateModalTag(ev.cat);
    $('#editTitle').value = ev.title;
    $('#editDate').value = fmtDateInput(ev.start);
    $('#editStart').value = fmtTime(ev.start);
    $('#editEnd').value = fmtTime(ev.end);
    $('#editCat').value = CATEGORY_META[ev.cat] ? ev.cat : 'deep';
    $('#editEffort').value = String(Math.max(0, Math.min(5, ev.effort)));
    $('#editSuggest').classList.add('is-hidden');

    $('#eventModal').classList.add('is-open');
    $('#eventModal').setAttribute('aria-hidden', 'false');
  }

  function closeModal() {
    $('#eventModal').classList.remove('is-open');
    $('#eventModal').setAttribute('aria-hidden', 'true');
    state.activeEvent = null;
  }

  async function saveEventEdits() {
    const ev = state.activeEvent;
    if (!ev) return;
    const title = $('#editTitle').value.trim();
    const date = $('#editDate').value;
    const startT = $('#editStart').value;
    const endT = $('#editEnd').value;
    if (!title || !date || !startT || !endT) { toast('Title, date, and times are required.'); return; }
    const start = new Date(`${date}T${startT}`);
    const end = new Date(`${date}T${endT}`);
    if (isNaN(start) || isNaN(end) || end <= start) { toast('End time must be after start time.'); return; }

    try {
      await api('PATCH', `/api/events/${encodeURIComponent(ev.id)}`, {
        title,
        cat: $('#editCat').value,
        effort: parseInt($('#editEffort').value, 10),
        start: start.toISOString(),
        end: end.toISOString(),
        calendarId: ev.calendarId,
      });
      closeModal();
      toast('Event updated.');
      await fetchEvents();
    } catch (err) {
      log(`Couldn't save event: ${err.message}`, 'rescue');
      toast('Save failed — check console');
    }
  }

  async function deleteActiveEvent() {
    const ev = state.activeEvent;
    if (!ev) return;
    const delBtn = $('#modalDelete');
    if (!state.deleteArmed) {
      state.deleteArmed = true;
      delBtn.textContent = 'Click again to confirm';
      delBtn.classList.add('is-armed');
      return;
    }
    try {
      await api('DELETE', `/api/events/${encodeURIComponent(ev.id)}`, { calendarId: ev.calendarId });
      closeModal();
      toast('Event deleted.');
      await fetchEvents();
    } catch (err) {
      log(`Couldn't delete event: ${err.message}`, 'rescue');
      toast('Delete failed — check console');
    }
  }

  async function flowSnooze(extraMins) {
    if (!state.activeEvent) return;
    const ev = state.activeEvent;
    closeModal();
    try {
      const data = await api('POST', '/api/snooze', {
        eventId: ev.id,
        calendarId: ev.calendarId,
        extraMins,
        calendars: visibleCalIds(),
      });
      log(data.message, 'flow');
      toast(`+${extraMins}m flow · day rippled`);
      await fetchEvents();
    } catch (err) {
      log(`Snooze failed: ${err.message}`, 'rescue');
      toast('Snooze failed — check console');
    }
  }

  /* ---------- QUICK ADD ---------- */
  async function quickAdd() {
    const title = $('#quickTitle').value.trim();
    const date = $('#quickDate').value;
    const startT = $('#quickStart').value;
    const dur = parseInt($('#quickDur').value, 10);
    if (!title) { toast('Give the event a title first.'); return; }
    if (!date || !startT) { toast('Pick a date and start time.'); return; }
    const start = new Date(`${date}T${startT}`);
    const end = new Date(start.getTime() + dur * 60000);

    const btn = $('#quickAddBtn');
    btn.disabled = true;
    try {
      await api('POST', '/api/events', {
        title,
        cat: $('#quickCat').value,
        start: start.toISOString(),
        end: end.toISOString(),
        source: 'quick-add',
        calendarId: state.writeCalendar,
      });
      $('#quickTitle').value = '';
      $('#quickSuggest').classList.add('is-hidden');
      toast('Event added.');
      await fetchEvents();
    } catch (err) {
      log(`Couldn't add event: ${err.message}`, 'rescue');
      toast('Quick add failed — check console');
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- CIRCUIT BREAKER ---------- */
  async function circuitBreaker() {
    try {
      const ids = visibleCalIds();
      const data = await api('GET', `/api/circuit-check${ids ? `?calendars=${ids.map(encodeURIComponent).join(',')}` : ''}`);
      if (data.inMeeting) {
        toast("You're in a meeting right now — I'll hold the breaker till you're out. 🤙");
        log("Circuit breaker skipped — you're in a meeting. I got you, I'll remind you when you're out.", 'info');
        return;
      }
      $('#breaker').classList.add('is-open');
      $('#breaker').setAttribute('aria-hidden', 'false');
    } catch {
      // Fallback: show the breaker anyway if the check fails
      $('#breaker').classList.add('is-open');
      $('#breaker').setAttribute('aria-hidden', 'false');
    }
  }

  function closeBreaker() {
    $('#breaker').classList.remove('is-open');
    $('#breaker').setAttribute('aria-hidden', 'true');
  }

  async function breakerStretch() {
    closeBreaker();
    try {
      await api('POST', '/api/events', {
        title: '10-min Stretch',
        cat: 'movement',
        effort: 1,
        start: new Date().toISOString(),
        end: new Date(Date.now() + 10 * 60000).toISOString(),
        source: 'circuit-breaker',
        calendarId: state.writeCalendar,
      });
      log("Nice. 10-minute stretch booked. Go move your body. 🤸", 'info');
      await fetchEvents();
    } catch (err) {
      log(`Couldn't book stretch: ${err.message}`, 'rescue');
    }
  }

  async function breakerSnooze() {
    closeBreaker();
    // Find current/next focus block and snooze +5
    const today = new Date();
    const cur = state.events.find(ev =>
      sameDay(ev.start, today) && ev.cat === 'deep' && new Date() < new Date(ev.end)
    );
    if (cur) {
      state.activeEvent = cur;
      await flowSnooze(5);
    } else {
      log("No active sprint to snooze — enjoy the breather. 🌿", 'info');
    }
  }

  /* ---------- BRAIN DUMP → AUTO SCHEDULE ---------- */
  async function autoSchedule() {
    const raw = $('#braindump').value.trim();
    if (!raw) { toast('Paste some tasks first.'); return; }
    const btn = $('#autoSchedule');
    btn.disabled = true;
    btn.style.opacity = '0.6';
    try {
      const data = await api('POST', '/api/auto-schedule', {
        text: raw,
        calendarId: state.writeCalendar,
        calendars: visibleCalIds(),
      });
      log(data.message, 'info');
      toast(`Scheduled ${data.scheduled.length} block${data.scheduled.length === 1 ? '' : 's'}.`);
      $('#braindump').value = '';
      await fetchEvents();
    } catch (err) {
      log(`Auto-schedule failed: ${err.message}`, 'rescue');
      toast('Auto-schedule failed');
    } finally {
      btn.disabled = false;
      btn.style.opacity = '';
    }
  }

  /* ---------- UTIL ---------- */
  function el(tag, cls) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function cssRgb(colorKey) {
    const map = {
      deep: '110,168,255', movement: '61,220,151', lunch: '255,180,84',
      light: '139,123,255', meeting: '255,122,182', buffer: '79,214,232', decompress: '179,136,255',
    };
    return map[colorKey] || '110,168,255';
  }

  function populateCatSelect(sel) {
    Object.entries(CATEGORY_META).forEach(([key, meta]) => {
      const opt = el('option');
      opt.value = key;
      opt.textContent = `${meta.icon} ${meta.label}`;
      sel.appendChild(opt);
    });
  }

  /* ---------- INIT ---------- */
  async function init() {
    renderBattery();

    // Populate category selects
    populateCatSelect($('#editCat'));
    populateCatSelect($('#quickCat'));

    // Quick-add defaults: today + next 15-min boundary
    const now = new Date();
    now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
    $('#quickDate').value = fmtDateInput(now);
    $('#quickStart').value = fmtTime(now);

    // Check health / GCal config
    try {
      const health = await api('GET', '/api/health');
      state.gcalConfigured = health.gcalConfigured;
    } catch {
      state.gcalConfigured = false;
    }

    if (state.gcalConfigured) {
      log("Hey, I got you. Your day's laid out. Deep work up front, lunch protected, breaks built in. Tap 🔥 I'm Fried! anytime you need a rescue. 🫡", 'info');
      await fetchCalendars();
    }

    await fetchEvents();

    // View toggle
    $$('.segmented__btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.segmented__btn').forEach(b => { b.classList.remove('is-active'); b.setAttribute('aria-selected', 'false'); });
        btn.classList.add('is-active');
        btn.setAttribute('aria-selected', 'true');
        state.view = btn.dataset.view;
        renderCalendar();
      });
    });

    // Week nav
    $('#prevWeek').addEventListener('click', () => {
      state.weekAnchor = addDays(state.weekAnchor, -7);
      fetchEvents();
    });
    $('#nextWeek').addEventListener('click', () => {
      state.weekAnchor = addDays(state.weekAnchor, 7);
      fetchEvents();
    });

    // Calendars panel
    $('#newCalBtn').addEventListener('click', createCalendar);
    $('#newCalName').addEventListener('keydown', (e) => { if (e.key === 'Enter') createCalendar(); });
    $('#writeCalendar').addEventListener('change', () => {
      state.writeCalendar = $('#writeCalendar').value;
      localStorage.setItem('igb:writeCalendar', state.writeCalendar);
      toast('New events will go to the selected calendar.');
    });

    // Quick add
    $('#quickAddBtn').addEventListener('click', quickAdd);
    $('#quickTitle').addEventListener('keydown', (e) => { if (e.key === 'Enter') quickAdd(); });
    $('#quickCat').addEventListener('change', () => { state.quickCatTouched = true; });
    wireSuggestion($('#quickTitle'), $('#quickCat'), $('#quickSuggest'), () => state.quickCatTouched);

    // Fried
    $('#friedBtn').addEventListener('click', imFried);

    // Auto schedule
    $('#autoSchedule').addEventListener('click', autoSchedule);

    // Circuit breaker
    $('#circuitBreaker').addEventListener('click', circuitBreaker);
    $('#breakerStretch').addEventListener('click', breakerStretch);
    $('#breakerSnooze').addEventListener('click', breakerSnooze);
    $$('[data-breaker-close]').forEach(n => n.addEventListener('click', closeBreaker));

    // Modal
    $('#modalSave').addEventListener('click', saveEventEdits);
    $('#modalDelete').addEventListener('click', deleteActiveEvent);
    $('#editCat').addEventListener('change', () => {
      state.editCatTouched = true;
      updateModalTag($('#editCat').value);
      $('#editSuggest').classList.add('is-hidden');
    });
    wireSuggestion($('#editTitle'), $('#editCat'), $('#editSuggest'), () => state.editCatTouched);
    $('#flow5').addEventListener('click', () => flowSnooze(5));
    $('#flow15').addEventListener('click', () => flowSnooze(15));
    $$('[data-close]').forEach(n => n.addEventListener('click', closeModal));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeModal(); closeBreaker(); }
    });

    // Live now-line: re-render every 60 seconds
    setInterval(() => {
      if (state.view === 'week') renderWeek();
      else renderDay();
    }, 60000);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
