# Growth Readiness Matrix

The question this document exists to answer:

> **What still requires a human in the Caring Companions office, why does it
> require a human, and roughly how many administrative hours a week does it
> consume?**

Whatever is left after that is the build list.

The goal is not green boxes. It is removing routine administrative labour and
preventing human error, while leaving human judgment where it belongs.

**Standing rules, applied to every row.** Do not build processors for dead
producers. Do not duplicate facts AxisCare owns. Do not treat probable identity
as permission for autonomous action. An automation that ran is not an automation
that worked — prove its producer is feeding it.

**Classification.** AUTOMATED = no routine human administration.
ASSISTED = the system creates, routes and chases; a human judges or acts.
MANUAL BY DESIGN = human judgment should stay.
BLOCKED = a named external dependency prevents it.

Hours are estimates and marked as such. They are the weakest column here and
should be corrected from what the office actually experiences.

---

## The chain, per workflow

`producer → authoritative source → decision/rule → responsible role → work
created → follow-up/chase → escalation → completion evidence → source
reconciliation → automation health`

A missing link is called out rather than built over.

---

## 1. Leads and enquiries

| | |
|---|---|
| **Status** | ASSISTED |
| Producer | Web forms, GHL, inbound calls |
| Authoritative source | GHL contact + Hub `leads` |
| Decision | `lead-followup`, `call-disposition` ladder (1, 2, 4, 7 days) |
| Owner | Care Coordinator |
| Work created | One evolving `ops_lead_<id>` item, open until Converted or Lost |
| Chase | Automated, stands down the moment a human makes contact |
| Escalation | `ops-escalate`, 24/7 by design |
| Completion | Status Converted or Lost |
| Reconciliation | **MISSING.** Nothing checks GHL against Hub leads |
| Health | Control Centre shows rows seen vs created |

**Est. 2–4 hrs/wk.** The most complete workflow in the system. The gap is
reconciliation: a lead created in GHL that never reaches the Hub is invisible.

---

## 2. Missed calls and caller identity

| | |
|---|---|
| **Status** | ASSISTED, and weaker than it looks |
| Producer | GHL call events. **The number is not ported yet** |
| Authoritative source | GHL conversations |
| Decision | `opsReconcileCalls`, 12-hour age guard |
| Owner | Operations Inbox |
| Work created | `ops_<callId>` |
| Escalation | Built |
| Reconciliation | **MISSING** |
| Health | Visible |

**Est. 3–6 hrs/wk, rising fast with volume.**

**905 GHL contacts are tagged "couldn't find caller name."** That is the office
measuring this problem itself. Caller recognition is built and proven, but sees
only leads and applicants — caregivers and clients are invisible. See rows 12
and 13.

---

## 3. New client Start of Care

| | |
|---|---|
| **Status** | BLOCKED — AxisCare API unreachable |
| Producer | AxisCare `client.created`. Webhook written, hardened, **not registered** |
| Authoritative source | AxisCare |
| Decision | Locked: AxisCare owns identity and service, Hub owns obligations |
| Owner | Care Coordinator |
| Work | `client_queue` scheduling handoff, plus SOC checklist |
| Completion | First completed visit in AxisCare. SOC tick is fallback only |
| Reconciliation | Designed, not built |
| Health | Control Centre row prepared |

**Est. 1–2 hrs per new client.** **Zero real clients have ever existed in the
Hub** — the three rows were test data. Every mechanism here is unproven against
a real person.

---

## 4. First visit and 24–72 hour follow-up

**BLOCKED.** Needs a verified AxisCare visit payload with a populated `clockIn`.
Same blocker that parks First-Visit Confirmation. Do not activate on a payload
shape nobody has seen.

---

## 5. Recurring client check-ins and QA

**BLOCKED, and the producer is dead.** `client_checkins` holds 3 rows, all Care
Match records, zero real check-ins. The processor is healthy over an empty
source. Cadence rules are written in `obligations.js`.

**Est. 4–8 hrs/wk once clients exist.**

---

## 6. Caregiver compliance and training

| | |
|---|---|
| **Status** | ASSISTED — the strongest engine in the Hub |
| Producer | `caregivers` blob + `eligibility-rules.js` |
| Authoritative source | Hub, until AxisCare/Viventium |
| Decision | Shared `obligations.js`. Anchored to 2025-04-25 Medicaid start |
| Owner | Lead Caregiver, escalating to Krystal |
| Work | `ops_cgc_<id>_<code>_<anchor>`, priority-sorted legal → management → verification |
| Guards | 45-day age guard, 10 per run, two-tier live flags |
| Health | rows_seen, candidates vs created vs deferred vs too_old |

**Est. 4–6 hrs/wk.** Blocked on Samantha manually entering WellSky training
dates. The engine is correct and waiting on data.

---

## 7. Hiring: applications → interview → orientation → hire

