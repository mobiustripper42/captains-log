# Captain's Log (Brewboat)

SMS-based trip logging for Brewboat captains. Captains text free-form trip summaries to a dedicated Twilio number; the system parses, asks for confirmation, and writes a row to the existing Brewboat Google Sheet.

Spec: `docs/SPEC.md`. Decisions: `docs/DECISIONS.md` — DEC-004 (Twilio toll-free), DEC-007 (single Node service), DEC-008 (Anthropic SDK direct, Haiku/Sonnet split), DEC-009 (Sheets via service account), DEC-010 (flat per-captain state JSON). DEC numbering preserved from helm for cross-repo traceability.

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
                                         ├─ on Y → write Sheet row
                                         └─ persist state to state/<phone>.json

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
├── raw/YYYY-MM-DD.log   # append-only SMS archive (matches Scrawl format, DEC-003)
├── structured/YYYY-MM-DD.json   # parsed entries (pre/post Sheet write)
├── state/<phone>.json   # per-captain conversation state (DEC-010, gitignored)
├── digest/YYYY-MM-DD.html       # nightly digest snapshots
└── .env                 # secrets (gitignored — see .env.example)
```

## Setup (dev on mill-dev)

1. **Install Node deps.**
   ```bash
   cd ~/captains-log
   npm install
   ```

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

```bash
# foreground (dev)
node bin/server.js

# tail today's raw intake
tail -f raw/$(date -u +%F).log
```

## Storage

- **Raw SMS log.** `raw/YYYY-MM-DD.log`, plaintext, pipe-separated, one line per inbound message. Matches Scrawl format (DEC-003). Git-versioned.
- **Structured entries.** `structured/YYYY-MM-DD.json`, one file per ET day, array of parsed-and-filed entries. Git-versioned.
- **Digest snapshots.** `digest/YYYY-MM-DD.html`, one file per night, the same HTML body emailed to Eric. Git-versioned.
- **Conversation state.** `state/<phone>.json`, atomic-rename writes. Per DEC-010. Gitignored — recoverable from raw log + sheet.

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
