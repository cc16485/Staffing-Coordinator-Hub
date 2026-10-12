# Call follow-up cards · slice A, practice (583)

Samantha 2026-10-12: "I want the ai employee to be reading our call transcripts and identify follow up tasks needed and
make them a call follow up task card in our work." Design: Phase 1 page section 17. Her decisions (all four as
recommended): a practice week first; every answered call plus voicemails that ask for something; cards routed by area
(slice C); Claude Sonnet 5.5 for the reading. **Built and tested; not deployed.**

## What it is
- `call-tasks` (new function, every 10 minutes at :05 past each ten, after call-pull): takes the calls call-pull handled
  (call_pull_seen, stage done/practice) since `ops_settings.call_tasks_since`, re-fetches GoHighLevel's transcript and
  contact (reads only), asks `call_who` who the number belongs to, gives Claude Sonnet 5.5 the call, the person's open
  cards and earlier suggestions for the same person in the last day, and keeps the answer in `call_task_reading`.
  Runs only while `ops_settings.call_tasks_practice === true` (Owners Hub Admin page, Calls).
- `_shared/call-tasks.ts`: the prompt (her rules), the strict tool `submit_followups`, `tool_choice: auto` (Sonnet 5.5
  refuses forced choice), effort medium, server-side refusal fallback (`fallbacks: "default"`), and `clean()` holding
  the rules in code: at most 3 cards, known areas, real dates, open-card ids that exist, phone numbers and emails scrubbed,
  no card for a new-client inquiry, `resolves` only for earlier suggestions it was shown.
- `call_tasks_583.sql`: `call_task_reading` (append-only; office read; no transcript, phone or email), `call_who(phone)`
  (the call record's rule: one person, one lead, several or none; name from person_identity, roles from
  person_source_id not needing review; server only).
- Hub (care-coordinator-hub): My Work tab "Call follow-ups (practice)" (call-practice.js), offered while the switch is on:
  each call, the cards the AI would have made, and the cards PEOPLE made about the same person within 24 hours.
- Owners Hub (team-hub): the switch "Call follow-ups: practice reading" under Calls.

## Practice means
No card is written to Work (`ops_items`). Nothing is sent. Slice B (`work_item.raise` behind the door with an origin)
and slice C (her authority grant + a `call_tasks_live` switch) come after the practice week.

## Tests
- call_tasks_583_test.mjs 39/39 (Node + PGlite): Steve Algiere's two calls of 2026-10-11 replayed (the 6:36 voicemail
  card is resolved by the 6:37 call; one "Schedule Angiel ... DMV trip" card due Fri Oct 16); request shape; clean();
  refusal and outage recorded once; no transcript/phone/email kept; nothing written to Work; reads only from GoHighLevel.
- call_tasks_583_install_test.py 18/18 (fake Supabase + CLI).
- Hub tests/call-practice-583-test.js 17/17; all 14 inline script blocks parse.
- Owners Hub: admin-switches-test has the same 3 failures on main (stale counts), untouched.

## Order
1. Merge the Hub and Owners Hub PRs (the tab says "appears once 583 has run" until then; harmless).
2. Merge this PR. 3. She runs `583 Call follow-ups practice.command` (installs, deploys, turns practice on, schedules,
   reads the last 3 days of calls and lists them in the report). 4. A week of practice, then her review.

## Rollback
Turn practice off on the Owners Hub; unschedule `call-tasks`; `call_tasks_583_rollback.sql`.
