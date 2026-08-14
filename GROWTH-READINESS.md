# Growth Readiness Matrix

> **What still requires a human in the Caring Companions office, why does it
> require a human, and roughly how much administrative time does it consume?**

Whatever is left after that is the build list. The goal is not green boxes. It
is growing substantially without office payroll growing with it.

## Standing rules

Do not build processors for dead producers. Do not duplicate facts another
system owns. Do not treat probable identity as permission for autonomous
action. An automation that ran is not an automation that worked.

**And the one this session earned the hard way:** never trust an aggregate
until the underlying rows make sense — especially when that aggregate could
create work, send a message, restrict someone, or affect a real person. Five
confident numbers turned out to be artifacts of how they were measured. Every
one was caught by reading the rows behind the total.

## Who owns what

| System | Owns |
|---|---|
| **AxisCare** | Clients, caregivers, visits, schedules, authorisations — service facts |
| **GoHighLevel** | Contacts, conversations, campaigns — communication facts |
| **Viventium** | Payroll and employment facts |
| **The Hub** | Coordination, obligations, accountability, supervision, exceptions, institutional knowledge, management visibility |

The Hub **observes** authoritative systems and creates, chases and reconciles
work around them. It does not copy them into itself.

## Classification

**AUTOMATED** — no routine human administration.
**ASSISTED** — the Hub detects, routes, reminds, chases and reconciles; a human
judges or acts.
**MANUAL BY DESIGN** — we want a human deciding.
**BLOCKED** — a named external dependency prevents completion.
**BROKEN** — it should work with what we already have. A link is missing.

`HUMAN MIN/WEEK` is `UNMEASURED` everywhere. Every figure would be derived from
reading code, not from watching the office, and a made-up number is worse than
an honest blank. Measure it from events once the Hub is in real use.

---

# GROWTH

## 1. Lead intake → contact → conversion
**ASSISTED.** The most complete chain in the system.
`lead-intake` → Hub `leads` → one evolving `ops_lead_<id>` → `lead-followup`
ladder → stands down on human contact → closes at Converted or Lost.
`lead-nurture` runs a 4-touch drip for "not ready yet" families.
**Reconciliation: BUILT this session** (`lead-reconcile`, report-only).

## 2. Inbound and missed calls
**ASSISTED, weaker than it looks.** `calls-feed` → `call-disposition`
(1/2/4/7-day ladder) → `call-followup`. `opsReconcileCalls` has a 12-hour age
guard.
**The number is not ported to GHL yet**, so the producer is not at full volume.
**905 contacts tagged "couldn't find caller name"** — the office already
measuring this.

## 3. Campaigns
**ASSISTED.** `campaign-auto`, `campaign-send`. Neither uses the shared outreach
boundary. Policy gap rather than identity risk.

## 4. LTC policy intake
**ASSISTED.** `ltc-policy-intake` + `ai-ltc-policy` draft the policy read.
Genuine labour removal — reading an LTC policy by hand is slow and error-prone.

---

# CLIENT CARE

## 5. Start of Care
**BLOCKED — AxisCare.** Webhook written, hardened, idempotent, fails closed
without a secret. Never registered. **Zero real clients have ever existed in the
Hub.**

## 6. Care plan and assessment
**ASSISTED.** `ai-draft-careplan` drafts, a human approves. Correct shape:
the machine does the typing, the person does the judgment.

## 7. First visit confirmation
**BLOCKED — AxisCare.** Needs a verified visit payload with `clockIn`. SOC tick
is fallback and reconciliation only, never the authoritative signal.

## 8. Client follow-ups and recurring QA
**BLOCKED, dead producer.** `client_checkins` holds 3 rows, all Care Match
records. Cadence rules written in `obligations.js`. `ai-draft-followup` drafts
the message.

## 9. Caregiver introductions and changes
**ASSISTED.** `caregiver-intro`, `caregiver-card`, `circle-send`.
**Both senders retrofitted onto the shared outbound boundary this session.**

## 10. Client issues and complaints
**BROKEN — and mostly UNBLOCKED.** Splitting it properly (see
[PROCESS-CHAINS.md](PROCESS-CHAINS.md) chain 4):

- **A. Intake** — how the Hub learns of a problem: **UNBLOCKED**
- **B. Identity** — which client: **PARTIAL**, family recognition BLOCKED
- **C. Management** — owner, due, chase, escalate, resolve: **UNBLOCKED**;
  `ops_items`, domains, ownership and escalation all already exist
- **D. Detection** — issues nobody reported: **BLOCKED (AxisCare)**

SYSTEM DOES: nothing today. HUMAN STILL DOES: everything, and there is **no
structured record of client problems at all**. WHY: *simply not automated yet* —
which makes this remaining build work, not an end state.