| | |
|---|---|
| **Status** | ASSISTED |
| Producer | Job pages, `/apply` pre-screen, GHL |
| Decision | `interview-messages`, `applicant-reengage`, orientation booking |
| Owner | Lead Caregiver (Cierra), Krystal covers |
| Chase | 2/5/9-day ladder |
| Completion | Promotion to caregiver |

**Est. 5–8 hrs/wk.** **A production defect here was fixed and deployed tonight**
— `promoteToCaregiver()` had been discarding phone, email and the source id on
every hire since it was written. Four booking systems still share one calendar.

---

## 8. Reference checks

**BLOCKED — dead producer.** `reference_requests` has 0 rows, ever, and **no
INSERT exists anywhere in the codebase.** `reference-chase` is a healthy
processor over a table nothing fills. Do not schedule it until something writes.

**Est. 2–3 hrs/wk, entirely manual today.**

---

## 9. Scheduling, call-offs, open shifts

**BLOCKED — AxisCare.** The highest-value blocked row: call-offs are urgent,
frequent and land on whoever answers the phone. `axiscare-open-shifts` exists in
the Training Platform project but has never run.

**Est. 6–12 hrs/wk. Probably the largest single administrative load.**

---

## 10. EVV exceptions and payroll

**ASSISTED.** Public correction form → `evv_submissions` → Accept & Log. Table
currently holds 0 rows. Payroll runs through Viventium, which the Hub does not
touch. **Est. 2–4 hrs/wk.**

---

## 11. Authorisations, payer administration, Medicaid/VA/LTCI

**MANUAL BY DESIGN, partly BLOCKED.** Authorisation exhaustion is exactly what a
system should watch, and it needs AxisCare authorisation data. Payer
classification is unreliable: `classes[]` mixes care level and payer, so payer
now resolves to null rather than a guess.

**Est. 4–8 hrs/wk.** High revenue risk — an exhausted authorisation is unpaid
care already delivered.

---

## 12. Caregiver identity and recognition

**BLOCKED.** 56 caregivers, 0 phone numbers. 52 were recovered from GHL by name
match, applied, then rolled back because name-only evidence cannot authorise
anything. No Hub-native bridge exists: 0 orientation bookings, 0 `candidate_id`
values, 0 EVV rows.

Unblocks with either GHL read scopes or AxisCare. The promote fix stops the
bleeding for future hires only.

---

## 13. Client family and contact identity

**BLOCKED.** Nobody knows whether AxisCare exposes responsible parties or
emergency contacts, because no endpoint has ever been reachable. Schema supports
office-entered relationships in the meantime.

---

## 14. Supervisory visits, med-box visits, GHEs

**ASSISTED / MANUAL.** GUIDE coordinator page and 9-question screener are live.
Supervisory visits are an obligation the engine can carry once visit data exists.

---

## 15. Does the business know it is running correctly?

**This is the row that turns the Hub into a CEO system, and it is the one with
the least built.**

The Automation Control Centre answers "did the automation run." The Home screen
should answer:

- Are all new leads being contacted?
- Are all open shifts covered?
- Are client problems being resolved, or just logged?
- Are required visits happening?
- Are caregivers compliant?
- **Are any authorisations approaching exhaustion?**
- Are supervisors reviewing what they are meant to review?
- **Did any automation stop receiving data?**
- Is anything sitting without an owner?
- **What required Samantha today that should not have?**

The last one is the real measure. Every other question is a symptom of it.

---

## What blocks what

**AxisCare API access** blocks rows 3, 4, 5, 9, 11, 12, 13 — seven of fifteen,
including the two largest labour loads. Support message written and ready.

**GHL read scopes** block row 12 and the canonical tag vocabulary. Two minutes
in their UI.

**Manual WellSky training entry** blocks row 6 from going live.

**A reference-request producer** blocks row 8. Needs building, not unblocking.

---

## Priority, by labour removed and risk prevented

1. **Send the AxisCare message.** Not a build. Unblocks seven rows.
2. **GHL read scopes.** Two minutes, unblocks caregiver recognition.
3. **Reference-request producer** (row 8). No external dependency. Pure
   automation of work that is fully manual today.
4. **Business-health Home screen** (row 15). No external dependency. Converts
   the Hub from a task manager into a control surface.
5. **Retrofit the outreach identity gate** onto the 3 highest-risk senders —
   `caregiver-intro`, `circle-send`, `calls-feed` — which read a phone straight
   off a person record with no gate at all.
6. Everything AxisCare-dependent, in the order access allows.

Items 3, 4 and 5 need no external dependency and no business decision. They are
the next build.

---

## Honest total

Roughly **35–60 administrative hours a week** across these workflows, most of it
in scheduling and call-offs, hiring, compliance and client follow-up. That range
is wide because it is estimated rather than measured, and correcting it from
what the office actually experiences would sharpen every priority above.

**The largest single blocker is one support ticket.**
