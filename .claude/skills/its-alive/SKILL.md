---
name: its-alive
description: Session start. Stamps the start time, opens a per-session file in `sessions/`, captures the active JSONL transcript path, reads last session context, reads the project plan, and presents a briefing with task recommendation. Waits for confirmation before any work begins.
tools: Read, Edit, Write, Bash, Glob, Grep, Agent
---

You are executing the session start ritual.

## Step 0 — Branch check

**Worktree check first:** run `git rev-parse --git-dir`.
- If the output contains `/worktrees/`: this is a **linked worktree session** (concurrent with another session). Skip the rest of Step 0 — the branch here is intentional. Note "Linked worktree" in the briefing output and continue to Step 1.
- Otherwise: continue.

Run `git fetch origin` to refresh remote state. Capture `BRANCH=$(git branch --show-current)`.

**Concurrent session check:** glob `sessions/*.md` for any file with `status: open` in its YAML frontmatter (`grep -l "^status: open" sessions/*.md 2>/dev/null`). If found:
- Show the user: "Session N is already open (file: <name>). Is this: **(a)** a currently running concurrent session → I'll create a worktree for this new task, or **(b)** a stale/crashed entry → I'll mark abandoned and continue here?"
- Wait for the user's answer.
- If **(b)** (stale): change `status: open` to `status: abandoned` in that session file. Continue.
- If **(a)** (concurrent): ask **"What branch name for this new task?"** Capture as `NEW_BRANCH`.
  - `REPO=$(basename $(git rev-parse --show-toplevel))`
  - `SLUG=${NEW_BRANCH#task/}`
  - `git worktree add ../${REPO}-wt-${SLUG} -b ${NEW_BRANCH}`
  - Tell the user: **"Worktree created at `../${REPO}-wt-${SLUG}`. Open a new CC window pointed there and run /its-alive. You can close this window."**
  - **Stop here** — do not open a session file in the main worktree.

**Branch handling:**
- `task/*` or other intentional feature branch: continue (PR-flow project, DEC-005).
- `claude/*` (CC Desktop / web / mobile auto-branch): accept and continue. The platform pre-cuts this branch when launching a session — `/kill-this` will PR it into `main` (or `staging`) at session end. Do **not** switch to `main` here; the platform's branch is the intended workspace.
- `main`: `git pull --ff-only origin main`. On divergence, show `git log --oneline origin/main..HEAD` and `git log --oneline HEAD..origin/main`, then ask: **"(a) rebase, (b) reset to origin/main, (c) abort?"** Wait for the choice.
- Anything else (manual non-standard branch): if `git status --porcelain` is dirty, stop and ask the user to commit/stash. If clean, ask the user **"Stay on `$BRANCH` or switch to `main`?"** Wait for the choice — don't auto-switch.

### Step 0.5 — Orphan branch + unmerged PR scan

Before stamping time, check for leftover work from prior sessions. The CC platform creates a new `claude/*` branch per session, so previous sessions' branches and PRs stay alive on the remote until explicitly merged or deleted. This is the single biggest source of "I thought that was closed" surprises.

**Resolve `WORKING_BRANCH`** (same logic as `/its-dead` Step 5):
```
git show-ref --verify --quiet refs/remotes/origin/staging && WORKING_BRANCH=staging || WORKING_BRANCH=main
```

**Scan A — remote `claude/*` branches with commits not on `$WORKING_BRANCH`:**
```
git for-each-ref refs/remotes/origin/claude/ --format='%(refname:short)'
```
For each `origin/claude/<slug>` (other than the current branch): `git log --oneline origin/$WORKING_BRANCH..<ref>`. If non-empty, it's a candidate.

**Scan B — open PRs from prior sessions:**
- `gh pr list --state open --base "$WORKING_BRANCH" --json number,title,headRefName,createdAt,updatedAt --limit 20` — or MCP `mcp__github__list_pull_requests` if `gh` is unavailable.

**Cross-reference** the two scans. Three categories surface:
| Category | Definition | Action |
|----------|------------|--------|
| Open-with-PR | Branch has unmerged commits AND an open PR | Tell the user; don't touch. They're "in flight." |
| Orphan-without-PR | Branch has unmerged commits AND no open PR | **Real problem** — work would silently disappear. Surface with prompt: "(a) open a PR now, (b) cherry-pick onto current branch, (c) delete (commits will be lost)?" Wait. |
| Stale-no-commits | Branch exists on remote but no commits ahead of `$WORKING_BRANCH` | Quietly suggest `git push origin --delete <ref>` if more than one such ref exists. |

Also surface any open PR whose `createdAt` is more than 24h old — likely forgotten merges. List with: "⚠ PR #N (`<title>`) has been open since `<createdAt>`. Merge with `gh pr merge N --merge --delete-branch` or close if abandoned."

This step is **advisory only** for in-flight work and **gating** for orphans-without-PR. Don't proceed past it without the user's explicit choice when an orphan is found.

If `gh` and MCP are both unavailable, skip this step silently — log a note in Context. The user can run `/restart-this` or rerun `/its-alive` once those tools come back.

## Step 1 — Stamp the time

```
START_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
DATE_PART=$(date -u +%Y-%m-%d)
TIME_PART=$(date -u +%H%M)
```

Record both — `DATE_PART` and `TIME_PART` go into the filename; `START_UTC` goes into the file's frontmatter.

## Step 2 — Resolve dev identity

```
DEV=$(cat ~/.claude/devname 2>/dev/null || echo "$USER")
```

If `~/.claude/devname` is missing AND `$USER` is empty/unhelpful, prompt the user once and offer to write `~/.claude/devname` for them.

## Step 3 — Derive the slug

Slug rule (in order of precedence):

