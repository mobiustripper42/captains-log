# Captain's Log — Architectural Decisions

Decisions are numbered DEC-NNN. Numbering is preserved from the helm
`docs/DECISIONS.md` for cross-repo traceability — that's why this file starts
at DEC-004. The gaps live in helm:

- DEC-001 (OpenClaw as agent runtime), DEC-002 (Gemini Flash-Lite primary,
  Haiku fallback), DEC-003 (flat per-day plaintext log files) — helm scope
- DEC-005 (Clark email-digest delivery) — helm scope, but Captain's Log's
  nightly digest reuses the same channel pattern
- DEC-006 (Scrawl as plain Node bot) — helm scope, the precedent DEC-007
  builds on

Migrated from helm to this repo on 2026-05-07.

---

## DEC-004: Twilio toll-free as the SMS provider for Captain's Log

**Decision:** Captain's Log uses a **Twilio toll-free number** (855/844/833/888/800) with Twilio's free toll-free verification. A2P 10DLC is explicitly deferred as a possible future upgrade.

**Why:** At Brewboat's actual volume (2025 = 258 log entries ≈ 1,800 SMS/season), toll-free is cheaper in year 1 *and* year 2+, needs no Brand/Campaign registration (saves $54 one-time + $48/yr in carrier fees), and approval is **1–3 business days** vs **1–3 weeks** for A2P. The tradeoff — an 855 number instead of a local 216 — does not meaningfully hurt an internal operational channel where captains text logs, not call customers.

**Cost comparison at 2025 volume:**

| | Toll-free | A2P 10DLC |
|---|---|---|
| Number monthly | $2/mo | $1/mo |
| Registration / verification | $0 | $54 one-time |
| Monthly carrier fees | $0 | ~$4/mo |
| Per-SMS | ~$0.0075 | ~$0.0083 |
| **Year 1 total** | **~$38** | **~$129** |
| **Year 2+ annual** | **~$38** | **~$75** |
| Approval wait | 1–3 business days | 1–3 weeks |

**Alternatives considered:**
- **Twilio A2P 10DLC** — rejected for V1. Local 216 is nice-to-have but doesn't outweigh the ~$90 year-1 savings and ~3 weeks faster time-to-dogfood. We revisit if volume grows or Brewboat operationalizes local-area-code branding.
- **Bandwidth, Telnyx, Plivo, Sinch, AWS End User Messaging, Vonage** — same toll-free option at each; per-SMS price differences at our volume (<$10/yr) aren't worth switching costs. Twilio docs + onboarding still win.
- **Google Voice** — rejected. No developer API, ToS explicitly prohibits business/automated SMS, carrier filtering is worse than registered commercial numbers.
- **Email-to-SMS carrier gateways** (`@vtext.com`, etc.) — rejected. Carrier-specific, deprecated, hacky; no path to Google Sheets write-back.

**Tradeoff:**
- Captains text an 855/844/etc. number instead of a local one. Less personal, still works for operational use.
- Toll-free max throughput is ~3 SMS/sec (180/min). We are nowhere close at any projected Brewboat volume.
- If volume ever grows past ~50K–100K SMS/year or we go multi-tenant, we port to A2P 10DLC (or to Bandwidth).

**Volume assumption (from 2025 Brewboat booking data, May–October season):**
- **258 log entries** (186 weekend Fri–Sun, 72 weekday). Pulled Session 6 from Eric's prior trip-analysis chat.
- **~7 SMS per entry** realistic weighted average (happy path = 5, one correction = 7, open-trip start+end = 9, open-trip + correction = 11).
- **~10 SMS per entry** for verification application sizing — overstate for carrier headroom.
- **Season volume:** ~1,800 realistic, ~2,580 registered on the verification form.
- **Season cost:** ~$14 SMS + $24 number = **~$38/year**.
- 2024 reference: 440 entries → ~$23/season SMS at toll-free rates. Planning on 2025 per Eric (most recent; reflects current Brewboat operations).

**Revisit if:** Annual SMS volume passes ~50K, Captain's Log goes multi-tenant, toll-free verification is rejected or becomes unreliable, or Brewboat's operational workflow requires a local area code.

