# Tiller — the regulatory record is one un-backed-up file, and "rebuild from raw" is broken

**Tiller, 2026-06-27.** One idea about Captain's Log. Draft PR — you're the gate; merge or close, the idea is the deliverable, not the diff.

---

## The idea

DEC-012 is the spine of this project: you left the Google Form behind and made SQLite the source of truth *specifically* because the regulatory record USCG Subchapter T wants — relational drills (the four-type enum is cut to 185.420/520/524), `safety_orientation_given` (185.506), passenger counts (185.504), crew relations — can't live in a Form. You built that store. It works. And right now it exists as **exactly one file, on one box, with no off-box copy**, and the safety net everyone assumes is there has quietly rotted away.

Two backstops are supposed to make a lost DB survivable. Both fail, for reasons specific to features you've already shipped:

1. **"Raw is sacred; structured can be rebuilt from the raw log"** (Design Principle 4). This was *true* when it was written — pre-LLM, pre-weather. It is **false today**, broken by two shipped features:
   - **Weather autofill (3.2).** `lib/weather.js` stamps Open-Meteo's `current=` block — the conditions *at parse time* — into `weather_summary`. That reading is gone the next minute; you cannot re-fetch "the weather when Drew texted." Re-parsing raw next year reconstructs every trip with the wrong weather, or none.
   - **The Haiku parse (2.1).** Parsing is non-deterministic and `claude-haiku-4-5` is a moving target. Re-running the raw log through next season's Haiku produces a *different* structured record than the one the captain actually saw and confirmed with `Y`. "Rebuild from raw" doesn't reproduce the filed record — it produces a fresh, unattested reinterpretation.
