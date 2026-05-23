# Captain's Log (Brewboat)

SMS-based trip logging for Brewboat captains. Captains text free-form trip summaries to a dedicated Twilio number; the system parses, asks for confirmation, and writes a row to the existing Brewboat Google Sheet.

Spec: `docs/SPEC.md`. Decisions: `docs/DECISIONS.md` — DEC-004 (Twilio toll-free, deferred), DEC-007 (single Node service), DEC-008 (Anthropic SDK direct, Haiku/Sonnet split), DEC-009 (Sheets via service account, amended), DEC-010 (per-captain state JSON, superseded), DEC-011 (Telegram as primary channel), DEC-012 (SQLite as source of truth). DEC numbering preserved from helm for cross-repo traceability.

> **Note (2026-05):** This README still describes the pre-Telegram-pivot SMS flow in many places. Storage references have been updated to DEC-012 (SQLite). The SMS → Telegram retrofit of the rest of the README is a separate cleanup task.

## Architecture

One Node + Express service runs both Scribbler (intake) and Purser (parse + confirm + file + digest):

```
SMS → Twilio → POST /webhook/sms → Scribbler.append() → ack TwiML
                                         │
                                         ▼ (in-process, fire-and-forget)
                                    Purser.handle()
                                         │
                                         ├─ parse (Haiku 4.5)
                                         ├─ outbound SMS confirm (Twilio REST)
                                         ├─ on Y → SQLite tx: insert trip + clear state (DEC-012)
                                         └─ persist state to conversation_state row (DEC-012)

Async cron → Purser.syncSheet() → append trips.findUnsynced() rows → mark synced
22:00 ET cron → Purser.digest() → Sonnet 4.6 → email to eric@stoffer.net
```

## Layout

```
captainslog/
├── bin/server.js        # Express + cron entrypoint
├── lib/                 # scribbler, purser, parse, sheets, weather, state, sms, digest
├── config/
│   ├── captains.json    # phone → captain lookup
│   ├── boats.json       # boat registry + aliases
│   └── routes.json      # route registry + aliases
├── data/captainslog.db          # SQLite source of truth (DEC-012, gitignored)
├── raw/YYYY-MM-DD.log           # append-only message archive (DEC-003, gitignored)
├── digest/YYYY-MM-DD.html       # nightly digest snapshots (gitignored)
└── .env                 # secrets (gitignored — see .env.example)
```

## Setup (dev on mill-dev)

1. **Install Node deps.**
   ```bash
   cd ~/captains-log
   npm install
   ```

   The `/feedback` + `/file` slash commands shell out to the GitHub CLI to open
   issues. Install `gh` and authenticate it once (`gh auth login`). Issues are
   filed to `mobiustripper42/captains-log` by default — override with
   `CAPTAINSLOG_FEEDBACK_REPO=owner/repo` in `.env` if needed.

2. **Fill `.env`.** Copy the template and edit:
   ```bash
   cp .env.example .env
   # then edit .env
   ```
   See `.env.example` for what each var does.

3. **Drop the Google service-account JSON.** Place the key at the path you set in `GOOGLE_SERVICE_ACCOUNT_KEY` (default: `./google-service-account.json`). Share the Brewboat Sheet with the service-account email as Editor. See DEC-009 for why this path, not MCP.

4. **Edit `config/captains.json`.** Replace the `REPLACE_ME` phone with Eric's mobile in E.164 (`+1XXXXXXXXXX`). Add other captains as testing expands.

5. **Start the service.**
   ```bash
   node bin/server.js
   ```
   `GET /health` should return 200. `POST /webhook/sms` validates the Twilio signature, looks up the sender, appends to `raw/YYYY-MM-DD.log`, and replies with TwiML. Confirmation flow (parse + Y/correction) lands in 3.3.

### Local webhook testing without Twilio

Set `TWILIO_SKIP_SIGNATURE=1` in `.env`, then:

```bash
curl -X POST http://localhost:3000/webhook/sms \
  -d 'From=+15555550100' \
  -d 'Body=Trip on Brewboat, 3 trips, 30 pax, Cuyahoga'
```

You should see the captain logged in `raw/$(date -u +%F).log` and a TwiML "Got it, Eric. Parsing now." in the response. Never enable `TWILIO_SKIP_SIGNATURE` in production.

## Run

### Start

```bash
cd ~/captains-log && node bin/server.js
```

Expect on boot:

```
[captainslog] listening on :3000 (vX.Y.Z)
[captainslog] Scribbler + Purser wired on /webhook/telegram.
[captainslog] Sheet sync cron: */5 * * * *
```