---

## DEC-007: Captain's Log runs as a single plain Node service

**Decision:** Both Scribbler (Twilio intake) and Purser (parse + confirm + Sheets file + nightly digest) live in one Express + `node-cron` Node process at `bin/server.js` on bee-grace, under systemd. Not OpenClaw agents.

**Why:** Scribbler is pure plumbing — signature-verify a Twilio POST, look up the sender, append a raw-log line, return TwiML. `helm:DEC-006`'s "no LLM in ingest → plain Node" rationale applies verbatim. Purser does need LLM calls, but it also needs an Express webhook handler, the Twilio REST client for outbound SMS, the Google Sheets API, a weather API client, and a 22:00 ET cron job — none of which OpenClaw helps with, and several of which OpenClaw doesn't currently support (Twilio channel, arbitrary HTTP webhooks). Co-locating Scribbler and Purser in one process avoids IPC for the parse-after-append handoff: the webhook handler appends raw, acks Twilio, then fires-and-forgets a `purser.handle()` call in-process.

**Alternative considered:** Scribbler as plain Node, Purser as an OpenClaw agent. Rejected — splits the captain conversation across two runtimes for no gain, and OpenClaw still doesn't have a Twilio adapter, so Purser would need its own webhook anyway.

**Tradeoff:** Second contradiction of `helm:DEC-001` in the same project (Scrawl was the first per `helm:DEC-006`). At this point, "all agents run on OpenClaw" is closer to "Clark runs on OpenClaw" — Bilge and Tiller still inherit the default when built, but the rule is fading. Also: a Node service crash takes both Scribbler and Purser down simultaneously. Mitigated by `Restart=on-failure` and Twilio's webhook retry semantics; raw log preserves the audit trail even if Purser drops a message.

**Cross-repo scope note:** This decision narrows `helm:DEC-001` further. Captain's Log is the second OpenClaw exception (after Scrawl per `helm:DEC-006`). Clark, Bilge, and Tiller in helm remain on OpenClaw.

**Revisit if:** Captain's Log outgrows a single process (multiple captains × multiple boats × multiple boatyards), or OpenClaw gains a first-class Twilio channel and webhook story.

---

## DEC-008: Captain's Log uses the Anthropic SDK directly; Haiku 4.5 for parse, Sonnet 4.6 for digest; no model fallback in V1

**Decision:** Purser calls Anthropic via `@anthropic-ai/sdk` directly. `claude-haiku-4-5` for parse, correction merging, and the conversational confirmation loop. `claude-sonnet-4-6` for the nightly digest. No automatic provider fallback.

**Why:** Spec budgets ~$1/season — a Haiku number. Parse and correction merges are structured-output tasks (tool-use JSON), where Haiku 4.5 is fast, cheap, and accurate. The nightly digest is one prose-heavy summary per day; same shape as Clark's daily report, which deviated to Sonnet for prose quality (see `helm:DEC-002`). Same logic applies. Going through Anthropic directly skips OpenRouter's added latency and `:free`-tier deprecation churn — Captain's Log is captain-facing and needs predictable behavior.

**Alternative considered:** Keep the `helm:DEC-002` stack (Flash-Lite primary, Haiku fallback). Rejected — Flash-Lite is a generalist; Captain's Log needs reliable structured-output parsing on the captain-facing path, and the cost difference at expected volume (~258 entries × ~7 SMS) is rounding-error against the toll-free messaging fee.

**Tradeoff:** No automatic fallback means an Anthropic outage during a captain conversation surfaces as a "system busy" reply asking the captain to retry or use the Google Form. We accept this for V1 — the failure mode is loud and recoverable, and adding cross-provider fallback would multiply prompt-engineering surface for a corner case.

**Cross-repo scope note:** Captain's Log does not use the `helm:DEC-002` Flash-Lite/Haiku stack. Bilge and Tiller in helm still inherit `helm:DEC-002` when built.

**Revisit if:** Anthropic outage rate during the season exceeds 0.5% of captain conversations, or cost actuals materially exceed the $1/season budget.

---

