# Tiller — the confirmed-trip corpus: instrument the parser you can't currently measure

**Tiller, 2026-07-08.** One idea about Captain's Log. Draft pitch — you're the gate; the idea is the deliverable, not the diff.

---

## The idea

Two of this project's own promises are, today, **unfalsifiable**. The success criteria list "<5% parse failure rate." DEC-008 arms a revisit trigger — "revisit if parse failure rate exceeds threshold" — and notes plainly that `claude-haiku-4-5` *drifts*. Both point at a number. **Nothing in the codebase measures that number.** The spec has a success metric it cannot check and a drift alarm that can never ring. For a *regulatory* record, that's a load-bearing hole.

Here's the part that makes it worth a pitch instead of a shrug: **the captains are already generating the exact asset that fills the hole, and the system throws it away every night.**

Every confirmed trip writes `parse_json` = `{ raw_message, parsed, received_at, source, correction_count }` (`lib/purser.js:fileTrip`). Read that as what it is: a **captain-ratified `(raw text → correct structured parse)` label.** The one person who knows the ground truth looked at the extraction and pressed `Y`. That is the precise thing you would otherwise *pay an annotator* to produce — and it accrues for free, one row per trip, into a column nothing ever reads back. The rows where `correction_count > 0` are rarer and more valuable still: a hard example with a difficulty signal attached — Haiku got it wrong on the first pass and the captain fixed it.

The build is the missing instrument, and it's small because the data already exists:

- **`scoreParse(expected, actual)`** — a pure function. Two JSON objects in, a per-field accuracy map + overall parse-failure-rate out. Deterministic field/enum/date matching. No LLM-as-judge (that would add a *second* thing that drifts).
- **`exportCorpus(db)`** — pure over a DB handle. Confirmed trips → `{ raw_message, parsed }` pairs.
- **An operator-invoked runner** (`npm run eval`) — replays each stored `raw_message` through the *live* `parse.js`, scores it against the captain-confirmed `parsed`, and prints the failure-rate + a per-field table + the worst offenders.

That's v1, and v1 alone closes the DEC-008 gap: for the first time you can say a *number* about your own parser instead of hoping. Per-field turns "Haiku drifts" into "Haiku drifts *on route extraction, 12% of the time*" — an alarm becomes a diagnosis.

The upside beyond measurement (v2/v3, deferred): gate it — a model-version bump that regresses a frozen slice gets caught before it ships; and the flywheel proper — promote the highest-signal corrected examples into a frozen few-shot block on the already-cached system prompt, so future first-pass parses improve at near-flat cost (the prompt prefix is already `cache_control: ephemeral`).

## Why it's worth it, and why *now*

Asymmetric: a small, mostly-pure module that makes the project's headline quality claim *true* instead of aspirational. And the timing is a genuine window, on two counts:

1. **The instrument is the precondition for everything downstream that touches the parse surface.** Voice notes, alias-learning, confidence-gating — each *changes* how well parsing works, and without this you'd ship them blind to whether you just blew past 5%. Build the gauge before you turn the knobs.
2. **You depend on a model you don't control, and the migration is coming.** Haiku 4.5 → the next version → eventual deprecation. Most teams migrate blind and pray. With the corpus, migration answers to a command: *is the new model better or worse for our extraction task?* That asset compounds and costs almost nothing to maintain, because normal operation feeds it. DEC-008's revisit trigger literally fires on a model change — this is the only thing that lets it fire at all.

## Why you haven't already — the honest reason it was hiding

The confirmation loop was framed, correctly, as **UX**: get the captain to a filed record with minimal friction. All the design energy went into Haiku parsing well and letting the captain correct fast. Nobody reframed the same loop as **data collection** — that every `Y` is a gold label and every correction is a labeled error. So `parse_json` got treated as an *audit blob* (store it in case something goes wrong) rather than a *corpus* (the training/eval asset the system emits by operating). And `correction_count` got stored for velocity gut-checks, not as a quality signal. The metric was written into the spec and the drift concern into a DECISION — and then both were left as prose, because the data that would animate them was sitting one `JSON.parse()` away, unread.

This is a **different verb** from the three prior pitches here, not a re-skin. #48 (closed) *reported* compliance gaps at report-time. #55 (open) *validates* at capture-time. #59 (open) *preserves* the record at rest. All three defend the **record**. This one instruments the **engine** that produces the record — *measure*, then *gate*, then *improve*. First time this vein's been touched.

