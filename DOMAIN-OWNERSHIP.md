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

## Escalation, classified

All ten escalate to Samantha. Before adding a tier, classify what actually
arrives:

| Type | Definition | Where it should stop |
|---|---|---|
| **SUPERVISOR EXCEPTION** | Owner cannot resolve it; a supervisor should | **the supervisor of that lane — decided per domain, not one person** |
| **OWNER DECISION** | Genuinely needs Samantha or Zach authority | Samantha |
| **SAFETY / URGENT** | May need immediate owner visibility | Samantha, always |
| **ADMINISTRATIVE LEAKAGE** | Should never have reached her | nobody — fix the cause |

### I withdraw my earlier recommendation

I suggested pointing Cierra's `field_quality` and Angiel's `payer_programs`
escalation at Krystal. **That was wrong, and wrong in a way worth naming.**

Krystal already owns `client_care`, `caregiver_performance`, `family_enquiries`,
`training_compliance` and `recruiting_orientation` — five domains. Adding
supervision of Cierra and Angiel makes it seven, plus scheduling exceptions.

**That is not scalability. That is rebuilding the bottleneck one level down.**
Getting Samantha out of the middle is worthless if Krystal becomes the human
router for the whole company.

The observation underneath it still stands: Cierra and Angiel escalate straight
past any supervisory layer to the CEO. But the fix is not "send it to Krystal by
default". The real question is per domain:

- Who should be **accountable**?
- Who actually **supervises this kind of work**?
- What exceptions can that supervisor **decide**?
- What specifically requires **Samantha or Zach**?

Those may be **different paths**. Field quality is clinical and practical.
Payer programs is regulatory and financial. Staffing is operational and
time-critical. There is no reason one person should sit above all three, and
good reason they should not.

**Recommendation: decide the supervisory path per domain from the duties in
script 96, and constrain any one person to a defensible number of domains.**
If a lane has no supervisor other than the CEO, that is a hiring signal — not a
reason to pile it on whoever is nearest.

Of the sixteen issue categories, only `suspected_abuse` is flagged
`owner_authority`. Everything else that reaches Samantha does so through
staleness or configuration, not because it needs her authority.

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
