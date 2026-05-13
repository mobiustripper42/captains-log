---
name: its-dead
description: Second half of the end-of-session shutdown. Calculates duration, fills in points, finalizes the per-session file (or legacy session-log.md entry), commits the log, and cleans up branches. Run after /kill-this once the draft looks good. Optional args: natural-language time adjustments, e.g. "/its-dead subtract 30 minutes for time away from desk".
tools: Read, Edit, Write, Bash, Glob, Grep, Agent
---

You are executing the second half of the end-of-session shutdown. The user has reviewed and approved the session log draft from /kill-this.

## Step 0 — Locate the open session

**Try new format first:**
```
SESSION_FILE=$(grep -l "^status: open" sessions/*.md 2>/dev/null | head -1)
```

If found: NEW MODE. Skip to Step 1.

**Otherwise legacy:** look for `[open]` in `session-log.md`:
```
grep -n "\[open\]" session-log.md
```

If found: LEGACY MODE. Note this and proceed; all writes go to `session-log.md` (NOT to a new sessions/ file). The PROJECT_PLAN.md `[x]` updates also still happen (legacy /its-dead behavior).

If neither: stop and ask the user how to proceed.

## Step 1 — Calculate time fields

Three numbers go into the session frontmatter, all in hours, rounded to nearest 5 minutes (0.083 hr). The session splits in two at `pr_opened_at`: everything before is dev work, everything after is review/close-out work.

| Field | Window | Definition |
|-------|--------|------------|
| `wall_clock` | `started` → `ended` | Raw end−start. Includes idle. |
| `dev_time` | `started` → `pr_opened_at` | Active dev time. Wall portion minus inferred breaks within that window. |
| `review_time` | `pr_opened_at` → `ended` | Review + close-out time (addressing code-review findings, drafting log, running `/its-dead`). Wall portion minus inferred breaks within that window. |

Merge happens AFTER `/its-dead` under DEC-012, so it's outside the session — not counted in any of these.

`duration:` remains in the frontmatter as a synonym for `dev_time:` for legacy velocity-table readers — write both to the same value.

### Step 1.0 — End time

```
END_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
```
(Not `git log -1 --format="%cI"` — that's the last commit's time, which can be hours earlier than session close if the user reviewed the /kill-this draft for a while. Wall clock means right now.)

### Step 1.1 — Start time

- NEW MODE: parse `started:` from the session file's YAML frontmatter.
- LEGACY MODE: parse the timestamp from the `## Session N — YYYY-MM-DD HH:MM [open]` heading.

### Step 1.2 — wall_clock

`WALL_CLOCK = (END_UTC − START_UTC) in hours`. Round to nearest 0.083 hr.

### Step 1.3 — Break inference (per window)

A "break" is any gap between consecutive transcript JSONL entries longer than the **15-minute threshold**.

**How to compute:**
1. Read `transcript:` path from the session frontmatter.
2. If the file exists: extract each line's `timestamp` field, sort, and walk pairwise. For each gap > 15 min, classify it by the gap-start timestamp:
   - Gap-start ≤ `pr_opened_at` → dev-window break.
   - Gap-start > `pr_opened_at` → review-window break.
3. If the file is missing or unreadable: skip inference (both window breaks = 0) and note `inference: unavailable` in the Context section.

Multiple JSONL files may exist if the session was compacted — Glob all `*.jsonl` in the transcript directory whose first timestamp is ≥ `started`, concatenate timestamps, sort.

**Manual adjustment from skill args:** if the user passed adjustments (e.g. `/its-dead subtract 30 minutes for time away from desk`), apply on top of inference. Ask which window the adjustment belongs to if not obvious from the user's phrasing; default to dev-window if ambiguous.

### Step 1.4 — dev_time

If `pr_opened_at` is **set** in the frontmatter (normal case — /kill-this ran):
```
dev_window = pr_opened_at − started
dev_time = max(0, dev_window − dev_window_breaks − dev_window_adjustment)
```

If `pr_opened_at` is **blank** (STATE=NO_PR — /kill-this didn't open a PR):
```
dev_time = wall_clock − all_breaks − adjustments
review_time = 0
```
The whole session was effectively dev work — no review phase. Skip Step 1.5.

### Step 1.5 — review_time

```
review_window = ended − pr_opened_at
review_time = max(0, review_window − review_window_breaks − review_window_adjustment)
```

`review_time` captures work done after the PR was opened: addressing `@code-review` findings, drafting the session entry, running `/its-dead`. The user-merge that happens AFTER `/its-dead` is outside this window — DEC-012 puts the merge outside the session entirely.

If `wall_clock < 0.25h`, skip both window inferences — there's not enough span. Set `dev_time = wall_clock - any adjustments`, `review_time = 0`.

If you cannot confidently determine any of these, ask the user. Never guess.

## Step 2 — Tally points

Two sources, in priority order:

**a) Issues closed this session (preferred for phase-rituals projects):**
```
gh pr list --author @me --state merged --search "merged:>$START_DATE" --json number,closingIssuesReferences --limit 20
```
For each PR's closing issues, sum the `points:N` label values. (Skip silently if `gh` unavailable or no Issues are in use.)

