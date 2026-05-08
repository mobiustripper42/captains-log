---
name: pause-this
description: Mid-session pause. Checks the build, commits WIP, and notes the pause point in the session file. Use when you need to walk away mid-task without closing the session. Follow up with /restart-this to resume.
tools: Read, Edit, Write, Bash, Glob, Grep
---

You are executing a mid-session pause.

## Step 0 — Locate the open session

```
SESSION_FILE=$(grep -l "^status: open" sessions/*.md 2>/dev/null | head -1)
```

If found: NEW MODE — pause note goes in the session file's Context section.
Otherwise check `session-log.md` for `[open]`: LEGACY MODE — pause note goes there.

## Step 1 — Build check (conditional)

Look up the project's build check in `CLAUDE.md §Commands`. Run whatever is defined (e.g. `npm run build`, `cargo build`, `make`). If `CLAUDE.md §Commands` defines no build step, skip silently.

If the build fails: do NOT commit broken code. If you can't fix quickly, note the errors in the pause entry so the next sitting knows where to start.

## Step 2 — Commit WIP

```
git add -A
git commit -m "WIP [phase/task] — [brief description of where things stand]"
```

Prefix with `WIP`. If nothing to commit, skip and say so.

## Step 3 — Note the pause

Append a pause line to the session file (NEW MODE) or open session entry (LEGACY MODE):

```
**[PAUSED HH:MM UTC]** Working on: [task]. Left off at: [specific file/function/step]. Next: [exactly what to do when resuming].
```

Do not close the session. Do not fill `ended:` / `duration:` / `points:`. Status remains `open`.

## Step 4 — Confirm

Tell the user:
- What was committed (or that nothing was)
- What the pause note says
- To run `/restart-this` when ready to resume
