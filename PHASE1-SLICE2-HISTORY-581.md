# Phase 1 · Slice 2 · change history for the operational records (581)

Approved in the Phase 1 design (2026-10-10, decision 3: "history for the selected keys only, with performance testing").
Prepared 2026-10-11. **Not deployed.** Runs only after Samantha approves this package.

## What changes

One database watcher. The 418 change history (`app_data_item_change`) watched candidates and caregivers only.
581 replaces its watcher function and two triggers so it also watches:

| key | what it is | one line per |
|---|---|---|
| ops_items | work items | item added / removed / changed |
| leads | leads | lead added / removed / changed (first + last kept on added/removed, as for candidates) |
| coverage_cases | call-off cases | case |
| timekeeper_cases | missed clock-in cases | case |
| staffing_plans | staffing plans | plan |
| visit_changes | visit changes | change |
| ops_settings | the office settings record | one line naming the settings that changed |

Each line: when, key, record id, added/removed/changed, the NAMES of the fields that changed (never values), who
(the signed-in email, else "server" for a job), role, and the page's site. No phone, email, note text or value.

Not changed: the table, its read rule (signed in, only for keys you can read; anon nothing; browsers never write),
every line already in it, every other app_data key, every page, every function, every switch, every permission.

Family circles are not in app_data (they are the care_circles / circle_contacts tables with their own link log), so
they are not part of this slice.

## Speed

The 418 watcher indexed the whole old and new list on every save. 581 compares the lists position by position first
and only indexes records at positions that differ (one record for a normal one-item save); a removal from the middle
falls back to the full comparison. A randomized test (120 random edit sets) proves it gives exactly the 418 answer.

Measured in the test database (WebAssembly Postgres, 1,500 work items, 2.5 MB, one item saved through
upsert_app_data_item): no history 10 ms, 581 watcher 14 to 15 ms, 418-style comparison 35 ms.

The Desktop step measures it again on the real lists BEFORE installing (one rolled-back transaction: 5 timed saves per
key today, trial install, 5 timed saves with the history). **Gate: any save at half a second or more stops the step
with nothing installed.** While the trial runs (a few seconds) other saves to app_data wait, then go through.

## Files

- `app_data_history_581.sql` the change (one transaction; refuses if 418 is missing; self-checks)
- `app_data_history_581_rollback.sql` = the 418 SQL again (418 watcher back; lines already written stay)
- `app_data_history_581_speed.sql` the rolled-back speed probe
- `app_data_history_581_proof.sql` the rolled-back production proof
- `slice2_history_581.py` the Desktop step; `slice2_581_test.mjs` (40 tests, real Postgres with PGLITE set);
  `slice2_history_581_install_test.py` (17 rehearsals against a fake Supabase)

## The Desktop step (581 Slice 2 change history.command)

1. Read only: reviewed files (sha), the 40 tests on her Mac, 418 installed, no app_data trigger calls out, sizes.
2. Speed probe (rolled back). Gate as above.
3. Install (one transaction).
4. Proof (rolled back): a signed-in work-item save leaves ONE line with that person (the design's Slice 2 gate);
   a settings save one line naming the setting; a server job's save one line as "server"; with the watcher forced to
   fail the save still goes through with one trigger_error line; afterwards nothing from the proof remains.

Sends nothing.

## Known, not in this slice

- Server jobs are recorded as "server", not by job name: the PostgREST request carries no job name. Naming the job
  needs each function's client to send one (a later slice, alongside the work_item contract in Slice 4).
- step1_land_apply (567) writes its own history line for candidates and the watcher writes one too, so a Step 1
  landing shows twice. Harmless; left for the Slice 4 history drawer to fold.
