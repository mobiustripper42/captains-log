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

## Step 1 — Calculate duration

**End time:** `END_UTC=$(git log -1 --format="%cI")` (most recent commit ISO 8601 timestamp).

**Start time:**
- NEW MODE: parse `started:` from the session file's YAML frontmatter.
- LEGACY MODE: parse the timestamp from the `## Session N — YYYY-MM-DD HH:MM [open]` heading.

Compute `END_UTC - START_UTC` in hours, rounded to nearest 5 minutes (0.083 hr). Apply any time adjustment from skill args (e.g. "subtract 30 minutes" → reduce by 0.5 hr). If you cannot confidently determine duration, ask the user.

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
   - `duration: <hours>` (e.g. `2.5`)
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
- **STATE=NO_PR:** legacy DEC-005 cleanup (orphan auto-branches like `claude/<slug>`):
  a. `git add $FILES && git commit -m "..."` on the current branch.
  b. `git checkout $WORKING_BRANCH` (or `git checkout -b $WORKING_BRANCH origin/$WORKING_BRANCH` if no local copy yet). `git pull --ff-only origin $WORKING_BRANCH`.
  c. `git merge --ff-only $BRANCH`. If can't FF, surface and ask.
  d. `git branch -d $BRANCH` (lowercase, safe). If fails: surface, do not retry with `-D`.
  e. `git push origin --delete $BRANCH`. Capture success/failure.
  f. If remote delete failed: append `**Orphan branch:** \`$BRANCH\` could not be deleted on origin (best-effort failure). Manual cleanup via GitHub UI required.` to the session file's Context section. Amend the commit.
  g. `git push origin $WORKING_BRANCH`.
  No version bump for NO_PR — it's a legacy cleanup path, not a real merge event. (If a project on this path adopts semver, it should also adopt PR flow.)

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

Print a one-line summary:
```
Session <N> closed. Duration: <hours>h. Points: <N>. File: <path>.
```

If on a PR-flow project and the phase rituals are in use, also say: "Phase progress: see `gh issue list --label phase:current --state open` — close out remaining issues, then `/retro` at phase boundary."
