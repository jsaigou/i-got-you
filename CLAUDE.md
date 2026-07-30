# CLAUDE.md — I got you

Energy-aware calendar / day-rescue app. Vanilla JS frontend (no build step) + Express 5 backend + Google Calendar API (read AND write). Public repo: https://github.com/jsaigou/i-got-you

## Current state (as of 2026-07-30, commit f5f2fc1)

**Deployed and live.** Production runs on `core` at `/home/jon/docker/igotyou/`, reachable at `https://igotyou.mango-rockhopper.ts.net`. GCal OAuth is set up (desktop-app client, refresh token in `.env` on core AND locally, both gitignored, mode 600).

**Feature set (shipped f5f2fc1):** multi-calendar (all account calendars, visibility toggles, auto-created "I Got You" write-target calendar), event edit modal (title/date/time/type/effort + delete), drag-to-reschedule on the week grid, keyword type-suggestion, quick-add form. App renamed from "I got you, bro" → "I got you" everywhere except `igb:*` GCal metadata keys (kept for backward compat with existing event metadata).

**Verified:** backend CRUD exercised against real GCal via curl (create/patch/list/delete/circuit-check ✓), UI smoke-tested in Chrome (renders, zero console errors), production `/api/health` + `/api/calendars` ✓. **Outstanding:** drag-and-drop and the edit modal were never click-tested in a real browser (session hit a rate limit) — if the user reports drag/save weirdness, that's the first place to look.

## Architecture

- **No database** — Google Calendar is the only data store. App category/effort stored via `colorId` + `extendedProperties.private` (`igb:category`, `igb:effort`, `igb:source`, `igb:app`). **Never rename the `igb:*` keys** — existing events on the user's calendars carry them.
- **Multi-calendar** — `GET /api/calendars` lists all account calendars and auto-creates the app-owned **I Got You** calendar (default write target, cached in `lib/gcal.js`). Event IDs are only unique per calendar, so **every event CRUD call threads `calendarId`** through. Visibility toggles + write target are frontend `localStorage` (`igb:calHidden`, `igb:writeCalendar`) — server stays stateless.
- **Energy level** — frontend-only, `localStorage` (`igb:energy` + `igb:energyDate`), resets daily to 72.
- **Frontend** — `public/app.js` single IIFE, state object + render functions. Grid is CSS `grid-template-columns: 56px repeat(7, 1fr)`, hours 9:00–17:00 at 60px/hour. Now-line is pure CSS `calc()` positioning (NO `getBoundingClientRect` — it was the original rendering bug). Drag-to-reschedule uses pointer events with `setPointerCapture`, 15-min snap, optimistic PATCH + revert. Keyword suggestion table in app.js duplicates `KEYWORDS` from `lib/scheduler.js` — keep them in sync.

## Key files

- `lib/gcal.js` — GCal client, cached singleton, refresh-token OAuth, calendar list/create + `getAppCalendarId()`. Every route depends on it.
- `lib/scheduler.js` — pure planner functions (`planRescue`, `planRippleSnooze`, `autoSchedule`, `parseBrainDump`). No GCal calls here — `server.js` executes the plans. Plan items carry `calendarId` so updates hit the right calendar.
- `lib/categories.js` — `parseEventMeta`/`serializeEventMeta` mapping between app shape and GCal shape.
- `server.js` — Express 5. Note: **Express 5 dropped `app.get('*')`** — the SPA fallback is an `app.use` middleware that checks method/path instead.

## Hard-won gotchas (don't re-learn these)

1. **OAuth client MUST be "Desktop app" type.** A "Web application" client fails with `redirect_uri_mismatch` at the consent screen because it has no registered redirect URIs. `credentials.json` must have the `installed` key, not `web`.
2. **OAuth script writes to `.env` directly** (mode 600), never prints tokens to stdout. Keep it that way — the classifier will (correctly) block printing tokens.
3. **Pre-existing GCal events render as Deep Focus ★★★★** (fallback when no `igb:*` metadata and unrecognized colorId). This is expected, not a bug.
4. **Deploy shape is docktail labels on the single app container** — the checked-in `docker-compose.yml` is the source of truth. Never reintroduce a `tailscale/tailscale` sidecar service.
5. **Redeploying after a docktail stack restart:** if logs show `unexpected state: NoState`, it's the known race — check `docker exec docktail-tailscale tailscale status --json` → `"BackendState": "Running"`, then `docker restart docktail` alone.
6. The user's real calendar data flows through this app — **be careful with destructive ops.** Rescue/snooze rewrite event times on the user's actual primary calendar.

## Commands

```bash
# Dev
npm install && node server.js          # http://localhost:3000 (needs .env — run node scripts/oauth-setup.js first if missing)

# Deploy (from repo root, pushes committed tree only)
git archive HEAD | tailscale ssh core "cd /home/jon/docker/igotyou && tar -x"
tailscale ssh core "cd /home/jon/docker/igotyou && docker compose up -d --build"

# Verify
curl -s https://igotyou.mango-rockhopper.ts.net/api/health
tailscale ssh core "docker logs docktail 2>&1 | grep -i igotyou | tail -5"
```

## Security invariants (public repo — enforce on every commit)

- `.env`, `credentials.json`, `token*.json` must stay gitignored. Verify: `git check-ignore .env credentials.json`.
- Secrets only ever exist in `.env` (local + core, mode 600). Never in code, never in stdout, never in the Docker image (`.dockerignore` covers this).
- Before committing: `git grep -iE '(GOCSPX|ya29\.|AIza)' -- . ':!package-lock.json'` must return nothing.
