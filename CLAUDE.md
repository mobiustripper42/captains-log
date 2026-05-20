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
- **Storage:** SQLite via `better-sqlite3` is the source of truth (DEC-012) —
  trips, drills, conversation state, crew. Google Sheets (DEC-009 as amended)
  is an async presentation target written by a nightly sync job. Plaintext raw
  message log per day for audit (`helm:DEC-003`).
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
├── data/captainslog.db        # SQLite source of truth (DEC-012, gitignored)
├── raw/YYYY-MM-DD.log         # append-only message archive (DEC-003, gitignored)
├── digest/YYYY-MM-DD.html     # nightly digest snapshots (gitignored)
├── PROJECT_PLAN.md            # phases, tasks, estimates
├── README.md                  # setup + run + prod handoff
└── .env                       # secrets (gitignored — see .env.example)
```

## Key Docs

| File | Purpose |
|------|----------|
| `README.md` | Setup, run, prod handoff |
| `PROJECT_PLAN.md` | Phases, tasks, effort, status |
| `docs/SPEC.md` | Spec — what we're building, scope, V1 vs later |
| `docs/DECISIONS.md` | DEC-004/007/008/009/010/011/012 — DEC numbering preserved from helm |
| `helm:docs/DECISIONS.md` | Cross-repo decisions still in helm: DEC-003 (log format), DEC-005 (digest delivery), DEC-006 (Scrawl precedent for DEC-007) |
| `.claude/seeds-version` | Schema version this project was last installed at. Used by `/pull-seeds` to gate template syncs. |
| `.claude/project-type` | Project type — `webapp` or `tool`. Used by `@sync-config` to gate template files that don't apply to this project's type (DEC-011). Optional. |

## Micro Workflow (every task, no exceptions)

1. **Spec it** — poker estimate, acceptance criteria
2. **Plan it** — summarize files to create/edit, commands to run, approach.
   Wait for explicit approval before writing code or running commands.
3. **Build it** — implement the change
4. **Test what makes sense** — run the script, send a test message via curl with
   `TELEGRAM_SKIP_SECRET=1`, hit `/health`, eyeball a Sheet row. No mock
   harness — live exercise on mill-dev.
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
- `data/` (SQLite DB) is **gitignored** — source of truth per DEC-012, lives on server filesystem
- `raw/`, `digest/` are **gitignored** — live on server filesystem; SQLite is the authoritative record, Sheet is a second copy after async sync
- Service-account JSON files are **gitignored**

## Session Skills

| Skill | When | What |
|-------|------|------|
| `/its-alive` | Session start | Stamp time, ensure `.sessions-worktree/` exists, open per-session file on orphan `sessions` branch, capture transcript, read context, recommend task |
| `/pause-this` | Mid-session break | Build check, commit WIP on the task branch, note pause in session file (on sessions branch) |
| `/restart-this` | Resume from pause | Reload context, continue same session |
| `/kill-this` | **Per task** (DEC-013) | Build check, commit code on task branch, open PR, append `## Task <N>` block to session file. Multiple runs per session — one per task. No time math. |
| `/its-dead` | Session end (once per window) | Stamp `ended:`, tally points, display wall_clock to screen, close session file. No time math, no version bump (those moved to `/retro`). Merge PRs whenever — order doesn't matter. |
| `/start-phase` | Phase boundary (start) | Materialize phase tasks from PROJECT_PLAN.md into Issues with phase:N + points:X labels |
| `/retro` | Phase boundary (end) | Compute per-session wall/dev/review from `started`/`ended`/transcript/PR-timestamps. Aggregate phase velocity. Mark `[x]`, reconcile drift, append to RETROSPECTIVES.md, patch-bump per merged PR + minor-bump at close (dev projects). |
| `/bump-major` | Breaking change | Manually bump major version. CHANGELOG.md entry + tag (on main) or deferred tag (on staging). Dev projects only |
| `/promote-staging` | Ship staging to prod | ff-merge `staging` → `main`, tag the release with current `package.json` version, push both. Staging-flow projects only |
| `/push-seeds` | After workflow improvements | Backport project-side improvements to the seeds templates via @sync-config |
| `/pull-seeds` | After seeds gets new improvements | Pull template changes into this project — schema-version-gated, applied via @sync-config |
| `/read-the-tape` | After a session worth learning from | Audit JSONL transcript, find anti-patterns, propose skill improvements |
| `/doc-consistency-check` | Mid-project, before phase boundaries, or after a session that touched multiple docs | Cross-reference factual claims across `docs/*.md` + root `CLAUDE.md`; flag mismatches + unfilled placeholders. Report-only via @doc-consistency |

