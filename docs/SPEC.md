# Captain's Log — Project Spec
**Owner: Eric Stoffer (Brewboat)**
**Date: April 19, 2026** (extracted from helm into this repo on May 7, 2026)
**Target: V1 deployed for 2026 season (May–October), beta by end of May**

---

## What This Is

A Telegram-based trip-logging system for Brewboat captains. Captains send free-form trip summaries to a dedicated Telegram bot after each shift. A parsing agent extracts structured fields, asks the captain to confirm, and writes a row to the existing Brewboat Google Sheet that USCG compliance is already built around. SMS is planned as a later concurrent channel (DEC-011).

Goal: reduce captain friction to as close to zero as possible while producing the same structured log the Google Form produces today.

---

## Design Principles

1. **Telegram first, SMS later.** Telegram Bot API is free, instant, and avoids toll-free verification delays. SMS added as a concurrent channel when operationally needed (DEC-011). A `source` field on each log entry tracks the origin channel.
2. **The existing Google Form keeps working.** Captain's Log is additive, not a migration. Captains who prefer the form use the form. Both write to the same Sheet.
3. **Raw message is always preserved.** Structured row is the "official" log, but the raw message log is the audit trail if anything ever goes wrong.
4. **Two-agent pattern, proven on Scrawl.** One dumb logger captures raw messages. A smart parser extracts structure. Raw is sacred; structured can be rebuilt if the schema changes.
5. **Compliance bar is low (show USCG the spreadsheet) but we build for more.** Operational insight is a real secondary value: VHF issue patterns, passenger trends, equipment flags.
6. **Cloud-hosted production.** Beta on grace, production on a VPS with near-100% uptime. Captains texting in the middle of a trip cannot wait for grace to finish compiling something.
7. **Captain-first UX.** Confirmation within 30 seconds of texting, total round-trip under 1 minute. Captains confirm while details are fresh.
8. **Fast failure recovery.** If parsing gets something wrong, captains correct it in natural language, not by editing fields.

---

## Lexicon

- **Captain's Log** — the system (generalizable name, kept intentionally brand-neutral)
- **Brewboat Captain's Log** — the Brewboat-specific deployment
- **Scribbler** — the dumb message logger (intake side, equivalent to Stupid)
- **Purser** — the smart parsing agent (equivalent to Clark)
- **captains.json** — chat_id-to-captain lookup roster (Telegram chat_id; SMS phone later)
- **boats.json** — boat name/alias/capacity registry
- **routes.json** — valid routes/waterways with aliases
- **raw log** — append-only message archive, captain's verbatim text
- **structured row** — the Google Sheet row Purser produces
- **the Sheet** — existing Brewboat compliance spreadsheet (source of truth)

---

## Architecture

### High level

```
Captain messages bot (Telegram)
     │
     ▼
Telegram Bot API delivers webhook
     │
     ▼ POST /webhook/telegram
Captain's Log gateway (cloud VPS)
     │
     ├─ Look up sender chat_id → captain name (captains.json)
     ├─ Reject if unknown chat_id
     │
     ▼
Scribbler: append raw message to ~/captains-log/raw/YYYY-MM-DD.log
     │
     ▼
Auto-reply: "Got it, [Captain]. Parsing now."
     │
     ▼ (within ~30s)
Purser: parse raw text → structured fields
     │
     ▼
Captain confirmation: "Blue Boat, 4 trips, 49 pax, Cuyahoga, VHF issue. Reply Y to file."
     │
     ▼
Captain replies Y / correction
     │
     ▼ (if correction, re-parse and re-confirm)
Purser writes row to Google Sheet
     │
     ▼
Eric gets nightly digest of all entries filed that day
```

### Directory layout

```
~/captains-log/
├── raw/
│   ├── 2026-06-01.log
│   ├── 2026-06-02.log
│   └── ...
├── structured/
│   ├── 2026-06-01.json    # parsed entries, pre-sheet
│   └── ...
├── config/
│   ├── captains.json
│   ├── boats.json
│   └── routes.json
├── digest/
│   └── 2026-06-01.html    # nightly digest sent to Eric
└── .git/
```

