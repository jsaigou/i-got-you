/* ============================================================
   Category ↔ Google Calendar color ID mapping
   + extendedProperties metadata parsing/serialization
   ============================================================ */

// Google Calendar color IDs (1-11).
// These map to the colors shown in the GCal UI, so events
// are visually consistent across the app and GCal itself.
export const CATEGORY_TO_COLOR = {
  deep:       '9',  // blue
  movement:   '2',  // green
  lunch:      '5',  // yellow
  light:      '1',  // purple
  meeting:    '6',  // red/pink
  buffer:     '3',  // cyan
  decompress: '8',  // graphite
};

// Reverse lookup: color ID → category key
export const COLOR_TO_CATEGORY = Object.fromEntries(
  Object.entries(CATEGORY_TO_COLOR).map(([cat, color]) => [color, cat])
);

// Human-readable labels + icons + default effort per category
export const CATEGORY_META = {
  deep:       { label: 'Deep Focus',      icon: '🧠', defaultEffort: 4 },
  movement:   { label: 'Movement Break',  icon: '🤸', defaultEffort: 1 },
  lunch:      { label: 'Protected Lunch', icon: '🍽️', defaultEffort: 0 },
  light:      { label: 'Light Admin',     icon: '✉️', defaultEffort: 2 },
  meeting:    { label: 'External Mtg',    icon: '👥', defaultEffort: 3 },
  buffer:     { label: 'Buffer',          icon: '⏳', defaultEffort: 1 },
  decompress: { label: 'Decompress',      icon: '🌿', defaultEffort: 0 },
};

export const ALL_CATEGORIES = Object.keys(CATEGORY_META);

/**
 * Parse a Google Calendar event into the app's internal event shape.
 * Extracts category + effort from extendedProperties, falling back to
 * color ID inference for pre-existing events without metadata.
 * @param {Object} gcalEvent
 * @param {string} [calendarId] — calendar the event was fetched from
 */
export function parseEventMeta(gcalEvent, calendarId = null) {
  const priv = gcalEvent.extendedProperties?.private || {};
  let category = priv['igb:category'];
  let effort = parseInt(priv['igb:effort'], 10);
  let source = priv['igb:source'] || 'manual';

  // Fall back to color ID if no explicit category
  if (!category) {
    category = COLOR_TO_CATEGORY[gcalEvent.colorId] || 'deep';
  }
  // Fall back to default effort for the category
  if (isNaN(effort)) {
    effort = CATEGORY_META[category]?.defaultEffort ?? 3;
  }

  const start = gcalEvent.start?.dateTime || gcalEvent.start?.date;
  const end = gcalEvent.end?.dateTime || gcalEvent.end?.date;

  return {
    id: gcalEvent.id,
    calendarId: calendarId || null,
    title: gcalEvent.summary || '(untitled)',
    cat: category,
    effort,
    source,
    start,
    end,
    colorId: gcalEvent.colorId || CATEGORY_TO_COLOR[category],
    description: gcalEvent.description || '',
    htmlLink: gcalEvent.htmlLink || null,
  };
}

/**
 * Serialize an app event into GCal event fields for create/update.
 * Stores category + effort in extendedProperties.private.
 */
export function serializeEventMeta(appEvent) {
  const category = appEvent.cat || 'deep';
  const effort = appEvent.effort ?? CATEGORY_META[category]?.defaultEffort ?? 3;

  return {
    summary: appEvent.title,
    colorId: CATEGORY_TO_COLOR[category] || CATEGORY_TO_COLOR.deep,
    start: { dateTime: appEvent.start },
    end: { dateTime: appEvent.end },
    extendedProperties: {
      private: {
        'igb:category': category,
        'igb:effort': String(effort),
        'igb:source': appEvent.source || 'manual',
        'igb:app': 'i-got-you',
      },
    },
  };
}