**b) PROJECT_PLAN.md task rows (legacy / pre-Phase-rituals projects):**
For each task completed this session, grep its row from `docs/PROJECT_PLAN.md` to read its effort: `grep "| <taskID> " docs/PROJECT_PLAN.md`. Sum.

Use whichever produced a number. If both are empty, mark `points: 0` with a note.

## Step 3 — Finalize the session file

**NEW MODE:** edit the session file:
1. Update frontmatter:
   - `ended: <END_UTC>`
   - `wall_clock: <WALL_CLOCK>` (e.g. `4.5`)
   - `dev_time: <DEV_TIME>` (e.g. `2.5`)
   - `review_time: <REVIEW_TIME>` (blank if not yet known — next /its-alive backfills)
   - `duration: <DEV_TIME>` (synonym for dev_time, kept for legacy readers)
   - `points: <sum>`
   - `status: closed`
2. Replace the body sections with the approved /kill-this draft (Task, Completed, In Progress, Blocked, Next Steps, Context, Code Review).

**LEGACY MODE:** replace the open entry in `session-log.md` with the approved draft using the existing format:
```
## Session N — YYYY-MM-DD HH:MM–HH:MM (Xh Ym)
**Duration:** Xh Ym | **Points:** N
...
```

## Step 4 — Update PROJECT_PLAN.md (legacy only)

