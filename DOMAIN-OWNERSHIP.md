# Domain ownership: current, interim, target

**Nothing here is changed. This is a proposal for decision.**

Ownership comes from `domains.owner_person` and changes only when a person
changes it. Responsibility rows describe capacity — what somebody does, covers
or is qualified for — and carry no routing authority.

## Five distinct roles, not one

The Hub currently expresses two of these. Collapsing them is how a temporary
arrangement quietly becomes the org chart.

| Role | Question it answers | In the Hub today |
|---|---|---|
| **Accountable owner** | Who is responsible for this process working? | `domains.owner_person` |
| **Duty owner** | Who is handling it *right now*, by schedule or coverage? | duty windows — **not consulted by routing** |
| **Backup** | Who takes over when the duty owner cannot? | responsibility `kind='backup'` — unused for routing |
| **Supervisor escalation** | Who resolves exceptions the operational owner cannot? | `domains.escalation_person` |
| **Owner authority** | What genuinely requires Samantha or Zach? | `issue_category.owner_authority` |

**The accountable owner is not necessarily the person doing the work today.**
That distinction is the whole point for `scheduling_coverage`.

**Proposed, not built:** `domains` needs `owner_is_temporary` and
`target_owner_role`. Without them a stopgap is indistinguishable from a
decision, and "Samantha owns scheduling because we had nobody else in August
2026" reads a year later as the intended design.

Evidence: `domains` read live 2026-08-13 (`entity='cc_ihs'`). Where a
recommendation rests on inference rather than a record, it says so.

**Run script 96 before deciding `money`, `program_administration` or
`scheduling_coverage`.** Those three turn on what the domains actually contain,
and I do not have that yet.

---

## The ten domains, from their actual duties

Read live 2026-08-13 (script 96). **The duty counts change the picture.**

| Domain | Owner | Real primary duties | Reading |
|---|---|---|---|
| `scheduling_coverage` | Samantha | **8** — richest in the business | Real, detailed, and already marked TEMPORARY |
| `payer_programs` | Angiel | **7** — detailed | Real and correctly held |
| `field_quality` | Cierra | **7** — detailed | Real and correctly held |
| `client_care` | Krystal | 2 primary + 5 support | Real |
| `caregiver_performance` | Krystal | 1 | Thin but genuine |
| `family_enquiries` | Krystal | 1 + 1 support | Thin but genuine |
| `training_compliance` | Krystal | **1, TEMPORARY** — "Training and compliance" | **Stub. A label, not duties** |
| `recruiting_orientation` | Krystal | **1, TEMPORARY** + 6 qualified | **Stub.** Real capability sits with Cierra and Angiel |
| `program_administration` | Samantha | **1, TEMPORARY** — "Programme administration" | **Stub. Undefined** |
| `money` | Samantha | **ZERO** | **Empty. Not a domain yet** |

### This corrects my earlier concern about Krystal

I said she owns five domains and warned about concentration. True by count, but
**three of her five are thin or stubs**. Primary responsibilities are almost
evenly distributed: Krystal 7, Angiel 7, Cierra 7, Samantha 7, Zach 1.

The operational depth sits with **Cierra, Angiel and Samantha**. Krystal holds
breadth and supervision. That is a more defensible structure than the domain
count suggested, and my bottleneck warning was overstated.

---

## `money` — do not route anything here

**Zero active responsibilities.** It is a placeholder somebody created and never
filled. Samantha "owns" nothing, because nothing is defined.

**Recommendation: leave `billing_hours_question` on `client_care`.** A family
asking about their hours is a service conversation and Krystal's team should
answer it. Either define what `money` contains or retire it — an empty domain
with the CEO's name on it looks like CEO-owned work in every metric while
representing no work at all.

## `program_administration` — undefined, decide later

One TEMPORARY primary reading "Programme administration". A label.

**Recommendation: route nothing here and do not reassign it.** Moving an
undefined domain to Angiel would hand her an unknown scope. Define what it
contains first — provider agreements and licensure are genuine owner work;
routine payer administration is Angiel's.

## `scheduling_coverage` — the model is already right

This is the most important finding, and it reverses my recommendation.

The eight primaries are real and specific: own daily schedule integrity, work
call-offs from report through to covered, fill open shifts and record who was
contacted, confirm accepted shifts ahead of time, keep availability current,
communicate changes to client and every affected caregiver, escalate a genuinely
uncovered shift rather than leaving it open.

**Three things are already true:**

1. Samantha's primary here is **already marked TEMPORARY**. The org already
   knows this is a stopgap.
2. A **Staffing Coordinator position already exists** — `pos_staffing_c` — and
   **two duty windows already point at it**.
3. Backup and capability rows already exist, including direct-care coverage for
   call-offs.

So the five-role model is **already expressed in the data**. What is missing is
that `domains.owner_person` cannot say "temporary, target = pos_staffing_c",
so at the domain level a stopgap looks like a decision.

