# The five administrative chains

57 functions is not the business. The unit that matters is the end-to-end
process, because that is where a person crosses four screens to do one thing.

For each chain: **every step the office physically performs today**, which
system it happens in, and whether that step can disappear. A step marked
`REMOVABLE` is remaining build work, not an acceptable end state.

`ASSISTED` is not a resting place. Thirteen of twenty-four workflows carry that
label and it hides how much manual work remains. Every step below answers
**why a human is required**: judgment, physical action, external system limit,
missing integration, policy, or simply not automated yet.

---

# CHAIN 1 — Call-off → shift filled → family told

The highest-frequency, highest-urgency chain, and it lands on whoever answers
the phone.

| # | Step | Who / where | Can it go? |
|---|---|---|---|
| 1 | Caregiver calls or texts the office | GHL / phone | **No** — physical event |
| 2 | Person realises this is a call-off, not a general call | Human ear | **REMOVABLE** — call disposition can classify it. *Not automated yet* |
| 3 | Look up which client and shift is affected | AxisCare | **REMOVABLE** — **BLOCKED (AxisCare)** |
| 4 | Decide urgency: today, tomorrow, next week | Human | **No** — judgment, but the system should present the facts |
| 5 | Search for available, eligible caregivers | AxisCare + compliance knowledge | **REMOVABLE** — eligibility rules already exist in `eligibility-rules.js`. **BLOCKED (AxisCare)** for availability |
| 6 | Contact caregivers one at a time | Phone / text | **REMOVABLE** — broadcast to eligible, first acceptance wins. *Not automated yet* |
| 7 | Wait, chase, re-contact | Human | **REMOVABLE** — automatic ladder |
| 8 | Record who accepted | Memory / notes | **REMOVABLE** |
| 9 | Update the schedule | AxisCare | **REMOVABLE** — **BLOCKED (AxisCare write)** |
| 10 | Tell the family | Phone | **Partly** — notify automatically, but a *disruption* to a client deserves a person |
| 11 | Document the resolution | Hub / AxisCare | **REMOVABLE** |
| 12 | Escalate if nobody accepts | Human judgment | **REMOVABLE** — escalate only on failure |

**Nine of twelve steps are removable.** Four are blocked by AxisCare, five are
simply not automated yet.

**The target:** caregiver calls off → system identifies the shift → finds
eligible available caregivers → contacts them → records responses → fills it →
updates AxisCare → tells the family → **escalates only if nobody accepts.**
A human touches step 4 and step 10, and only step 12 when it fails.

**This single chain is probably the largest administrative cost in the
business.** It is also the one where growth hurts most: call-offs scale
linearly with caregiver count.

## Chain 1 starting point, traced 2026-08-13

**Step 2 is already built.** `call-disposition` recognises `call-off` /
`call off` / `caregiver call-off` and creates a `coverage_cases` record with
`reason: 'call_off'`, an `asked: []` array for who was contacted, and
`resolved_at` / `resolved_how` / `covered_by`. The shape is right.

**Three unblocked gaps, none needing AxisCare:**

1. **The coverage case has no owner.** Exactly the defect Chain 4 had — it
   routes to a queue, not a person. `scheduling_coverage` resolves to Samantha
   today, so every call-off already lands on the CEO by configuration.
2. **No work item prompts anybody.** The case is written and nobody is told.
3. **`asked[]` is never filled.** The field for recording who was contacted
   exists and nothing writes to it, so the chase has no memory.

**Blocked and correctly parked:** which client and shift (step 3), eligible
available caregivers (step 5), writing the schedule back (step 9).

## Chain 1 status, 2026-08-13

| | |
|---|---|
| **BUILT** | Coverage case (existing), manual ask/response state (existing `covAsk`/`covAskState`), owner resolution, duty holder, candidate orchestration, `asked[]` dedupe memory, controlled waves |
| **PROVEN** | Dry-run recipient safety and no duplicate asks, tested against the whole roster rather than only inside a case |
| **BLOCKED** | **Autonomous sends, until trustworthy caregiver phone numbers exist.** An identity-source dependency, not a scheduling one |
| **BLOCKED BY AXISCARE** | Shift details, availability, schedule conflict, skills, overtime, distance, assignment write-back, family notification |
| **REMAINS** | **Inbound reply correlation** and **failure escalation** |

