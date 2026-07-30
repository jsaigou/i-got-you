/* ============================================================
   Scheduler — brain-dump parser, rescue, ripple-snooze logic
   ============================================================ */

import { CATEGORY_META } from './categories.js';

const DAY_START_H = 9;
const DAY_END_H = 17;
const LUNCH_START_H = 12;
const LUNCH_END_H = 13;
const FOCUS_SPRINT_MINS = 45;
const MOVEMENT_BREAK_MINS = 10;
const MOVEMENT_BREAK_EXPANDED_MINS = 15;

/* ---------- date helpers ---------- */

export function addMinutes(date, mins) {
  return new Date(date.getTime() + mins * 60000);
}

export function durMins(start, end) {
  return Math.round((new Date(end) - new Date(start)) / 60000);
}

export function nextWeekday(date) {
  const d = new Date(date);
  d.setDate(d.getDate() + 1);
  if (d.getDay() === 6) d.setDate(d.getDate() + 2); // Sat → Mon
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);  // Sun → Mon
  return d;
}

export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isSameDay(a, b) {
  a = new Date(a); b = new Date(b);
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

/* ============================================================
   BRAIN DUMP PARSER
   ============================================================ */

const KEYWORDS = {
  meeting: ['call', 'sync', 'meet', '1:1', 'standup', 'interview', 'client', 'vendor', 'catch up', 'demo'],
  light:   ['email', 'reply', 'slack', 'triage', 'inbox', 'admin', 'file', 'expense', 'schedule', 'book', 'update', 'log', 'review pr', 'merge', 'deploy'],
  movement: ['walk', 'stretch', 'gym', 'run', 'break', 'water', 'hydrate'],
  lunch: ['lunch', 'eat', 'food'],
};

/**
 * Parse raw brain-dump text into classified tasks.
 * Each task: { title, cat, effort }
 */
export function parseBrainDump(text) {
  const lines = text.split('\n')
    .map(s => s.replace(/^[\s\-*•\d\.\)]+/, '').trim())
    .filter(Boolean);

  return lines.map(line => {
    const low = line.toLowerCase();
    let cat = 'deep';
    let effort = 4;

    if (KEYWORDS.lunch.some(k => low.includes(k))) {
      cat = 'lunch'; effort = 0;
    } else if (KEYWORDS.meeting.some(k => low.includes(k))) {
      cat = 'meeting'; effort = 3;
    } else if (KEYWORDS.light.some(k => low.includes(k))) {
      cat = 'light'; effort = 2;
    } else if (KEYWORDS.movement.some(k => low.includes(k))) {
      cat = 'movement'; effort = 1;
    } else if (low.length < 20) {
      cat = 'light'; effort = 2;
    }

    return { title: line, cat, effort };
  });
}

/* ============================================================
   AUTO-SCHEDULE
   Takes parsed tasks + existing events, produces new events to create.
   ============================================================ */

/**
 * @param {Array} tasks — output of parseBrainDump
 * @param {Date} now — starting point (usually new Date())
 * @returns {Array} events to create: [{ title, cat, effort, start, end, source }]
 */
export function autoSchedule(tasks, now = new Date()) {
  // Round up to next 5-min boundary
  let cursor = new Date(now);
  cursor.setSeconds(0, 0);
  const mins = cursor.getMinutes();
  cursor.setMinutes(Math.ceil(mins / 5) * 5);
  if (cursor <= now) cursor = addMinutes(cursor, 5);

  const newEvents = [];
  const lunchStart = new Date(cursor);
  lunchStart.setHours(LUNCH_START_H, 0, 0, 0);
  const lunchEnd = new Date(cursor);
  lunchEnd.setHours(LUNCH_END_H, 0, 0, 0);

  let sprintCount = 0;

  for (const task of tasks) {
    // Protect lunch
    if (cursor < lunchEnd && addMinutes(cursor, FOCUS_SPRINT_MINS) > lunchStart) {
      cursor = new Date(lunchEnd);
    }

    // End-of-day guard
    if (cursor.getHours() >= DAY_END_H) {
      const nd = startOfDay(nextWeekday(cursor));
      nd.setHours(DAY_START_H, 0, 0, 0);
      cursor = nd;
    }

    const isFocus = task.cat === 'deep';
    const dur = isFocus ? FOCUS_SPRINT_MINS
              : task.cat === 'meeting' ? 60
              : task.cat === 'movement' ? MOVEMENT_BREAK_MINS
              : task.cat === 'lunch' ? 60
              : 30;

    newEvents.push({
      title: task.title,
      cat: task.cat,
      effort: task.effort,
      start: new Date(cursor).toISOString(),
      end: addMinutes(cursor, dur).toISOString(),
      source: 'auto',
    });

    cursor = addMinutes(cursor, dur);

    // Add movement break after focus sprints
    if (isFocus) {
      // Don't add a break right before lunch
      if (cursor < lunchStart || cursor >= lunchEnd) {
        newEvents.push({
          title: 'Movement Break',
          cat: 'movement',
          effort: 1,
          start: new Date(cursor).toISOString(),
          end: addMinutes(cursor, MOVEMENT_BREAK_MINS).toISOString(),
          source: 'auto',
        });
        cursor = addMinutes(cursor, MOVEMENT_BREAK_MINS);
      }
      sprintCount++;
    }
  }

  return newEvents;
}

/* ============================================================
   RESCUE — "I'm Fried!"
   Identifies remaining high-effort blocks today, reschedules
   them to tomorrow morning, inserts a decompress block now.
   ============================================================ */

