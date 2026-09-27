# Change 4 · A finished Team Builder plan becomes AxisCare schedules

Approved in the audit (decision 3's order: 1 → 2 → 3 → 4). Plan and all decisions approved 2026-09-27 (service picker, overnight shifts included, new fields and function). **Built and tested.**
This is the first change that **creates** things in AxisCare that caregivers see, so it is built around one human confirmation, a read-back, and an undo.

## What happens today (verified in code, 2026-09-27)

- A Team Builder plan holds the client's name (free text), days, shifts (label, start, end), and one caregiver per day and shift, with a status (penciled, asked, confirmed, declined). The plan can be linked to the family's Journey.
- Each cell stores the caregiver's **name only**. The roster Team Builder loads does carry each caregiver's AxisCare ID.
- **Plan complete** is offered once every cell is confirmed. It marks the plan done and shows an alert: "Now enter it in AxisCare; this board never writes there itself." Krystal then builds the same schedule again in AxisCare by hand.

## What AxisCare needs to create a schedule (API spec)

- Required: client ID, days, start date, start time, end time, and **a service code**.
- Optional: caregiver ID, end date, frequency (1 = every week).
- AxisCare only accepts a service already set up for that client. That setup is part of billing, which stays a hand step, so **billing setup must happen before the schedule can be created**. If it hasn't, AxisCare refuses and the hub says so.
- There is no API to list a client's services. The hub can see which services are in use from AxisCare's own visits.
- Schedules can be changed afterwards (caregiver, times, dates) and ended from a date. Days and frequency can't be changed once created.

## What Change 4 does

1. **"Plan complete" opens a preview** instead of the alert. The preview shows the schedules to create, one per caregiver and shift, with the days grouped. For example: "Jane Doe · Mon, Wed, Fri · 9:00am–1:00pm".
   - **The client:** the AxisCare client comes from the plan's linked Journey. If the plan isn't linked, or the person has no AxisCare ID yet, the preview says so and nothing can be created.
   - **The caregivers:** each caregiver's AxisCare ID is stored on the cell when they're penciled in (new). Older cells are matched by exact name against the AxisCare roster. If a name matches nobody, or more than one person, that schedule is blocked until someone re-pencils them.
   - **Start date:** the coordinator picks it. It defaults to the Start Contract's target date when that's in the future.
   - **Service:** the coordinator picks from the services AxisCare is already using. It defaults to the service on the client's own visits, if they have any.
   - **Already in AxisCare:** the preview reads the client's existing schedules. An identical one (same caregiver, days, times) is skipped, never duplicated. Anything else already there is shown for the coordinator to judge.
2. **"Create N schedules in AxisCare"** is the one confirmation. Each schedule is created on its own and the result is reported line by line, so one refusal doesn't stop the others.
3. **Read-back.** The hub reads the client's schedules again and shows ✓ for each one AxisCare now holds.
4. **Undo, same day.** "Remove what I just created" ends those schedules in AxisCare from their start date, so no visits remain. It's offered only for schedules this plan created.
5. The plan keeps a record of what was sent, what AxisCare returned, and who did it. The plan is then marked done.

After this, Change 1's New Clients card fills in "caregiver" and "schedule" by itself, because AxisCare now holds them.

## Decided (2026-09-27)

- **Service code:** picked in the preview, from services AxisCare is already using (recommended). The alternative is a fixed code per payer that you give me.
- **Overnight shifts** (ending after midnight): include them and check them on first use through the read-back (recommended), or leave them as a hand step until one has been proven.
- **New fields** (the plan lives in the shared app_data):
  - on each cell, `cg_ax_id`, the caregiver's AxisCare ID, stored when penciled in;
  - on the plan, `axiscare_push`, the record of what was created.
- **New function** `schedule-push` in the shared project, for signed-in staff: preview (read only), create, and undo. It writes to AxisCare only on the coordinator's click. It adds no database tables and nothing runs in the background.

## As built

- **Permission proof changed, safer than planned.** AxisCare lists and removes schedules only for *active* clients, and Test Client 5 is inactive. A test schedule there could be neither read back nor removed. So the install sends a deliberately incomplete schedule request instead (no days, dates or times). AxisCare refuses it as incomplete if the connection is allowed, and as "not allowed" if not. **Nothing can be created by it.**
- **Penciling in now stores the exact caregiver's AxisCare ID.** Two caregivers with the same name are never confused.
- **A plan already sent can't be sent twice by accident.** "Send again" is deliberate, and identical schedules are skipped even then.
- **Undo** ends the created schedules from their start date (or today), on the day they were created, and reopens the plan. The sent record moves to the plan's history.
- **Escape hatch.** "Mark the plan complete without sending" keeps today's hand-entry path.

## Proof

| What | Result |
|---|---|
| Function against a fake AxisCare (`schedule_push_harness.mjs`) | 24/24 |
| Install script against fake services (`schedule_push_install_proof.py`) | 4/4 |
| Preview, create (partly), undo, with a sample plan | checked in the browser preview |

## Rollout (install BEFORE the hub merge)

1. Merge the Staffing-Coordinator-Hub pull request.
2. `248` deploys `schedule-push` and runs the permission check. If NOT READY, stop.
3. Merge the care-coordinator-hub pull request.
