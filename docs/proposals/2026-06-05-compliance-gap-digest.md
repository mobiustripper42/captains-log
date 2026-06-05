# Tiller proposal — the nightly digest should report what's *missing*, not just what happened

*2026-06-05 · captains-log · drop straight into Claude Code if you want to build it*

## The idea

The whole reason Captain's Log exists as more than a fancier Google Form is DEC-012:
the Sheet is a Form artifact, and the regulatory record USCG Subchapter T actually
wants — drill cadence per 185.420/520/524, passenger counts per 185.504, safety
orientation per 185.506 — needs a relational store the Form can't carry. You built
that store. The `drills` table has the four-type enum baked exactly to the regulation
(`abandon_ship`, `mob`, `fire`, `crew_emergency`), `trips.safety_orientation_given`
is already a column, and there's even a `drills_type_boat_date` index sitting there.
But nothing ever *reads* that index for compliance. Captain's Log is, right now, a
write-only ledger: it records drills beautifully and never once asks "is any boat
overdue?" Add a small `lib/compliance.js` that answers exactly that — latest drill
per (boat × type) vs. a configurable cadence — and feed its output into the nightly
digest you're about to build in Phase 4.1. The digest stops being a backward-looking
diary ("here's what got logged today") and becomes a forward-looking compliance
board: *"Blue Boat — no fire drill logged in 38 days; Subchapter T wants monthly.
Brewboat is current on all four."* Same Sonnet call, same 22:00 email to you, one
extra query.

## Why it's worth it

This is the product thesis from DEC-012 finally doing something. You pivoted the
entire storage layer to SQLite on the argument that the regulatory record is the
deliverable — and then the V1 plan only ever *writes* that record. The leverage is
that every expensive piece already exists: the drill capture flow (3.4), the
type enum that maps 1:1 to the CFR drill list, the index built for cadence lookups,
and — critically — a nightly Sonnet digest that already reaches you and that you
haven't built yet. The cost of folding compliance gaps in *now*, while Phase 4.1 is
still a blank `lib/digest.js`, is one query module plus a prompt section. The cost of
retrofitting it after the digest ships as a diary is a rewrite of the digest's whole
framing. Why now: 4.1 is "not started" in the plan. This is the one moment where the
idea is free.

And it closes the loop the spec keeps gesturing at and walking away from. The
ambiguity/unconfirmed handling already aims the morning-after decision at *you*
("Eric decides next morning whether to chase the captain"). A drill that's overdue
is the same shape — a thing only you can chase — so it belongs in the same digest,
aimed at the same person.

## Why you haven't already

The plan splits drills into "capture" (3.4, in V1) and "reminders / triage"
(walled off to V2 — "no reminders / triage in V1"). The original spec calls it
"monthly reminder to captains who haven't completed them." That framing is the trap:
"reminder" reads as a *notification system aimed at captains* — who to ping, when,
opt-out, snooze, escalation — which is genuinely heavyweight and genuinely a V2
problem. So the cadence logic got filed under that heavy thing and deferred whole.

But you don't need the reminder *system*. You need the compliance *query*, and you
already have a daily channel to the one person who acts on it. Aim the gap report at
you, in the digest you're already sending, and the entire reminder apparatus
evaporates. The wall between "capture in V1" and "cadence in V2" was drawn one box
too early — the query half is a Phase 4 nightly-digest concern, not a V2 captain-UX
concern.

## How to start

1. **`lib/compliance.js`** — one pure, host-testable function (matches the
   `state.test.js` `openDb(':memory:')` pattern): `gaps(db, asOf)` returns, per active
   boat × drill type, the latest `drill_date` and days-overdue against a cadence.
   Put cadence in `config/compliance.json` (e.g. `{ "drill_interval_days": 30 }`),
   not a hardcoded constant — your "configurable values in a lookup, not enums"
   convention. One `SELECT ... GROUP BY boat_slug, drill_type` against the index
   that's already there. Add `safety_orientation_given` rollups later if you want;
   start with drills.
2. **Wire it into Phase 4.1's `lib/digest.js`** as you build it — call `gaps()`,
   hand the result to the Sonnet prompt as a "Compliance" section, and have it
   narrate only the boats with a gap (silence = compliant, so a clean board reads
   clean). That's the whole V1 surface.

Bolder horizon, not the first step: the same `gaps()` query behind a `/status`
owner slash-command (the digest is just its scheduled form), and eventually a
one-command "boarding packet" export when USCG actually steps aboard. Both ride the
exact same function. Build the function once.

---

*Tiller brought one idea. The outside-tech radar stayed quiet tonight — nothing on
the watchlist was load-bearing here, and a marine offline-sync angle is the wrong
tool for a Telegram-delivered bot where the phone is the client. This stands on the
project's own footing.*
