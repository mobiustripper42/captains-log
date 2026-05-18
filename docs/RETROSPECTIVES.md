# Retrospectives

## Phase 2 — Storage pivot — 2026-05-18

**Sessions:** 6 (sessions 3–8)
**Points:** 26 shipped / 26 planned (100%) + 3 pts Phase 3 spillover (3.2 in session 8)
**Wall clock:** 35.50 h
**Dev time:** 7.33 h
**Review time:** 0.58 h
**Breaks:** 27.58 h (session 4's 20-hour overnight planning dominates)
**Velocities:**
- Wall: 1.22 h/pt
- Dev: 0.25 h/pt  ← headline forecast (but flattering — see PM read)
- Review: 0.02 h/pt
**PRs:** 27 merged in the phase window (#2–#28, includes 7 auto-sync template PRs)

### Per-session breakdown

| Session | Date       | Wall  | Dev  | Review | Breaks | Points | PRs |
|---------|------------|------:|-----:|-------:|-------:|-------:|---|
| 3       | 2026-05-08 |  3.08 | 2.25 |   0.00 |   0.83 |     13 | (pre-DEC-013) |
| 4       | 2026-05-09 | 20.00 | 1.00 |   0.00 |  19.00 |      0 | DEC-012 pivot session, 0 ship |
| 5       | 2026-05-11 |  0.42 | 0.42 |   0.00 |   0.00 |      3 | (pre-DEC-013) |
| 6       | 2026-05-11 |  4.50 | 0.58 |   0.00 |   3.92 |      5 | (pre-DEC-013) |
| 7       | 2026-05-13 |  3.67 | 0.50 |   0.58 |   2.58 |      2 | #12 |
| 8       | 2026-05-17 |  3.83 | 2.58 |   0.00 |   1.25 |      6 | #17–25 + post-session #26–28 |
| **TOT** |            | **35.50** | **7.33** | **0.58** | **27.58** | **29** | |

### What worked

- the development was way smoother than i expected. this project has been very easy

### What didn't

- claude regularly thinks the human is stupid

### Changes for next phase

- have the human read more closely. i've missed a few things because i'm not paying enough attention

### Scope changes

- **DEC-012 (SQLite as source of truth)** — major mid-phase pivot triggered in session 4. Original Phase 2 was 13 pts (parse FSM only); grew to 26 pts when SQLite work was absorbed (2.2 schema, 2.3 trip CRUD, 2.4 conversation state, 2.5 async Sheet sync). Not drift — re-baseline. DEC-010 (per-captain JSON state) superseded; DEC-009 (Sheets via service account) amended for async path.
- **DEC-014 (orphan sessions branch)** — infrastructure migration completed in session 8 (no points), prior session files moved off main onto `.sessions-worktree/`.
- **3.2 weather autofill (3 pts)** — pulled forward into session 8 alongside Phase 2 closeout. Done.
- **2.5 + 3.2 cut candidates from session 4 plan all survived.** Remaining V1 reserve for June 1 is 3.5 `/feedback` (3 pts).

### PM read

**Pace.** 26 planned, 26 shipped, plus 3 pts of 3.2 spillover — Phase 2 hit its number. The headline 0.25 h/pt dev velocity is real but flattering: 27.58 hours of "breaks" across 35.50 wall-clock hours means dev time is six-and-a-half hours sitting inside a phase that took ten days. Session 4 alone — the 20-hour storage-pivot planning session that shipped zero points — is most of that gap. The pivot was the right call (the Sheet-as-source-of-truth model wouldn't have survived the regulatory record requirement), but it means "0.25 h/pt dev" is not the number to forecast Phase 3 against. Wall clock at 1.22 h/pt is closer to honest. At 22 pts remaining and that ratio, you're looking at ~27 hours of calendar work across 14 days to June 1 — doable, but not the comfortable nine-hour glide path the dev-time number suggests.

**Scope.** Phase 2 ate a major mid-phase pivot (DEC-012) without slipping its point total, which is the rare healthy outcome. Two architectural decisions got formalized (DEC-012 promoted, DEC-010 superseded, DEC-009 amended) and the original 13-pt Phase 2 grew to 26 to absorb the SQLite work. That's not drift, that's a re-baseline. The named cut candidates from session 4 (3.5 `/feedback`, 2.5 Sheet sync, 3.2 weather autofill — 9 pts total) all survived; 2.5 and 3.2 are already done. The remaining lever for June 1 is 3.5 alone, which is three points. Worth knowing now: if Phase 3 starts running over, that's the entire reserve.

**Patterns.** Live ops keeps consuming uncounted hours. Session 8's 1.25 hours of "breaks" included GCP service-account setup, the mill-vs-bee-grace SCP confusion (~30 min), and an .env-exposure incident that forced rotating Anthropic + Telegram keys mid-session. Session 7 had its own version — a stale May-12 service process catching test curls with old code. Both are the same shape: state on the production host drifts from state in Claude's head, and the cost lands as wall-clock, not dev-time. The other recurring beat is bug-discovery-as-feature-find: `filed_to_sheet: false` hardcoded in purser.js with no Sheet write ever implemented (the DEC-012 trigger), and the Sheet append silently doing nothing because `OVERWRITE` insertDataOption hid the bug under a cheerful "synced N/N" log. Both shipped earlier without Eric or Claude noticing. Tests grew 40 → 75 this session in partial response, but the intake layer was untested until PR #22 — most of the bug-find pattern is still ahead of us, not behind us.

**Reaction to the feedback.** "Claude regularly thinks the human is stupid" — fair, and the right complaint to surface before Phase 3 rather than after. The pattern shows up in session logs as over-explanation of obvious steps and pre-emptive defense of choices Eric hasn't questioned. It's a tone calibration problem, and the CLAUDE.md verbosity rules already say not to do it; that they keep getting violated is the issue. The self-directed answer on Phase 3 — "have the human read more closely" — is also fair, but it's load-bearing in a way worth naming: the Approval Before Action workflow only works if both sides actually read. The .env-exposure incident in session 8 is a clean example — Claude shouldn't have Read it, and a closer human read of the proposed plan would have caught it. Both failure modes are real. Splitting responsibility for the fix between them is correct. As for "the development was way smoother than i expected" — noted, and the honest read is that Phases 1 and 2 were architectural-foundation work where Claude is strongest. Phases 3.1b and 3.4b are open-ended prompt tuning. The smoothness curve probably bends from here.

**Forward note for Phase 3.** 22 pts remaining, two of them open-ended prompt-tuning tasks (3.1b at 5 pts, 3.4b at 3 pts) that Phase 2's velocity numbers do not predict at all. Phase 2 was structural — schemas, migrations, sync jobs — where "done" is a row in a table or a green test. 3.1b and 3.4b are "done when the messages feel right," which is a different unit of measurement and historically slower per point. The June 1 beta target is still reachable, but the planning-overhead pattern from session 4 and the live-ops pattern from session 8 both repeat in Phase 3 if uncorrected, and there is no second pivot's worth of slack to absorb them. Recommend treating 3.5 (`/feedback` + `/file`) as the explicit reserve cut from day one of Phase 3 rather than discovering you need it on May 29.