**NEW MODE / phase-rituals projects:** **DO NOT** edit PROJECT_PLAN.md. Phase-boundary-only writes — task `[x]` marking happens at `/retro`. The Issue close (via PR's `closes #N`) is the source of truth during the phase.

**LEGACY MODE:** mark any tasks completed this session with `[x]` and append `<!-- completed YYYY-MM-DD -->`.

## Step 5 — Branch cleanup + final push

**Worktree check first:** `git rev-parse --git-dir`. If output contains `/worktrees/`, the worktree path applies (no `checkout main`, no FF-merge). Capture `IS_WORKTREE=1`; otherwise `IS_WORKTREE=0`.

`BRANCH=$(git branch --show-current)`.

**Working branch:** projects using staging-flow (DEC-008) merge PRs into `staging`, not `main`. Resolve `WORKING_BRANCH`:
```
git show-ref --verify --quiet refs/remotes/origin/staging && WORKING_BRANCH=staging || WORKING_BRANCH=main
```
All references to `main` in the STATE=MERGED branches below should use `$WORKING_BRANCH` instead — checkout, pull, push, and the post-merge version bump in Step 5.3 all target wherever the PR was actually merged. Local-ref check (not `git ls-remote`) so offline sessions still resolve correctly — `/its-alive` already fetched at session start.

### Step 5.0 — Resolve PR state (gating)

If `BRANCH=main`, skip this sub-step — `STATE` is irrelevant.

Otherwise resolve `STATE` to exactly one of: `OPEN`, `MERGED`, `CLOSED`, `NO_PR`. Try methods in order; never silently default.

**Method 1 — `gh` CLI:**
```
gh pr view "$BRANCH" --json state,number,title 2>/dev/null
```
- Exit 0 with non-empty JSON: parse `state` (uppercased) → `STATE`. Also capture `number` → `PR_NUMBER` and `title` → `PR_TITLE` (used by Step 5.3 changelog write). Done.
- Exit 0 with empty output: `STATE=NO_PR`. Done.
- `gh: command not found` / auth error / non-zero exit: fall through.

**Method 2 — MCP github fallback:** call `mcp__github__list_pull_requests` with `head: <owner>:$BRANCH, state: all, perPage: 5`.
- A PR is returned: `STATE` = its `state` uppercased; `PR_NUMBER` = `number`; `PR_TITLE` = `title`.
- No PRs returned: `STATE=NO_PR`.

**Method 3 — STOP:** if neither tool is available, STOP. Ask: "Cannot determine PR state for `$BRANCH` — `gh` CLI and `mcp__github__list_pull_requests` both unavailable. Tell me the state (OPEN / MERGED / CLOSED / NO_PR), or abort /its-dead so it can be fixed manually." Wait for the answer. Never default.

Echo the resolved `STATE` (and `PR_NUMBER`, `PR_TITLE` if any) to the user before branching.

### Step 5.1 — Files to commit

Set `FILES` based on mode:
- NEW MODE: `FILES="$SESSION_FILE"`
- LEGACY MODE: `FILES="session-log.md docs/PROJECT_PLAN.md"`

Commit message: `Update session log for session $N`.

### Step 5.2 — Branch on IS_WORKTREE and STATE

**On `main` (no worktree):**
```
git add $FILES
git commit -m "Update session log for session $N"
git push origin main
```
Done.

**Worktree path (`IS_WORKTREE=1`, `WORKTREE_PATH=$(git rev-parse --show-toplevel)`):**
- **STATE=OPEN:** `git add $FILES && git commit -m "..." && git push origin $BRANCH`. Remind user to review/merge. Worktree stays until merged.
- **STATE=MERGED:** same commit + push (log travels with the branch). Tell user: "Worktree cleanup — from main repo: `git worktree remove $WORKTREE_PATH`".
- **STATE=CLOSED:** STOP. Ask: "PR was closed without merging — discard this worktree or keep for archeology?" Wait.
- **STATE=NO_PR:** `git add $FILES && git commit -m "..." && git push origin $BRANCH`. Remind user to open a PR.

**Normal path, non-main (`IS_WORKTREE=0`):**
- **STATE=OPEN:** PR is the merge gate. `git add $FILES && git commit -m "..." && git push origin $BRANCH` so the log lands in the PR. Surface the PR URL. Do NOT FF-merge or delete the branch. Stop.
- **STATE=MERGED:** commit the log directly to the working branch (NOT the task branch — task branch is now orphaned post-merge):
  ```
  git checkout $WORKING_BRANCH
  git pull --ff-only origin $WORKING_BRANCH
  git add $FILES
  git commit -m "Update session log for session $N"
  git push origin $WORKING_BRANCH
  git branch -d "$BRANCH"
  git push origin --delete "$BRANCH"   # no-op if GitHub already deleted on merge
  ```
  If `git branch -d` fails: tell the user, provide `git branch -D` to run manually.
  Then continue to Step 5.3 for the post-merge version bump.
- **STATE=CLOSED:** STOP. Ask: "PR was closed without merging — discard this branch or keep?" Wait.
- **STATE=NO_PR:** legacy DEC-005 cleanup (orphan auto-branches like `claude/<slug>`) — but **first detect protected `$WORKING_BRANCH`** (DEC-012). If `$WORKING_BRANCH` rejects direct push, drop into the PR-creation fallback rather than failing:

  **Protection probe (do this before the cleanup attempt):**
  ```
  PROTECTED=0
  if gh api "repos/{owner}/{repo}/branches/$WORKING_BRANCH/protection" --silent 2>/dev/null; then PROTECTED=1; fi
  ```
  (If `gh` is unavailable, also try MCP `mcp__github__pull_request_read`-adjacent endpoints; if both unavailable, attempt the push and catch a 403 as `PROTECTED=1`.)

  **If `PROTECTED=1` (protected-main fallback):**
  Treat this as if the session ran without a PR by accident. Open one now:
  a. `git add $FILES && git commit -m "Update session log for session $N"` on the current branch.
  b. `git push origin $BRANCH`.
  c. Compose a minimal PR body:
     ```
     ## Summary
     Session $N close-out — PR opened by /its-dead because direct push to `$WORKING_BRANCH` is protected and no PR existed from /kill-this.

     ## Files changed
     <list from git diff --name-only origin/$WORKING_BRANCH..HEAD>
     ```
  d. Try `gh pr create --base "$WORKING_BRANCH" --head "$BRANCH" --title "Session $N close-out" --body "..."`. On non-zero exit, fall back to `mcp__github__create_pull_request`. On both failing, STOP and ask user to open manually.
  e. Capture the resulting PR URL. **Set `STATE=OPEN`** (the protected-main fallback effectively turns this into an OPEN-state close) and continue to Step 6, which will surface the merge instruction.
  f. Do NOT delete the branch — the PR is the merge gate now.
  No version bump on this path — the post-merge bump waits for the next session's /its-alive (which detects the merge during orphan-branch scan and triggers Step 5.3 retroactively) or for `/its-dead` of the merging session.

  **If `PROTECTED=0` (unprotected main — original DEC-005 path):**
  a. `git add $FILES && git commit -m "..."` on the current branch.
  b. `git checkout $WORKING_BRANCH` (or `git checkout -b $WORKING_BRANCH origin/$WORKING_BRANCH` if no local copy yet). `git pull --ff-only origin $WORKING_BRANCH`.
  c. `git merge --ff-only $BRANCH`. If can't FF, surface and ask.
  d. `git branch -d $BRANCH` (lowercase, safe). If fails: surface, do not retry with `-D`.
  e. `git push origin --delete $BRANCH`. Capture success/failure.
  f. If remote delete failed: append `**Orphan branch:** \`$BRANCH\` could not be deleted on origin (best-effort failure). Manual cleanup via GitHub UI required.` to the session file's Context section. Amend the commit.
  g. `git push origin $WORKING_BRANCH`.
  No version bump for NO_PR — it's a legacy cleanup path, not a real merge event.

### Step 5.3 — Version bump (dev projects only, post-merge)

Run only if **all** of these are true:
- `STATE=MERGED` (a PR was actually merged into the working branch this session).
- `IS_WORKTREE=0` (worktree paths don't bump — the log stayed on the worktree branch, not on `$WORKING_BRANCH`).
- `package.json` exists at the repo root (dev-project signal — DEC-007).

Otherwise: skip silently. No echo, no noise.

You are already on `$WORKING_BRANCH` from Step 5.2's MERGED block. Proceed:

a. **Bump patch:**
   ```
   NEW_VERSION=$(npm version patch --no-git-tag-version | tr -d 'v')
   ```
   `--no-git-tag-version` is critical — we control tagging in (d) so each release gets exactly one tag.

b. **Append CHANGELOG entry.** If `CHANGELOG.md` doesn't exist at the repo root, create it with `# Changelog\n\n`. If it exists but doesn't start with the literal `# Changelog\n` header (e.g. setext form `Changelog\n=========`, or `# CHANGELOG`, or notes above the header), STOP and surface to the user — do not guess where to insert. Otherwise prepend a new section after the `# Changelog` header (CHANGELOG entries are reverse-chronological, newest at top):
   ```
   ## [<NEW_VERSION>] - <YYYY-MM-DD>
   - PR #<PR_NUMBER>: <PR_TITLE>
   ```
   Use the `PR_NUMBER` and `PR_TITLE` captured in Step 5.0. If they were not captured (e.g. user supplied STATE manually under Method 3), prompt: "What was the merged PR number and title for the CHANGELOG entry?" Wait for input; never invent.

c. **Stage + commit:**
   ```
   git add package.json CHANGELOG.md
   [ -f package-lock.json ] && git add package-lock.json
   git commit -m "Bump version to v$NEW_VERSION"
   ```
   `package-lock.json` is staged conditionally — some node projects don't commit it.

d. **Tag (main only):** tags only ever appear on `main` (DEC-007). If `$WORKING_BRANCH = main`:
   ```
   git tag "v$NEW_VERSION"
   ```
   If `$WORKING_BRANCH = staging`: skip the tag — `/promote-staging` will tag when promoting to main.

e. **Push:**
   ```
   git push origin "$WORKING_BRANCH"
   ```
   If a tag was created in (d), also: `git push origin "v$NEW_VERSION"`.

f. **Echo:** `Version bumped: v<previous> → v<NEW_VERSION>` (and `tag: v<NEW_VERSION>` if main).

## Step 6 — Closing summary

The summary must be **conditional on the resolved `STATE`** — never report a flat "Session N closed" when there's still an action waiting. The user reads this line and walks away; if a PR is open they'll forget it sat there.

**STATE=OPEN (most common on protected-main PR-flow projects):**
```
Session <N> closed. Wall: <wall_clock>h | Dev: <dev_time>h | Pts: <N>.
⚠ PR #<X> is OPEN — merge to ship:
    gh pr merge <X> --merge --delete-branch
or via GitHub UI. Branch `$BRANCH` lives until merged. Review time fills in next /its-alive.
```

**STATE=MERGED:**
```
Session <N> closed. Wall: <wall_clock>h | Dev: <dev_time>h | Review: <review_time>h | Pts: <N>.
PR #<X> merged. Branch cleaned. Version bumped: v<previous> → v<NEW_VERSION>.
```
Drop the version-bump line if Step 5.3 skipped (non-dev project, etc.).

**STATE=NO_PR (legacy DEC-005 direct-push to unprotected main):**
```
Session <N> closed. Wall: <wall_clock>h | Dev: <dev_time>h | Pts: <N>.
Cleaned up `$BRANCH`.
```

**STATE=CLOSED:** the skill already STOPped in Step 5.2 awaiting user direction; no closing summary fires from that path.

If on a PR-flow project and the phase rituals are in use, append: "Phase progress: see `gh issue list --label phase:current --state open` — close out remaining issues, then `/retro` at phase boundary."
