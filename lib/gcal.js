/* ============================================================
   Google Calendar client — OAuth2 with auto-refresh, CRUD
   Multi-calendar: event IDs are only unique per calendar, so
   every CRUD op takes a calendarId. App-created events default
   to the "I Got You" calendar (auto-created on first use).
   ============================================================ */

import { google } from 'googleapis';
import { parseEventMeta, serializeEventMeta } from './categories.js';

const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const APP_CALENDAR_NAME = 'I Got You';

let _calendar = null;
let _appCalendarId = null;

/**
 * Initialize / return a cached authenticated calendar client.
 * Uses OAuth2 with a refresh token — googleapis auto-refreshes
 * the access token when it expires.
 */
export function getCalendar() {
  if (_calendar) return _calendar;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing Google Calendar credentials. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN in .env');
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost:3001');
  oauth2.setCredentials({ refresh_token: refreshToken });

  _calendar = google.calendar({ version: 'v3', auth: oauth2 });
  return _calendar;
}

/**
 * Check if the client is configured (has all required env vars).
 */
export function isConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
}

/* ---------- CALENDARS ---------- */

/**
 * List all calendars on the user's account.
 * @returns {Promise<Array>} [{ id, summary, primary, accessRole, backgroundColor }]
 */
export async function listCalendars() {
  const calendar = getCalendar();
  const res = await calendar.calendarList.list({ maxResults: 250 });
  return (res.data.items || []).map(c => ({
    id: c.id,
    summary: c.summaryOverride || c.summary || c.id,
    primary: !!c.primary,
    accessRole: c.accessRole || 'reader',
    backgroundColor: c.backgroundColor || null,
    hidden: !!c.hidden,
  }));
}

/**
 * Create a new calendar on the account.
 */
export async function createCalendar(summary) {
  const calendar = getCalendar();
  const res = await calendar.calendars.insert({ requestBody: { summary } });
  return {
    id: res.data.id,
    summary: res.data.summary,
    primary: false,
    accessRole: 'owner',
    backgroundColor: res.data.backgroundColor || null,
  };
}

/**
 * Resolve the app-owned "I Got You" calendar ID, creating the
 * calendar if it doesn't exist yet. Cached after first call.
 */
export async function getAppCalendarId() {
  if (_appCalendarId) return _appCalendarId;
  const calendars = await listCalendars();
  const existing = calendars.find(c => c.summary === APP_CALENDAR_NAME && c.accessRole === 'owner');
  if (existing) {
    _appCalendarId = existing.id;
  } else {
    const created = await createCalendar(APP_CALENDAR_NAME);
    _appCalendarId = created.id;
  }
  return _appCalendarId;
}

/* ---------- READ ---------- */

/**
 * List events in a time range, aggregated across calendars.
 * @param {Date|string} timeMin
 * @param {Date|string} timeMax
 * @param {Array<string>} [calendarIds] — defaults to app calendar + primary
 * @returns {Promise<Array>} app-shaped events (each tagged calendarId) sorted by start
 */
export async function listEvents(timeMin, timeMax, calendarIds = null) {
  const calendar = getCalendar();
  const ids = calendarIds && calendarIds.length
    ? calendarIds
    : [await getAppCalendarId(), 'primary'];

  const min = typeof timeMin === 'string' ? timeMin : timeMin.toISOString();
  const max = typeof timeMax === 'string' ? timeMax : timeMax.toISOString();

  const perCalendar = await Promise.all(ids.map(async (calId) => {
    try {
      const res = await calendar.events.list({
        calendarId: calId,
        timeMin: min,
        timeMax: max,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 250,
      });
      return (res.data.items || []).map(ev => parseEventMeta(ev, calId));
    } catch (err) {
      // A calendar may have been deleted or unshared — don't fail the whole fetch
      console.error(`listEvents failed for calendar ${calId}:`, err.message);
      return [];
    }
  }));

  return perCalendar
    .flat()
    .sort((a, b) => new Date(a.start) - new Date(b.start));
}

/**
 * Get a single event by ID.
 */
export async function getEvent(eventId, calendarId = 'primary') {
  const calendar = getCalendar();
  const res = await calendar.events.get({ calendarId, eventId });
  return parseEventMeta(res.data, calendarId);
}

/* ---------- WRITE ---------- */

/**
 * Create a new event from app-shaped data.
 * @param {Object} appEvent — { title, cat, effort, start, end, source? }
 * @param {string} [calendarId] — defaults to the app "I Got You" calendar
 * @returns {Promise<Object>} created app-shaped event
 */
export async function createEvent(appEvent, calendarId = null) {
  const calendar = getCalendar();
  const calId = calendarId || await getAppCalendarId();
  const body = serializeEventMeta(appEvent);
  const res = await calendar.events.insert({
    calendarId: calId,
    requestBody: body,
  });
  return parseEventMeta(res.data, calId);
}

/**
 * Update an existing event.
 * @param {string} eventId
 * @param {Object} appEvent — full or partial app event (title, cat, effort, start, end)
 * @param {string} [calendarId]
 * @returns {Promise<Object>} updated app-shaped event
 */
export async function updateEvent(eventId, appEvent, calendarId = 'primary') {
  const calendar = getCalendar();
  // Fetch current event to merge with updates
  const current = await getEvent(eventId, calendarId);
  const merged = { ...current, ...appEvent };
  const body = serializeEventMeta(merged);
  const res = await calendar.events.patch({
    calendarId,
    eventId,
    requestBody: body,
  });
  return parseEventMeta(res.data, calendarId);
}

/**
 * Delete an event.
 */
export async function deleteEvent(eventId, calendarId = 'primary') {
  const calendar = getCalendar();
  await calendar.events.delete({ calendarId, eventId });
  return { ok: true };
}

/**
 * Move an event to a new start time (adjusts end to preserve duration).
 * @param {string} eventId
 * @param {Date|string} newStart
 * @param {string} [calendarId]
 * @returns {Promise<Object>} updated app-shaped event
 */
export async function moveEvent(eventId, newStart, calendarId = 'primary') {
  const current = await getEvent(eventId, calendarId);
  const durMs = new Date(current.end) - new Date(current.start);
  const newStartDate = new Date(newStart);
  const newEndDate = new Date(newStartDate.getTime() + durMs);
  return updateEvent(eventId, {
    ...current,
    start: newStartDate.toISOString(),
    end: newEndDate.toISOString(),
  }, calendarId);
}

/**
 * Batch-create multiple events.
 * @param {Array<Object>} appEvents
 * @param {string} [calendarId] — defaults to the app calendar
 * @returns {Promise<Array<Object>>} created events
 */
export async function createEvents(appEvents, calendarId = null) {
  const results = [];
  for (const ev of appEvents) {
    results.push(await createEvent(ev, calendarId));
  }
  return results;
}

export { SCOPES, APP_CALENDAR_NAME };