```
case "$BRANCH" in
  task/*)    SLUG="${BRANCH#task/}" ;;
  feature/*) SLUG="${BRANCH#feature/}" ;;
  claude/*)  SLUG="${BRANCH#claude/}" ;;
  main|master) SLUG="main" ;;
  *) SLUG=$(echo "$BRANCH" | tr '/' '-') ;;
esac
```

**For domain repos with no semantic branch** (or `BRANCH=main` and the project is non-dev): if the user passes a topic via `/its-alive <topic>`, use that as the slug. Otherwise the default `main` is fine.

Sanitize: lowercase, replace any non-`[a-z0-9.-]` with `-`, collapse repeats.

## Step 4 — Determine session number

`SESSION_NUM=$(($(ls sessions/*.md 2>/dev/null | wc -l) + 1))`

If `sessions/` does not exist: this is the first session under the new format. Create the dir: `mkdir -p sessions`. If the project has a legacy `session-log.md` with prior sessions, find the highest old session number and start from N+1 (counting both old and new). Run: `LEGACY_MAX=$(grep -oE "^## Session [0-9]+" session-log.md 2>/dev/null | grep -oE "[0-9]+" | sort -n | tail -1)`. Use `SESSION_NUM=$((${LEGACY_MAX:-0} + $(ls sessions/*.md 2>/dev/null | wc -l) + 1))`.

## Step 5 — Capture the transcript path

Compute the project's JSONL directory path via Bash:

```
echo "$HOME/.claude/projects/$(pwd | tr '/' '-')"
```

Capture stdout as `JSONL_DIR`. The command is structurally simple — variable expansion + a single pipe + echo — and passes the harness validator without prompting (no globs, no `cd`, no output redirection).

Then use the **Glob** tool to find the latest JSONL:
- `path: <JSONL_DIR>`
- `pattern: *.jsonl`

Glob returns absolute paths sorted by modification time, newest first. `TRANSCRIPT = result[0]`.

If the Glob result is empty (no JSONL files in the dir, or the dir doesn't exist), leave `transcript:` empty in the frontmatter — `/read-the-tape` will fall back to "latest JSONL" matching at audit time.

**Why the Glob tool, not Bash:** earlier versions used `ls *.jsonl` directly. Two harness validator rules have flagged that path: tree-sitter-bash can't classify `"$VAR"/*.glob` (drops to confirmation), and a newer rule flags `cd "$VAR" && ls 2>/dev/null` (compound `cd` + output redirection). Each shape was a workaround for the other. Switching to the Glob tool sidesteps every Bash validator entirely — Glob runs through the harness's tool layer, not the shell. The lone Bash call above is small enough that no validator pattern triggers.

## Step 6 — Compose the session filename and write the open entry

```
SESSION_FILE="sessions/${DATE_PART}-${TIME_PART}-${DEV}-${SLUG}.md"
```

Write the file with this content:

```
---
session: <N>
dev: <DEV>
slug: <SLUG>
branch: <BRANCH>
started: <START_UTC>
ended:
wall_clock:
dev_time:
review_time:
duration:
points:
status: open
pr_number:
pr_url:
pr_opened_at:
transcript: <TRANSCRIPT>
---

# Session <N> — <SLUG>

**Task:** [filled at /kill-this]

**Completed:**

**In Progress:**

**Blocked:**

**Next Steps:**

**Context:**

**Code Review:**
```

Then immediately commit + push so the stop hook stays quiet through the briefing:

```
git add "$SESSION_FILE"
git commit -m "Open Session $SESSION_NUM entry"
git push origin "$BRANCH"
```

## Step 7 — Read last session context

Find the most recent CLOSED session file:

```
PREV=$(ls -t sessions/*.md 2>/dev/null | grep -v "$SESSION_FILE" | head -10)
```

For each candidate (newest first), check if `status: closed` is in its frontmatter (`grep "^status: closed"`). The first match is the previous session. If none exist, fall back to reading the top entry of `session-log.md` (legacy archive) for context.

Extract from the previous file:
- **Task** — what they were working on
- **In Progress** — anything half-done
- **Blocked** — anything waiting
- **Next Steps** — exact verbatim
- **Context** — gotchas worth remembering

## Step 8 — Read project state

Grep `docs/PROJECT_PLAN.md` — do not read the whole file:
- Unchecked tasks: `grep "\[ \]" docs/PROJECT_PLAN.md`
- Deferred tasks: `grep "\[~\]" docs/PROJECT_PLAN.md`
- Priority note: `grep "Next session priority" docs/PROJECT_PLAN.md -A 2`
- Current phase: `grep -E "^## Phase " docs/PROJECT_PLAN.md | head -3`
- Velocity: `grep "Velocity baseline" docs/PROJECT_PLAN.md -A 1`

If the project uses Issues for the active phase (post-Phase-rituals rollout), also check active issues:
- `gh issue list --label "phase:current" --state open --json number,title,labels --limit 50` (skip silently if `gh` unavailable or the project doesn't use Issues yet).

## Step 9 — Present briefing

```
Session <N> — <DATE_PART>
Started: <local time> (<UTC time>)
Branch: <BRANCH>
Session file: <SESSION_FILE>
Dev: <DEV>

Last session: [one-line summary]

In Progress: [anything half-done]
Blocked: [anything waiting]
Next Steps from last session: [verbatim or paraphrased]

Recommended task: [task ID + name + why]

[On `main`:] ⚠ First move after confirming: cut the branch — `git checkout -b task/X.Y-description`
[On `task/*`:] Branch already cut: <BRANCH> — good to go.
[Linked worktree:] Linked worktree on <BRANCH> — concurrent session, good to go.
```

Then ask: **"Ready to go? Confirm the task or redirect me."**

Stop here. Do not begin any implementation work until the user confirms.
