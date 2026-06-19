# Captain's Log — Project Context

Everything specific to **this** project. The seeds-managed `CLAUDE.md` shell reads this file at session start and treats it as authoritative for project-specific facts (DEC-S019). This is a **`tool`** project (`.claude/project-type` = `tool`), so the shell's webapp defaults — Playwright/pgTAP, Supabase migrations, 375px screenshots, `<VersionTag />` — are overridden or N/A below. Nothing here syncs from seeds.

## What We're Building

Telegram-based trip logging for Brewboat captains. Captains send free-form trip summaries to a dedicated Telegram bot; the system parses, asks for confirmation, and writes a row to the existing Brewboat Google Sheet. Eric gets a nightly HTML digest by email. SMS support is planned as a later concurrent channel (DEC-011).

This repo was extracted from `helm/captainslog/` (helm Phase 3) so Captain's Log can ship and operate independently of the rest of the helm fleet (Scrawl, Clark, Bilge, Tiller).

## Stack

- **Runtime:** Node.js 20+ (ESM, `"type": "module"`)
- **Framework:** Express (Telegram Bot webhook) + node-cron (nightly digest)
- **Models:** `claude-haiku-4-5` (parse / confirmation FSM), `claude-sonnet-4-6` (nightly digest). Direct Anthropic SDK — see DEC-008.
- **Storage:** SQLite via `better-sqlite3` is the source of truth (DEC-012) — trips, drills, conversation state, crew. Google Sheets (DEC-009 as amended) is an async presentation target written by a nightly sync job. Plaintext raw message log per day for audit (`helm:DEC-003`).
- **Messaging:** Telegram Bot API — no SDK, plain `fetch` (DEC-011)
- **Email:** Gmail SMTP w/ app password (`helm:DEC-005`)
- **Host:** mill-dev (dev). VPS production lands in Phase 5.

## Architecture

```
Telegram → POST /webhook/telegram → Scribbler.append() → 200 OK
                                         │
                                         ▼ (in-process, fire-and-forget)
                                    Purser.handle()
                                         │
                                         ├─ parse (Haiku 4.5)
                                         ├─ outbound confirm (Telegram sendMessage)
                                         ├─ on Y → SQLite tx: insert trip + clear state
                                         └─ persist state to conversation_state row

Async cron → Purser.syncSheet() → append trips.findUnsynced() rows → mark synced
22:00 ET cron → Purser.digest() → Sonnet 4.6 → email to eric@stoffer.net
```

Single Node + Express service runs both Scribbler (intake) and Purser (parse + confirm + file + digest) in one process. See DEC-007.

## Layout

```
captains-log/
├── bin/server.js        # Express + cron entrypoint; supports --version / -v
├── lib/                 # scribbler, purser (3.3+), parse, sheets, weather, state, telegram, digest
├── config/
│   ├── captains.json    # chat_id → captain lookup
│   ├── boats.json       # boat registry + aliases
│   └── routes.json      # route registry + aliases
├── data/captainslog.db        # SQLite source of truth (DEC-012, gitignored)
├── raw/YYYY-MM-DD.log         # append-only message archive (DEC-003, gitignored)
├── digest/YYYY-MM-DD.html     # nightly digest snapshots (gitignored)
├── PROJECT_PLAN.md            # phases, tasks, estimates (repo root, not docs/)
├── README.md                  # setup + run + prod handoff
└── .env                       # secrets (gitignored — see .env.example)
```

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

## Additional Docs

The `CLAUDE.md` shell's baseline `## Key Docs` table is webapp-shaped. Captain's Log's actual doc set:

| File | Purpose |
|------|---------|
| `README.md` | Setup, run, prod handoff (repo root) |
| `PROJECT_PLAN.md` | Phases, tasks, effort, status (**repo root, not `docs/`**) |
| `docs/SPEC.md` | Spec — what we're building, scope, V1 vs later |
| `docs/DECISIONS.md` | DEC-004/007/008/009/010/011/012 — DEC numbering preserved from helm |
| `helm:docs/DECISIONS.md` | Cross-repo decisions still in helm: DEC-003 (log format), DEC-005 (digest delivery), DEC-006 (Scrawl precedent for DEC-007) |

Baseline docs the shell lists that **don't apply here:** no `docs/BRAND.md` or `docs/USER_STORIES.md` (tool project, single internal user). `docs/AGENTS.md`, `docs/RETROSPECTIVES.md`, `docs/VELOCITY_AND_POKER_GUIDE.md`, `docs/CHEATSHEET.md` are present per the baseline.

## Workflow Overrides