The client can be free text until AxisCare arrives. That is a degraded identity
link, not a fake client, and it is how the office already works on paper.

**BUILT · DEPLOYED · UI-PROVEN · PRODUCERS LIVE.** Detection of unreported
issues remains **BLOCKED BY AXISCARE**. See [PROCESS-CHAINS.md](PROCESS-CHAINS.md)
chain 4.

---

# STAFFING

## 11. Scheduling, call-offs, open shifts
**BLOCKED — AxisCare. Probably the largest single administrative load.**
Call-offs are urgent, frequent, and land on whoever answers the phone.
`axiscare-open-shifts` exists in the Training Platform project and has never
run.

## 12. EVV exceptions
**ASSISTED.** Public correction form → `evv_submissions` → Accept & Log.
Table currently holds 0 rows.

## 13. Payroll exceptions
**MANUAL BY DESIGN, partly BLOCKED.** Viventium owns payroll and the Hub does
not touch it. Correct — do not duplicate it.

---

# CAREGIVERS

## 14. Applications → interview → orientation → hire
**ASSISTED.** The deepest automation in the system: `interview-feed`,
`interview-messages`, `score-interview`, `vapi-interview` (AI phone screen),
`orientation-booked`, `applicant-reengage`, `profile-polish`,
`hire-intake-purge`.
**A production defect was fixed and deployed this session** —
`promoteToCaregiver()` had discarded phone, email and the source id on every
hire since it was written.
Four booking systems still share one calendar.

## 15. References
**ASSISTED — built, correctly refusing to run.** `references-run` reads the
candidate record (`r1..r4`), which is what `obDeriveStatus()` gates on.
One evolving item per candidate carrying all four slots. Closes at two
positives, closes on candidate exit, flags Negative/Conditional for judgment.
`reference_requests` is a duplicate store and stays empty.
**Dry run: 1 candidate, 0 slots. Outbound channel and consent UNRESOLVED.**

## 16. Background checks
**ASSISTED.** Live OIG API check plus batch. EDL, FCSR, fingerprints tracked
with 90-day and annual cycles.

## 17. Training and compliance
**ASSISTED — the strongest engine in the Hub.** Shared `obligations.js` decides;
browser and server consume the same file. Anchored to the 2025-04-25 Medicaid
start. Priority-sorted legal → management → verification. 45-day age guard,
10 per run, two-tier live flags.
**Blocked on manual WellSky training-date entry, not on code.**

## 18. Supervisory visits, GHEs, med-box
**ASSISTED.** `ghe-reminders` runs. Supervisory visits become obligations once
visit data exists.

## 19. Caregiver identity and recognition
**BLOCKED.** 56 caregivers, 0 phone numbers. 52 recovered by name match,
applied, then **rolled back** — name-only evidence cannot authorise anything.
No Hub-native bridge exists: 0 orientation bookings, 0 `candidate_id` values,
0 EVV rows. The promote fix stops the bleeding for future hires only.

## 20. Client family and contact identity
**BLOCKED.** Whether AxisCare exposes responsible parties is **unknown** — no
endpoint has ever been reachable. Schema supports office-entered relationships
meanwhile.

---

# OPERATIONS

## 21. Escalation
**ASSISTED.** `ops-escalate`, 24/7 by design. Attention grading derived from the
clock, never stored, never changing ownership.

## 22. Backup, retention, purge
**AUTOMATED.** `shared-backup` snapshots every `app_data` key,
`backup-verify` proves the snapshot restores, `purge-recordings` and
`lead-docs-retention` enforce retention. **The only genuinely AUTOMATED domain**
— and worth noting it is the one where a human was never in the loop to begin
with.

## 23. Reporting
**ASSISTED.** `reports-rollup`.

## 24. Documentation QA
**BROKEN.** `transcribe-recording` exists; nothing reviews care notes for
quality, completeness or risk signals. Cierra's expanded role includes reading
all care notes — currently entirely manual.

---

# BLOCKED BY AXISCARE — the activation queue

**Every path returns an HTML 403 from CloudFront before reaching API routing.
Not a credential problem.** Support message written and ready to send.

