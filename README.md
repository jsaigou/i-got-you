# I got you, bro 🔥

An energy-aware calendar and day-rescue tool. Integrates with Google Calendar, runs on your tailnet, and helps you manage cognitive energy — not just time.

## Features

- **Weekly grid + daily timeline** views of your real Google Calendar events
- **Cognitive energy battery** (0–100%) with live status indicator
- **🔥 I'm Fried!** — emergency rescue: pushes remaining high-effort blocks to tomorrow, inserts a 15-min decompress break, drops your battery into recovery
- **Flow Snooze + Ripple** — extend any focus sprint by +5m or +15m; subsequent tasks ripple down, breaks expand, overflow ships to tomorrow
- **Brain dump → auto-schedule** — paste a messy to-do list, get back timed sprints with movement breaks and a protected lunch
- **Circuit breaker** — full-screen movement reminder that checks if you're in a meeting first
- **Bro log** — real-time, supportive, slightly cheeky messages

## Quick start (local dev)

```bash
# 1. Install deps
npm install

# 2. Get Google Calendar OAuth credentials
#    a. Go to Google Cloud Console → APIs & Services → Credentials
#    b. Create an OAuth 2.0 Client ID (type: Desktop app)
#    c. Download the JSON → save as ./credentials.json (gitignored)
#    d. Run the one-time OAuth script:
node scripts/oauth-setup.js
#    e. Copy the printed refresh token into .env

# 3. Configure environment
cp .env.example .env
# Edit .env with your client ID, secret, and refresh token

# 4. Run
node server.js
# Open http://localhost:3000
```

## How category/effort metadata is stored

Google Calendar has no native "category" or "cognitive effort" field. This app uses:

- **Calendar color IDs** — mapped to categories (Deep Focus = blue, Movement = green, etc.) so events are visually distinct in GCal too.
- **`extendedProperties.private`** — stores `igb:category`, `igb:effort`, and `igb:source` as key-value pairs invisible in the GCal UI but readable via the API.

Pre-existing GCal events without metadata are still rendered — the app infers a category from the color ID or defaults to "Deep Focus".

## Docker deployment (tailnet)

This app deploys as a single Docker container behind [docktail](https://github.com/marvinvr/docktail) (Tailscale Services via Docker labels).

```bash
# On your server (accessible via Tailscale SSH):
git archive HEAD | tailscale ssh core "cd /home/jon/docker/igotyou && tar -x"
# Create .env with real credentials on the server
cd /home/jon/docker/igotyou && docker compose up -d --build
```

See `docker-compose.yml` for the docktail label configuration. The app becomes available at `https://igotyou.<your-tailnet>.ts.net`.

## Project structure

```
├── public/              # Frontend (vanilla JS, no build step)
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── lib/                 # Backend logic
│   ├── gcal.js          # Google Calendar client (OAuth2, CRUD)
│   ├── scheduler.js     # Brain-dump parser, rescue, ripple logic
│   └── categories.js    # Category ↔ color ID mapping, metadata parsing
├── scripts/
│   └── oauth-setup.js   # One-time: get refresh token from Google
├── server.js            # Express app (static + API)
├── Dockerfile
├── docker-compose.yml
└── .env.example         # Template — copy to .env, never commit real values
```

## Security

This repo is **public**. No secrets are ever committed:

- `.env`, `credentials.json`, `token*.json` are all gitignored
- `.env.example` contains only placeholder values
- The Docker image receives secrets via `env_file` at runtime, not baked in
