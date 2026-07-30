# I got you, bro 🔥

An energy-aware calendar and day-rescue tool. Integrates with Google Calendar (read + write), runs on your tailnet, and helps you manage cognitive energy — not just time.

**Live (private tailnet):** https://igotyou.mango-rockhopper.ts.net

## Features

- **Weekly grid + daily timeline** views of your real Google Calendar events
- **Cognitive energy battery** (0–100%) with live status indicator — persisted in `localStorage`, resets daily
- **🔥 I'm Fried!** — emergency rescue: pushes remaining high-effort blocks to the next weekday morning, inserts a 15-min "Walk / Tea / Breathe" decompress block at the current time, drops your battery into recovery mode
- **Flow Snooze + Ripple** — click any focus/meeting/admin event → +5m or +15m; subsequent tasks ripple down the timeline, short breaks expand 10→15m, anything overflowing past 5 PM ships to the next weekday
- **Brain dump → auto-schedule** — paste a messy to-do list, get back keyword-classified sprints (45m deep / 30m admin / 60m meeting) with movement breaks and protected 12–1 PM lunch; overflow goes to the next weekday
- **Circuit breaker** — full-screen movement reminder; checks `/api/circuit-check` first and skips if you're in a meeting
- **Bro log** — real-time, supportive, slightly cheeky messages

## Quick start (local dev)

```bash
# 1. Install deps (Node ≥ 22)
npm install

# 2. Google Calendar OAuth — one-time setup
#    a. Google Cloud Console → APIs & Services → Credentials
#    b. Create OAuth 2.0 Client ID — MUST be type "Desktop app"
#       (a "Web application" client will fail with redirect_uri_mismatch
#        unless you register the localhost redirect URI manually)
#    c. Download the JSON → save as ./credentials.json (gitignored)
#    d. Run the setup script — it opens your browser, and on success writes
#       GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN
#       directly into ./.env (mode 0600, never printed to stdout):
node scripts/oauth-setup.js

# 3. Run
node server.js
# Open http://localhost:3000
```

If GCal isn't configured, the UI shows a setup banner instead of the calendar — check `GET /api/health` → `gcalConfigured`.

## API

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/health` | Health + `gcalConfigured` flag (used by docktail) |
| GET | `/api/events?start=&end=` | List events in range |
| GET/PATCH/DELETE | `/api/events/:id` | Single-event ops |
| POST | `/api/events` | Create event `{title, cat, effort, start, end, source}` |
| POST | `/api/rescue` | I'm Fried! — reschedule today's heavy blocks, insert decompress |
| POST | `/api/snooze` | `{eventId, extraMins}` — extend + ripple |
| POST | `/api/auto-schedule` | `{text}` — parse brain dump, create sprints |
| GET | `/api/circuit-check` | `{inMeeting}` — meeting guard for circuit breaker |

## How category/effort metadata is stored

Google Calendar has no native "category" or "cognitive effort" field. This app uses:

- **Calendar color IDs** — mapped to categories (Deep Focus = blue, Movement = green, Lunch = yellow, Light Admin = purple, Meeting = red/pink, Buffer = cyan, Decompress = graphite) so events are visually consistent in GCal's own UI.
- **`extendedProperties.private`** — stores `igb:category`, `igb:effort`, `igb:source`, `igb:app`. Invisible in GCal UI, fully API-readable, survives user edits.

Pre-existing GCal events without metadata still render — category is inferred from the color ID, defaulting to Deep Focus ★★★★. App behavior only changes events when you explicitly rescue/snooze/auto-schedule them.

## Deployment (core, docktail)

Single container behind [docktail](https://github.com/marvinvr/docktail) (Tailscale Services via Docker labels). The checked-in `docker-compose.yml` is the source of truth for the docktail shape — never reintroduce a per-stack Tailscale sidecar.

```bash
# From the repo (deploys exactly the committed tree):
git archive HEAD | tailscale ssh core "cd /home/jon/docker/igotyou && tar -x"
tailscale ssh core "cd /home/jon/docker/igotyou && docker compose up -d --build"

# Verify:
curl -s https://igotyou.mango-rockhopper.ts.net/api/health
```

Secrets live only in `/home/jon/docker/igotyou/.env` on the server (mode 600). First-time setup also requires adding the `igotyou-internal` network to both containers in `/home/jon/docker/docktail/docker-compose.yml` — done once on 2026-07-30, no action needed for redeploys.

## Project structure

```
├── public/              # Frontend (vanilla JS, no build step)
│   ├── index.html       # SPA shell: header, grid, sidebar, modal, breaker overlay
│   ├── styles.css       # Dark premium theme
│   └── app.js           # All UI logic — fetches /api/*, no mock data
├── lib/                 # Backend logic
│   ├── gcal.js          # Google Calendar client (OAuth2 refresh-token, CRUD)
│   ├── scheduler.js     # Brain-dump parser, rescue/ripple/auto-schedule planners
│   └── categories.js    # Category ↔ color ID map, extendedProperties parsing
├── scripts/
│   └── oauth-setup.js   # One-time: browser OAuth → writes .env directly
├── server.js            # Express 5 app (static + /api/*)
├── Dockerfile           # node:22-slim, npm ci --omit=dev
├── docker-compose.yml   # docktail labels (source of truth for deploy shape)
└── .env.example         # Placeholders only — safe to commit
```

## Security

This repo is **public**. No secrets are ever committed:

- `.env`, `credentials.json`, `token*.json` are gitignored (verified with `git check-ignore` before every commit)
- `.env.example` contains only placeholder values
- The Docker image receives secrets via `env_file` at runtime, not baked in; `.dockerignore` excludes `credentials.json` and `scripts/`
- GCal scope is `calendar` (read+write) — the refresh token is the only long-lived secret