| # | Needs | What we do with it | Built | Remains | Activation test |
|---|---|---|---|---|---|
| 5 | `client.created` + `/api/clients` | Create the scheduling handoff, start obligations | Webhook, idempotency proven at DB level, event contract, payer resolver | Register webhook, set secret | One real payload recorded in `client_events`, no duplicate on redelivery |
| 7 | `/api/visits` with `clockIn` | Authoritative "care started"; reconcile the SOC tick | Obligation engine, SOC checklist | Visit adapter | `clockIn` populated on a real visit; SOC and AxisCare agree |
| 8 | Active client census | Give the check-in cadence subjects | `obligations.js` cadence rules | Producer wiring | `rows_seen` > 0 with real clients |
| 11 | Open shifts, assignments, call-offs | Coverage automation | `axiscare-open-shifts` (wrong project) | Rehome, wire, test | A real call-off creates one owned item |
| 19 | `/api/caregivers` with phone | Settle all 56 identities without name matching | Identity layer, provenance | Backfill adapter | 56 caregivers CONFIRMED, zero probable |
| 20 | Responsible parties / emergency contacts | Family caller recognition | `person_relationship` | Adapter, if exposed at all | A daughter's call names her client |
| — | Authorisations + consumption | Exhaustion warnings before unpaid care | Nothing | All | An authorisation nearing its limit raises an item |

# BLOCKED BY GHL PERMISSIONS — the activation queue

| Needs | What we do with it | Built | Remains | Activation test |
|---|---|---|---|---|
| View Custom Fields | Look for an employee or applicant id — a real caregiver bridge | Identity layer, evidence grader | Bridge adapter | A caregiver matched by identifier, not name |
| View Tags | Replace tag-string guessing with a canonical vocabulary | `identity_vocabulary` | Mapping | Lead classification stops keying off free text |
| View Opportunities | Pipeline visibility for leads | Nothing | Assessment | — |

---

# Priority, ranked by labour removed and risk prevented

Not by ease of building.

1. **Send the AxisCare support message.** Not a build. Unblocks 7 rows including
   the two largest labour loads.
2. **Add the three GHL read scopes.** Two minutes. Unblocks caregiver identity
   and the vocabulary.
3. **Client issue lifecycle** (row 10, chain 4 steps 4–11). Unblocked. No
   structured record of client problems exists today.
4. **Samantha-dependency instrumentation** (below). No dependency. Every
   workflow needs to start recording it before it can ever be reported.
5. **Retrofit the remaining 22 senders** onto the shared outbound boundary.
   Policy gap; the two dangerous ones are done.
6. **Referee capture** (chain 3, step 6). One form change makes an entire
   already-built workflow useful — it is why `references-run` found zero slots.
7. **Call-off classification** (chain 1, step 2). First removable step in the
   most expensive chain, and it needs no AxisCare.
8. **Documentation QA** (row 24). Cierra reads every care note by hand.
7. Everything AxisCare-dependent, in the order access allows.
8. **Business-health Home screen — last.** A dashboard over incomplete
   workflows reports labour rather than removing it.

---

# What the domain ownership table revealed

Read live 2026-08-13 from `domains` (entity `cc_ihs`), the canonical
accountability record:

| Domain | Owner | Escalation |
|---|---|---|
| caregiver_performance | Krystal | Samantha |
| client_care | Krystal | Samantha |
| family_enquiries | Krystal | Samantha |
| field_quality | Cierra | Samantha |
| **money** | **Samantha** | Samantha |
| payer_programs | Angiel | Samantha |
| **program_administration** | **Samantha** | Samantha |
| recruiting_orientation | Krystal | Samantha |
| **scheduling_coverage** | **Samantha** | Samantha |
| training_compliance | Krystal | Samantha |

**Samantha owns scheduling_coverage.** That is chain 1 — call-offs and open
shifts — which this analysis already identified as probably the largest single
administrative load in the business, with nine of twelve steps removable. The
CEO is the accountable owner of the highest-volume operational queue.

By the definitions we set, work reaching her there is not exception work. It is
**administrative leakage by design**, and no instrumentation will show it as a
problem because the routing is behaving exactly as configured.

She also owns `money` and `program_administration`. Three of ten domains.

**And she is the escalation person for all ten.** Every escalation in the
business terminates at the owner. That is defensible in a small office and it
is the thing that has to change first as it grows, because exception volume
scales with client count while her hours do not.

**This reframes the growth-readiness question.** It is not only "how much
administrative work can be automated" but "which domains should stop being
owned by the CEO, and who takes them". That is an org decision, not a build.

# Samantha dependency

The metric that matters most for growth:

> **What percentage of Caring Companions operated correctly without Samantha
> this week?**

Not built. But every workflow must start recording the facts to calculate it,
because they cannot be reconstructed later. For anything that reaches her:

| Field | Why |
|---|---|
| `reached_samantha_at` | when |
| `original_owner` | who should have held it |
| `escalation_reason` | why it left them |
| `escalation_appropriate` | did it genuinely need her |
| `decision_type` | `owner_decision` (only she can make it) vs `administrative` (the system or team should have) |
| `category` | which workflow produced it |

