# Change 1 · New Clients reads what AxisCare already knows

Approved 2026-09-26 (audit decisions 1 to 4, "start with 1"). Source audit: https://claude.ai/artifact/KxCJaAFDcXgBdoT2SYNxL7

## What the coordinator sees

| Launch step today | After this change |
|---|---|
| ☐ Caregiver assigned in AxisCare, then type the name | No box. Shows who AxisCare has on the upcoming visits ("Jane Doe, next 6 visits"; "2 upcoming visits have nobody yet"). |
| ☐ Called and briefed the caregiver (notes) | Unchanged. |
| ☐ Called the client and confirmed (notes) | Unchanged. |
| ☐ Schedule entered in AxisCare | No box. Shows "12 visits in AxisCare, next Mon Sep 29 at 9:00". |
| ☐ EVV / setup verified for the first shift | Stays a person's pre-shift check (the call to make sure the caregiver can clock in). Satisfied on its own once the first shift clocks in and out. |
| ☐ First shift completed | No box. Shows "Care began Sep 22: Jane Doe clocked in 9:02, out 12:01 (Mobile, verified)". |
| Follow-ups, DSDS notice, Launch Complete | Unchanged. |

When the evidence is missing, conflicting or exceptional, the step shows why in amber and offers "Record by hand" with a required reason. Nothing is ever un-ticked, and nothing a person recorded is replaced.

Actual SOC everywhere (New Clients card, lead profile, client profile "Their start") becomes the Springfield date of the first real clock-in, labelled as coming from AxisCare. A hand mark stays visible as a hand mark.

## The evidence rules (launch-evidence.js, tested 27/27 in three time zones)

- Only this client's visits, not removed, from the later of AxisCare go-live (2026-08-17) and the day the launch opened.
- First shift = the earliest visit with a clock-in AND a clock-out. Actual SOC = its clock-in date on Springfield's calendar. "Verified" is shown as extra strength, not required.
- Never counted: a scheduled visit, planned times, a "verified" visit with no clock-in, the AxisCare profile start date.
- Sent to a person, nothing recorded:
  - clock-in with no clock-out after the visit should have ended (2 hours grace);
  - an earlier visit with a caregiver but no clock-in (care may have begun without EVV);
  - a clocked visit before this launch opened (first launches only; returning clients' old visits are history);
  - "first shift" marked by hand before any clock-in AxisCare shows.
- Flagged for attention, nothing recorded: the start date passed with no clocked visit; past visits with a caregiver but no clock-in.
- A step a person records by hand, with a reason, is that person's decision: its questions close, and AxisCare's later evidence is kept beside it, never over it. A bare checkbox tick earlier than any clock-in is still a question.
- Clients already in care before AxisCare: unchanged, "not recorded (care was already under way when tracking began)".

## How it stays in step

- `launch-evidence` edge function (signed-in staff; CORS from day one):
  - `refresh` for one card, run when the card opens: reads that client's visits live, returns what AxisCare shows, and records new evidence when the switch is on.
  - `record` for "Record by hand": a signed-in person, a reason (and the day care began, for a first shift). Not behind the switch; it is a person's act.
  - `run` for every open launch opened in the last 120 days, 25 per run, every 30 minutes day and night (care happens overnight too): dry until `ops_settings.launch_evidence_live`, stops politely on AxisCare 429, logs seen/recorded/flagged counts to `automation_log`.
- The function fetches `launch-evidence.js` from the live hub and stops if it can't, like promise-run.
- Reads only. Nothing is written to AxisCare in this change.

## Storage: the one new thing (approved 2026-09-26)

No new columns on `client_queue` (it is shared with the Staffing hub and the older lazy engine).

One new append-only table, `launch_evidence`, one row per recorded fact:

| column | holds |
|---|---|
| launch_id | the New Clients launch (`client_queue.id`) |
| fact | schedule, caregiver, first_shift, evv |
| source | axiscare, or person (hand record) |
| evidence | the visit id, clock-in and clock-out, caregiver, clock-in method, verified |
| reason | required when a person records by hand |
| recorded_by, recorded_at | who (the automation, or the staff email) and when |

Written only through one door, `launch_evidence_record(...)` (server only, advisory lock, audit, refuses a completed launch). The door also ticks the matching existing `client_queue` box when it is still empty, with the evidence time (the clock-in time for the first shift), so every existing reader, including Launch Complete and the older Staffing hub checklist, keeps working unchanged.

## Also in this change

- `coverage-shifts` and `timekeeper-watch`: clock-in and clock-out are records, not text. Live Schedule showed "ect]" for clock times. Fixed with `clockHM()`; timekeeper's chase behaviour is unchanged (it was right by accident).
- `axiscare-open-shifts` (Training project) has the same record-as-date mistake. Separate project and deploy; next.

## Also fixed along the way

- New Clients retried a failed family load on every redraw (about 90 redraws in 5 seconds when signed out or offline). It now retries once a minute.

## Proof

| What | Result |
|---|---|
| Engine rules (`launch_evidence_test.js`) | 27/27, in Chicago, UTC and Tokyo time |
| Table + Door in disposable Postgres (`launch_evidence_proof.py`), fed by the real engine | 25/25 |
| Edge function under Node with fake AxisCare (`launch_evidence_harness.mjs`) | 17/17 |
| Install + on/off scripts against fake services and real Postgres (`launch_evidence_scripts_proof.py`) | 11/11 |
| Card in the hub preview with sample data | read-outs, exception, hand-record form, switch-off view |

## Rollout

1. Merge the hub pull request (card, readers, `launch-evidence.js`). With nothing installed the card keeps its checkboxes.
2. `239` installs the table, Door and function, redeploys coverage-shifts and timekeeper-watch with the clock-time fix, and does one dry run with a preview. Cards now show AxisCare's view beside the checkboxes.
3. `240` turns it on: switch, every-30-minutes schedule, one live run with counts. `241` turns it off.
