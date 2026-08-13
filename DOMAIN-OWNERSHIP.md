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

## The ten domains

| Domain | Current owner | What the work is | Best owner **today** | Target **at scale** | Is Samantha's ownership right? |
|---|---|---|---|---|---|
| `client_care` | Krystal | Client service, follow-ups, family relationship | **Krystal** | Care Coordinator, then a Client Care lead | n/a |
| `caregiver_performance` | Krystal | Conduct, discipline, coaching outcomes | **Krystal** | Krystal — supervisory by nature | n/a |
| `field_quality` | **Cierra** | Hands-on competency, OJT, supervisory visits | **Cierra** | Cierra, growing into Clinical Coordinator | n/a |
| `family_enquiries` | Krystal | New enquiries, consultations, conversion | **Krystal** | Care Coordinator | n/a |
| `recruiting_orientation` | Krystal | Hiring pipeline, interviews, orientation | **Cierra** (runs morning interviews and orientation; Krystal covers) | Staffing Coordinator | n/a |
| `training_compliance` | Krystal | Training records, annual and Medicaid compliance | **Krystal** | Compliance-holding role | n/a |
| `payer_programs` | **Angiel** | Medicaid, VA, CDS, authorisations, eligibility | **Angiel** | Angiel, growing into Payer Programs lead | n/a |
| `scheduling_coverage` | **Samantha** | Call-offs, open shifts, coverage — **highest volume in the business** | see below | **Staffing Coordinator** | **No — temporary** |
| `money` | **Samantha** | Unknown split: routine billing vs owner financial authority | see below | split, see below | **Probably only in part** |
| `program_administration` | **Samantha** | Unknown: routine payer admin vs owner compliance | see below | see below | **Probably not** |

**Escalation is Samantha for all ten.**

---

## The three that matter

### `scheduling_coverage` — the one that costs the most

Chain 1 is the highest-frequency, most urgent, most interrupt-driven work in the
business, and nine of its twelve steps are removable. It is owned by the CEO.

**Do not reassign it to make a metric look better.** Three real options:

1. **Krystal as operational owner now.** She already owns four domains and is
   the supervisory layer. Adds the largest queue in the business to the person
   already carrying the most.
2. **Samantha stays interim owner, explicitly marked temporary**, with a named
   target owner recorded. Honest, changes nothing today, and makes the
   dependency visible instead of looking like a settled design.
3. **Use the existing duty-window or backup structure** to express who handles
   coverage day to day without moving accountability. Script 96 shows whether
   duty windows already do this — if they do, this is the best answer, because
   it is the mechanism you built for exactly this question.

**My recommendation: 3 if duty windows already carry it, otherwise 2.** Option 1
moves the bottleneck rather than removing it. What actually fixes this is the
Staffing Coordinator hire, and until that person exists, the honest state is a
temporary owner with a named successor.

### `money` — separate authority from administration

**Owner authority and operational ownership are different things**, and this
domain probably conflates them. The split:

| Work | Belongs to |
|---|---|
| Routine billing runs, invoices, statements | **Not the CEO.** Admin or Client Care |
| Client billing questions | **`client_care`** — a family asking about their invoice is a service conversation |
| Payroll questions | **Viventium and the payroll holder**, not a Hub domain |
| Payer reimbursement issues | **`payer_programs`** — Angiel |
| Rates, write-offs, financial commitments | **Samantha — genuine owner authority** |

If script 96 shows `money` is mostly the first three rows, most of it should
move and only the last row should stay.

### `program_administration` — needs its contents read

If it is routine Medicaid, VA and CDS administration, it belongs with
**Angiel** alongside `payer_programs`. If it holds genuine compliance and owner
decisions — provider agreements, licensure, regulatory attestations — it stays
with Samantha, and the routine part should be split out rather than the whole
domain moving.

---

## Escalation, classified

All ten escalate to Samantha. Before adding a tier, classify what actually
arrives:

| Type | Definition | Where it should stop |
|---|---|---|
| **SUPERVISOR EXCEPTION** | Owner cannot resolve it; a supervisor should | **Krystal** |
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