**Recommendation: change no ownership.** Add `owner_is_temporary` and
`target_owner_position` to `domains`, populate them from the TEMPORARY markers
already present, and have routing consult duty windows for the *duty owner*
while accountability stays put. Samantha remains accountable until
`pos_staffing_c` is filled, and the Hub says so out loud.

That also applies to `training_compliance`, `recruiting_orientation` and
`program_administration` — all three carry TEMPORARY primaries today.

---

## What `escalation_person` actually means today

Traced in the Hub. **One field, three different behaviours** — exactly the
conflation worth separating:

| Button | What the code does | Concept |
|---|---|---|
| Ask for help | sets `help_from`, comment says *"leaves accountability exactly where it was"* | **owner notification / assistance** |
| Needs Samantha | **sets `it.owner`** — accountability transfers | **ownership handoff** |
| Unclaimed discipline | escalation person gets *"waiting for owner approval"* | **owner decision** |

So the Hub already distinguishes assistance from transfer from approval. It
just points all three at one person per domain. The three-way split you
described is **already half-built** — it needs three fields, not a new concept:

- `assist_person` — can help; owner unchanged
- `operational_escalation` — authority to resolve the exception
- `owner_notify` — must know, does **not** become responsible

---

# The ten domains

## `scheduling_coverage` — the one that matters

| | |
|---|---|
| **Current owner** | Samantha (primary marked **TEMPORARY**) |
| **Actual work** | Four groups: (1) *daily integrity* — every shift has a confirmed caregiver; (2) *call-off response* — from reported through to covered, contacting and recording; (3) *availability upkeep* — new availability, restrictions, time off; (4) *communication and escalation* — tell client and every affected caregiver, escalate a genuinely uncovered shift |
| **Who does it today** | Samantha owns it. Krystal holds 2 backup rows. Cierra and Angiel hold `capability` rows for direct-care coverage on call-offs |
| **Capacity risk** | Moving it to Krystal adds the highest-volume queue to someone already holding 5 domains. **Relocates the bottleneck** |
| **Interim owner** | **Samantha, explicitly temporary.** No current person should absorb this |
| **Target owner role** | **`pos_staffing_c`** — already exists, already referenced by 2 duty windows |
| **Duty coverage** | Duty windows already point at `pos_staffing_c` |
| **Backup** | Krystal (2 backup rows), plus Cierra/Angiel for physical coverage |
| **Escalation path** | Operational: Staffing Coordinator resolves. Owner notify: a genuinely uncovered shift |
| **Owner-only decisions** | Refusing a shift we contracted to cover; agreeing to a rate or hours change to secure coverage; telling a client we cannot staff them |
| **Automation opportunity** | **Most of it.** Chain 1 has 9 of 12 steps removable: classify the call-off, identify the shift, find eligible available caregivers, broadcast, record responses, fill, update AxisCare, notify the family, escalate only on failure |

**This is the column that changes the hire.** Do not build the Staffing
Coordinator role around today's twelve duties. Around eight of them are
matching, broadcasting, confirming, recording and reconciling — machine work.

**The role that should exist:** owns coverage *performance*, caregiver
relationships, judgment on difficult fills, and the exceptions automation
cannot close. Not a person doing what Samantha does now, faster.

---

## `payer_programs` — correctly held, real depth

| | |
|---|---|
| **Current owner** | Angiel |
| **Actual work** | Three groups: (1) *case progression* — Medicaid IHS, VA, CDS through eligibility, enrolment, authorisation; (2) *record integrity* — FUSION, authorisations, enrolment data; (3) *referral relationships* — hospitals, social workers, case managers |
| **Capacity risk** | 7 primary + 3 support + 2 qualified. Fully loaded, correctly loaded |
| **Interim owner** | **Angiel — no change** |
| **Target owner role** | Payer Programs lead; referral relationships may split to business development |
| **Escalation path** | Operational: **needs a peer with payer authority, which does not exist.** Owner notify: authorisation about to lapse |
| **Owner-only decisions** | Continuing service on an expired authorisation; accepting a case at a payer rate below cost; provider-agreement matters |
| **Automation opportunity** | Authorisation tracking and expiry warnings — **currently nobody watches this systematically.** Blocked on AxisCare. Highest *revenue* risk in the matrix |

**Referral relationships do not belong here.** Growing referral sources is
business development, not payer administration. Flagged below.

---

## `field_quality` — correctly held, real depth

| | |
|---|---|
| **Current owner** | Cierra |
| **Actual work** | Three groups: (1) *competency* — coaching technique, OJT, early field support; (2) *surveillance* — reading care notes across active clients, spotting patterns across visits; (3) *follow-through* — carrying concerns to resolution, keeping every assigned caregiver informed |
| **Capacity risk** | 7 primary. Also covers shifts and runs interviews. **Watch this one** |
| **Interim owner** | **Cierra — no change** |
| **Target owner role** | Clinical Coordinator, possibly RN |
| **Escalation path** | Operational: clinical judgment — **no peer exists.** Owner notify: safety |
| **Owner-only decisions** | Removing a caregiver from all clients; ending a client relationship on safety grounds |
| **Automation opportunity** | **"Review care notes routinely across active clients" and "watch for patterns across multiple visits" is the biggest unautomated reading load in the business.** Blocked on AxisCare notes. Chain 24 in the matrix |

