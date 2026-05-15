---
name: retro
description: Phase-end retrospective. Closes the current phase. Under DEC-013, retro is also where per-session time math runs — for every session in the phase window, it computes wall_clock / dev_time / review_time from `started`, `ended`, the transcript JSONL, and GitHub PR timestamps. Aggregates to phase velocity. Marks PROJECT_PLAN.md `[x]`, reconciles drift, writes RETROSPECTIVES.md, runs version bumps (patch per merged PR + minor at phase close on dev projects), prompts retro notes. Optionally chains into `/start-phase`.
tools: Read, Edit, Write, Bash, Glob, Grep, Agent
---

You are running the phase-end retrospective. Work for this phase is complete (or you've decided to call it done and move scope).

Under DEC-013, this skill **owns all per-session time math** that used to live in `/its-dead` and **all version bumps** that used to live in `/its-dead` (patch per merge) and `/retro` (minor at close). Session files are atomic event logs; retro is where they get turned into numbers.

## Step 0 — Identify the current phase

Find phase N as the **lowest phase number with any open issues** OR (if all closed) the highest phase with `[ ]` rows in PROJECT_PLAN.md but no `[x]` marks yet.

```
for phase in 0 1 2 3 4 5 6 7 8 9; do
  open=$(gh issue list --label "phase:$phase" --state open --json number -q 'length')
  if [ "$open" -gt 0 ]; then echo "Phase $phase has $open open issues"; break; fi
done
```

Confirm: "Run retro for Phase **N**?" Wait.

## Step 1 — Account for all phase issues

```
gh issue list --label "phase:<N>" --state all --json number,title,state,labels --limit 100
```

For each open issue, ask the user: "Move to next phase, leave open, or close as won't-do?"
- **Move:** swap `phase:N` → `phase:N+1`.
- **Leave open:** record in retro.
- **Close as won't-do:** `gh issue close <N> --reason "not planned" --comment "Closed at Phase N retro — descoped."`

## Step 2 — Per-session time math (DEC-013 — moved from `/its-dead`)

Find every session file in the phase window. Phase window = first issue's `createdAt` → last issue's `closedAt` (use `gh issue list --label "phase:<N>" --state all --json createdAt,closedAt`).

For each session file in `.sessions-worktree/sessions/` whose `started:` falls within the phase window (or `started:` < phase_start AND `ended:` is within — span sessions count too):

### Step 2.1 — Read frontmatter

Parse `started`, `ended`, `pr_numbers`, `points`, `transcript` from the session file's YAML frontmatter. Required: `started`, `ended`. If `ended` is empty (session was abandoned or unclosed), skip with a note in the retro.

### Step 2.2 — wall_clock

`wall_clock = (ended − started) in hours, rounded to nearest 0.083h`. Always defined.

### Step 2.3 — Break inference from transcript

If `transcript` is set and the file is readable:
1. Read the JSONL line by line; parse each line's `timestamp` field.
2. Sort timestamps ascending.
3. Walk pairwise. Any gap > 15 min counts as idle.
4. Sum idle minutes within `[started, ended]` to get `total_breaks_hours`.

If the transcript is unreadable or missing, set `total_breaks_hours = 0` and note `inference: transcript-unavailable` in the per-session line of the retro.

### Step 2.4 — PR timestamps from GitHub

For each PR number in `pr_numbers`:
```
gh pr view <N> --json number,createdAt,mergedAt,state
```
Capture `createdAt` (= `pr_opened_at`) and `mergedAt` (= `pr_merged_at`, may be null if still open or closed-without-merge).

If `gh` is unavailable, try `mcp__github__pull_request_read` with `owner`, `repo`, `pullNumber`.

If both unavailable: skip PR-derived math for this session; note `inference: github-unavailable`. The user can rerun retro later.

### Step 2.5 — dev_time and review_time

The session has a dev phase (work happens, possibly across multiple tasks) and review phases (user reviews each PR and merges). Compute:

**`dev_time`** = `(min(all pr.createdAt) − started) − breaks_in_dev_window`
- Window: `started` to the earliest PR opening of the session. (If no PRs, dev window = `started` to `ended`.)
- Breaks: count only break gaps whose start timestamp falls inside this window.

**`review_time`** = sum across all PRs of `(merged_at − created_at) − overlap_with_dev` for each merged PR, capped at `ended − earliest_pr.created_at` if user merged before `/its-dead`.
- If a PR was opened mid-session and merged after `/its-dead`, count only the in-session portion (up to `ended`).
- If a PR was opened and merged in-session, count the full open→merged span.
- Subtract any break gaps inside the review window.

Edge cases:
- No PRs at all: `dev_time = wall_clock - breaks`, `review_time = 0`.
- All PRs merged after `/its-dead`: `review_time = max(0, ended - earliest_pr.created_at - breaks_in_review_window)`.
- A PR was closed without merging: do not count it in `review_time`.

Round all times to nearest 0.083h (5 min). If any number comes out negative due to clock skew, clamp to 0.

### Step 2.6 — Per-session line for the retro

Build one row per session for the RETROSPECTIVES.md table:

```
| Session N | YYYY-MM-DD | wall_clock | dev_time | review_time | breaks | points | PRs |
```

Hold these numbers — they get summed in Step 3.

## Step 3 — Phase metrics

Sum the per-session numbers:
- `phase_wall_clock` = Σ wall_clock
- `phase_dev_time` = Σ dev_time
- `phase_review_time` = Σ review_time
- `phase_breaks` = Σ breaks
- `phase_points` = Σ points (also confirm against `points:N` label sum from closed issues — flag mismatch)
- `phase_sessions` = count

Three velocities:
- `wall_clock / point` — total elapsed including all idle and review
- `dev_time / point` — active dev only (the headline number for forecasting)
- `review_time / point` — review-and-iterate cost per point

## Step 4 — Update PROJECT_PLAN.md

Mark all closed phase tasks `[x]`. For each row:
```
| 1.1 | Task description | 3 | [x] [#42](url) |
```

Reconcile drift: issues with `phase:<N>` labels that don't appear in PROJECT_PLAN.md (added mid-phase). Add rows with status `[x] [#N](url)` and inline note `Added during P<N> retro`.

Update the velocity table at the top:
```
| Phase | Sessions | Points | Wall (h) | Dev (h) | Review (h) | hrs/pt (dev) |
|-------|----------|--------|----------|---------|------------|------------------|
| N     | <count>  | <pts>  | <wall>   | <dev>   | <review>   | <hrs_pt_dev>     |
```

Append one row per phase as they complete.

## Step 5 — Prompt retro notes

Ask three questions, one at a time, capture verbatim:
1. **What worked?**
2. **What didn't?**
3. **What changes for next phase?**

## Step 5.5 — PM retro commentary

Invoke `@pm` (Sonnet) with the full retro context: phase number + name, metrics from Step 3, user's verbatim answers, the per-session table from Step 2.6, closed-issue list with descoped/moved notes, and `docs/RETROSPECTIVES.md` for cross-phase comparison. Let `@pm` read the session files themselves for in-the-trenches detail.

`@pm` returns 3–5 short paragraphs on pace, scope, patterns, a reaction to the user's answers (not a paraphrase), and a forward-looking note.

Show the commentary verbatim:
> **PM read on Phase N:**
>
> <commentary>
>
> Use (a), edit (e), or skip (s)?

- **Use:** carry forward.
- **Edit:** ask "What would you change?" — apply edits, carry forward.
- **Skip:** omit the section from RETROSPECTIVES.md.

## Step 6 — Append to RETROSPECTIVES.md

If `docs/RETROSPECTIVES.md` doesn't exist, create it with `# Retrospectives\n\n`. Append:

```
## Phase <N> — <YYYY-MM-DD>

**Sessions:** <count>
**Points:** <points completed> / <planned> (<%>)
**Wall clock:** <wall>h
**Dev time:** <dev>h
**Review time:** <review>h
**Velocities:**
- Wall: <wall/pt> h/pt
- Dev: <dev/pt> h/pt  ← headline forecast
- Review: <review/pt> h/pt
**Issues:** <created> created, <closed> closed, <moved> moved to Phase <N+1>

### Per-session breakdown
| Session | Date | Wall | Dev | Review | Breaks | Points | PRs |
|---------|------|------|-----|--------|--------|--------|-----|
| <row>   | ...  | ...  | ... | ...    | ...    | ...    | ... |

### What worked
- <verbatim>

### What didn't
- <verbatim>

### Changes for next phase
- <verbatim>

### Scope changes
- [Tasks added mid-phase, moved out, descoped]

### PM read
<commentary from Step 5.5, verbatim or edited — omit section if skipped>
```

## Step 7 — Commit (sessions branch updates are read-only here)

Session files were already finalized by `/its-dead` and are not modified by this skill — DEC-013 atomicity.

```
git add docs/PROJECT_PLAN.md docs/RETROSPECTIVES.md
git commit -m "Phase <N> retro — <points> pts in <dev>h dev (<dev/pt> hrs/pt)"
git push origin <BRANCH>
```

## Step 8 — Version bumps (dev projects only — DEC-013 moved patch bumps from `/its-dead` here)

Run only if `package.json` exists at the repo root (dev-project signal — DEC-007).

Resolve working branch:
```
git show-ref --verify --quiet refs/remotes/origin/staging && WORKING_BRANCH=staging || WORKING_BRANCH=main
```

If `BRANCH != $WORKING_BRANCH`: STOP. Tell the user "Switch to `$WORKING_BRANCH` and re-run /retro." Wait.

### Step 8.1 — Enumerate merged PRs in the phase window

```
gh pr list --state merged --search "merged:>=<phase_start_iso> merged:<=<phase_end_iso>" --json number,title,mergedAt --limit 100
```

Sort by `mergedAt` ascending. Each PR earns one patch bump + one CHANGELOG entry.

### Step 8.2 — Patch-bump per PR

For each PR in order, sequentially:

a. **Bump patch:** `NEW_VERSION=$(npm version patch --no-git-tag-version | tr -d 'v')`.

b. **CHANGELOG entry.** If `CHANGELOG.md` doesn't exist, create with `# Changelog\n\n`. Read it first; if it doesn't start with the literal `# Changelog\n` header, STOP and surface (don't guess where to insert). Prepend after the header:
   ```
   ## [<NEW_VERSION>] - <YYYY-MM-DD>
   - PR #<N>: <title>
   ```

c. **Commit + tag (main only):**
   ```
   git add package.json CHANGELOG.md
   [ -f package-lock.json ] && git add package-lock.json
   git commit -m "Bump version to v<NEW_VERSION> (PR #<N>)"
   ```
   If `$WORKING_BRANCH = main`: `git tag "v<NEW_VERSION>"`. On `staging`: skip the tag — `/promote-staging` tags later.

### Step 8.3 — Minor-bump at phase close

After all PR patches:

a. `NEW_VERSION=$(npm version minor --no-git-tag-version | tr -d 'v')` — zeros the patch (e.g. 1.2.7 → 1.3.0).

b. CHANGELOG entry:
   ```
   ## [<NEW_VERSION>] - <YYYY-MM-DD> — Phase <N>
   - <points> pts shipped across <session count> sessions (<dev/pt> hrs/pt dev)
   - See `docs/RETROSPECTIVES.md` for the full retro
   ```

c. Commit + tag (main only):
   ```
   git add package.json CHANGELOG.md
   [ -f package-lock.json ] && git add package-lock.json
   git commit -m "Phase <N> close — bump to v<NEW_VERSION>"
   ```
   `$WORKING_BRANCH = main` → `git tag "v<NEW_VERSION>"`. `staging` → skip.

### Step 8.4 — Push

```
git push origin "$WORKING_BRANCH"
```
If any tags were created in 8.2 or 8.3: `git push origin --tags`.

Echo: `Phase <N> closed at v<NEW_VERSION>` (and `tagged` if main).

## Step 9 — Offer next phase

"Phase <N+1> is next. Run `/start-phase <N+1>` now or stop here?" Let the user invoke `/start-phase` themselves — don't auto-chain.

## Step 10 — Summary

```
Phase <N> closed.
Points: <P> in <dev>h dev time (<dev/pt> hrs/pt)
Wall: <wall>h | Review: <review>h | Sessions: <count>
Issues: <closed>/<created> closed; <moved> moved to Phase <N+1>
Retro: docs/RETROSPECTIVES.md
Version: v<NEW_VERSION>  (dev projects only; skipped if no package.json)
```

## Notes

- **Session files are read-only here.** Retro reads them; never writes. DEC-013 atomicity.
- **GitHub queries can fail.** If `gh` and MCP are both unavailable, skip the PR-derived numbers, mark them `inference: github-unavailable` in the retro, and tell the user they can rerun retro later. Don't guess.
- **The headline velocity is `dev_time / point`.** Wall-clock velocity is inflated by review-and-merge wait. Review-time velocity is interesting but secondary. Forecast against dev_time.