/**
 * @param {Array} todayEvents — app-shaped events for today
 * @param {Date} now
 * @returns {Object} { rescheduled: [], decompressBlock: {}, energyDrain: number }
 *   - rescheduled: array of { eventId, originalStart, newStart } — caller moves them
 *   - decompressBlock: event to create at current time
 *   - energyDrain: suggested battery drain
 */
export function planRescue(todayEvents, now = new Date()) {
  const heavy = todayEvents
    .filter(ev => (ev.cat === 'deep' || ev.cat === 'meeting') && new Date(ev.start) >= now)
    .sort((a, b) => new Date(a.start) - new Date(b.start));

  // Build tomorrow morning schedule starting at 10:00
  const tomorrow = nextWeekday(now);
  tomorrow.setHours(10, 0, 0, 0);

  const rescheduled = heavy.map(ev => {
    const dur = durMins(ev.start, ev.end);
    const newStart = new Date(tomorrow);
    const newEnd = addMinutes(tomorrow, dur);
    // Advance cursor with a 10-min buffer between blocks
    tomorrow.setTime(addMinutes(tomorrow, dur + 10).getTime());
    return {
      eventId: ev.id,
      title: ev.title,
      cat: ev.cat,
      effort: ev.effort,
      originalStart: ev.start,
      newStart: newStart.toISOString(),
      newEnd: newEnd.toISOString(),
    };
  });

  const decompressBlock = {
    title: 'Walk / Tea / Breathe',
    cat: 'decompress',
    effort: 0,
    start: new Date(now).toISOString(),
    end: addMinutes(now, 15).toISOString(),
    source: 'rescue',
  };

  return {
    rescheduled,
    decompressBlock,
    energyDrain: 35,
    message: heavy.length > 0
      ? `Hey, I got you, bro. Shutting it down. I pushed all your heavy deep work (${heavy.length} block${heavy.length === 1 ? '' : 's'}) to ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][nextWeekday(now).getDay()]} morning. Go grab some fresh air.`
      : "Hey, I got you, bro. No heavy blocks left today — you're already in the clear. Go take a breather anyway. 🌿",
  };
}

/* ============================================================
   RIPPLE SNOOZE — extend a block, push subsequent tasks down
   ============================================================ */

/**
 * @param {string} eventId — the event to extend
 * @param {number} extraMins — how many minutes to add (5 or 15)
 * @param {Array} todayEvents — all events on the same day, sorted by start
 * @returns {Object} { extendedEvent, rippled: [], overflow: null, message }
 */
export function planRippleSnooze(eventId, extraMins, todayEvents) {
  const events = [...todayEvents].sort((a, b) => new Date(a.start) - new Date(b.start));
  const idx = events.findIndex(e => e.id === eventId);
  if (idx < 0) throw new Error('Event not found in today\'s schedule');

  const target = events[idx];
  const originalEnd = new Date(target.end);
  const newEnd = addMinutes(originalEnd, extraMins);

  const rippled = [];
  let cursor = new Date(newEnd);
  let overflow = null;

  for (let i = idx + 1; i < events.length; i++) {
    const next = events[i];
    const dur = durMins(next.start, next.end);

    // Expand short movement/buffer breaks from 10 → 15
    const isBreak = next.cat === 'movement' || next.cat === 'buffer';
    const effectiveDur = isBreak && dur < MOVEMENT_BREAK_EXPANDED_MINS
      ? MOVEMENT_BREAK_EXPANDED_MINS
      : dur;

    const newStart = new Date(cursor);
    const newEndForNext = addMinutes(cursor, effectiveDur);

    // Overflow past 17:00 → move to next day
    if (newEndForNext.getHours() >= DAY_END_H && isSameDay(newStart, target.start)) {
      const nd = startOfDay(nextWeekday(newStart));
      nd.setHours(DAY_START_H, 0, 0, 0);
      overflow = {
        eventId: next.id,
        title: next.title,
        cat: next.cat,
        effort: next.effort,
        originalStart: next.start,
        newStart: nd.toISOString(),
        newEnd: addMinutes(nd, effectiveDur).toISOString(),
      };
      // Include all remaining events as overflow targets (only first one reported,
      // but caller should move subsequent ones too)
      for (let j = i + 1; j < events.length; j++) {
        const after = events[j];
        const aDur = durMins(after.start, after.end);
        const aStart = addMinutes(nd, effectiveDur + 10);
        overflow._subsequent = overflow._subsequent || [];
        overflow._subsequent.push({
          eventId: after.id,
          title: after.title,
          cat: after.cat,
          effort: after.effort,
          originalStart: after.start,
          newStart: aStart.toISOString(),
          newEnd: addMinutes(aStart, aDur).toISOString(),
        });
      }
      break;
    }

    rippled.push({
      eventId: next.id,
      title: next.title,
      cat: next.cat,
      effort: next.effort,
      originalStart: next.start,
      newStart: newStart.toISOString(),
      newEnd: newEndForNext.toISOString(),
      expanded: effectiveDur !== dur,
    });

    cursor = newEndForNext;
  }

  const movedName = rippled.length > 0 ? rippled[0].title : 'low-priority admin';

  return {
    extendedEvent: {
      eventId: target.id,
      title: target.title,
      originalEnd: target.end,
      newEnd: newEnd.toISOString(),
      extraMins,
    },
    rippled,
    overflow,
    message: `Flow locked in! Extended your sprint by ${extraMins}m, expanded your recovery break, and moved ${movedName} so you still finish on time. 🌊`,
  };
}

/* ============================================================
   CIRCUIT BREAKER — check if currently in a meeting
   ============================================================ */

export function isInMeeting(todayEvents, now = new Date()) {
  return todayEvents.some(ev =>
    ev.cat === 'meeting' &&
    new Date(ev.start) <= now &&
    new Date(ev.end) > now
  );
}