The shell's `## Micro Workflow` is webapp-shaped (branch + Playwright + pgTAP + 375px screenshot). Captain's Log is a Node service with no UI and no migration framework — its loop:

1. **Spec it** — poker estimate, acceptance criteria.
2. **Plan it** — summarize files to create/edit, commands to run, approach. Wait for explicit approval before writing code or running commands (see the shell's *Approval Before Action*).
3. **Build it.**
4. **Test what makes sense** — run the script, send a test message via `curl` with `TELEGRAM_SKIP_SECRET=1`, hit `/health`, eyeball a Sheet row. **No mock harness — live exercise on mill-dev.** No Playwright, no pgTAP, no 375px screenshot.
5. **Close out** — `/kill-this` (per task) → `/its-dead` (once at end of window).

## Migration Protocol (project)

**No Supabase** — the shell's Supabase *toolchain*, `safe-supabase.sh` guard (DEC-S009), and Supabase↔Vercel env-var sync are N/A. But the shell's migration *discipline* genuinely applies: storage is **SQLite (`better-sqlite3`), the source of truth (DEC-012)**, and **schema changes go through numbered migrations** — `lib/migrations/NNN_*.sql` applied in order by `lib/migrate.js`, gated on the `user_version` pragma (FK enforcement off during table-rebuild migrations, `foreign_key_check` before commit). Add a new numbered file; never hand-patch an already-applied migration. Google Sheets is an async presentation copy (DEC-009 as amended), not a database.

## Conventions

### Files & layout
- ESM only (`"type": "module"`), single-quote strings
- `bin/` for entrypoints, `lib/` for everything else
- Config in `config/*.json`, secrets in `.env` (gitignored)

### Naming
- Files: `kebab-case`
- Log files: `YYYY-MM-DD.log` UTC (matches Scrawl, DEC-003); ET day-bucketing for cron / digest / Sheet rows
- Telegram chat IDs: stored as strings in `captains.json`; raw log prefixed `telegram:<id>`

### Logs
- Plaintext raw message log: `<ISO-timestamp> | <source>:<sender_id> | <captain> | <body>` per line, one file per UTC day (e.g. `telegram:123456789`)
- Service logs: console + journalctl (in prod). No log library in V1.
- *(There is no separate structured-log file — `lib/structured-log.js` was deleted when SQLite became the source of truth, DEC-012. Structured data lives in the DB.)*

### Storage rules
- `data/` (SQLite DB) is **gitignored** — source of truth per DEC-012, lives on server filesystem
- `raw/`, `digest/` are **gitignored** — live on server filesystem; SQLite is the authoritative record, Sheet is a second copy after async sync
- Service-account JSON files are **gitignored**

## Versioning (project)

SemVer lives in `package.json` (`node bin/server.js --version` prints it); the shell's `/retro` / `/bump-major` bump it + tag on `main` as normal. The `<VersionTag />` component is **N/A** — it's a Next.js/Vercel build-stamp; this is a headless Node service. The version surface is the CLI `--version` flag.

## Workflow Notes (project)

- **Environment-changing commands** (`npm install`, deploys, anything touching the prod VPS): output them for the user to run, don't run them unprompted. Diagnostic commands (running the service, `curl` tests, `/health`) run directly.
- **Bug reports:** `gh issue create`, tag `bug`, add to current or next phase.
- No build step beyond `npm install`; `/kill-this`'s build check is effectively the service starting + the curl smoke test.

## Scope Discipline (project)

Check `docs/SPEC.md` scope (V1 vs later) before adding anything. SMS is a deliberately-deferred later channel (DEC-011) — not V1. If a task feels bigger than its estimate: stop, re-estimate, update `PROJECT_PLAN.md`; if it's a 13, break it down; if it's scope creep, flag and move on.

## Model Selection (project override)

Captain's Log is a lightweight bot and deliberately runs **leaner than the shell's DEC-S027 Opus-default**. Its standing policy:
- **Main CC session: Sonnet by default.** Switch to Opus manually when stuck on something hard. (This overrides the shell's Opus-default — kept deliberately for cost on a small tool.)
- **Agents:** model set in each agent's frontmatter; don't override unless the task warrants it.
- **New agents:** default to Sonnet; add `model: opus` only for architecture-level agents.

⚠️ **Unresolved drift to confirm:** `.claude/agents/architect.md` frontmatter currently pins **`model: fable`**, but this project's prior CLAUDE.md described `@architect` as **Opus**. The migration left the frontmatter file untouched — so `@architect` runs Fable today. Decide which is intended (Sonnet / Opus / Fable) and align the frontmatter; this note is the only thing tracking the discrepancy.
