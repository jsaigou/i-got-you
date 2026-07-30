/* ============================================================
   I got you, bro — Express server
   Serves static frontend + REST API for Google Calendar
   ============================================================ */

import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

import * as gcal from './lib/gcal.js';
import * as scheduler from './lib/scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json({ limit: '1mb' }));

/* ---------- HEALTH ---------- */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    gcalConfigured: gcal.isConfigured(),
    time: new Date().toISOString(),
  });
});

/* ---------- EVENTS CRUD ---------- */

// List events in a time range
app.get('/api/events', async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) {
      return res.status(400).json({ error: 'Missing start or end query parameter' });
    }
    const events = await gcal.listEvents(start, end);
    res.json({ events });
  } catch (err) {
    console.error('GET /api/events error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get single event
app.get('/api/events/:id', async (req, res) => {
  try {
    const event = await gcal.getEvent(req.params.id);
    res.json({ event });
  } catch (err) {
    console.error(`GET /api/events/${req.params.id} error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Create event
app.post('/api/events', async (req, res) => {
  try {
    const { title, cat, effort, start, end, source } = req.body;
    if (!title || !start || !end) {
      return res.status(400).json({ error: 'Missing required fields: title, start, end' });
    }
    const event = await gcal.createEvent({ title, cat, effort, start, end, source });
    res.status(201).json({ event });
  } catch (err) {
    console.error('POST /api/events error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Update event
app.patch('/api/events/:id', async (req, res) => {
  try {
    const event = await gcal.updateEvent(req.params.id, req.body);
    res.json({ event });
  } catch (err) {
    console.error(`PATCH /api/events/${req.params.id} error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Delete event
app.delete('/api/events/:id', async (req, res) => {
  try {
    await gcal.deleteEvent(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error(`DELETE /api/events/${req.params.id} error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ---------- HIGH-LEVEL ACTIONS ---------- */

// I'm Fried! — emergency rescue
app.post('/api/rescue', async (req, res) => {
  try {
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(now);
    dayEnd.setHours(23, 59, 59, 999);

    const todayEvents = await gcal.listEvents(dayStart, dayEnd);
    const plan = scheduler.planRescue(todayEvents, now);

    // Execute: move heavy blocks to tomorrow + create decompress block
    const moved = [];
    for (const item of plan.rescheduled) {
      // Update the original event to the new time
      const updated = await gcal.updateEvent(item.eventId, {
        title: item.title,
        cat: item.cat,
        effort: item.effort,
        start: item.newStart,
        end: item.newEnd,
        source: 'rescue',
      });
      moved.push(updated);
    }

    // Create decompress block
    let decompress = null;
    if (plan.decompressBlock) {
      decompress = await gcal.createEvent(plan.decompressBlock);
    }

    res.json({
      rescheduled: moved,
      decompressBlock: decompress,
      energyDrain: plan.energyDrain,
      message: plan.message,
    });
  } catch (err) {
    console.error('POST /api/rescue error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Flow Snooze + Ripple
app.post('/api/snooze', async (req, res) => {
  try {
    const { eventId, extraMins } = req.body;
    if (!eventId || !extraMins) {
      return res.status(400).json({ error: 'Missing eventId or extraMins' });
    }

    // Fetch today's events
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(now);
    dayEnd.setHours(23, 59, 59, 999);

    const todayEvents = await gcal.listEvents(dayStart, dayEnd);
    const plan = scheduler.planRippleSnooze(eventId, parseInt(extraMins, 10), todayEvents);

    // Execute: extend the target event
    const target = todayEvents.find(e => e.id === eventId);
    if (!target) {
      return res.status(404).json({ error: 'Event not found in today\'s schedule' });
    }

    const extended = await gcal.updateEvent(eventId, {
      ...target,
      end: plan.extendedEvent.newEnd,
    });

    // Ripple: update subsequent events
    const rippledResults = [];
    for (const r of plan.rippled) {
      const updated = await gcal.updateEvent(r.eventId, {
        title: r.title,
        cat: r.cat,
        effort: r.effort,
        start: r.newStart,
        end: r.newEnd,
        source: 'ripple',
      });
      rippledResults.push(updated);
    }

    // Overflow: move to next day
    let overflowResult = null;
    if (plan.overflow) {
      overflowResult = await gcal.updateEvent(plan.overflow.eventId, {
        title: plan.overflow.title,
        cat: plan.overflow.cat,
        effort: plan.overflow.effort,
        start: plan.overflow.newStart,
        end: plan.overflow.newEnd,
        source: 'ripple-overflow',
      });

      // Move subsequent overflow events too
      if (plan.overflow._subsequent) {
        for (const s of plan.overflow._subsequent) {
          await gcal.updateEvent(s.eventId, {
            title: s.title,
            cat: s.cat,
            effort: s.effort,
            start: s.newStart,
            end: s.newEnd,
            source: 'ripple-overflow',
          });
        }
      }
    }

    res.json({
      extendedEvent: extended,
      rippled: rippledResults,
      overflow: overflowResult,
      message: plan.message,
    });
  } catch (err) {
    console.error('POST /api/snooze error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Brain dump → auto-schedule
app.post('/api/auto-schedule', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Missing text field' });
    }

    const tasks = scheduler.parseBrainDump(text);
    const now = new Date();

    // Fetch existing events for today to avoid conflicts
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(now);
    dayEnd.setHours(23, 59, 59, 999);
    const existing = await gcal.listEvents(dayStart, dayEnd);

    const newEventSpecs = scheduler.autoSchedule(tasks, now);
    const created = await gcal.createEvents(newEventSpecs);

    const overflowCount = newEventSpecs.filter(e => {
      const h = new Date(e.start).getHours();
      const d = new Date(e.start).getDate();
      return d !== now.getDate() || h >= 17;
    }).length;

    const msg = `I got you, bro. Parsed ${tasks.length} task${tasks.length === 1 ? '' : 's'} into ${created.length} sprint${created.length === 1 ? '' : 's'} with movement breaks, lunch protected.` +
      (overflowCount > 0 ? ` ${overflowCount} overflowed to tomorrow — no biggie.` : ' You\'re set. Let\'s roll. 🫡');

    res.json({
      scheduled: created,
      taskCount: tasks.length,
      overflowCount,
      message: msg,
    });
  } catch (err) {
    console.error('POST /api/auto-schedule error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Circuit breaker check — are we in a meeting?
app.get('/api/circuit-check', async (req, res) => {
  try {
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(now);
    dayEnd.setHours(23, 59, 59, 999);

    const todayEvents = await gcal.listEvents(dayStart, dayEnd);
    const inMeeting = scheduler.isInMeeting(todayEvents, now);

    res.json({ inMeeting, now: now.toISOString() });
  } catch (err) {
    console.error('GET /api/circuit-check error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ---------- STATIC FRONTEND ---------- */
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback — serve index.html for any non-API, non-static route
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/') && !req.path.match(/\.\w+$/)) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  next();
});

/* ---------- START ---------- */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ┌──────────────────────────────────────────┐`);
  console.log(`  │  I got you, bro 🫡                        │`);
  console.log(`  │  server listening on http://0.0.0.0:${PORT}   │`);
  console.log(`  │  GCal: ${gcal.isConfigured() ? 'configured ✓' : 'NOT configured ✗'}        │`);
  console.log(`  └──────────────────────────────────────────┘\n`);
});