`Ctrl-C` to stop.

### Detached (background) with log file

```bash
cd ~/captains-log
nohup node bin/server.js > server.log 2>&1 &
tail -f server.log              # Ctrl-C to detach; server keeps running
pkill -f "node bin/server.js"   # to stop it later
```

### Health check

From mill-dev (or any host that can reach `localhost:3000`):

```bash
curl http://localhost:3000/health
# {"status":"ok","service":"captainslog","version":"X.Y.Z"}
```

From elsewhere on the tailnet (or the public Funnel URL):

```bash
curl https://mill-dev.tail7e2bfd.ts.net/health
```

### Useful one-liners

```bash
# Tail today's raw intake (every inbound message, captain or unknown)
tail -f raw/$(date -u +%F).log

# Most recent trips and their sync status
sqlite3 data/captains-log.db \
  "SELECT id, status, captain_name, boat_slug, sheet_synced_at FROM trips ORDER BY id DESC LIMIT 10"

# Confirmed-but-unsynced backlog (what the next cron tick will push)
sqlite3 data/captains-log.db \
  "SELECT id, confirmed_at FROM trips WHERE status='confirmed' AND sheet_synced_at IS NULL"

# Watch Sheet sync activity (only logs when there's pending work)
grep "^\[sheets\]" server.log
```

### Re-register the Telegram webhook (after token / URL change)

```bash
set -a; source ~/captains-log/.env; set +a
curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  --data-urlencode "url=https://mill-dev.tail7e2bfd.ts.net/webhook/telegram" \
  --data-urlencode "secret_token=${TELEGRAM_SECRET_TOKEN}"
echo
```

Verify with:

```bash
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo" | python3 -m json.tool
```

## Storage

- **SQLite source of truth.** `data/captainslog.db` (path overridable via `CAPTAINSLOG_DB_PATH`). Trips, drills, conversation state, crew. Per DEC-012. Gitignored — lives on the server filesystem.
- **Raw message log.** `raw/YYYY-MM-DD.log`, plaintext, pipe-separated, one line per inbound message. Matches Scrawl format (DEC-003). Gitignored.
- **Digest snapshots.** `digest/YYYY-MM-DD.html`, one file per night, the same HTML body emailed to Eric. Gitignored.
- **Google Sheet.** Async second copy, written by the nightly sync job (DEC-009 as amended by DEC-012).

## Models

- **Parse / confirmation FSM:** `claude-haiku-4-5` (Anthropic SDK direct). Per DEC-008.
- **Nightly digest:** `claude-sonnet-4-6`. Per DEC-008 (matches Clark's Sonnet/Haiku rationale, DEC-002).
- **No automatic provider fallback in V1.** Anthropic outage → captain sees a "system busy, retry or use the form" SMS.

## Moving to production (Hetzner / DigitalOcean)

Bee-grace is dev. Production will be a VPS. The handoff is:

1. Provision a VPS (Ubuntu 24.04 LTS, 2 GB RAM minimum). DigitalOcean recommended in spec for US-region webhook latency; Hetzner ~half the cost (EU-region tradeoff).
2. Install Node 24.x. Clone this repo (`git clone …/captains-log.git /srv/captainslog`).
3. Re-run setup steps 2–4 above on the VPS:
   - New `.env` with prod values (re-issue Anthropic key if dev key is leaked, swap Twilio webhook to the prod URL, regenerate Gmail app password if rotated).
   - Re-issue or copy the Google service-account JSON. The sheet ID stays the same — just re-share with the service-account email if you minted a new one.
   - Set up a real domain + HTTPS via Let's Encrypt + nginx (or Caddy).
4. Update the Twilio number's Messaging webhook to the prod HTTPS URL.
5. Set up systemd: `Restart=on-failure`, `WorkingDirectory=/srv/captainslog`, `EnvironmentFile=/srv/captainslog/.env`. (Unit file lands in 3.8 once we're closer to production.)
6. Sanity check: `curl https://<prod-domain>/health` → 200, send one test SMS, watch journalctl.

No mill-dev-specific paths are baked into the code. Everything portable lives in `.env` or `config/`.

## Conventions

- Shell scripts: kebab-case `*.sh`, GNU coreutils target (matches Clark, doesn't matter here — JS-first).
- JS: ESM (`"type": "module"` in `package.json`), single-quote strings, no semicolons-or-with-semis preference yet. Pick one in 3.2 and stay consistent.
- Logs: console + journalctl (in prod). No log library in V1.
