# Phase 0 · security fixes (576)

Samantha approved the eight P0 items from the Cara Implementation Plan on 2026-10-10 with three rules: narrow scope,
tested, documented; no operational permission changes; no new AI autonomy. This file is the engineering record. The
Desktop step **576 Phase 0 security.command** deploys it and writes a report; the report is the live proof.

## What the review found before changing anything

The inventory scans read a local clone that was 77 commits behind. Re-checked against `origin/main` on 2026-10-10:

| # | Finding in the plan | Status on main | What 576 does |
|---|---|---|---|
| 1 | Four functions with no caller check: transcribe-recording, score-interview, ai-ltc-policy, oig-check | score-interview was already fixed (live fix 562, 2026-10-09). The other three were open. | transcribe-recording and ai-ltc-policy: `requireStaff(OFFICE_ROLES)`. oig-check: moved from cc-hub-live into this repo with the staff check, on the Hub project, using the same LEIE reader as the nightly caregiver audit (`_shared/oig-leie.ts`). |
| 2 | caregiver-intro reaches families on a bare sign-in | Open. | `requireStaff(OFFICE_ROLES)`, the same check as circle-send. |
| 3 | ghl-attach-doc: shared key in the browser, GHL contact upsert, no audit | Half stale. The Hub stopped holding the key on 2026-09-28 (T2) and sends its own sign-in; the Training-project copy still wanted the key, so every filing since then failed with "missing key" and the Hub swallowed it. | Moved into this repo on the Hub project with the staff check and one `op_events` row per filing (`prehire_doc_filed`). The Hub calls it through its own sign-in and says so when a filing fails. The Training-project copy is removed only if it is byte-for-byte the retired build. Filing documents onto the GoHighLevel contact starts working again. |
| 4 | orientation-booked: public-key relay into a GHL workflow | Already fixed (live fix 562, 2026-10-09): relays only a real booking saved in the last 15 minutes, once, never while the Hub's own reminder is on. | Nothing. Listed in the automation review for the "one reminder system" decision. |
| 5 | shift-confirm answers any caller with the public key; ops-escalate on a URL token | Open. | Both answer only `jobCaller` (the vault secret `hub_job_secret` as `x-cron-secret`, or the owner's server key). `?auth_check=1` answers who the caller is and does nothing. 576 re-points any schedule that calls them to carry the vault secret in the same run. If the vault secret is missing, neither is deployed. |
| 6 | Owners Hub records protected only by a client-side email list | Open. | `owner_keys_lock_576.sql`: four restrictive rules on `app_data` for finance_snapshots, owner_settings, budget_lines, budget_actuals, offboardings, file_audits, using `public.desk_is_owner()`. `discipline_actions` is deliberately NOT locked: coordinators issue and read write-ups through it. Applied only when both owners resolve to owner_admin with Hub access. |
| 7 | Checkr webhook accepts results when its secret is unset | Open. | `checkrHmacOk` returns false with no secret. ht-local is deployed only when `CHECKR_WEBHOOK_SECRET` exists, otherwise skipped and reported, so nothing changes until the secret is set. |
| 8 | New Clients schedule-note push calls a different Supabase project | Misread by the scan: it is the same project. The real issue is that it calls `axiscare-push-note`, a function in no repo. | Nothing. 576 reports whether that function is live. If it is, it goes on the automation review (an untracked AxisCare writer); if not, the Hub call is dead code for P2 clean-up. |

Also found while here: the inventory's sender register gap, the browser-composed caregiver texts and the free-text
candidate door are P1 and untouched.

## Files

- `supabase/functions/transcribe-recording/index.ts`, `ai-ltc-policy/index.ts`, `caregiver-intro/index.ts`: staff check.
- `supabase/functions/shift-confirm/index.ts`, `ops-escalate/index.ts`: job caller, `auth_check`.
- `supabase/functions/ht-local/index.ts`: Checkr fail-closed.
- `supabase/functions/oig-check/index.ts`, `ghl-attach-doc/index.ts`: new here (moved from cc-hub-live).
- `owner_keys_lock_576.sql`, `owner_keys_lock_576_rollback.sql`.
- `phase0_576_test.mjs` (32 checks), `phase0_576.py` (the step), `quiet_hours_425_test.mjs` (ops-escalate now called with the secret).
- cc-hub-live: `caregivers-engine.js` calls ghl-attach-doc on the Hub project through `sb.functions.invoke`; the two stale function folders are deleted there.

## Tests

`node phase0_576_test.mjs` runs the real function code under Node with a stand-in database, GoHighLevel and LEIE file:
no sign-in, public key and non-office role refused on five functions; shift-confirm and ops-escalate refuse the public
key and a URL token and accept only the vault secret (as cron) or the owner key (as owner); a Checkr result with no
secret is refused, a forged signature is refused, a real one passes; filing a document writes one op_events row that
never carries the email or phone. 32/32 pass.

Regression: caregiver_profile_2b, nsf2_families, nsf2_scheduling, nsf3_hometogether, optout_0b3, s4_htlocal,
s5_staff, staff_alerts_one_contact all pass as before. optout_0b2 fails 4 checks on main before this change (not
touched). quiet_hours_425 had one pre-existing failure on main (the "scan" check); its ops-escalate calls were updated
to the new auth and pass.

## Order

1. Merge the Staffing-Coordinator-Hub pull request.
2. Run **576 Phase 0 security.command** on the Desktop and read the report.
3. Merge the cc-hub-live pull request (the Hub then calls the moved functions).

## Rollback

Any function: redeploy the previous build from git history. Owner keys: `owner_keys_lock_576_rollback.sql`. A
re-pointed schedule keeps working with either build of its function.
