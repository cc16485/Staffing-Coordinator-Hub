# Step 3 · New Clients · "Who is this?" — record

**Status:** INSTALLED 2026-09-26 18:18 UTC by desktop script 234, all checks passed. Hub screens: care-coordinator-hub PR "Step 3".

## What it does
`client_admission_admit(case_id, existing|new, person_id, display_name, no_lead_reason, staff, seat, note)` admits an
AxisCare client who did **not** come from an inquiry, in one transaction: confirms who they are
(`client_admission_confirm`), then keeps the person's active Journey or opens an honest new one
(converted, began on or before the day AxisCare showed them, earlier history not observed). If the Journey
step is refused, the identity confirmation rolls back too. The decision and its reason are kept in
append-only `client_admission_journey`.

A client who came from an inquiry is not admitted here: the hub routes them through Step 2
(`lead_journey_connect`), which closes the admission case. The proof shows a second admission is then refused.
`client_admission_lead_options` lists, per open case, the unconnected inquiries it might have come from,
with a name hint only. The lead mirror is not touched.

The `client-admit` edge function (Journey seat holders): `prepare` (AxisCare lookup, read only, plus an
idempotent `client_admission_open` so New Clients arrivals the admission scan never saw still get a case),
`admit`, `dismiss`. CORS + OPTIONS.

## Files
| File | Purpose |
|---|---|
| `admission-newclients.sql` / `-rollback.sql` | Migration / rollback while unused |
| `admission_newclients_proof.py` / results | Disposable-Postgres proof: 20 / 20 |
| `admission_newclients_install.py` / proof / results | Installer (embedded in script 234): 3 / 3 |
| `client_admit_helpers_test.ts` | Edge-function helper tests: 7 / 7 |
| `supabase/functions/client-admit/` | prepare / admit / dismiss |

## Identity (SHA-256)
- `admission-newclients.sql` `de30096f7529064dd591cb7f20a1076ef317cf4defe82402b1f0378b7282c293`
- `client-admit/index.ts` `1ea7b62a621638c9c08b2818855a57420fd10e08d079d15ab57b1a38ea49fd92`

## Production at install
4 open New Clients launches with an AxisCare id; 2 will ask "Who is this?" (or show an unconfirmed lead);
1 admission case waiting. Nothing existing changed.