**Not complete.** A real caregiver response cannot yet travel back into the
same coverage case, and an unresolved case does not yet reliably become an
exception. Those two are the remaining unblocked work.

**Found by the dry run, and worth more than the phone gap:** wave 1 would have
rung **Samantha and Krystal**. The caregiver roster mixes office staff with
field staff, so candidate selection was about to offer to text the CEO and the
supervisor to cover a shift. Anyone holding an active office domain is now
excluded, read from the canonical `domains` record so adding a coordinator
never puts them in a wave by accident. Being on the roster is not consent.

**Do not solve the phone problem inside Chain 1.** The coverage machinery is
correct and waiting for trusted contact data. When AxisCare or stronger GHL
identifiers arrive, sending turns on without redesigning anything.

**Ranking is additive by design:** trusted identity → availability → schedule
conflict → required skills → overtime → distance → client relationship. Only
the first is real today; the rest attach as AxisCare exposes them.

**No family notification before assignment.** Accepted caregiver → human
selection → AxisCare assignment succeeds → *then* the family is told. Never
before the authoritative system has committed it.

---

# CHAIN 2 — New family → Start of Care → first follow-up

| # | Step | Who / where | Can it go? |
|---|---|---|---|
| 1 | Enquiry arrives | Web / phone / referral | **No** |
| 2 | Capture it | `lead-intake` → Hub | **GONE** — automated |
| 3 | Create follow-up work | Hub | **GONE** — one evolving item |
| 4 | Contact the family | Human | **No** — this is the sale |
| 5 | Chase if no answer | `lead-followup` ladder | **GONE** |
| 6 | Consultation | Human | **No** — judgment and relationship |
| 7 | Assessment | Human, in the home | **No** — physical |
| 8 | Draft the care plan | `ai-draft-careplan` | **GONE** — machine drafts, human approves |
| 9 | Determine payer | Human + documents | **Partly** — `ai-ltc-policy` reads LTC policies. Medicaid/VA still manual |
| 10 | Create the client in AxisCare | Human, AxisCare | **No** — AxisCare owns identity |
| 11 | Get it into the Hub | Manual today | **REMOVABLE** — **BLOCKED (AxisCare webhook)** |
| 12 | Scheduling handoff | `client_queue` checklist | **Partly gone** |
| 13 | Assign a caregiver | Human | **No** — matching is judgment |
| 14 | Call caregiver, call client | Human | **REMOVABLE** as a *reminder*; the calls stay |
| 15 | Confirm the first visit happened | Human checks | **REMOVABLE** — **BLOCKED (AxisCare visits)** |
| 16 | 24–72 hour follow-up | Human remembers | **REMOVABLE** — obligation engine, **BLOCKED** on 15 |
| 17 | Set the ongoing QA cadence | Human remembers | **REMOVABLE** — **BLOCKED** |

**Six steps already gone.** Five removable, all blocked by AxisCare. Six
correctly stay human — the sale, the assessment, the match.

---

# CHAIN 3 — Applicant → caregiver → compliant

The deepest existing automation, and the clearest example of `ASSISTED` hiding
manual work.

