# Captain's Log — Claude Code Project Context

## What We're Building

Telegram-based trip logging for Brewboat captains. Captains send free-form trip
summaries to a dedicated Telegram bot; the system parses, asks for confirmation,
and writes a row to the existing Brewboat Google Sheet. Eric gets a nightly HTML
digest by email. SMS support is planned as a later concurrent channel (DEC-011).

This repo was extracted from `helm/captainslog/` (helm Phase 3) so Captain's
Log can ship and operate independently of the rest of the helm fleet (Scrawl,
Clark, Bilge, Tiller).

## Stack

- **Runtime:** Node.js 20+ (ESM, `"type": "module"`)
- **Framework:** Express (Telegram Bot webhook) + node-cron (nightly digest)
- **Models:** `claude-haiku-4-5` (parse / confirmation FSM), `claude-sonnet-4-6`
  (nightly digest). Direct Anthropic SDK — see DEC-008.
- **Storage:** Google Sheets (existing Brewboat form schema, DEC-009) +
  flat per-captain state JSON (DEC-010) + plaintext raw message log per day
  (`helm:DEC-003`)
- **Messaging:** Telegram Bot API — no SDK, plain `fetch` (DEC-011)
- **Email:** Gmail SMTP w/ app password (`helm:DEC-005`)
- **Host:** bee-grace (dev, via ngrok). VPS production lands in Phase 4.

## Architecture

```
Telegram → POST /webhook/telegram → Scribbler.append() → 200 OK
                                         │
                                         ▼ (in-process, fire-and-forget)
                                    Purser.handle()
                                         │
                                         ├─ parse (Haiku 4.5)
                                         ├─ outbound confirm (Telegram sendMessage)
                                         ├─ on Y → write Sheet row
                                         └─ persist state to state/<chat_id>.json

22:00 ET cron → Purser.digest() → Sonnet 4.6 → email to eric@stoffer.net
```

Single Node + Express service runs both Scribbler (intake) and Purser (parse +
confirm + file + digest) in one process. See DEC-007.

## Layout

```
captains-log/
├── bin/server.js        # Express + cron entrypoint; supports --version / -v
├── lib/                 # scribbler, purser (3.3+), parse, sheets, weather, state, telegram, digest
├── config/
│   ├── captains.json    # chat_id → captain lookup
│   ├── boats.json       # boat registry + aliases
│   └── routes.json      # route registry + aliases
├── raw/YYYY-MM-DD.log         # append-only message archive (DEC-003)
├── structured/YYYY-MM-DD.json # parsed entries (pre/post Sheet write)
├── state/<chat_id>.json       # per-captain conversation state (DEC-010, gitignored)
├── digest/YYYY-MM-DD.html     # nightly digest snapshots
├── PROJECT_PLAN.md            # phases, tasks, estimates
├── README.md                  # setup + run + prod handoff
└── .env                       # secrets (gitignored — see .env.example)
```

## Key Docs

| File | Purpose |
|------|---------|
| `README.md` | Setup, run, prod handoff |
| `PROJECT_PLAN.md` | Phases, tasks, effort, status |
| `docs/SPEC.md` | Spec — what we're building, scope, V1 vs later |
| `docs/DECISIONS.md` | DEC-004/007/008/009/010/011 — DEC numbering preserved from helm |
| `helm:docs/DECISIONS.md` | Cross-repo decisions still in helm: DEC-003 (log format), DEC-005 (digest delivery), DEC-006 (Scrawl precedent for DEC-007) |

## Micro Workflow (every task, no exceptions)

1. **Spec it** — poker estimate, acceptance criteria
2. **Plan it** — summarize files to create/edit, commands to run, approach.
   Wait for explicit approval before writing code or running commands.
3. **Build it** — implement the change
4. **Test what makes sense** — run the script, send a test message via curl with
   `TELEGRAM_SKIP_SECRET=1`, hit `/health`, eyeball a Sheet row. No mock
   harness — live exercise on bee-grace via ngrok.
5. **Close out** — `/kill-this` → `/its-dead`

## Commands

```bash
# Service
npm install
node bin/server.js            # foreground (dev)
node bin/server.js --version  # → 0.1.0, exit 0

# Health
curl http://localhost:3000/health

# Local webhook test (TELEGRAM_SKIP_SECRET=1 in .env)
curl -X POST http://localhost:3000/webhook/telegram \
  -H 'Content-Type: application/json' \
  -d '{"message":{"chat":{"id":123456789},"from":{"username":"estoffer"},"text":"3 trips, 30 pax, Cuyahoga"}}'

# Tail today's raw intake
tail -f raw/$(date -u +%F).log
```

## Conventions

### Files & layout
- ESM only (`"type": "module"`), single-quote strings
- `bin/` for entrypoints, `lib/` for everything else
- Config in `config/*.json`, secrets in `.env` (gitignored)

### Naming
- Files: `kebab-case`
- Log files: `YYYY-MM-DD.log` UTC (matches Scrawl, DEC-003); ET day-bucketing
  for cron / digest / Sheet rows
- Telegram chat IDs: stored as strings in `captains.json`; raw log prefixed `telegram:<id>`

### Logs
- Plaintext raw message log: `<ISO-timestamp> | <source>:<sender_id> | <captain> | <body>`
  per line, one file per UTC day (e.g. `telegram:123456789`)
- Structured entries: JSON array per ET day in `structured/YYYY-MM-DD.json`
- Service logs: console + journalctl (in prod). No log library in V1.

### Storage rules
- `state/*.json` is **gitignored** — recoverable from raw log + Sheet (DEC-010)
- `raw/`, `structured/`, `digest/` are **git-versioned** — that's the audit trail
- Service-account JSON files are **gitignored**

## Session Skills

| Skill | When | What |
|-------|------|------|
| `/its-alive` | Session start | Stamp time, read context, recommend task |
| `/pause-this` | Mid-session break | Commit WIP, note pause |
| `/restart-this` | Resume from pause | Reload context, continue same session |
| `/kill-this` | Session end (part 1) | Commit, code review, draft log |
| `/its-dead` | Session end (part 2) | Calc time + points, write log, update plan, push |

## Approval Before Action

For every task — not just bugs — explain the plan and wait for approval before
doing anything:
1. State what files you'll create or modify and why
2. List commands you'll run, especially commits, pushes, package installs,
   anything touching production
3. Wait for "go", "do it", or equivalent
4. Do not edit files or run commands until approved

## Scope Discipline

If a task starts feeling bigger than its estimate:
1. Stop and re-estimate
2. Update PROJECT_PLAN.md
3. If it's now a 13, break it down
4. If it's scope creep, flag it and move on

## Tone

Occasional dry humor and sarcasm are welcome. Don't overdo it — one good line
beats three forced ones.
