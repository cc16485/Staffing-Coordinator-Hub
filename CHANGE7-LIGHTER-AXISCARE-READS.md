# Change 7 · Lighter, faster AxisCare reads (map and plan, nothing built)

Audit wording (2026-09-26): "Visit polling uses 'changed since'; ask AxisCare support
to switch on change notifications, used only as doorbells."

## What reads AxisCare visits today

| Job | How often | What it reads | Why it needs it |
|---|---|---|---|
| timekeeper-watch | every 2 min | today's visits | late or missing clock-ins |
| timekeeper-watch (EVV chase) | once a day after 9am | yesterday | missing clock-outs to chase |
| coverage-run | every 3 min | visits for open cases; the caregiver census when a case is open | filling call-offs |
| coverage-watch | every 5 min | the next 72 hours | new call-offs (a visit with no caregiver) |
| coverage-watch (sweep) | hourly | the next 14 days | unassigned recurring shifts |
| coverage-watch (history) | hourly, only when unassigned shifts exist | the last 21 days | "make them the regular" suggestion |
| coverage-watch (pattern) | when an open case needs it | next 28 days, visits and schedules | "every Tuesday" labels |
| coverage-watch (notes) | hourly | yesterday and today, plus up to 70 single-visit reads | care-note flags |
| coverage-watch (attendance) | once a day | yesterday | tardy log |
| launch-evidence | every 30 min | one read per client in launch | Actual SOC |
| carematch-watch | daily | a short window | care-match check-ins |
| coverage-shifts | on screen open | various | Live Schedule and Cara screens |

At one page per read, that works out to about 65 calls an hour, plus a burst of
up to about 80 at the top of each hour. It is not large, but it is steady.

## The catch: "changed since" can't replace most of these

`updatedSinceDate` returns visits that CHANGED. Two of the most important
checks look for things that did NOT happen, or that did not change:

1. **Late clock-in (timekeeper-watch).** A caregiver who never clocks in produces
   no change. Only the full list of today's visits shows the missing clock-in.
2. **Call-offs entering the 72-hour window (coverage-watch).** A shift that was
   left open a week ago doesn't change when it comes within 72 hours. Only a
   window read finds it.

So a "changed since" read can only sit ON TOP of the window reads, making new
changes show up sooner. It can't remove them without a shared, always-fresh copy
of the schedule. That copy would feed the two jobs that protect clients (call-off
detection and the clock-in watch), and if it went stale both would go quiet.

It is also unproven. We don't yet know that `updatedSinceDate` includes:
- a visit whose caregiver was removed (the call-off itself);
- a clock-in or clock-out;
- visits generated from a recurring schedule (ids `s=…:d=…`) when the schedule is edited.

## Proposed order (one step at a time)

**7a · Measure and prove, read-only (proposed for approval).** A new read-only
function, `axiscare-read-probe`, that only the owner script (service role) can call,
plus Desktop 253. It changes nothing and sends nothing. It reports:
- pages and visit counts for each window above (today, 72h, 14d, 21d back, 28d);
- any 429 or other AxisCare errors recorded by the pollers in `automation_log`;
- the natural experiment: every clock-in recorded in the last 24 hours, and every
  call-off case opened in the last 7 days. Did `updatedSinceDate` return that visit?
  Did it return visits from recurring schedules at all?
- counts and visit ids only, never names.

**7b · Decide from the evidence.**
- If the pollers show no 429s and `updatedSinceDate` misses anything above: leave
  the pollers alone. They are cheap and they work. Change 7 ends as the support
  request and 7c.
- If `updatedSinceDate` proves complete: add a 1-minute "changed since" read that
  lets coverage-watch see a new call-off within about a minute, while the existing
  window reads stay as the safety net (possibly less often). The full design would
  come back to you first.

**7c · Doorbells, when AxisCare switches notifications on.** The client receiver
already exists (log-only, fails closed without a secret). A visit doorbell would
record the event and then run the same read as 7b, never acting on the message
body. Waits on AxisCare support.

## Open question for Samantha
- Was "AxisCare support request - change notifications.txt" sent?

## 7a as built (2026-09-27, approved "yes, build 7a")

