/* ============================================================
   Google Calendar client — OAuth2 with auto-refresh, CRUD
   ============================================================ */

import { google } from 'googleapis';
import { parseEventMeta, serializeEventMeta } from './categories.js';

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

let _calendar = null;

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

export function getCalendarId() {
  return process.env.GOOGLE_CALENDAR_ID || 'primary';
}

/**
 * Check if the client is configured (has all required env vars).
 */
export function isConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
}

/* ---------- READ ---------- */

/**
 * List events in a time range.
 * @param {Date|string} timeMin
 * @param {Date|string} timeMax
 * @returns {Promise<Array>} app-shaped events sorted by start time
 */
export async function listEvents(timeMin, timeMax) {
  const calendar = getCalendar();
  const calId = getCalendarId();
  const res = await calendar.events.list({
    calendarId: calId,
    timeMin: typeof timeMin === 'string' ? timeMin : timeMin.toISOString(),
    timeMax: typeof timeMax === 'string' ? timeMax : timeMax.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 250,
  });
  return (res.data.items || []).map(parseEventMeta);
}

/**
 * Get a single event by ID.
 */
export async function getEvent(eventId) {
  const calendar = getCalendar();
  const res = await calendar.events.get({
    calendarId: getCalendarId(),
    eventId,
  });
  return parseEventMeta(res.data);
}

/* ---------- WRITE ---------- */

/**
 * Create a new event from app-shaped data.
 * @param {Object} appEvent — { title, cat, effort, start, end, source? }
 * @returns {Promise<Object>} created app-shaped event
 */
export async function createEvent(appEvent) {
  const calendar = getCalendar();
  const body = serializeEventMeta(appEvent);
  const res = await calendar.events.insert({
    calendarId: getCalendarId(),
    requestBody: body,
  });
  return parseEventMeta(res.data);
}

/**
 * Update an existing event.
 * @param {string} eventId
 * @param {Object} appEvent — full or partial app event (title, cat, effort, start, end)
 * @returns {Promise<Object>} updated app-shaped event
 */
export async function updateEvent(eventId, appEvent) {
  const calendar = getCalendar();
  // Fetch current event to merge with updates
  const current = await getEvent(eventId);
  const merged = { ...current, ...appEvent };
  const body = serializeEventMeta(merged);
  const res = await calendar.events.patch({
    calendarId: getCalendarId(),
    eventId,
    requestBody: body,
  });
  return parseEventMeta(res.data);
}

/**
 * Delete an event.
 */
export async function deleteEvent(eventId) {
  const calendar = getCalendar();
  await calendar.events.delete({
    calendarId: getCalendarId(),
    eventId,
  });
  return { ok: true };
}

/**
 * Move an event to a new start time (adjusts end to preserve duration).
 * @param {string} eventId
 * @param {Date|string} newStart
 * @returns {Promise<Object>} updated app-shaped event
 */
export async function moveEvent(eventId, newStart) {
  const current = await getEvent(eventId);
  const durMs = new Date(current.end) - new Date(current.start);
  const newStartDate = new Date(newStart);
  const newEndDate = new Date(newStartDate.getTime() + durMs);
  return updateEvent(eventId, {
    ...current,
    start: newStartDate.toISOString(),
    end: newEndDate.toISOString(),
  });
}

/**
 * Batch-create multiple events.
 * @param {Array<Object>} appEvents
 * @returns {Promise<Array<Object>>} created events
 */
export async function createEvents(appEvents) {
  const results = [];
  for (const ev of appEvents) {
    results.push(await createEvent(ev));
  }
  return results;
}

export { SCOPES };
