# Captain's Log — Project Plan

Standalone repo extracted from `helm/captainslog/` (helm Phase 3.1 + 3.2). Spec
lives at `docs/SPEC.md` and decisions at `docs/DECISIONS.md`.

**V1 target:** June 1, 2026 beta with real captains.

## Estimation Method

Fibonacci scale (1, 2, 3, 5, 8, 13). See `helm:docs/VELOCITY_AND_POKER_GUIDE.md`
for definitions. Tests (or their equivalent — sending a real test message,
checking a real Sheet row) are baked into every task estimate.

Estimates come from collaborative poker (both Spink and Claude throw a number,
discuss when they differ, settle together). Solo estimates aren't poker.

**Velocity:** 3 sessions complete, 18 pts shipped (3 + 2 + 13). Sample is too
small and uneven to project from — treat as informational. Update after the
next 3 sessions.

---

## Phase 1: Extract from helm — ✓ shipped

**Goal:** Captain's Log lives in its own repo, builds, and runs `--version`
without crashing. Helm-side `captainslog/` is deleted in a matching follow-up.
**Total:** 9 pts (shipped).

| # | Task | Effort | Status |
|---|------|--------|--------|
| 1.1 | Copy `bin/`, `lib/`, `config/`, `.env.example`, `README.md`, `package.json` from helm verbatim | 2 | ✓ |
| 1.2 | New `CLAUDE.md` scoped to this repo + new `.gitignore` + README path scrub | 2 | ✓ |
| 1.3 | Wire `/health` version + `--version`/`-v` CLI flag | 2 | ✓ |
| 1.4 | Helm-side `captainslog/` deletion + `.gitignore` cleanup | — | ✓ (helm-side) |
| 1.5 | Migrate spec + DECs from helm → `docs/SPEC.md` + `docs/DECISIONS.md` | 3 | ✓ |

---

## Phase 2: Storage pivot

**Goal:** SQLite is the source of truth for trips, drills, and conversation
state. Google Sheets becomes an async presentation target written by a nightly
sync job. `lib/structured-log.js` deleted.

**Why:** Reading the existing Brewboat Sheet schema against 46 CFR Subchapter T
revealed the Sheet schema doesn't match the regulatory record we need (185.504
passenger count, 185.506 safety orientation, drill cadence per 185.420/520/524).
The Sheet is a Google Form artifact. SQLite is free, embedded, and lets us
atomic-tx confirmation + state changes. Pivot triggered Session 4 before any
Sheet write was implemented — `filed_to_sheet: false` was hardcoded in
`lib/purser.js:101`. Decision pending in `DEC-012`.

**Total remaining:** 3 pts (2.1, 2.2, 2.3, 2.4 shipped).

