# Change 5 · An approved care plan's tasks go into AxisCare

Approved in the audit (order 1 → 5). Plan and all decisions approved 2026-09-27 (picker, automatic Start of Care tick on full read-back, new fields, new function). **Built and tested.**

## What happens today (verified in code, 2026-09-27)

- A care plan (Care Assessments → Generate Care Plan, or typed by hand) stores **free text**: ADL needs, IADL needs, conditions, medications, safety, goals, services, frequency, hours per week, start and review dates.
- **Save + push** attaches the whole plan to the client's AxisCare profile as one important note. It goes through the Training project's function and the shared key.
- Start of Care then asks Krystal to "enter the care plan in AxisCare". She reads the note and builds each care task in AxisCare by hand.

## What AxisCare accepts (API spec)

- **Care tasks (ADLs)** are picked from the agency's **own task list** in AxisCare (`GET /api/adls`, e.g. "Bathing", "Client Errands"). Only active tasks can be used.
- Each task on a client has optional **instructions** and at least one **event**: the day (Sun to Sat), whether it's **always** or **as needed**, and **when** (any time, morning, afternoon, evening, night).
- Tasks can be added, changed (instructions, days) and removed through the API.
- Diagnoses, medications and allergies have **no** place in the API. They stay in the note.

Free text can't become catalog tasks without guessing. So this change adds a **picker**, and the person decides.

## What Change 5 does

1. **A "Care tasks for AxisCare" section on the care plan form.**
   - It loads AxisCare's own task list live.
   - Tasks whose names appear in the plan's ADL and IADL text are **suggested, not ticked**.
   - For each ticked task: the days, always or as needed, the time of day, and instructions (prefilled from the plan text, editable).
   - Days default to the linked Team Builder plan's days if there is one, otherwise every day.
2. **Save + push** does what it does today (the note) and also sends the ticked tasks:
   - Tasks the client doesn't have yet are **added**.
   - Tasks already there are shown side by side (AxisCare's version and the plan's). They're **only changed when the coordinator ticks "update"**.
   - **Nothing is ever removed automatically.** Taking a task off the plan offers "also remove it from AxisCare" as its own click.
3. **Read-back.** The hub reads the client's tasks back and shows ✓ for each one AxisCare now holds.
4. The note and the tasks both go through a new shared-project function with the coordinator's own sign-in, which retires the plan's use of the Training key.

## Decided (2026-09-27)

- **The picker as described** (suggest, never tick; days default from Team Builder; nothing removed without its own click).
- **Start of Care step "enter the care plan in AxisCare"**: when every ticked task reads back ✓, tick that step automatically, with the evidence (recommended). The alternative is showing "✓ tasks sent" beside it and leaving the tick to a person.
- **New fields** on the care plan: `axiscare_tasks` (the ticked tasks and their settings) and `axiscare_tasks_push` (the record of what was sent and read back).
- **New function** `careplan-tasks` (shared project, signed-in staff): the task list, preview, push. It writes to AxisCare only on Save + push.

## As built

- The picker loads AxisCare's active task list and suggests tasks whose names appear in the ADL / IADL text (whole-word match); nothing is ticked for the coordinator. Days default to the client's Team Builder plan (matched by client name, only as a default the coordinator sees), otherwise every day.
- "As needed" is always "any time" (AxisCare's rule), enforced in the form and again on the server.
- **Save & Push** opens a side-by-side preview. The coordinator sends it with "Send to AxisCare":
  - "update" and "remove" are separate ticks, and both start unticked;
  - an AxisCare-only task is never removed unless ticked.
- When everything reads back as planned, the Start of Care step "Enter the care plan & caregiver instructions in AxisCare" is ticked as "Automatic: care tasks read back in AxisCare", with who sent it and how many tasks were confirmed.
- **Permission proof:** an empty task request on an Active client, which AxisCare refuses as invalid. Nothing can be added by it.

## Proof

| What | Result |
|---|---|
| Function against a fake AxisCare (`careplan_tasks_harness.mjs`) | 17/17 |
| Install script against fake services (`careplan_tasks_install_proof.py`) | 4/4 |
| Care plan form (suggestions, defaults), preview (add / differs / AxisCare-only), send, automatic Start of Care tick | checked in the browser preview |

## Rollout (install BEFORE the hub merge)

1. Merge the Staffing-Coordinator-Hub pull request.
2. `249` deploys `careplan-tasks` and runs the permission check. If NOT READY, stop.
3. Merge the care-coordinator-hub pull request.
