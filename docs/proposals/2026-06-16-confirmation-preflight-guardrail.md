# Tiller proposal — The confirmation as a preflight guardrail (and the recorded override)

**Tiller, 2026-06-16.** One idea about Captain's Log. Draft PR — you're the gate;
merge or close, the idea is the deliverable, not the diff.

---

## The idea

Right now the captain's `Y` is the system's only validation gate, and it validates
the wrong proposition. `formatConfirmation` echoes the parsed fields back as bullets
and asks "reply Y to file." When a tired captain at 9:30pm taps `Y`, they are
attesting *"yes, that's the text I sent"* — a transcription check. What the
Subchapter T record needs is *"yes, that's correct and legal"* — a truth check.
The gap between those two attestations is exactly where a bad number becomes the
permanent regulatory record.

The fix is small because the system **already holds the fact it needs and never reads
it**: `config/boats.json` carries `"capacity": 20` — the COI (certificate of
inspection) passenger limit, the thing 46 CFR 185.504 is about — and zero lines of
code touch it. Wire a deterministic validation pass into the confirmation:

- **passenger_count > the boat's COI capacity** → flag.
- **first_mate resolves to the captain themselves** → flag (manning is two distinct
  people; a captain can't crew as their own mate).
- **passengers = 0 with trip_count > 0** → flag (a parse that lost the count).

On a flag, the confirmation foregrounds it instead of burying it in a bullet:

```
Heads up, Eric:
  ⚠ 22 passengers — over Brewboat's COI limit of 20. Typo, or flagging an overload?

Confirming your log, Eric:
  • Brewboat
  • 4 trips, 2:00pm–8:00pm
  • 22 passengers
  ...
Reply Y to file, or tell me what's wrong.
```

`Y` **still files** — this advises, it never blocks. But here is the part that makes
it a regulatory feature and not just input validation: **when the captain confirms
past a flag, the filed row records the override.** `parse_json` gains a
`confirmed_over_warnings: [...]` field. The difference between

> "captain entered 22 passengers"

and

> "captain entered 22 passengers; system flagged over-COI; captain confirmed anyway"

is the difference between a typo and a deliberately-recorded incident. The second is a
defensible Subchapter T fact. The first is the number that looks bad in an
investigation precisely because nobody can show it was ever questioned. The recorded
override is the single most valuable thing this feature produces.

## Why it's worth it, and why now

The checks are deterministic JS over data already in the repo — no new dependency, no
network on the confirmation hot path, no LLM call. The capacity flag earns its keep on
day one: the *common* case isn't a real overload, it's `22` typed for `12`, and the
captain fixes it the moment they see "over the COI limit of 20." The
`first_mate==captain` flag catches a real manning-record error a captain would
absolutely rubber-stamp past.

Now, because the confirmation flow is being actively built (open-trip work, 3.1a/3.1b,
is the current phase) — the formatter and `routeParsed` are warm, and adding a
`warnings` seam costs one pure module plus a parameter. Bolt it on after the
confirmation framing has set and it's a retrofit of the gate everything files through.

## Why you haven't already — and why this isn't my last pitch again

Two honest reasons it was hiding:

1. **The confirmation was framed as a parse-accuracy check** ("did I understand
   you?"), so all the validation effort went into making Haiku parse well and letting
   the captain correct. Nobody framed it as a *plausibility/compliance* check ("is
   what you said even possible, even legal?"). So `capacity` got put in the config and
   never wired — a loaded chamber.

2. **It rhymes with a thing you already rejected, and that rhyme hid the difference.**
   Last week this engine pitched making the *nightly digest* report compliance gaps
   (#48, closed unmerged). You were right to close it: reporting a violation the
   morning after, when the record is already permanent, is useless. The shared
   through-line is real — this project keeps regulatory facts (the drills index then,
   `capacity` now) that the runtime never consults. But #48 tried to wake that data at
   **report time**, which is too late. This wakes it at **capture time**, the one
   moment the human is still in the loop and the record isn't written yet. Same
   diagnosis, opposite — and correct — point of intervention. That's why this one is
   worth a look where #48 wasn't.

---

## Build handoff

A contained feature; here's the file-by-file a CC session can run in one pass.

### Approach

A pure, host-testable validation function feeds advisory warnings into the existing
confirmation, with **zero new state**. The confirmation already emits a
"⚠ First mate: not provided" nudge, so warn-at-confirm is an established pattern in the
codebase — this generalizes it for semantic-conflict warnings and adds the override
audit trail. Keep the checks deterministic and out of the Haiku prompt: a COI guardrail
an LLM can talk itself out of is not a guardrail, and you could never defend a
non-deterministic compliance check to the Coast Guard. Parser stays creative; gate
stays boring.

### File-by-file

1. **`lib/validate.js`** (new, pure). Export
   `validateParsed(parsed, boatRow, captainName)` → array of
   `{ field, severity, message }`. Implement as small predicates mapped/filtered:
   - `parsed.total_passengers != null && boatRow?.capacity != null && parsed.total_passengers > boatRow.capacity`
     → `{ field: 'passengers', severity: 'warn', message: \`\${n} passengers — over \${boatRow.official_name}'s COI limit of \${cap}. Typo, or flagging an overload?\` }`
   - `parsed.trip_count > 0 && parsed.total_passengers === 0` → zero-pax warn.
   - `first_mate` canonicalizes (reuse `canonicalNameFor` from `lib/crew.js`) to the
     same identity as `captainName` → manning warn.
   - **Do not** add an end<start time check this pass — `trip_start`/`trip_end` are
     free-text Haiku strings (`"2:00pm"`, `"2-ish"`, `"1400"`, null); a half-parser
     that returns "valid" on `"2-ish"` is worse than no check. Defer until/unless
     `parse.js` emits normalized `*_24h` fields (separate task); then it's one more
     predicate. The other three checks are pure integer/string comparisons — no parsing,
     no false positives.
   No file I/O inside `validate.js` — it takes two plain objects + a string. That purity
   is the whole testability win; don't import `rosters.js` into it.

2. **`lib/rosters.js`** — add `boatRowFor(officialName)` returning the resolved boat
   config row (it currently exposes only `boatSlugFor`; same loop, return the row).

3. **`lib/purser.js`**:
   - `formatConfirmation(captainName, parsed, warnings = [])` — new third arg,
     defaulted so every existing call site and test is untouched. Render warnings as a
     `Heads up, <name>:` block at the **top**, after the greeting, before the bullets.
     Leave the existing "First mate: not provided" bullet where it is — it's a
     missing-field nudge, a different animal; don't refactor the whole confirmation to
     merge them.
   - In `routeParsed`, on the trip-confirmation path (the `done`/single-message branch
     that builds `mergedParsed` and calls `formatConfirmation` ~line 332): resolve
     `boatRowFor(mergedParsed.boat)`, compute
     `warnings = validateParsed(mergedParsed, boatRow, captain.name)`, pass them to
     `formatConfirmation`, and **persist them into the saved state**
     (`saveState(db, chatId, { ...existing fields, warnings })`).
   - In `fileTrip`, read `state.warnings`; if non-empty, include
     `confirmed_over_warnings: state.warnings` in the `parse_json` object it already
     builds. That's the recorded override.
   - Scope to trips only — capacity/manning don't apply to drills; leave
     `formatDrillConfirmation` alone.

4. **No new state value.** Warnings ride inside the existing `awaiting_confirmation`
   status and change only the reply text. `Y` files (override recorded); anything else
   re-enters `routeParsed`, which recomputes warnings against the corrected parse **for
   free**. If you find yourself adding an `awaiting_warning_ack` status, back out — you've
   over-built it.

### Gotchas / risks

- **Advisory, never a gate.** Over-capacity is plausibly real (private charter, COI
  change, Haiku misreading a route number as a count). The captain is the authority; a
  confirmation that *refuses* to file just teaches captains to log lower counts. Flag,
  record, file.
- **No rules engine.** Three checks. A registry/DSL/severity-tier system is
  abstraction ahead of need — more surface to test than the checks themselves. The
  "configurable values in config" convention is already satisfied: `capacity` lives in
  `boats.json` and the check reads it. Don't gold-plate it.
- **Unknown-boat path is unchanged** — `boatRow` is null, the capacity predicate skips,
  and the existing `UNKNOWN_BOAT` error flow still fires where it does today.

### Done when

- A trip parsed with passengers over the boat's `capacity` shows the `Heads up` block;
  `Y` still files the row; the filed row's `parse_json` contains
  `confirmed_over_warnings` naming the capacity flag.
- A first_mate that resolves to the captain's own identity is flagged.
- An unknown boat behaves exactly as before (no crash, existing error path).
- `validateParsed` has direct unit tests (pure in/out, no DB, no mocks) covering each
  predicate firing and not-firing.
- A purser test asserts a flagged confirmation still files on `Y` and writes the
  override into `parse_json`.
- Existing test suite stays green (the `warnings` default keeps old call sites intact).

### Bolder horizon (not the first step)

Once the gate exists, it's the seam for a real **preflight checklist** over facts the
system already holds: manning = two distinct rostered crew; last fire/abandon-ship
drill age vs. the Subchapter T cadence (`drills.js` already records them, never reasons
about them); and — after a season of SQLite accretes — per-boat/per-route **anomaly
bands** ("7 trips today; you've logged 7+ only twice all season — right?"). The same
record the gate protects becomes the training data that makes the gate harder to fool
each trip. Build the deterministic seam once; everything rides it. Tier 3 is worthless
on day one by definition — don't build the learner before there's anything to learn
from.

---

*Radar was quiet tonight — the outside-tech watchlist leans offline-sync and
agent-rulesets, and this architecture sidesteps both (Telegram already owns the offline
buffer; the checks are stronger as dumb deterministic JS than as anything LLM- or
framework-shaped). One adjacent find the panel surfaced and I'm noting but not pitching:
Telegram redelivers webhooks on any non-200/timeout, and there's no dedup — a unique
constraint on the update id (`INSERT OR IGNORE`) would close a double-file path that
this feature slightly widens by making the confirmation do more work. Hygiene, not an
idea; worth a one-line migration when convenient.*