Lives at `github.com/mobiustripper42/captains-log` (private). Extracted from `helm/captainslog/` on 2026-05-07.

---

## Provider Choice: Twilio (toll-free)

**Decision recorded in DEC-004 (2026-04-20, Session 6):** Twilio toll-free number with Twilio's free toll-free verification. A2P 10DLC deferred unless volume grows significantly.

Alternatives compared:

| Provider | Pros | Cons |
|---|---|---|
| **Twilio** | Industry default, best docs, every framework supports it, free toll-free verification | Slightly higher per-SMS than bargain providers |
| **Bandwidth** | Cheaper per message at volume, direct carrier relationships | Smaller developer community, steeper onboarding |
| **Telnyx** | Cheapest for volume, good dev experience | Smaller ecosystem |
| **Google Voice** | Zero cost | **Rejected** — no developer API, ToS prohibits business/automated SMS, carrier filtering |

**Why toll-free over A2P 10DLC:**
- **~$90 cheaper in year 1**, ~$37 cheaper each year after, at Brewboat's 2025 volume.
- **Approval in 1–3 business days**, not 1–3 weeks. POC can dogfood with real captains the same week verification submits.
- No Brand/Campaign registration paperwork.
- Tradeoff: toll-free (855/844/etc.) area code instead of local 216. Acceptable for an internal operational channel.

**Why Twilio over cheaper competitors:**
- At our volume (~1,800 SMS/season) the per-SMS delta between Twilio and Telnyx is ~$8/year.
- Twilio docs, console, and MCP support win by more than $8 of dev-time friction.
- Numbers are portable if costs ever become an issue.

### Cost estimate at actual volume

Based on 2025 Brewboat booking data (258 log entries over May–October — 186 weekend, 72 weekday). See DEC-004 for sourcing.

**Messages per log entry:**
- Single-message happy path, immediate Y: 5 SMS (2 in + 3 out)
- One correction round: 7 SMS
- Ambiguity clarification: 7 SMS
- Open-trip workflow (start + end, no issues): 9 SMS
- Open-trip + correction: 11 SMS

Weighted realistic average: **~7 SMS per entry**.

- 258 entries × 7 SMS = ~1,800 SMS/season
- Twilio toll-free: ~$0.0075/SMS × 1,800 = **~$14/season SMS usage**
- Plus $2/month for the toll-free number × 12 months = $24/year (number stays provisioned off-season)
- Toll-free verification: free (one-time)
- Token costs for Purser (Haiku, ~2K tokens per parse+confirm cycle): ~$1/season

See the Cost Summary section at the end for the full Year 1 / Year 2+ table. 2024 reference: 440 entries → ~$23/season SMS usage at toll-free rates.

### Toll-free verification (the registration step)

Free. Required by US carriers for reliable outbound SMS from toll-free numbers. Full paste-ready form lives at `helm:docs/toll-free-verification-prep.md` (it has not been migrated yet because the registration step itself hasn't been kicked off — when it's time, copy or move the prep doc here). Short version of the process:

1. Create Twilio account + buy toll-free number ($2/mo)
2. Submit toll-free verification through the Twilio console:
   - Business info (Brewboat legal name, EIN, address)
   - Use case description ("internal employee trip logging for compliance recordkeeping")
   - Sample messages (inbound + outbound)
   - Opt-in method and consent language
   - Volume estimate (~2,580 SMS/season from 2025 data)
   - Public URL describing the service + privacy policy page
3. Wait for approval (**typically 1–3 business days**)
4. Approved → number fully production-ready across all US carriers

**This is the only real long-lead item, and it's short.** A2P 10DLC is the alternative we explicitly passed on in DEC-004.

---

## Deployment: Cloud VPS

Beta on grace. Production on cloud — not optional. Grace is at home; home loses power, internet, or gets rebooted. A captain texting at 10pm on a Saturday cannot wait.