---

## Build handoff

A contained unit a Claude Code session can run in one pass. **No migration** (reads existing `parse_json`). Ship v1; v2/v3 are marked and deferred.

### Approach

Four well-separated pieces, three of them pure and host-testable, one nondeterministic and operator-invoked. The governing rule, and the whole line between "flywheel" and "harness nobody runs": **automatic to measure, gated to change.** The scorer stays boring on purpose — deterministic comparison, never an LLM judge. And the live-Haiku replay is a *measurement*, not a *test*: it never enters `npm test`.

Two corpora, matching the PII boundary:
- **Committed synthetic fixtures** — a small, hand-fabricated/scrubbed set exercising known edge cases. Feeds the *scorer's* CI tests. PII-free, version-controlled, deterministic.
- **Harvested real corpus** — generated on demand by `exportCorpus` from the live DB, written to a `.gitignore`d path, consumed by `npm run eval`, **never committed**. `raw_message` is free-form captain text (names, boats, ports) — it stays local to the box that has the DB. The *exporter* is versioned; its *output* is not.

### File-by-file

1. **`lib/parse-eval.js`** (new, pure — the clean seam).
   - `scoreParse(expected, actual) → { perField: {field: 'match'|'miss'|'both-null'}, failed: bool, failureRate }`. Compare structured fields by normalized string / enum / integer / date equality. Score `notes` loosely or exclude it from the failure verdict (free text isn't a compliance field). "Failed" = any *material* field (boat, route, trip_count, passenger total, first_mate) mismatched. No file I/O, no DB, no clock — two objects in, score out. Slots straight into the `openDb(':memory:')` test style.
   - `exportCorpus(db) → Array<{ raw_message, parsed, correction_count }>`. Pure over the handle: `SELECT parse_json FROM trips WHERE status='confirmed'`, `JSON.parse`, project. Deterministic given a DB.
   - `aggregate(results) → { failureRate, perFieldAccuracy, worst: [...] }`. Pure fold over scored results for the report.
2. **`test/parse-eval.test.js`** (new) — CI tests `scoreParse`/`aggregate` against **`test/fixtures/parse-corpus.sample.jsonl`** (new, committed, synthetic). Deterministic, offline, fast. This is what CI guards; it never calls Haiku.
3. **`scripts/eval-parse.mjs`** (new) + `"eval"` npm script — the operator-invoked runner. `exportCorpus(openDb(process.env.CAPTAINSLOG_DB_PATH))` → for each row, `await parseTrip({ rawText: raw_message })` → `scoreParse` vs stored `parsed` → `aggregate` → print failure-rate, per-field table, worst offenders (raw + diff). Writes the harvested corpus to a gitignored artifact for inspection. **Asserts nothing, gates nothing** — it's a gauge you read, run against a real or snapshot DB (pairs naturally with #59's snapshot if that lands). Honor a `--limit` and a `--field` filter for cheap spot-checks so a full replay isn't the only mode.
4. **`.gitignore`** (edit) — add the harvested-corpus artifact path (e.g. `eval/corpus-*.jsonl`). PII never enters git.
5. **`docs/DECISIONS.md`** (edit) — **DEC-013**: confirmed trips are the ground-truth corpus for the `<5%` criterion and DEC-008's drift trigger; scorer/exporter/aggregator are pure and CI-tested against *synthetic* fixtures; live-Haiku replay is operator-invoked (`npm run eval`), never in `npm test`, never a PR gate; harvested real corpus is a gitignored build artifact, never committed (PII). Worth the entry even if v2/v3 wait.

**v3 (optional, deferred — the flywheel):**
6. **`config/parse-examples.json`** (new) + `lib/parse.js` (`buildSystemPrompt` appends a frozen few-shot block to the already-cached system text). Critical constraint: exemplar selection is **offline and out of the hot path** — a promoter script picks high-signal `correction_count>0` examples, scrubs them, and freezes them into this versioned config for human review. `parse.js` stays a pure function of `(message, config)` and the cached prompt *prefix stays stable*. Do **not** read the DB at request time to select exemplars — that makes `parse.js` impure *and* busts the ephemeral cache on every rotation (paying more for the cache feature by destabilizing its prefix).

