# Change 8 · One family, easy to find (map and plan, nothing built)

Audit wording (2026-09-26): "Link the same family across the lead, assessment, New Clients
card, Client 360 and Team Builder plan. Give check-ins a client picker. Keep one first-shift
follow-up. Switch on the stalled-start check that already exists."

All line numbers are cc-hub-live/index.html unless named.

## What the map found

### Links between the screens for one family
| From \ To | Lead | Assessment | New Clients | Client 360 | Team Builder | Family Circle |
|---|---|---|---|---|---|---|
| Lead | · | "Schedule assessment" (always a NEW one) | none | none | none | none |
| Assessment | none (lead_id stored, unused) | · | none | none | none | none |
| New Clients | yes (Journey; same AxisCare id; name suggestion) | none | · | none | none | none |
| Client 360 | yes (Journey) | text only | text only | · | none | members shown, no button |
| Team Builder | none | none | none | none | · | none |
| Family Circles | none | none | none | none | none | · |

Shared key almost everywhere: the AxisCare client id. Team Builder plans hold only a typed
name (plus an optional Journey link).

**Wrong-family risks found:**
- Client 360 falls back to a FIRST-NAME match to open a profile (30869), and its timeline
  pulls assessments, nurse visits and coverage by first name (30655, 30666, 30675). Two
  clients named Mary could show each other's history.
- The client roster files a converted lead under the CALLER's name, not the client's (12278).
  The daughter's name, not the mother's, so a lead and its assessment land on different rows.

### Client entry on check-ins
- Client Check-ins: typed name and typed AxisCare id (6508-6509).
- Nurse Visits: typed name only, no AxisCare id at all (1108-1122); Client 360 then matches
  nurse data by first name.
- Care Match: logged from the pairs board, which knows the AxisCare client id but throws it
  away (32738); the off-board form is typed.
- Care Plan Reviews: already a picker. Nothing to do.
- A ready-made picker exists: the one Cara's "ask about a client" box uses (hwAskClients,
  30957), fed by the live client list.
- Due dates key on the record id, not the name, so a picker that still fills the name and
  AxisCare id is safe. Side finding: a new check-in doesn't close the older record's
  "check-in due" item (only editing the old record does).

### First-shift follow-up: two trackers, never linked
- New Clients: two checkboxes ("24–72h follow-up, client/family" and "caregiver"). No date,
  no reminder, no My Work item.
- Care Match: every new client-caregiver pair, "call them" on the board, a morning email,
  ratings for both sides. Covers fill-ins too.
- Logging one doesn't clear the other, so the same family can get two calls about the same
  first shift.

### Stalled-start check
- `csEvaluate` (14305) was built 2026-08-12 and never connected: nothing calls it, no switch,
  no cron. It would raise one My Work item per stuck start, route it by step, re-route as
  the bottleneck moves, and close itself when the start moves.
- It disagrees with the screen: the Start of Care "Stuck" badge gives family-owned steps 14
  days; csEvaluate gives them 3.
- It lives in the hub page. Running it there would mean it only runs when someone has the hub
  open, and hub start-up already does too much (the "boot is not read-only" finding), so it
  belongs on the server like Cara's other checks.

## Proposed steps (one at a time, each approved first)

**8a · Check-in pickers (smallest).** Client Check-ins, Nurse Visits and the off-board Care
Match form pick the client from the same live list Cara uses. Still stores the name and the
AxisCare id, so due dates keep working. Care Match keeps the id it already has. New field:
`axiscare_client_id` on nurse clients (existing ones matched once by a person). Also: logging
a new check-in closes the older record's due item.

**8b · Stalled starts become owned work.** csEvaluate moves to a shared engine file that
the server runs on a timer (like launch evidence), dry first with counts, then switched on.
Needs her ruling: family-owned steps stuck after 3 days or 14?

**8c · One strip of links per family.** On the lead, assessment, New Clients card, Client
360, Team Builder plan and Family Circle: the same short row, "Inquiry · Assessment · Start ·
Client 360 · Team plan · Family", each found by id (AxisCare id, Journey, lead id), never by
name. A screen with no id shows "Connect" instead of guessing. The lead opens its existing
assessment instead of always starting a new one. Team Builder plans gain the AxisCare id from
their Journey link. Removes the first-name matching in Client 360 and files converted leads
under the client's name.

**8d · One first-shift follow-up.** Needs her team's ruling on which place is home. Proposal:
Care Match is the one place (it already covers every new pairing and records both ratings);
the New Clients boxes become read-outs that tick themselves when that call is logged.

**Separately (asked 2026-09-27):** per-client coverage rules (only-ask list, outside backup,
notes), tied to the AxisCare client id. Proposed as its own step after 8, or sooner.