## DEC-009: Captain's Log writes to Google Sheets via service-account auth, not MCP

**Decision:** Purser writes rows to the Brewboat Google Sheet via the `google-spreadsheet` npm package authenticated with a Google Cloud service-account JSON key. Not the Google Sheets MCP server.

**Why:** MCP is a Claude-Code-time integration — it lives in the agent's tool surface during interactive sessions. Captain's Log runs as a long-lived systemd service on bee-grace with no Claude-Code process attached. The right primitive is a programmatic auth path: GCP project, Sheets API enabled, service account, JSON key on disk, sheet shared with the service-account email as Editor. `google-spreadsheet` v4 wraps this cleanly.

**Alternative considered:** Stand up an MCP client inside the Node service. Rejected — adds a Claude dependency to a captain-facing critical path and provides no capability we don't already have via the Sheets REST API.

**Tradeoff:** One-time setup overhead (GCP project, key generation, sheet sharing) versus zero-setup MCP. We absorb the setup cost once; runtime is then dependency-free.

**Revisit if:** Helm gains a separate Sheets-MCP use case where the MCP path makes more sense for Claude-Code-time tooling.

---

## DEC-010: Captain conversation state lives in flat per-captain JSON files

**Decision:** Purser maintains per-captain conversation state in `state/<chat_id>.json` (Telegram; SMS will use `state/<phone>.json` when added), written via atomic rename (`*.tmp` → final). Each file has at most two top-level keys: `open_trip` (a captain's start-of-trip partial awaiting trip-end completion) and `pending_confirmation` (a parsed structured entry awaiting captain "Y" or correction). Either is null when absent. The `state/` directory is gitignored.

**Why:** State must survive process restarts (the systemd unit may bounce mid-conversation), but the volume is trivial — at peak, one row per active captain. Atomic rename handles the burst-message race. Flat JSON matches `helm:DEC-003`'s "flat files until proven insufficient" ethos and stays consistent with how the rest of helm stores data. SQLite is overkill at this scale and adds an operational dependency. In-memory loses on restart. Re-deriving from the raw log doesn't work — the parsed-but-unconfirmed structured object isn't in raw log (only captain words are).

**Alternative considered:** SQLite. Rejected — too much machinery for a one-row-per-captain workload.

**Tradeoff:** Corrupted state file → fall back to "treat this message as a fresh entry." Annoying for the captain (one redundant message), not catastrophic. Raw log preserves the audit trail. The fallback is documented in `lib/state.js` and tested.

**Revisit if:** Captain's Log expands to multi-boatyard with concurrent captains where per-file locking becomes a hotspot, or if a "show me my open trips" feature requires cross-captain queries.

---

## DEC-011: Telegram Bot API as the primary messaging channel (SMS deferred)

**Decision:** Captain's Log uses the Telegram Bot API as its V1 messaging channel. SMS (Twilio toll-free, previously DEC-004) is deferred and planned as a later concurrent channel. When both run simultaneously, a `source` field on each structured entry and Sheet row identifies the origin channel.

**Why:** Toll-free verification (required for reliable outbound SMS at scale) is a multi-week process. Telegram Bot API is free, has no registration queue, works immediately, and has zero per-message cost. The bot webhook pattern is simpler than Twilio's signed-request model. For an internal operational channel where all captains have smartphones, requiring the Telegram app is an acceptable constraint.

**Implementation:** `lib/telegram.js` — `fetch`-based, no SDK. Webhook at `POST /webhook/telegram`. Secret token in `X-Telegram-Bot-Api-Secret-Token` header (skippable with `TELEGRAM_SKIP_SECRET=1` for local curl tests). Captain lookup key in `captains.json` is the Telegram `chat_id` (string). Raw log sender field is prefixed `telegram:<chat_id>` for channel traceability.

**Supersedes:** DEC-004 (Twilio toll-free) for V1. DEC-004 provisions remain valid for when SMS is added as a concurrent channel.

**TODO:** Full rationale and alternatives to be pasted in from Eric's decision notes (pending).

**Revisit if:** Telegram penetration among captains is lower than expected, or SMS becomes operationally necessary before the season starts.