**Outside-tech horizon (v2 gate — the one radar cross that's load-bearing):**
7. A **GitHub-triggered Claude Code Routine** wired to the pinned model id. When a PR flips `claude-haiku-4-5-*` to the next version, the Routine replays the **committed synthetic frozen slice** through the candidate model and comments per-field accuracy + failure-rate on the PR. This is the exact event DEC-008 cares about — a model bump — and it's event-driven in a way `node-cron` structurally can't be. It runs the *synthetic* slice (not the PII corpus — a cloud CC session must not pull real captain text), which is precisely why the two-tier corpus split earns its keep. Node-cron on the box can run the *full* harvested corpus nightly once Phase 5 has a host; the PR gate runs the frozen slice. Two cadences, two corpora.

### Gotchas / risks

- **Live Haiku never enters `npm test`.** Nondeterministic + costs money + needs a key. Conflating "regression-test my scoring logic" (deterministic, CI, synthetic fixtures) with "is Haiku still good this week" (nondeterministic, on-demand) is the trap. Two homes.
- **PII is the one thing to get exactly right.** Committed = synthetic only. Real `raw_message` = gitignored artifact, local to the box. Never let the harvested corpus reach a git remote or a cloud Routine.
- **Few-shot must be frozen config, not a runtime DB read.** Keeps `parse.js` pure and the cached prefix stable. The naive "select exemplars at request time" version quietly inverts the cache economics and breaks host-testability.
- **The scorer stays deterministic.** An LLM-as-judge adds cost and a second drift surface — the exact thing you're measuring. Field/enum/date equality, loose on `notes`.
- **Don't over-build.** ~50–200 curated examples as a frozen regression slice is plenty at fishing-boat scale. No labeling UI, no active learning, no dataset lineage, and the words "fine-tune Haiku" are the cliff edge — few-shot into a cached prompt is the entire ceiling.
- **v1 is the whole win.** Stop at the measurement floor and you've already made your own spec claim checkable. v2 (gate) and v3 (flywheel) are compounding upside, not the premise.

### Done when

- `scoreParse`/`aggregate` have direct unit tests against committed synthetic fixtures; `npm test` stays green, fast, and offline (no Haiku call).
- `npm run eval` against a real (or snapshot) DB prints an overall parse-failure-rate number, a per-field accuracy table, and the worst offenders — the first time the `<5%` criterion is an observed number rather than an aspiration.
- The harvested corpus artifact is gitignored; no captain text is committed.
- **DEC-013** written.
- (v3, if pursued) rotating `config/parse-examples.json` measurably lowers the failure-rate on the frozen slice, and `parse.js` still never touches the DB.

### Kickoff (paste to a CC session)

> Read `docs/proposals/2026-07-08-parse-quality-flywheel.md`. Implement v1 of the parse-quality instrument. New pure `lib/parse-eval.js`: `scoreParse(expected, actual)` (per-field + overall parse-failure-rate, deterministic field/enum/date match, loose on `notes`, never an LLM judge), `exportCorpus(db)` (confirmed trips' `parse_json` → `{raw_message, parsed, correction_count}`), and `aggregate(results)`. Unit-test the scorer/aggregator against a new committed **synthetic** fixture `test/fixtures/parse-corpus.sample.jsonl` — `npm test` stays offline, no Haiku. Add `scripts/eval-parse.mjs` + an `"eval"` npm script that replays each stored `raw_message` through live `parse.js`, scores vs the confirmed parse, and prints failure-rate + per-field table + worst offenders; write the harvested corpus to a gitignored path (`eval/corpus-*.jsonl`) — it carries captain PII and must never be committed. No migration. Then draft **DEC-013** recording that confirmed trips are the ground-truth corpus for the `<5%` criterion and DEC-008's drift trigger, that live-Haiku replay is operator-invoked and never in CI, and that the harvested corpus is a gitignored artifact. Defer the few-shot/flywheel and the model-bump PR gate to follow-ups.

---

*Radar was mostly quiet. The one load-bearing cross is the model-version-PR Routine gate (radar: Claude Code Routines) — event-driven regression on the exact DEC-008 trigger, folded into the v2 horizon above. Local-first sync (the marine-tagged item) was considered and rejected: it reverses DEC-011's deliberate online-only choice and this is a server-side SQLite service with no Postgres and no frontend — nothing for it to reconcile. This stands on the project's own footing.*

---

*Generated by Tiller (Claude Code).*