| # | Step | Who / where | Can it go? |
|---|---|---|---|
| 1 | Application arrives | Job page / GHL | **GONE** |
| 2 | Pre-screen | `/apply` + `score-interview` | **GONE** |
| 3 | Phone screen | `vapi-interview` (AI) | **GONE** |
| 4 | Book the interview | `interview-messages` | **GONE** |
| 5 | Conduct the interview | Cierra, Krystal covers | **No** — judgment |
| 6 | Collect referee details | Human asks | **REMOVABLE** — the form can. *Not automated yet* — **and this is why `references-run` found zero slots** |
| 7 | Contact referees | Human | **REMOVABLE**, but **channel and consent UNRESOLVED** — policy, not technical |
| 8 | Record responses | Human types | **No** — a reference is a conversation |
| 9 | Chase non-responders | Human remembers | **GONE** — built this session |
| 10 | Background checks | OIG live API, EDL, FCSR | **Mostly gone** |
| 11 | Decide to hire | Human | **No** — judgment |
| 12 | Book orientation | `orientation-booked` | **GONE** |
| 13 | Deliver orientation | Human, in person | **No** — physical |
| 14 | Promote to caregiver | One click | **GONE** — and it stopped destroying phone and email this session |
| 15 | Enter them in AxisCare | Human | **No** |
| 16 | Ongoing compliance | `obligations-run` | **GONE** — strongest engine in the Hub |
| 17 | Enter historical training dates | **Samantha, by hand, from WellSky** | **REMOVABLE** — the blocker on row 17 is data entry, not code |

**Step 6 is the interesting one.** Nobody collects referee contact details in a
structured way, which is why the reference workflow correctly found nothing to
chase. **Fixing step 6 is what makes step 9 useful.** That is a genuine chain
dependency invisible when looking at functions individually.

---

# CHAIN 4 — Client issue → resolution

Your challenge was right and my conclusion was wrong. Splitting it properly:

| Part | Status |
|---|---|
| **A. Intake** — how does the Hub learn someone has a problem? | **UNBLOCKED** |
| **B. Identity** — which client does it concern? | **PARTIAL** — caller recognition works for leads and applicants; clients and family are **BLOCKED** |
| **C. Management** — owner, due, escalation, resolution | **UNBLOCKED** — `ops_items`, domains, ownership, escalation and My Work already exist |
| **D. Detection** — spot issues nobody reported | **BLOCKED (AxisCare)** — needs care notes, call-offs, visit records |

| # | Step | Who / where | Can it go? |
|---|---|---|---|
| 1 | Family or caregiver reports a problem | Phone | **No** |
| 2 | Person recognises the caller | Caller recognition | **Partly** — works for leads; **BLOCKED** for family |
| 3 | Decide it is an issue, not a question | Human | **No** — judgment |
| 4 | Record it | **Nowhere structured today** | **REMOVABLE — UNBLOCKED. This is the gap.** |
| 5 | Decide who owns it | Human | **REMOVABLE** — domain routing already exists |
| 6 | Set a due date | Human | **REMOVABLE** — severity-driven |
| 7 | Work it | Human | **No** — the actual care work |
| 8 | Chase it | Human remembers | **REMOVABLE** — the ladder exists |
| 9 | Escalate if unresolved | Human judgment | **REMOVABLE** — `ops-escalate` exists |
| 10 | Tell the family | Human | **No** |
| 11 | Prove it is resolved | Nothing | **REMOVABLE** |
| 12 | Supervisory review | Human | **Partly** |

**Steps 4, 5, 6, 8, 9 and 11 are removable with what we already have.** The
client can be named as free text until AxisCare arrives — that is a *degraded
identity link*, not a fake client, and it is exactly how the office already
works on paper.

## Chain 4 status, 2026-08-13

| | |
|---|---|
| **BUILT** | Durable issue, 17 categories, action history, canonical routing, follow-up scheduling, duplicate candidates, degraded identity |
| **DEPLOYED** | `client-issues.sql` installed; `issues-run` live; intake, triage, action and resolve in the Hub at cc.mo-care.com; Owner Home exception-only |
| **UI-PROVEN** | 22 of 23 checks via the same endpoints the browser calls, routing verified in each recipient's own My Work filter |
| **PRODUCERS LIVE** | Manual intake (Report a concern) and `call-disposition` for `caregiver issue` / `client concern` |
| **BLOCKED BY AXISCARE** | **Automatic detection.** Nothing spots an issue nobody reported — care notes, visit anomalies, call-off and late-visit signals all need AxisCare |