**The distinction that matters:** an owner decision reaching the owner is the
system working. Administrative work reaching the owner is the system failing.
Today nothing separates them, so the 6% that should remain is indistinguishable
from the 6% that should not.

**Next concrete step:** add these fields to the ops item shape and populate them
in `ops-escalate`, which is the one place work currently reaches her.

---

# CRM cleanup — logged, not today's project

Found while tracing, worth fixing, not worth a session:

- Live test contacts in production GHL: `ZZTest Lead DoNotCall`, `E2E Test`,
  `WEBSITE TEST (Claude, delete...)`
- 237 tags including both `applicant qualified` and `qualified applicant`
- `Tanisha Peterson` tagged both `lead` and `active client`

---

# Read this with PROCESS-CHAINS.md

The matrix lists workflows. [PROCESS-CHAINS.md](PROCESS-CHAINS.md) traces the
five end-to-end processes across them, step by step, marking every step the
office physically performs and whether it can disappear.

That reordering changes the priorities. By function, the next builds looked like
reference chasing and lead reconciliation. By chain, they are the client issue
lifecycle, referee capture, and call-off classification — because those are
where a person crosses four screens to do one thing.

**Chain 1 (call-off → shift filled) has nine of twelve steps removable and is
where growth hurts most**, since call-offs scale linearly with caregiver count.

# The honest summary

**AUTOMATED: 1 of 24** — backup and retention, the one domain where a human was
never in the loop.

**ASSISTED: 13.** The Hub detects, routes and chases; a person judges. This is
the right end state for most of them.

**BROKEN: 2** — client issues (no producer) and documentation QA (nothing
reviews notes). Both fixable with what we already have.

**BLOCKED: 6**, five of them by one support ticket.

**MANUAL BY DESIGN: 2** — payroll and the judgment calls inside hiring.

The single largest lever is not a feature. It is an email to AxisCare support.

---

# Deferred architecture — recorded, not implemented

Agreed 2026-08-13. None of these block Chain 4.

**`owner_is_temporary` and `target_owner_position` on `domains`.** The TEMPORARY
markers already exist on responsibilities; the domain record cannot express
them, so a stopgap reads as a decision.

**Splitting `escalation_person`.** It drives three materially different
behaviours today: `help_from` (assistance, accountability explicitly unchanged),
`needs_samantha` (ownership actually transfers), and discipline approval.
**Inventory every call site before splitting.** A schema split without migrating
each behaviour deliberately would be worse than the overloaded field.

**Domain taxonomy cleanup.** `money` is empty. `program_administration` is a
label. `training_compliance` and `recruiting_orientation` are stubs. Referral
relationships are misfiled inside payer administration. `client_care` and
`family_enquiries` may be one lane.

**Cierra's reading load.** "Review care notes routinely across active clients"
and "watch for patterns across multiple visits" is the largest unautomated
reading load in the business. Removing it is worth more than moving
responsibilities on an org chart — her time belongs in homes, assessing,
training, and making quality judgments software cannot make. Blocked on AxisCare
care notes.

## ARCHITECTURE INVARIANT — safe defaults

Found via `phone_index.confidence` defaulting to `'confirmed'`, which meant any
row written without stating provenance became a number the outreach gate would
send to.

> **Missing evidence must never silently become permission.**

Anything that grants trust, permission, eligibility, authority or autonomous
action defaults to the **non-permissive** state. Trust is asserted, never
inherited by omission.

Applies to: identity confidence, sending permission, caregiver eligibility,
approval authority, automatic assignment, and every future switch. Apply it
whenever a workflow is touched — not as a separate audit.

## FOUR INDEPENDENT QUESTIONS

Kept separate because collapsing any two produces a bug that looks like a
feature:

| Question | Answered by |
|---|---|
| **Identity** — who is this person? | `person_identity`, `person_source_id` |
| **Capability / eligibility** — what work may they perform? | `responsibilities` kind `capability` / `backup` |
| **Duty** — what are they responsible for right now? | duty windows |
| **Authority** — what may they decide? | `domains.owner_person`, `owner_authority` |

Samantha and Krystal are the proof case: confirmed identity, real AxisCare
caregiver ids, verified phones — and still not ordinary coverage candidates.
Identity can no longer be the reason they are excluded; **eligibility** is.

And the exclusion must not be blanket. Cierra and Angiel hold explicit
`capability` rows reading *"Provide direct-care coverage when needed for
call-offs"*. They have said they cover shifts, and the system must not overrule
them. Four states, not two: ordinary, office-not-eligible,
office-but-capable, backup.

## The methodological lesson

Counting domains was misleading. Counting responsibilities was misleading.
Counting escalations would have been misleading. **The useful unit is the
business process and the human judgment remaining inside it.**
