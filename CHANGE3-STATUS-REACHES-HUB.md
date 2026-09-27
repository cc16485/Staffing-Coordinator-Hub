# Change 3 · AxisCare's client status reaches the hub

Approved in the audit (order 1 → 2 → 3). Plan and new pieces approved 2026-09-27. **Built and tested.**

## What the status check has actually seen (report 243, 2026-09-27)

- Status words in AxisCare today: **Active 25, Inactive 229, Deceased 39, Out of Service Area 1** (the non-Active ones are past clients; none has a hub person).
- **No status change has been observed since the check started.** So there is no observed "how a discharge looks" yet.
- AxisCare and the hub agree today except **Peggy Thomason (#295)**: Active, no hub person, open "Who is this?" case.
- "Office Staff" (#293) is Active in AxisCare **and** is an active client in the hub.
- Correction to the audit: Active Clients is not drifting today. It has nothing to keep it in step when a client *does* change.

The status check's own rule: nothing acts on a status change until the real wording is observed, and "interpretation is a later, human-reviewed step". So this change **never decides what a status change means**. It puts every change in front of a person, and the person's answer is what changes the hub.

## The three parts

### 1. "Who is this?" opens on its own
Run the existing admission scan 3 minutes after every 6-hourly status check (00:20, 06:20, 12:20, 18:20 UTC). It only opens a case for an Active AxisCare client with no hub person; it never creates a person. It's already safe to repeat: an open case returns "already open", a linked client returns "already linked".

### 2. Every status change for a hub client goes to a person
After each status check, a new reader looks at the changes it recorded. For each change on a client the hub knows, it opens **one review** in My Work (Client Intake):

> "AxisCare changed **Ruth Jones** from **Active** to **Inactive** (seen Sep 30). What happened?"

The person answers:

| Answer | What the hub does |
|---|---|
| **Care ended** (date, default the day it was seen; reason: discharged, moved to a facility, moved away, deceased, other) | Ends their active Journey on that date and ends their client role, through one door. |
| **On hold, care will resume** | Nothing ends. The note is kept. |
| **AxisCare mistake / nothing changed** | Nothing ends. The note is kept. |
| **Returning client** (for a change back to Active) | Routed to Owner / Decision to open their new Journey, as today's rule requires. |

- Nothing ends automatically, whatever the word is, including "Deceased".
- The My Work item closes itself when the review is answered.
- A change for a client the hub has never known (for example a past client going from Inactive to Deceased) is only logged.
- Every answer is kept (who, when, what, why), and becomes the observed vocabulary the status check has been waiting for.

### 3. Active Clients shows AxisCare's status
Each client shows AxisCare's current status and when it was last checked. Anyone whose care was confirmed ended moves to a **Past clients** section instead of disappearing.

## New things (approved 2026-09-27)

- `client_status_review`: one row per status change for a hub client; the person's answer is recorded once and can't be edited (append-only history).
- `client_status_decide(...)`: the one door for an answer. It ends the Journey and client role only for "Care ended".
- `client_status_current`: AxisCare's current status per client, rewritten each check, so Active Clients can show it (AxisCare stays the owner; this is a labelled copy "as of" the last check).
- A reader function (`client-status-review`) scheduled after each check, dry until switched on, with the usual counts in the automation log.
- Nothing is written to AxisCare.

## As built

- The admission scan is called by the reader, server to server, after each check; the server key never goes into a schedule.
- "Care ended" uses the Journey foundation's own door (`episode_set_state` → ended, documented, with the AxisCare change and who confirmed it as evidence) and sets the client role to former with the day and reason. An end before care began is refused by the Journey rules and nothing is saved.
- "Returning client" uses `episode_open_for_person` (established, documented) and starts a new active client role; the ended Journey stays as history.
- A change to "Deceased" is high priority in My Work and says nothing contacts the family automatically.

## Proof

| What | Result |
|---|---|
| Tables + Doors in disposable Postgres on the real Journey foundation (`client_status_proof.py`) | 26/26 |
| Reader under Node with a fake database (`client_status_harness.mjs`) | 15/15 |
| Install + on/off scripts against fake services and real Postgres (`client_status_scripts_proof.py`) | 8/8 |
| Active Clients (status column, Past clients) and the Answer panel, with sample clients | checked in the browser preview |

## Rollout

1. Merge the hub pull request (Answer panel, AxisCare status on Active Clients). Until installed, the status column shows "—" and nothing else changes.
2. `244` installs and does one dry run.
3. `245` turns it on (5 minutes after each status check). `246` turns it off.