- `supabase/functions/axiscare-read-probe/index.ts` (sha256 fed74605…): service role only
  (legacy JWT or the exact new-style secret, constant-time compare); CORS + OPTIONS. GET
  `/api/visits` only; reads `app_data.coverage_cases`; writes nothing. 250 ms between
  requests, 30-page cap per read, stops everything on the first 429, never follows a
  "next page" off our AxisCare site. Output is counts and visit ids only.
- Tests: A clock-ins/outs in the last 24h (strict), B call-off cases this week (open,
  closed, sweep), C unassigned in the next 72h, D every visit AxisCare itself marks as
  changed in the last 24h, plus recurring-schedule ids, the combined date + since filter,
  and visit field names. A visit not returned whose own last-changed time is before the
  period counts as "changed before this period", not a miss (except for A).
- `axiscare_read_probe_report.py` + Desktop 253: sha-check, deploy, run, then read-only
  SQL on `cron.job`, `cron.job_run_details` (24h) and `net._http_response` for 429s
  passed on by timed jobs.
- Proof: `axiscare_read_probe_harness.mjs` 23/23 (`axiscare-read-probe-harness-results.txt`);
  `axiscare_read_probe_scripts_proof.py` 15/15 against a real disposable Postgres queried
  as a SELECT-only role (`axiscare-read-probe-scripts-proof-results.txt`).

## 7a result (Desktop 253, 2026-09-27 07:21 UTC)

- Load is small: today 15 visits / 1 page, next 72h 65 / 1 page; about 52 visit reads an
  hour. No 429 and no AxisCare error passed on by any timed job in the ~6 hours kept; no
  cron failures in 24 hours.
- "Changed since" returned 10/10 clock-ins, 7/7 clock-outs, 4/4 closed call-offs; the
  combined date + since filter behaves as AND. It returns recurring-schedule ids (s=…).
- One ✗: s=119:d=2026-09-28, unassigned with a call-off reason, not changed in 7 days
  (probably called off earlier; can't tell, see next point).
- **Visits carry NO last-changed field** (only modificationReason). coverage-watch's
  "a human-closed case holds unless the visit changed since (modifiedDate)" rule therefore
  can never see a change: any shift with a closed case never gets a new case, including a
  second call-off after a fill. Desktop 254 (read only) lists every unassigned upcoming
  shift, the watcher's verdict and its case history, and flags HELD shifts.
- Direction for 7b: leave the timed window reads alone (cheap, no 429s, and "changed
  since" can't see a missed clock-in). Use "changed since" for the one thing it fixes:
  replace the missing modifiedDate in the reopen rule.

## 7b as built (2026-09-27, approved "yes, build 7b")

Desktop 254 found Joel & Carol Wolverton's shift today unassigned ("Staffing Change -
Caregiver Call Off") with its only case closed last night as covered by Grace Levering:
held, with nobody told.

- `supabase/functions/_shared/held-shift.ts` (sha c4e16ffa…): `changedSince` (one read:
  that visit's own day, `updatedSinceDate` = the close; 404 = no change; any error = "can't
  tell", never "no change"), `decideHeld`, `heldItem`, `visitMs` (a time with no offset is the
  visit's own wall clock, Springfield by default).
- `coverage-watch` (sha 47f7d15f…): the dead `modifiedDate` guard is gone. For a called-off
  shift whose last case is closed: changed → a fresh case (generation n+1, "Opened again");
  unchanged + covered → a high-urgency My Work item for a person (Cara texts nobody);
  AxisCare can't be asked → an item for a person; unchanged + closed any other way → held.
  Items have deterministic ids and are never raised twice or reopened after a person closes
  them. "Already started" uses `visitMs`.
- All of it sits behind `ops_settings.coverage_watch_7b_live` (off by default). While off,
  the watcher behaves exactly as before and only REPORTS `held_checks` and `time_check`
  (does AxisCare send an offset; which shifts the old reading gets wrong).
- Found while building: if AxisCare's times have no offset, the old `new Date(start)` read
  them as UTC on Supabase, so a call-off within about 5 hours of the shift was ignored as
  "already started". The install preview shows whether this is real.
- Desktop 255 (`held_shift_install.py`): sha-check, deploy with 7b off, preview (?dry=1),
  then asks; only "yes" switches on (approval recorded) and runs Cara's check once.
  Desktop 256 switches off.
- Proof: `held_shift_harness.mjs` 24/24 (runs the real coverage-watch in UTC, like
  Supabase); `held_shift_install_proof.py` 11/11 against a real disposable Postgres.