### VPS requirements
- Ubuntu 24.04 LTS (matches grace for config parity)
- 2 GB RAM minimum, 4 GB comfortable
- Node.js 24.x
- Captain's Log service running under systemd (same pattern as Scrawl on grace)
- Fixed public IP or hostname (Twilio webhooks need it)
- HTTPS (Let's Encrypt) for the webhook endpoint
- Backup + monitoring

### VPS provider candidates
- **DigitalOcean** ($12/month droplet) — most predictable, great documentation
- **Hetzner** ($5/month) — half the price, EU-based, comparable reliability
- **Linode/Akamai** ($12/month) — solid
- **AWS Lightsail** ($10/month) — integrates with AWS ecosystem if we ever need it

**Recommendation: DigitalOcean.** Cost-effective, predictable, well-supported. Hetzner is cheaper but is in Europe which may add latency to Twilio webhooks (Twilio is US-based).

### Uptime target
99%+. A captain texting and getting no reply is a real problem. Captain's Log should recover from crashes automatically (systemd restart, health check). If it's down, Eric gets an alert and the captain gets a fallback "system down, please use the Google Form this trip" auto-reply from Twilio's fail-open handler.

---

## Data Schemas

### `captains.json`

```json
{
  "+12165551234": {
    "name": "Drew",
    "full_name": "Drew Lastname",
    "role": "captain",
    "active": true,
    "notes": "Lead captain, USCG master"
  },
  "+12165555678": {
    "name": "Brendan",
    "full_name": "Brendan Lastname",
    "role": "captain",
    "active": true
  },
  "+12165559012": {
    "name": "Brandon",
    "full_name": "Brandon Lastname",
    "role": "captain",
    "active": true
  }
}
```

Eric maintains manually. Adding a captain: one line in the JSON, git commit, redeploy. Low churn.

### `boats.json`

```json
{
  "brewboat": {
    "official_name": "Brewboat",
    "hull_id": "OH-XXXX-XX",
    "uscg_number": "XXXXXXX",
    "capacity": 20,
    "aliases": ["brew", "the brew", "big boat"]
  },
  "blue_boat": {
    "official_name": "Blue Boat",
    "hull_id": "OH-YYYY-YY",
    "capacity": 13,
    "aliases": ["blue", "blueboat", "little blue"]
  }
}
```

### `routes.json`

```json
{
  "cuyahoga": {
    "official_name": "Cuyahoga River",
    "aliases": ["cuyahoga", "the river", "cuy"]
  },
  "lake_erie": {
    "official_name": "Lake Erie",
    "aliases": ["lake", "erie", "out on the lake"]
  }
}
```

### Raw log entry format

Plain text, pipe-separated, matches Scrawl convention:

```
2026-06-01T23:14:00Z | +12165551234 | Drew | Trip started 1pm on Blue Boat, 4 cruises, 12 pax each except 13 on last, ended 9:30, Cuyahoga, VHF cutting out on 16
```

### Structured entry (pre-Sheet)

JSON, one file per day, matches Google Sheet columns:

```json
{
  "id": "2026-06-01-003",
  "entry_number": 3,
  "received_at": "2026-06-01T23:14:00Z",
  "captain": "Drew",
  "captain_phone": "+12165551234",
  "boat": "Blue Boat",
  "boat_hull": "OH-YYYY-YY",
  "route": "Cuyahoga River",
  "trip_start": "2026-06-01T17:00:00Z",
  "trip_end": "2026-06-02T01:30:00Z",
  "trip_count": 4,
  "total_passengers": 49,
  "passengers_by_trip": [12, 12, 12, 13],
  "issues": [
    {
      "category": "equipment",
      "subcategory": "VHF",
      "description": "VHF cutting out on channel 16",
      "severity": "medium"
    }
  ],
  "notes": null,
  "raw_message": "Trip started 1pm on Blue Boat...",
  "confirmed_by_captain": true,
  "confirmed_at": "2026-06-01T23:15:22Z",
  "filed_to_sheet": true,
  "sheet_row_id": "abc123"
}
```

**Final schema depends on the actual Google Form columns.** Eric will provide. The above is illustrative.

---

## Conversation Patterns

### Happy path

```
Captain (Drew): Trip started 1pm on Blue Boat, 4 cruises, 12 pax each except 13 on last, ended 9:30, Cuyahoga, VHF cutting out on 16

Scribbler (immediate): Got it, Drew. Parsing now.

Purser (~30s later): 
  Confirming your log, Drew:
  • Blue Boat
  • Cuyahoga River
  • 4 trips, 1pm–9:30pm
  • Passengers: 12 + 12 + 12 + 13 = 49 total
  • Equipment issue: VHF cutting out on ch 16
  Reply Y to file, or tell me what's wrong.

Captain: Y

Purser: Filed. Thanks, Drew.
```

### Correction path

```
Captain: actually 3 trips not 4, first group cancelled

Purser:
  Updated:
  • Blue Boat
  • Cuyahoga River
  • 3 trips, 1pm–9:30pm
  • Passengers: 12 + 12 + 13 = 37 total
  • Equipment issue: VHF cutting out on ch 16
  Reply Y to file.

Captain: Y

Purser: Filed.
```

### Ambiguity path

```
Captain: done for the day, 3 trips on the brew, 45 pax total, no issues

Purser:
  I need a few more details, Drew:
  • Trip start and end times?
  • Which route (Cuyahoga, Lake Erie, other)?
  Reply in one message or reply "skip" for any field.

Captain: 2pm to 8pm cuyahoga

Purser:
  Confirming:
  • Brewboat
  • Cuyahoga River
  • 3 trips, 2pm–8pm
  • 45 passengers total
  Reply Y to file.

Captain: Y

Purser: Filed.
```

### Unknown sender

```
Unknown number: Hey can you pick up some sandwiches

Scribbler: This number isn't registered for Brewboat logs. If you think this is a mistake, contact Eric at [phone]. Otherwise, ignore this reply.
```

(Silence is also an option — no reply at all to unknown numbers, to avoid confirming the line exists to spammers. Decide at build time.)

### System down

If gateway is down, Twilio auto-reply: "System temporarily down. Please use the Google Form for now. Sorry for the inconvenience. — Brewboat"

---

## Review & Digest

Every night (cron, 11:59pm ET), Purser runs a digest job:
1. Pull all entries filed that day
2. Format as HTML
3. Email to Eric per `helm:DEC-005` (inline HTML to `eric@stoffer.net`) with:
   - Total trips by boat
   - Total passengers
   - Any flagged issues (equipment, safety, weather)
   - Any unconfirmed entries (captain sent but never said Y)
   - Any parse-failed entries (captain sent something Purser couldn't parse)

Unconfirmed entries: Eric decides next morning whether to chase the captain or file as-is.

Parse failures: Eric reviews and files manually if needed.

---

## Session Decisions

### Session 5 (2026-04-20 morning)

Key calls made during the first planning session — these override or clarify the spec above:

- **POC in helm first.** Phase 3 of the helm project plan. Runs on bee-grace via Twilio + ngrok. When POC works, break out into its own repo and move to cloud VPS. Cloud deployment is a separate project, not part of the helm POC.
- **Captain confirmation is sufficient.** No Eric-review step for filing. Captain says Y → row goes to Sheet. Eric gets the nightly digest.
- **First mate is required.** Not optional. Purser must ask if missing.
- **Weather autofill confirmed.** Purser pulls from forecast API at parse time. Captains do not provide weather.
- **Flexible passenger count.** Captain can log total for the day or per-trip. Both are valid; Purser handles either. V1 writes a single passenger count to the Sheet (what the existing form captures).
- **Open-trip workflow.** Captain can text at trip start with available info, then again at trip end to complete the entry. Timestamps come from SMS. Correctable if submitted next day.
- **Google Form schema confirmed.** Pulled from existing `Captains Log All (Responses).xlsx`. Fields: Timestamp, Date, Departure Time, Equipment (boat), Trip Duration (hr:mm), Engine Hours Start, Engine Hours End, Captain, First Mate, Emergency Drills (monthly checkbox), Number of Passengers, Weather Forecast/Actual, Destinations/Stops, Vessel Concerns and Captain Notes.
- **Emergency drills — V1 is just a checkbox.** Future feature: monthly reminder to captains who haven't completed them yet. Not in POC scope.

### Session 6 (2026-04-20 evening)

- **SMS provider: Twilio toll-free, not A2P 10DLC.** Recorded in DEC-004. Reasons: ~$90 cheaper year 1, ~$37 cheaper year 2+, verification in 1–3 business days vs 1–3 weeks, no Brand/Campaign registration paperwork. Tradeoff: toll-free area code (855/844/etc.) instead of local 216 — acceptable for an internal operational channel.
- **Volume planning locked on 2025 data.** 258 log entries May–October (186 weekend, 72 weekday). 2024 (440 entries) retained as reference upper bound.
- **Messages per entry coefficient: ~7 realistic for cost, 10 for verification sizing.** Detailed scenario table lives in DEC-004 and the Cost estimate section above.
- **Verification prep paste source: `helm:docs/toll-free-verification-prep.md`.** Supersedes the earlier A2P prep doc (removed).
- **Registration deferred until POC feels viable.** Eric doesn't want to spend even ~$24 (one month of a toll-free number) on paperwork until Scribbler + Purser are wired up end-to-end on bee-grace against his own phone in Twilio trial mode. Only then do we buy the number and submit verification.

---

## Build Phases

> **Note:** The phase numbering below (Phase 0–5 = paperwork through wider rollout) is the *original* spec phasing from when Captain's Log was Phase 3 of helm. The phasing in this repo's `PROJECT_PLAN.md` (Phase 1 Extract → Phase 2 Purser MVP → Phase 3 Open-trip + digest + E2E → Phase 4 Production) is the live execution plan and supersedes this section. Kept here for historical context.

### Phase 0 — Paperwork (start when POC looks viable, runs in background)
- [ ] Set up Twilio account under Brewboat billing
- [ ] Buy a toll-free number ($2/mo) — SMS-capable, 844/855/833/888
- [ ] Stand up a public URL + privacy-policy page on Brewboat domain (required by toll-free verification)
- [ ] Submit toll-free verification via Twilio console (use `helm:docs/toll-free-verification-prep.md` as the paste source)
- [ ] Wait for approval (**1–3 business days**)
- [ ] Number goes live across all US carriers — unblocks Phase 3.8 real-captain test

### Phase 1 — Cloud infrastructure (1–2 days actual work)
- [ ] Spin up DigitalOcean droplet (2GB, Ubuntu 24.04, Cleveland region)
- [ ] Install Node.js, systemd services
- [ ] Set up HTTPS with Let's Encrypt on a Cloudflare domain (existing Brewboat domain works)
- [ ] Create webhook endpoint that handles Twilio payloads
- [ ] Deploy captains-log repo skeleton (git, directory structure, seed JSON files)
- [ ] Verify gateway comes up clean, health endpoint reports green

### Phase 2 — Scribbler (1 day)
- [ ] Implement intake handler: receive SMS → look up captain → append to raw log → reply "Got it, [Name]. Parsing now."
- [ ] Handle unknown sender case
- [ ] Test with 2 captains for 3 days — no parsing yet, just intake
- [ ] Verify raw logs are clean

### Phase 3 — Purser (Eric-review mode) (2–3 days)
- [ ] Wire Purser with access to raw logs, boats/routes/captains JSON, Google Sheets API
- [ ] Parse most recent raw entry → produce structured JSON → SMS Eric the draft confirmation
- [ ] Eric reviews via SMS, approves or corrects
- [ ] Purser writes to Google Sheet
- [ ] Eric uses this mode for 2 weeks to tune the prompt and catch edge cases
- [ ] **Do not move to Phase 4 until confident**

### Phase 4 — Purser (captain-review mode)
- [ ] Shift confirmation SMS from Eric to the submitting captain
- [ ] Captain confirms or corrects
- [ ] Eric still receives daily digest
- [ ] Run in parallel with Google Form for at least one month
- [ ] Captains opt in individually ("Drew, want to try SMS instead of the form?")

### Phase 5 — Wider rollout
- [ ] All captains enrolled
- [ ] Google Form remains as fallback
- [ ] Monitor failure rate, parse success rate, captain complaints
- [ ] Iterate prompts monthly

---

## Cost Summary

Based on 2025 actuals (258 log entries over May–October) × ~7 SMS/entry realistic average. Twilio toll-free at ~$0.0075/msg.

### Cloud production (VPS, target end-state)

| Item | Year 1 | Year 2+ |
|---|---|---|
| DigitalOcean droplet ($12/mo) | $144 | $144 |
| Twilio toll-free number ($2/mo) | $24 | $24 |
| Toll-free verification | $0 | — |
| Twilio SMS usage (~1,800 SMS × $0.0075) | $14 | $14 |
| Anthropic API (Haiku for Purser) | ~$1 | ~$1 |
| Google Sheets API | Free | Free |
| Domain (existing Brewboat domain) | $0 | $0 |
| **Total** | **~$183** | **~$183** |

### POC (helm on bee-grace)

Same as above minus the $144 droplet — bee-grace hosts during POC.

| | Year 1 | Year 2+ |
|---|---|---|
| **POC total** | **~$39** | **~$39** |

Cost assumptions documented in DEC-004. Toll-free verification sizes to 10 SMS/entry (~2,580 SMS/season) for carrier headroom; the cost line uses the realistic 7 SMS/entry. Total well under a Brewboat line item.

**Year 1 / Year 2+ identical** under toll-free because there's no one-time registration fee — a notable simplification vs the A2P 10DLC path we passed on (~$129 year 1 / ~$75 year 2+).

---

## Open Questions / Decisions Still Needed

These should be resolved before or during Phase 1, but are not blocking to start the paperwork:

1. ~~**Existing Google Sheet schema**~~ — **Resolved (2026-04-20).** Schema confirmed from `docs/Captains Log All (Responses).xlsx`. Fields documented in Session Decisions section above.
2. **Cloud provider** — DigitalOcean recommended, but decide by Phase 1.
3. **Domain for webhook** — existing Brewboat domain or new subdomain (e.g., `log.brewboat.com`)?
4. ~~**Digest delivery method**~~ — **Resolved (2026-04-20) — see `helm:DEC-005`.** Email to Eric (inline HTML). Same channel as Clark's EOD report.
5. **Handling captain corrections after filing** — if captain realizes an error next day, what's the workflow? Probably "text the original entry number + correction," Purser updates the sheet row.
6. **Parse failure fallback** — if Purser can't extract anything usable, does it text the captain asking for a structured version, or does it escalate to Eric?
7. **Holiday/off-season behavior** — does the system stay running year-round, or is it paused October–May? Recommend: stays running, free tier usage is negligible.
8. **Insurance/compliance sanity check** — worth a quick call to Brewboat's USCG contact to confirm SMS-originated log entries are acceptable if stored in the existing Sheet format. Unlikely to be an issue but one email to verify.

---

## Non-Goals for V1

- Multi-tenant (serving other boat operators). Keep it Brewboat-only. If it works, consider spinning out later.
- Voice input. Captains text, period.
- Real-time dashboards. The Sheet is the dashboard.
- Integration with POS/booking systems (Xola). Separate project.
- Historical backfill of pre-Captain's Log trips. Start fresh.
- Photo attachments (MMS). Maybe V2.

---

## Success Criteria (end of 2026 season)

- 100% of active captains have tried SMS logging at least once
- 50%+ of logged trips come through Captain's Log (vs. Google Form)
- Zero USCG compliance issues
- <5% parse failure rate
- <2 captain complaints about the system per month
- Operational cost under $250 for the year
- Eric spends less than 30 minutes/week on maintenance

---

## References

- Scrawl spec (`helm:docs/scrawl-phase0-spec-final.md`) — similar two-agent pattern, proven
- Existing Brewboat Google Form (Eric to export)
- Twilio toll-free verification docs: https://www.twilio.com/docs/messaging/compliance/toll-free-message-verification
- Twilio A2P 10DLC docs (for reference; not the V1 path per DEC-004): https://www.twilio.com/docs/messaging/compliance/a2p-10dlc