**Dev identity:** `~/.claude/devname` (one-line file with your handle). Set once per machine.

**Task model:** PROJECT_PLAN.md is read at planning, written at retro. Untouched mid-phase. Current-phase tasks live as GitHub Issues. The phase ends when its issues close.

## Agent Workflow

| Agent | Model | When | Purpose |
|-------|-------|------|-------|
| @architect | Opus | Before design decisions | Keep architecture coherent |
| @code-review | Sonnet | After every commit (wired into `/kill-this`) | Catch issues early |
| @pm | Sonnet | Start/end of sessions (via skills) | Track progress, flag risks |
| @sync-config | Sonnet | `/push-seeds` and `/pull-seeds` | Classifies template-vs-project diffs, gates structural backports |
| @tape-reader | Sonnet | `/read-the-tape` | Audits session JSONL for workflow anti-patterns |
| @doc-consistency | Sonnet | Via `/doc-consistency-check` skill, or ad-hoc | Cross-reference factual claims across project docs; flag mismatches + unfilled placeholders. Report-only |

## Model Selection

- **Main CC session:** Sonnet by default. Switch to Opus manually when you're stuck on something hard.
- **Agents:** model is set in each agent's frontmatter. Don't override unless the task warrants it.
- **New agents:** default to Sonnet. Add `model: opus` frontmatter only for architecture-level agents.

## PR Workflow (DEC-013 + DEC-014)

- Each **task** gets a branch (`git checkout -b task/X.Y-short-description`). Multiple tasks per session is normal.
- `/kill-this` runs **per task** — opens a PR for the current task branch and appends a `## Task <N>` block to the session file (on the orphan `sessions` branch). Run it as many times as you have tasks.
- `/its-dead` runs **once per Claude window**, at the end. Stamps `ended:`, no other writes to file beyond closing it. No version bump.
- Merge each PR whenever convenient — before next `/kill-this`, after `/its-dead`, days later. Order doesn't matter; `/retro` reads merge timestamps from GitHub.
- The session file is **atomic** after `/its-dead` writes `status: closed`. No skill modifies it again. `/retro` reads but doesn't write.
- Keep no more than 3 open PRs at once. Prefer 1.
- Self-approve unless a stakeholder review is explicitly needed.

## Versioning (DEC-007)

Every dev project carries a SemVer version in `package.json`, mirrored to a git tag (`vX.Y.Z`) on `main`.

**Three triggers (DEC-013 — all bumps run at `/retro`):**
- **Patch:** `/retro` Step 8.2 — one bump + CHANGELOG entry per PR merged during the phase window. Title pulled from GitHub.
- **Minor:** `/retro` Step 8.3 — bumped at phase close after all patches land. CHANGELOG entry summarizes the phase.
- **Major:** `/bump-major` manual. User supplies the breaking-change rationale.

**Tag rule:** tags are only ever applied on `main`. In staging-flow projects, bumps on `staging` are untagged; the tag lands when `/promote-staging` ff-merges to `main`.

**Detection:** these skills check `package.json` exists at the repo root before bumping. If it doesn't (template/markdown-only project), they no-op silently.