---

## Krystal's five

`client_care` (2 primary + 5 support), `caregiver_performance` (1),
`family_enquiries` (1 + 1 support), `training_compliance` (**1, TEMPORARY —
stub**), `recruiting_orientation` (**1, TEMPORARY — stub**, with 6 `qualified`
rows showing Cierra and Angiel actually conduct interviews and orientation).

**Interim: no change.** Three of the five are thin or stubs, and her total
primary count is 7 — the same as Angiel, Cierra and Samantha. **My earlier
bottleneck warning was overstated.**

**Automation opportunity:** monthly check-ins are cadence work the obligation
engine already models (blocked on clients). Training compliance is the Hub's
strongest engine already. Recruiting is the deepest existing automation.

**Owner-only decisions:** terminating a caregiver; declining a client.

---

## `money` — retire or define

**Zero active responsibilities.** An empty placeholder with the CEO's name on
it, which inflates every CEO-ownership metric while representing no work.

**Recommendation: retire it, or define it.** Leave `billing_hours_question` on
`client_care`.

## `program_administration` — undefined

One TEMPORARY primary reading "Programme administration". A label.

**Recommendation: route nothing here, reassign nothing.** Handing an undefined
scope to Angiel gives her unknown work.

---

# Challenging the taxonomy

**Retire `money`** — empty.

**Define or retire `program_administration`** — a label, not a scope.

**`training_compliance` and `recruiting_orientation` are stubs** whose real work
lives elsewhere: compliance in the obligations engine, recruiting capability
with Cierra and Angiel. Either populate them or fold them into
`caregiver_performance` and a staffing lane.

**Referral relationships are misfiled.** Building relationships with hospitals
and case managers is business development, sitting inside payer administration
because Angiel does both. Different work, different measure, different future
owner.

**`client_care` and `family_enquiries` may be one lane.** Same owner, adjacent
work, one is the front door to the other. Worth asking whether the split earns
its keep.

**Honest count: ten domains, six carry real duties.**

---

# The recommendation, in one line per domain

| Domain | Current → Interim → Target |
|---|---|
| `scheduling_coverage` | Samantha → **Samantha, marked temporary** → `pos_staffing_c`, scoped to exceptions and relationships |
| `payer_programs` | Angiel → Angiel → Payer Programs lead (referrals split out) |
| `field_quality` | Cierra → Cierra → Clinical Coordinator |
| `client_care` | Krystal → Krystal → Care Coordinator |
| `caregiver_performance` | Krystal → Krystal → supervisory role |
| `family_enquiries` | Krystal → Krystal → merge into `client_care`? |
| `training_compliance` | Krystal → Krystal → **populate or fold in** |
| `recruiting_orientation` | Krystal → Krystal → `pos_staffing_c` |
| `money` | Samantha → **retire or define** → — |
| `program_administration` | Samantha → **define first** → — |

**No ownership changes proposed.** The two real changes are structural: add
`owner_is_temporary` and `target_owner_position` to `domains`, and split
`escalation_person` into assist / operational-escalation / owner-notify.

---

## Issue-category routing recommendations

Based on the underlying work, not the label:

| Category | Currently | Recommend | Why |
|---|---|---|---|
| `billing_hours_question` | `client_care` | **`client_care`** — keep | A family asking about hours is a service conversation, not a finance task |
| `payer_authorization` | `client_care` | **`payer_programs`** | Angiel owns Medicaid, VA and authorisations. This is her work |
| Training or compliance issue | *no category* | **new category → `training_compliance`** | A gap: nothing routes there |
| Program administration issue | *no category* | **hold** | Depends on what the domain contains |

The `payer_authorization` move is the one I would make immediately — it is
currently routing Angiel's work to Krystal.

---

## The new signal: CEO-owned operational work

Administrative leakage measures work that *escaped* to Samantha.

It cannot see work **designed** to land on her. Three of ten domains, including
the highest-volume queue in the business, route to her by configuration, and
every one of those items would be recorded as correctly routed.

So a second measure is needed:

> **CEO-OWNED OPERATIONAL WORK** — routine domain work landing on Samantha
> *before* any escalation, because she is the configured owner.

And a third, because the goal is not zero:

> **OWNER DECISIONS** — work that legitimately required Samantha or Zach's
> authority.

| Measure | Target |
|---|---|
| CEO-owned operational work | **toward zero** |
| Administrative leakage | **toward zero** |
| Owner decisions | **visible and intentional — not zero** |

Leakage measures whether the system is behaving. CEO-owned operational work
measures whether the org design still requires her. Owner decisions measure
whether she is spending her authority on things that actually need it.

**A perfectly behaving system with three CEO-owned domains still has a CEO
bottleneck**, and only the second number shows it. Together they answer whether
this is a company that can operate without Samantha doing routine
administration — rather than a company with more automation.

Instrument all three where issues and ops items are created, next to the
existing dependency fields.