**Reported issues are operational now. Discovering unreported ones is not.**

Proven end to end: routing to Cierra and Krystal in their own lists;
`needs_triage` from a phone concern; triage reclassifying the **same** issue
with its history intact; a second report offering the existing issue; an action
leaving the issue open; an issue-backed item refusing the generic close; a
14-day follow-up scheduled with a real date and only the completed check
resolving it; staleness raising attention with ownership unchanged; a first
name alone working with no client record manufactured.

**One decision outstanding:** `payer_authorization` still routes to
`client_care`, so Angiel's Medicaid, VA and authorisation work reaches Krystal.
A one-line change once confirmed.

**Not machine-proven:** that the buttons render and fire. Worth five minutes of
somebody pressing Report a concern and trying to close the result the lazy way.

---

# CHAIN 5 — Authorisation → utilisation → renewal

| # | Step | Who / where | Can it go? |
|---|---|---|---|
| 1 | Authorisation approved | Payer portal | **No** — external |
| 2 | Record hours and dates | AxisCare | **No** |
| 3 | Schedule within the limit | Human judgment | **Partly** |
| 4 | Track consumption | **Nobody systematically** | **REMOVABLE** — **BLOCKED (AxisCare)** |
| 5 | Notice it is running out | **Human memory** | **REMOVABLE** — **BLOCKED** |
| 6 | Request renewal | Human | **No** — external process |
| 7 | Chase the payer | Human remembers | **REMOVABLE** |
| 8 | Stop or continue at the limit | Human | **No** — judgment with revenue risk |

**Steps 4 and 5 are the entire risk.** An exhausted authorisation means care
delivered and not paid for. Nobody watches this systematically today, and it is
the clearest *revenue* case in the matrix rather than a labour case.

---

# What this reordering changes

Looking at functions, the priorities were reference chasing and lead
reconciliation. Looking at **chains**, they are:

1. **Client issue lifecycle (Chain 4, steps 4–11)** — unblocked, high frequency,
   direct client risk, and the office has no structured record of problems at
   all today.
2. **Referee capture (Chain 3, step 6)** — one form change that makes an entire
   already-built workflow useful.
3. **Call-off classification (Chain 1, step 2)** — the first removable step in
   the most expensive chain, and it does not need AxisCare.
4. **Authorisation tracking (Chain 5)** — blocked, but the highest revenue risk,
   so first in the AxisCare queue.
5. Everything else AxisCare-dependent.

**Chain 1 is where growth hurts most.** Call-offs scale with caregiver count, so
the office load grows linearly with the business unless nine of those twelve
steps disappear.

---

# Samantha dependency, properly scoped

`ops-escalate` is **one** path, not the definition. The full set to capture as
each workflow is touched:

| Event | Category |
|---|---|
| Formally escalated to her | EXCEPTION |
| Reassigned to her | depends on why |
| Approval only she or Zach can give | **OWNER WORK** |
| "Ask for help" directed at her | EXCEPTION |
| She completes something owned by someone else | **ADMINISTRATIVE LEAKAGE** |
| She picks up unowned work | **ADMINISTRATIVE LEAKAGE** |
| Recurring work she does because no role owns it | **ADMINISTRATIVE LEAKAGE** |

**OWNER WORK** is the system working. **EXCEPTION WORK** is acceptable and
should be rare. **ADMINISTRATIVE LEAKAGE is the number to drive to zero.**

Instrument cheaply as each workflow is touched. Do not build analytics over
processes about to be automated away. The order is **eliminate → automate →
assist → measure what remains.**

---

# AxisCare activation, one producer at a time

When access arrives: **authenticate → inspect real payloads → verify
authoritative identifiers → dry-run → inspect the rows → activate ONE producer.**
Then the next. No mass activation.

Order, by value: authorisations (revenue), call-offs (labour), caregivers
(identity), clients (foundation), visits (completion evidence), contacts (family
recognition).