| # | Task | Effort | Status | Notes |
|---|------|--------|--------|-------|
| 2.1 | Parse FSM — Haiku 4.5 → JSON → Y/correction loop | 13 | ✓ | Session 3. Was originally helm 3.3. |
| 2.2 | SQLite + schema + driver + migrations on startup | 3 | ✓ | `lib/db.js` (driver, WAL, tx helper) + `lib/migrate.js` + `lib/migrations/001_init.sql` (8 tables — V1 + V2 baked) + startup hook + tests. |
| 2.3 | Trip CRUD + Purser cutover + crew lookup | 5 | ✓ | `lib/trips.js` (create/findById/findUnsynced/markSynced/update/remove), `config/crew.json` + `lib/crew.js` resolver (case-insensitive + alias, lazy crew-row create), `lib/rosters.js` (shared boats/routes/crew loader + slug helpers), `lib/purser.js` cutover (replace `filed_to_sheet: false` block with SQLite tx, resolve first-mate before write), `lib/migrations/002_photo_urls_check.sql` (table-rebuild + JSON CHECK), `lib/db.js` `CAPTAINSLOG_DB_PATH` env override, `lib/migrate.js` FK-off + `foreign_key_check`, deleted `lib/structured-log.js`. 40/40 tests green. |
| 2.4 | `conversation_state` in SQLite | 2 | ✓ | Session 7 (PR #12). `lib/state.js` rewritten against `better-sqlite3` — sync API, `(db, chatId, data)`, upsert via `INSERT … ON CONFLICT(chat_id) DO UPDATE`. `test/state.test.js` rewritten against `openDb(':memory:')`. 40/40 tests green. |
| 2.5 | Async Sheet sync job | 3 | | `lib/sheets.js`: `google-spreadsheet` v4 + service-account auth, reads `trips.findUnsynced()`, appends rows, marks `sheet_synced_at`. Test/prod via `SHEETS_WORKSHEET_TITLE` env var (same file, different tab). |

---

## Phase 3: V1 capture features

**Goal:** Open-trip workflow, weather autofill, drill capture, and `/feedback`.
The substantive V1 feature work.

**Total:** 22 pts.

| # | Task | Effort | Notes |
|---|------|--------|-------|
| 3.1 | Open-trip workflow (split for honesty) | **8** | Total — see 3.1a + 3.1b. Captain texts at trip start with available info, then at end to complete. |
| 3.1a | Open-trip structural — status transitions, `findActive`, Purser routing, mocked-parse tests | 3 | `open` → `awaiting_confirmation` → `confirmed`. Mock-testable, bounded. |
| 3.1b | Open-trip prompt tuning — "starting / update / done" sub-intent + multi-open arbitration | 5 | Iteration on real captain text. Not unit-testable in advance. Happens once 3.1a is in and traffic flows on mill-dev. |
| 3.2 | Weather autofill via Open-Meteo | 3 | No auth, plain `fetch`. Lat/lon per route in `config/routes.json`, fallback to boat home dock. Same-day in-memory cache. Plumbed into `trips.weather_summary`. |
| 3.3 | Intent classification (trip / drill / unknown) | 3 | Extend Haiku prompt to return `intent` discriminator. Purser dispatch on intent. "I didn't understand" reply for `unknown`. `/feedback` and `/file` slash-commands bypass Haiku entirely. |
| 3.4 | Drill capture (split for honesty) | **5** | Total — see 3.4a + 3.4b. NL capture only — no reminders / triage in V1. |
| 3.4a | Drill structural — `lib/drills.js` insert, Purser drill confirm flow, mocked-parse tests | 2 | Reuses `lib/crew.js` resolver from 2.3 for `crew_present_text`. |
| 3.4b | Drill prompt tuning — `drill_type` extraction + crew name extraction on real captain text | 3 | Same dynamic as 3.1b. |
| 3.5 | `/feedback` + `/file` slash commands | 3 | `/feedback <observation>` → Haiku drafts a GH issue body → store as `pending`, surface draft. `/file` → file via `gh` CLI/REST → mark `filed`. Spink-only access check. Cancel path. |

---

## Phase 4: Digest + E2E

**Goal:** Nightly digest reaches Spink; live exercise on mill-dev across
multiple captains and days proves the system before VPS cutover.

**Total:** 6 pts.

| # | Task | Effort | Notes |
|---|------|--------|-------|
| 4.1 | Nightly digest to Spink (Sonnet 4.6, 22:00 ET cron) | 3 | `lib/digest.js`: SQLite query for today's confirmed trips + drills, Sonnet prompt, HTML format, Gmail SMTP send (DEC-005 path), snapshot to `digest/YYYY-MM-DD.html`. |
| 4.2 | E2E live exercise on mill-dev | 3 | 3+ days, 2+ captains (Spink + at least one other), real Sheet sync, real digest. Reactive bug fixes. The "did we build the right thing" gate. |

---

## Phase 5: Production deploy

**Goal:** Move off mill-dev onto a real VPS with HTTPS, systemd, and a
working webhook URL. Brewboat target: June 1, 2026 beta.

**Total:** 9 pts.

| # | Task | Effort | Notes |
|---|------|--------|-------|
| 5.1 | VPS verification + Node 24 + deploy dir | 1 | Box already provisioned. Verify state, confirm Node 24 present, prep deploy directory. |
| 5.2 | TLS + reverse proxy (Caddy, Let's Encrypt) | 3 | DNS A record on Brewboat, Caddyfile entry, automatic cert issuance, Telegram `setWebhook` to the new URL. |
| 5.3 | systemd unit + env file | 2 | `Restart=on-failure`, env file at `/etc/captainslog/env` (perms 600), `EnvironmentFile=...`, service-account JSON colocated, journald logging via `journalctl -u captainslog`. |
| 5.4 | Cutover + smoke test | 3 | Swap webhook URL from mill-dev to VPS. Each captain sends one trip + one drill. Verify SQLite write + Sheet sync next tick + digest at 22:00 ET. Roll back to mill-dev if anything fails. |

---

## V1 Totals

| Phase | Pts | Status |
|-------|-----|--------|
| 1 — Extract from helm | 9 | ✓ shipped |
| 2 — Storage pivot (2.5 remaining) | 3 | in progress |
| 3 — V1 capture features | 22 | not started |
| 4 — Digest + E2E | 6 | not started |
| 5 — Production deploy | 9 | not started |
| **V1 total remaining** | **40** | |

22 days to June 1 (from 2026-05-10). At ~3 sessions/week, ~9 sessions of
headroom against ~8 sessions of work at 6 pt/session. **No slack.** If anything
slips, candidate cuts (worth 9 pt total): 3.5 `/feedback` → V1.5, 2.5 Sheet
sync → V1.5, 3.2 weather autofill → V1.5. Don't deploy preemptively;
re-evaluate at the Phase 3 boundary.

---

## Decisions referenced

Live in this repo (`docs/DECISIONS.md`):

- DEC-004 — Twilio toll-free (superseded for V1 by DEC-011; provisions retained for SMS-as-concurrent-channel)
- DEC-007 — Single Node service for Scribbler + Purser
- DEC-008 — Anthropic SDK direct, Haiku/Sonnet split
- DEC-009 — Google Sheets via service account (amended by DEC-012 — async sync, not on Purser hot path)
- DEC-010 — Per-captain state as flat JSON (**superseded** by DEC-012)
- DEC-011 — Telegram Bot API as primary V1 channel; SMS deferred
- DEC-012 — SQLite as source of truth for trips, drills, conversation state

Live in `mobiustripper42/helm` (`docs/DECISIONS.md`):

- DEC-003 — Plaintext per-day log format (Scrawl-shared)
- DEC-005 — Email digest via Gmail SMTP, inline HTML (Clark-shared)
