# Domain ownership: current, interim, target

**Nothing here is changed. This is a proposal for decision.**

Ownership comes from `domains.owner_person` and changes only when a person
changes it. Responsibility rows describe capacity — what somebody does, covers
or is qualified for — and carry no routing authority.

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

**Where a second layer would genuinely help**, tested against the actual
domains rather than theory:

Krystal owns four domains and escalates to Samantha. **That escalation is
already a supervisor escalation** — there is nobody between them, so
"supervisor exception" and "owner decision" arrive identically. Making Krystal
the escalation target for **Cierra's `field_quality`** and **Angiel's
`payer_programs`** would stop those two domains at a supervisor. Their
escalations currently skip the supervisory layer entirely and land on the CEO.

That is two of ten domains fixed by a configuration change, no hiring required.

**Do not** change escalation on the domains Krystal owns. There is nowhere for
those to stop below Samantha until another supervisory role exists, and routing
them elsewhere would hide them.

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

Both must fall. Leakage measures whether the system is behaving. This measures
whether the org design still requires her. **A perfectly behaving system with
three CEO-owned domains still has a CEO bottleneck**, and only this number shows
it.

Instrument it where issues and ops items are created, next to the existing
dependency fields.
