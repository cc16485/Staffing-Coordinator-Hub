# "When a caregiver calls in" · each client's call-in plan (built 2026-09-27)

Her ask (2026-09-27): client-by-client rules for how a call-in is handled (LeeAnn Walker: only
Dixie or Autumn; if neither, her friend covers), plus "a notes section ... so we can also go and
manually look and see who put in the info and where they got the info". Approved: "yes to all,
any staff can add, do this first then change 8".

## What it is
- **Client 360 → "📞 When a caregiver calls in"** (under Home & life). The plan in force, then the
  full history. "＋ Add an update" starts from the plan in force.
  - Coverage: Must be covered, no matter what / Cover it if we can / Family would rather cover it
    themselves (call them first) / Flexible: the visit can move to another time or day / Not asked yet
  - Only ask these caregivers (AxisCare's live active list)
  - Outside backup: name, phone, relationship (a person calls them; Cara never does)
  - What did they tell you? (notes for staff; Cara doesn't act on them)
  - Who told us (required) and how (phone, in person, assessment, care plan review, text, email)
  - Who entered it and when: from their sign-in, never the form
- **The call-off board:** a chip on each open case (🔴 must be covered, 👪 call the family first,
  🔁 flexible on time, 📋 only certain caregivers) and the plan above Cara's picker, with the note,
  who entered it, and a link to the full history.

## What Cara does (fixed rules only)
| Plan | Cara |
|---|---|
| only-ask list | offers and texts ONLY those caregivers; everyone else "not on <client>'s call-in list" |
| must be covered | the admin text goes at any hour, "MUST BE COVERED (call-in plan)"; the email's subject and body say so |
| family covers / flexible | no automatic caregiver texts; the case's first step says what to do |
| backup, notes | shown to people only |
| plan can't be read | everyone held (fail closed), and the picker says why |

## Built
- `client-callin-plan.sql` (sha 7af1de8c…): `client_callin_entries` (append-only, guards on
  update/delete/truncate), `client_callin_current` (latest per client), door `client_callin_add`
  (service_role only; validates everything; request id makes a double click record once).
  Signed-in staff read both; nobody writes except through the door.
- `supabase/functions/callin-plan` (sha a0d35032…): signed-in staff only, `add` only.
- `supabase/functions/_shared/callin-plan.ts` (sha e936dc47…) + `coverage-run` (sha 62cf0c7d…).
- Hub: `cipProfileLoad`, `cipOpenForm`, `cipSave`, `cipEnsureForCases`, `cipCaseChip`,
  `cipCaseHtml`; `covLoadCaregivers` shared with the call-off dropdown.

## Proof
- `client_callin_proof.py` 10/10 (disposable Postgres)
- `callin_plan_harness.mjs` 16/16: the REAL coverage-run; against the old engine the new rules fail
  and the "as today" checks pass
- `callin_plan_hub_test.mjs` 18/18 (the hub's own code; a note with code in it shows as text)
- `callin_plan_fn_test.mjs` 4/4; `callin_plan_install_proof.py` 7/7
- Earlier harnesses still pass: covered-outside 18/18, held-shift 24/24