2. **"The Sheet is a second copy"** (DEC-012's own mitigation). `lib/sheets.js:formatRow` maps a *trip* into the Google Form schema — and the **entire `drills` table is never synced to the Sheet at all**, nor is `safety_orientation_given`, nor the per-trip passenger breakdown, nor any capture-time override record. The Sheet backs up a lossy projection of trips and **zero** of the drill-cadence record — which is the exact record DEC-012 existed to create.

So the full Subchapter T record is irreplaceable and single-homed. DEC-012 says this out loud — "the DB is the only authoritative copy until a Sheet row is synced" — and punts the fix to "the existing host-level backup story." On mill-dev that story is vague; on the Phase 5 VPS it doesn't exist yet, and Phase 5's checklist is all uptime (systemd restart, TLS) and says nothing about durability. Uptime and durability are different failure modes, and the first one's checklist is hiding the second.

**The build is a nightly off-box snapshot — but the shape that makes it worth more than a cron-job `rsync` is this:** make each snapshot a link in a **hash chain**, so the record can prove its own honesty. The hardest question a USCG investigator asks is never "do you have the log" — it's *"did you write that drill entry the day of the drill, or the day before we showed up?"* A live, mutable SQLite file cannot answer that. A chain of nightly snapshots, each recording the SHA-256 of the last, can: the entry was present in a snapshot dated before anyone knew a boarding was coming. That turns a backup into a **legal instrument** at almost no extra surface.

Concretely, two artifacts a night, each playing to a different strength:

- **Encrypted binary snapshot → off-box object storage.** `VACUUM INTO` → gzip → `rclone`/`restic` to a bucket. Byte-exact, the actual restore path. Encrypted because it carries captain PII — which is the reason it must *not* go to a git remote.
- **A PII-free manifest line, append-only, in git.** `date | sha256(snapshot) | per-table row counts | prev_sha256`. No captain data — just hashes, counts, and the model id in play. This is the tamper-evident ledger; because it's text and carries no PII, it's safe to keep in version control, where git's own history hardens it further.

And one heartbeat: the nightly digest (Phase 4.1, which you're about to build) gains a single line — `✓ Backup 02:00, restore-check passed, 1,240 rows` or `⚠ BACKUP STALE — last good snapshot 3 days ago`. A backup that fails silently is worse than none; the digest already reaches the one person who acts on it, so the durability signal rides the channel you're already building.

## Why it's worth it, and why now

The leverage is asymmetric: a one-module feature standing guard over the entire deliverable. Everything else this system does — parse quality, confirmation UX, Sheet sync — is in service of producing the record. If the record evaporates in August because a droplet's disk died, none of the rest mattered. This is the cheapest moment it will ever be: **Phase 5 is not started.** Fold durability into the deploy while the VPS is still a checklist item, and it's one cron beside the digest cron. Bolt it on after the box has been the sole home of three months of live trips, and you're doing data-recovery archaeology instead.

The hash-chain elevation costs almost nothing on top — a SHA-256 and a `prev_hash` field — and it's the difference between "I have a backup" and "I can prove to the Coast Guard that this record is contemporaneous and unaltered." For a compliance tool, that second sentence *is* the product.

## Why you haven't already — the honest reason it was hiding

1. **Principle 4 was true when written, and nobody re-read it when it stopped being true.** It's load-bearing belief — "the raw log is the backstop, structured is disposable" — and it predates the two features (weather, Haiku parse) that silently converted the structured record from *rebuildable* to *irreplaceable*. Shipped features don't usually circle back to re-audit a design principle three docs away, so the backstop became a ghost: still cited, no longer real. That ghost is exactly why a backup never felt urgent — why back up what you believe you can regenerate?
2. **DEC-012 named the risk and filed it under "later."** "Host-level backup story" is the kind of phrase that closes a decision without solving it. On a single dev box that never bit, so it stayed closed. Phase 5 is the moment it goes live, and Phase 5's framing is "stay up" (systemd, restart-on-failure), not "survive the disk" — so the one checklist you'll actually run past doesn't have a line for this.

This is a third, distinct concern from the two prior pitches here, not a re-skin: **#48** (closed) reported compliance gaps at *report* time; **#55** (open) validates at *capture* time; this protects the *record itself*, at rest. Same through-line — the project keeps regulatory facts the runtime under-serves — but a different verb: not detect, not validate, **preserve, and prove.**

---

## Build handoff

A contained feature: one new lib module, one config file, one cron, one digest line, plus a manual restore-check script. No migration (backup reads; it doesn't change schema). Scale note: keep it to **one coherent unit** — resist a "backup framework." No pluggable drivers, no KMS, no audit web UI; those are a V2 product and will sink this.

### Approach

- **Two artifacts, two purposes.** The encrypted binary (`VACUUM INTO` → gzip) is the *restore path* — byte-exact, shipped to object storage. A PII-free hash manifest is the *attestation* — text, append-only, lives in git. Don't conflate them; don't make a SQL/NDJSON text dump the system of record (text exports drift from real restore behavior).
- **Module does logic; transport is shelled out.** `lib/snapshot.js` writes a verified snapshot + manifest to a staging dir. A config-named command (`rclone`/`restic`) ships it. This keeps the module host-testable and the transport swappable.
- **Kill the binary-in-git temptation.** A `.db` blob on an orphan branch in *this* repo bloats every clone forever and doesn't diff. The `sessions`-branch pattern (DEC-S014) works because session files are *text* — don't cargo-cult the mechanism past the property that made it safe. The manifest is text and may live in git; the binary may not.
- **The heartbeat rides the digest.** Don't build a separate alerting path; you're building the digest in 4.1. One line, computed from the manifest's newest entry.

### File-by-file

- **`lib/snapshot.js`** (new, the core, host-testable):
  - `async snapshot(db, { stagingDir, dbPath })` → runs `VACUUM INTO` (or `db.backup()`) to a temp `.db`, gzips it, computes `sha256` of the gzip, reads the previous manifest tail for `prev_sha256`, writes/append the manifest line (`{ date, sha256, prev_sha256, rows: { trips, drills, crew, ... }, parse_model }`), and an NDJSON-per-table export beside it. Returns `{ snapshotPath, manifestEntry }`.
  - `restoreCheck(snapshotPath, { expectedSha })` → opens the snapshot read-only, runs `PRAGMA foreign_key_check`, asserts table row counts are non-decreasing vs the prior manifest entry, verifies `sha256` matches. Returns `{ ok, reasons[] }`. This is durability's CI — a daily pass/fail, not a hope.
  - `backupStatus(manifestPath, asOf)` → `{ lastGood, ageHours, stale }` for the digest line. Pure, trivially testable.
- **`config/backup.json`** (new): `{ "staging_dir": "...", "retention_count": 30, "rclone_remote": "captainslog-backups", "schedule": "30 2 * * *", "max_age_hours": 26 }`. Configurable, per the project's "values in config, not hardcoded constants" rule.
- **`bin/server.js`** (edit): one thin `cron.schedule(backupCfg.schedule, ...)` beside the existing Sheet-sync cron — call `snapshot()`, then `restoreCheck()`, then shell the configured transport command; log a one-line result. Gate on a `BACKUP_DISABLED` env like `SHEETS_SYNC_DISABLED`.
- **`scripts/restore-check.mjs`** (new): manual entry point calling `lib/snapshot.js` `restoreCheck()` against the latest local or pulled snapshot. Add `"restore-check": "node scripts/restore-check.mjs"` to `package.json` scripts.
- **`lib/digest.js`** (when you build 4.1): one "Backup" line from `backupStatus()` — narrate only the heartbeat (green one-liner, or a loud `⚠ STALE` if `ageHours > max_age_hours`).
- **`docs/DECISIONS.md`** (edit): a short **DEC-013** recording that Design Principle 4 ("rebuild from raw") is retired as a durability guarantee — weather-current + non-deterministic parse made the structured record irreproducible — and that the DB is therefore the irreplaceable artifact, protected by off-box snapshot + hash-chain attestation. This correction is itself worth the PR even if the code waits.
- **`README.md` / Phase 5 in `PROJECT_PLAN.md`** (edit): add a "Data durability" line to the production handoff so the VPS cutover provisions the bucket + transport credentials, not just TLS/systemd.

### Gotchas / risks

- **PII transport is the one thing to get right.** The binary carries captain names + passenger counts. Encrypt it (`restic` does this natively; `rclone crypt` otherwise) and send it to a private bucket — **never** to a git remote, where an immutable PII history is a `git filter-repo` incident waiting to happen. The git half is hashes-and-counts only. This split is non-negotiable.
- **Silent failure is the default failure.** Online-only (DEC-011) means the box can be offline at 02:00 and the snapshot just… doesn't run. That's why `restoreCheck` + the digest staleness line are load-bearing, not polish. Test the stale path explicitly.
- **WAL consistency.** `VACUUM INTO` and `better-sqlite3`'s `.backup()` are both WAL-safe online; don't `cp` the `.db` file out from under WAL — you'll capture a torn read.
- **Provenance columns are adjacent, not core.** For the attestation to prove *which* model/weather produced a given row, you'd want `parse_model_id` + `weather_fetched_at` on the row. Per the project's migration discipline, fold those into whichever feature next writes those rows (a parse or weather task), not this backup PR — the manifest's repo-wide `parse_model` captures the coarse version in the meantime.

### Done when

- `npm test` covers `snapshot()` and `restoreCheck()` against `openDb(':memory:')` backed to a `tmpdir` file: snapshot → reopen → `foreign_key_check` clean → row counts match → sha matches; and a corrupted/truncated snapshot makes `restoreCheck` return `ok: false`.
- A live run on mill-dev produces a gzipped snapshot + a manifest line whose `prev_sha256` matches the prior night, ships it to the configured remote, and `npm run restore-check` against the pulled-back artifact passes.
- The digest (once 4.1 lands) shows the green heartbeat, and flipping the clock / disabling the cron makes it show `⚠ STALE`.
- DEC-013 is written; Phase 5's handoff names the bucket + transport setup.

### Kickoff

> Implement durable off-box snapshots for the regulatory record (Tiller proposal `docs/proposals/2026-06-27-durable-attestation-snapshot.md`). Start with `lib/snapshot.js`: `snapshot(db, opts)` does `VACUUM INTO` → gzip → sha256 → append a PII-free manifest line (`date | sha256 | row counts | prev_sha256 | parse_model`) plus an NDJSON-per-table export; `restoreCheck(path)` reopens the snapshot, runs `PRAGMA foreign_key_check`, verifies the sha and non-decreasing row counts; `backupStatus(manifest, asOf)` returns staleness for the digest. Add `config/backup.json`, a thin cron in `bin/server.js` beside the Sheet-sync cron that snapshots → restore-checks → shells the configured `rclone`/`restic` transport, and `scripts/restore-check.mjs` + an npm script. Tests against `openDb(':memory:')` backed to a tmpdir, including the corrupted-snapshot failure path. No migration. Keep it one module — no backup framework. Then draft DEC-013 retiring "rebuild from raw" as a durability guarantee.

---

*Radar stayed quiet tonight — the one marine-tagged item (local-first sync) would reverse DEC-011's online-only choice, not back up a single-server DB, so it belongs to Sailbook if anywhere. This stands on the project's own footing.*
