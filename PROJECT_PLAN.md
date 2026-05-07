# Captain's Log — Project Plan

Standalone repo extracted from `helm/captainslog/` (helm Phase 3.1 + 3.2). Spec
and decisions still live in helm (`helm:docs/captains-log-spec.md`,
`helm:docs/DECISIONS.md`) until extracted.

## Estimation Method

Fibonacci scale (2, 3, 5, 8, 13). See `helm:docs/VELOCITY_AND_POKER_GUIDE.md`
for definitions. Tests (or their equivalent — sending a real test message,
checking a real Sheet row) are baked into every task estimate.

**Velocity baseline:** Inherited from helm — not yet established for this
repo. Update after the first 5 sessions on `captains-log`.

---

## Phase 1: Extract from helm

**Goal:** Captain's Log lives in its own repo, builds, and runs `--version`
without crashing. Helm-side `captainslog/` is deleted in a matching follow-up.
**Total:** 6 pts.

| # | Task | Effort | Notes |
|---|------|--------|-------|
| 1.1 | Copy `bin/`, `lib/`, `config/`, `.env.example`, `README.md`, `package.json` from helm verbatim | 2 | Scribbler + Twilio webhook + captain lookup + raw-log + signature validation — everything from helm 3.1 + 3.2. Drop the `captainslog/` path prefix. |
| 1.2 | New `CLAUDE.md` scoped to this repo + new `.gitignore` (no `captainslog/` prefix) + README path scrub (`~/helm/captainslog` → `~/captains-log`) | 2 | Includes the `helm:` doc-reference convention used until spec/DECISIONS extract. |
| 1.3 | Wire `/health` version + `--version`/`-v` CLI flag (read once from `package.json` at startup) | 2 | Verified: `node bin/server.js --version` → `0.1.0`, exit 0. `/health` returns the same value. |
| 1.4 | Helm-side `captainslog/` deletion + `.gitignore` cleanup | — | Lands on the matching helm branch. Tracked here for traceability; not counted in this repo's velocity. |

---

## Phase 2: Purser MVP

**Goal:** Captain texts a trip, Purser parses, asks for confirmation, files to
the Sheet on Y. Carryover from helm Phase 3.3–3.5.
**Total (provisional, not re-pokered post-extract):** 21 pts.

| # | Task | Effort | Notes |
|---|------|--------|-------|
| 2.1 | Purser parse — Haiku 4.5 → structured JSON → SMS confirmation → Y/correction loop | 13 | Core logic from helm 3.3. Handles partial/ambiguous messages, first mate required, emergency drills checkbox, flexible passenger count. 6 input × state combinations × happy/sad/ambiguous paths — drove the bump from 8 → 13 in helm Session 14. |
| 2.2 | Google Sheets write — Purser files row to Sheet on captain Y | 5 | helm 3.4. Schema must match existing Brewboat Form columns exactly. Uses GCP service account per DEC-009. |
| 2.3 | Weather autofill — pull from Open-Meteo by route/location at parse time | 3 | helm 3.5. Captain doesn't provide weather; Purser auto-fills. Open-Meteo is keyless — no secret needed. |

---

## Phase 3: Open-trip workflow + nightly digest + E2E

**Goal:** Multi-message trips (start partial → end complete), nightly HTML
digest email, full live exercise. Carryover from helm Phase 3.6–3.8.
**Total (provisional):** 11 pts.

| # | Task | Effort | Notes |
|---|------|--------|-------|
| 3.1 | Open-trip workflow — start-of-trip partial + end-of-trip completion, state tracking | 5 | helm 3.6. Captain texts at trip start with available info, then at end to complete. Timestamps from SMS; correctable if submitted next day. State persists in `state/<phone>.json` (DEC-010). |
| 3.2 | Nightly digest — HTML summary email to Eric per DEC-005 | 3 | helm 3.7. Total trips by boat, total pax, flagged issues, unconfirmed entries, parse failures. Same delivery pattern as Clark (Gmail SMTP, inline HTML to `eric@stoffer.net`). 22:00 ET via node-cron. |
| 3.3 | End-to-end test — full run on bee-grace via ngrok, real Twilio SMS, real Sheet write | 3 | helm 3.8. No mock harness. At least 2 captains, 3+ days. |

---

## Phase 4: Production deploy

**Goal:** Move off bee-grace + ngrok onto a real VPS with HTTPS, systemd, and
monitoring. Brewboat target: end of May 2026.
**Total (provisional):** 11 pts.

| # | Task | Effort | Notes |
|---|------|--------|-------|
| 4.1 | Provision VPS + base setup | 3 | Ubuntu 24.04 LTS, 2 GB RAM minimum. DigitalOcean (US-region webhook latency) vs Hetzner (~half cost, EU). Decision lands when we cut over. Includes Node 24.x, non-root user, ssh hardening. |
| 4.2 | TLS + reverse proxy | 3 | Real domain on Brewboat, Let's Encrypt via Caddy or nginx. Replaces ngrok in the Twilio webhook URL. |
| 4.3 | systemd unit + env file | 2 | `Restart=on-failure`, `WorkingDirectory=/srv/captainslog`, `EnvironmentFile=/srv/captainslog/.env`. Service-account JSON colocated. |
| 4.4 | Cutover + smoke test | 3 | Swap Twilio webhook → prod URL, send test SMS from each registered captain, verify Sheet write + digest email. Roll back to bee-grace if anything fails — keep ngrok warm for 48 h. |

---

## Decisions referenced (live in helm)

- DEC-003 — Plaintext per-day log format `<ISO-ts> | <field> | …`
- DEC-004 — Twilio toll-free (vs A2P 10DLC)
- DEC-005 — Email digest to `eric@stoffer.net`, Gmail SMTP, inline HTML
- DEC-007 — Single Node service for Scribbler + Purser
- DEC-008 — Anthropic SDK direct, Haiku/Sonnet split
- DEC-009 — Google Sheets via service account (not MCP)
- DEC-010 — Per-captain state as flat JSON, atomic-rename writes
