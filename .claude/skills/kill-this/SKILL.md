---
name: kill-this
description: First half of the end-of-session shutdown. Checks the build, commits code changes, runs code review, opens a PR with findings, and shows a draft session log entry for review. Time calculation and point tally happen in /its-dead. Follow up with /its-dead to finalize.
tools: Read, Edit, Write, Bash, Glob, Grep, Agent
---

You are executing the first half of the end-of-session shutdown.

## Step 0 — Capture branch

Run `git branch --show-current` and hold the result as `BRANCH` for all steps below. All file reads below are fresh reads — do not rely on any version of `CLAUDE.md` or `PROJECT_PLAN.md` read earlier in the session (branch switches since session start make those stale).

## Step 1 — Build check (conditional)

Look up the project's build check in `CLAUDE.md §Commands`. Run whatever is defined there (e.g. `npm run build`, `cargo build`, `make`, `supabase db reset`, etc. — whatever the project considers a build verification).

If `CLAUDE.md §Commands` defines no build step (e.g. a markdown-only repo, a domain project with no software build), skip this step silently — no noise.

If the build fails, fix errors before proceeding. Do not commit broken code.

## Step 2 — Commit and push branch

Stage and commit all uncommitted changes with `git add -A`. Write a commit message that:
- Starts with the phase/task (e.g. "Phase 5.5 —")
- Summarizes what was done in plain English
- Ends with `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

If there is nothing to commit, skip the commit and say so.

Then push based on the current branch — **do not open a PR yet**:

**On `main` (DEC-005 solo flow):**
Run `git push origin main`. Push unconditionally — catches any earlier-session unpushed commits so the stop hook stays quiet through `/kill-this` → `/its-dead`. Skip Steps 3 and 4 — no PR needed. Go straight to Step 5.

**On a `task/*`, `claude/<slug>`, or feature branch (PR flow):**
Capture: `BRANCH=$(git branch --show-current)` and `SUBJECT=$(git log -1 --format=%s)`.
Push the branch: `git push -u origin $BRANCH`. Do not open a PR yet — code review runs first.

## Step 3 — Code review

Run the @code-review agent against HEAD (`git diff HEAD~1`). Wait for it to complete. Capture the findings — you'll need them for the PR body and the session log draft.

When addressing code review findings before the PR: Read every file you plan to edit before editing it — including files created by shell commands during the task (e.g. a generator command creates the file initially empty; Read it before Writing to it). Parallel writes fail silently without a prior Read.

## Step 4 — Open PR (feature branches only)

**Resolve PR base:** projects using staging-flow (DEC-008) PR into `staging`, not `main`.
```
git show-ref --verify --quiet refs/remotes/origin/staging && BASE=staging || BASE=main
```
Use `$BASE` for both the merge-order check and the PR creation in Step 4.2.

**Merge-order check:** Run `git diff --name-only $BASE..HEAD` to get changed files. Then run `gh pr list --state open --base "$BASE" --json number,title,headRefName` and for each open PR whose branch is not `$BRANCH`, run `gh pr diff <number> --name-only`. If any file appears in both lists, warn: "⚠ PR #N also touches `<file>` — consider merge order." Advisory only; do not block.

### Step 4.0 — Resolve existing PR state (gating)

Set `EXISTING_PR_STATE` to exactly one of `OPEN`, `MERGED`, `CLOSED`, or `NONE`, and (when a PR exists) `PR_URL`. Try methods in order; never silently default.

**Method 1 — `gh` CLI:**
```
gh pr view "$BRANCH" --json url,state 2>/dev/null
```
- Exit 0 with non-empty JSON: parse `state` (uppercased) and `url`. Done.
- Exit 0 with empty output: `EXISTING_PR_STATE=NONE`. Done.
- `gh: command not found` / auth error / non-zero exit: fall through.

**Method 2 — MCP fallback:** call `mcp__github__list_pull_requests` with `head: <owner>:$BRANCH, state: all, perPage: 5`.
- A PR is returned: `EXISTING_PR_STATE` = its `state` uppercased; `PR_URL` = its `html_url`.
- No PRs returned: `EXISTING_PR_STATE=NONE`.

**Method 3 — STOP:** if neither `gh` nor `mcp__github__list_pull_requests` is available, STOP. Ask: "Cannot determine PR state for `$BRANCH` — `gh` CLI and MCP github tools both unavailable. (a) tell me the URL+state, or (b) skip PR creation and I'll instruct manual open." Wait for the answer. Never default.

Echo the resolved `EXISTING_PR_STATE` (and `PR_URL` if any) before branching.

### Step 4.1 — Branch on EXISTING_PR_STATE

- **OPEN:** capture `PR_URL`, surface it, and skip Step 4.2 (no duplicate). Note in the draft session log Context.
- **MERGED / CLOSED:** unusual — branch was already submitted. Surface: "⚠ Existing PR for `$BRANCH` is `$EXISTING_PR_STATE` ($PR_URL). Open a new PR on top of it? (y/n)" Wait. If yes, proceed to 4.2; if no, skip and note in Context.
- **NONE:** proceed to Step 4.2.

### Step 4.2 — Create the PR

Compose `BODY` with all four sections:

**## Summary**
One-line description of what changed and why.

**## Files changed**
Bulleted list from `git diff --name-only $BASE..HEAD`.

**## Code review**
Paste the findings from Step 3 here. If clean, say "Clean bill of health."

**## Test plan**
Generate this yourself by inspecting `git diff --name-only $BASE..HEAD`. Do NOT copy from the code review findings. Each item must be a step-by-step scenario: navigate to URL → take action → verify result. No vague outcome checklists.

Check each category:
- Any `supabase/migrations/*.sql`? → `- [ ] Run \`supabase db push\`, confirm migration applied without error`
- Any RLS policy or `supabase/tests/` file? → `- [ ] Run \`supabase test db\`, confirm all tests pass`
- Any file under `src/app/`, `src/components/`, or other UI paths? → write a specific scenario per screen: `- [ ] Navigate to [URL] → [action] → verify [expected result]`
- Any new user-facing flow or feature? → write the full end-to-end flow as numbered steps
- Any `tests/*.spec.ts` Playwright file? → `- [ ] Run \`npx playwright test tests/[file] --project=desktop\`, confirm [N] tests pass`

Always include at least one step-by-step scenario. Never leave this section empty, generic ("verify it works"), or as a copy of the code review.

Try creation methods in order; never silently default to "no PR":

**Method 1 — `gh pr create`:**
```
gh pr create --base "$BASE" --head "$BRANCH" --title "$SUBJECT" --body "$BODY"
```
On success (exit 0, URL printed): capture URL. Done.

**Method 2 — MCP fallback:** if `gh` is unavailable or returned a non-zero exit, call `mcp__github__create_pull_request` with `base: $BASE, head: $BRANCH, title: $SUBJECT, body: $BODY`. Capture `html_url`.

**Method 3 — STOP:** if both methods fail, push has already succeeded so the branch is on the remote — surface to the user: "PR creation failed via `gh` and MCP. Branch `$BRANCH` is pushed. Open manually at the GitHub branch URL and paste the body below: ..." then print the body. Note the missing PR in the draft log's Context. Do not pretend the PR exists.

Capture the returned PR URL. Surface it in your response and note it in the draft session log entry's `Context` section.

### Step 4.3 — Record PR anchors in session frontmatter

Write three fields to the open session file's YAML frontmatter so `/its-dead` Step 1.4 and the next `/its-alive` review_time backfill can find them:

```
pr_number: <PR_NUMBER>
pr_url: <PR_URL>
pr_opened_at: <ISO 8601 timestamp of this PR creation>
```

For Method 1 (`gh pr create`): capture the URL from stdout; the `pr_opened_at` is "right now" — use `date -u +%Y-%m-%dT%H:%M:%SZ`.
For Method 2 (MCP): the response body contains `created_at` — use that for `pr_opened_at`.
For Method 3 (manual fallback): leave the three fields blank; the user will fill in or let backfill skip.

**Multi-PR sessions — preserve history before overwrite:**

Before writing, **Read the session file** and inspect the current `pr_number:` value:
- If empty / missing: write the three fields as above. Done.
- If non-empty and equal to the new `$PR_NUMBER` (idempotent re-run): no-op, just confirm.
- If non-empty and DIFFERENT from the new `$PR_NUMBER`: a previous PR existed (likely opened earlier in this session, merged, and now a follow-up PR is being opened). Do not silently overwrite — that loses the CHANGELOG record.
  1. Read the existing `pr_history:` list if present, else initialize to `[]`.
  2. Append an entry preserving the OLD values: `{ number: <old pr_number>, url: <old pr_url>, opened_at: <old pr_opened_at>, merged_at: <old pr_merged_at if present> }`.
  3. Then overwrite `pr_number` / `pr_url` / `pr_opened_at` with the new PR's values — `/its-dead` Step 1.4 (review_time) and Step 5.0 (state resolution) target the NEWEST PR.
  4. Surface to the user: "Session already has PR #<old> recorded — moving it into `pr_history` and pointing primary fields at PR #<new>. /its-dead CHANGELOG enumeration will list both PRs for this version."

If `EXISTING_PR_STATE=OPEN` and Step 4.2 was skipped: still write these fields, capturing them from the existing PR's data (Method 1: `gh pr view "$BRANCH" --json number,url,createdAt`; Method 2: the MCP `list_pull_requests` response already includes `created_at` and `html_url`). The same Read-before-write history check applies.

If `EXISTING_PR_STATE=MERGED`: write `pr_number`, `pr_url`, `pr_opened_at`, AND `pr_merged_at` from the PR's `merged_at`. /its-dead Step 1.4 will compute `review_time` directly without backfill.

## Step 5 — Draft session log entry

Find the open session — try new format first:
```
SESSION_FILE=$(grep -l "^status: open" sessions/*.md 2>/dev/null | head -1)
```

If found: NEW MODE — draft fills the body sections of the session file (Task, Completed, etc.). Frontmatter `ended` / `duration` / `points` stay empty until /its-dead.

Otherwise legacy: draft uses the inline session-log.md format with `[TBD]` placeholders.

Compose the draft but DO NOT write it yet:

**NEW MODE draft (preview only — do not write):**
```
**Task:** What the session was working on
**Completed:**
- Bullet list of what got done (include file paths for significant changes)
- If Issues were closed, list them: `closed #42, #43`
**In Progress:** Anything partially done
**Blocked:** Anything waiting on a decision or external input
**Next Steps:** Exactly what to do when sitting back down (specific enough for cold start)
**Context:** Gotchas, patterns established, things easy to forget
**Code Review:** [findings or "Clean Bill of Health"]
```

**LEGACY MODE draft:**
```
## Session N — YYYY-MM-DD HH:MM–[TBD] ([TBD] hrs)
**Duration:** [TBD] | **Points:** [TBD]
**Task:** ...
**Completed:** ...
**In Progress:** ...
**Blocked:** ...
**Next Steps:** ...
**Context:** ...
**Code Review:** ...
```

Show the draft to the user and ask: **"Does this look right? Any edits before I lock it in? Run /its-dead when ready — pass any time adjustments as args (e.g. /its-dead subtract 30 minutes for time away from desk)."**

Stop here. Do not write anything yet. (Step 2 already pushed work-product. The log write happens in `/its-dead`.)