### CHANGELOG.md

Auto-maintained by the version-bump skills. Don't edit by hand mid-flow — the skills always prepend after the `# Changelog` header. If the file doesn't exist, the first bump creates it.

Format (Keep-a-Changelog inspired but simpler):
```
# Changelog

## [1.2.3] - 2026-05-05
- PR #42: Add login form

## [1.2.2] - 2026-05-04
- PR #41: Fix dashboard query
```

## Workflow Notes
- **Diagnostic commands** (build, lint, type check, test): run directly — see errors, fix them, don't bother the user.
- **Environment-changing commands** (npm install, migrations, git push, deploys): output these for the user to run.
- **Never rebase a task branch that already has commits on origin.** If main has advanced while a PR branch is open, leave the branch as-is — GitHub's "Update branch" button handles this at merge time. Rebasing rewrites remote history and requires a force-push, which is blocked by policy. Use `git merge --ff-only` only if explicitly asked.
- **JSON parsing in Bash:** Prefer `gh ... --jq '...'` (built-in jq via `gh`) or `jq` over `python3 -c "import json,sys; ..."` one-liners. The python invocations trigger per-pattern permission prompts (each unique argument list is a new allowlist entry), while `gh --jq` runs under the existing `Bash(gh ...)` allowance. For non-`gh` JSON, install/use `jq` directly. Reserve python for cases where the data shape genuinely needs control flow.
- **Bug reports:** Create a GitHub issue (`gh issue create`), tag `bug`, add to current or next phase.

## Approval Before Action

For every task — not just bugs — explain the plan and wait for approval before
doing anything:
1. State what files you'll create or modify and why
2. List commands you'll run, especially commits, pushes, package installs,
   anything touching production
3. Wait for "go", "do it", or equivalent
4. Do not edit files or run commands until approved

## Bug Reports & Questions
When a bug is reported or a question is asked:
1. Explain the cause and your proposed fix
2. Wait for approval before making any changes
3. Do not edit files, run commands, or implement fixes until given the go-ahead

## Scope Discipline

If a task starts feeling bigger than its estimate:
1. Stop and re-estimate
2. Update PROJECT_PLAN.md
3. If it's now a 13, break it down
4. If it's scope creep, flag it and move on

## Tone

Occasional dry humor and sarcasm are welcome. Don't overdo it — one good line
beats three forced ones.

## Verbosity

End-of-turn summaries: one or two sentences. What changed, what's next. Stop there.

Do not recap work I just watched you do. Do not restate the task. Do not explain why an obvious step was obvious. The summary exists so I can re-enter context next session — not so you can demonstrate effort.

If a turn ends with a tidy bullet list followed by three paragraphs of prose, the prose is wrong. Delete it.

Mid-session updates: one sentence per state change. "Found X." "Switching to Y." "Build green." Not a paragraph.

This rule applies double at session end. The session-summary block is the first thing I read next session — make it dense, not voluminous. Five bullets of work and a wall of text means I cannot actually use the summary. Cut the wall.

## Cost and Waste

Never minimize cost. Banned phrasings include but are not limited to:
- "essentially zero"
- "negligible"
- "only a few cents"
- "just X dollars"
- "a rounding error"
- "not a big deal"
- "don't worry about it"

If you find yourself reaching for one, stop. Any synonym counts. If the function of the phrase is to minimize, it's banned.

It's my money. Willing-to-spend is not the same as willing-to-spend-flippantly. Treat every cost as real, including small ones. Same rule for compute, API calls, third-party services, and dependencies — anything that consumes resources I'm paying for.

Waste of any kind — food thrown out, hours lost, a bad batch, a bricked migration, an over-provisioned instance, a wrong dependency pulled — is a fact, not a problem to console me about. When I tell you something had to be discarded, do not reassure me it's fine. Acknowledge it and move on.

If you catch yourself about to write a reassurance, just don't. The fact is the fact.
