# Phase 1 · Slice 1 · one record (578)

Samantha approved the Phase 1 design on 2026-10-10 (Cara Phase 1 Design, v2). Slice 1 is the uniform audit record and,
by her decision, the authorization fix for the shared-project office feeds. Nothing deploys until she runs the Desktop step
**578 Slice 1 one record.command** after reviewing this.

## What changes

| Piece | Before | After |
|---|---|---|
| `op_events` definition | only in Desktop step 159 | `op_events_harden_578.sql` in the repository, with rollback |
| Columns | at, actor_email, actor_name, verb, item_id, area, summary, data | + actor_kind, actor_id, via, action, request_id, approval, outcome, evidence (defaults; existing rows backfilled to kind person/job/system by value only) |
| Indexes | time only | + item, actor, action, request id; one `started` row per request id (unique partial index: two simultaneous callers with the same request id cannot both execute) |
| Append-only | no update/delete policy for pages; the server key could rewrite | guard triggers refuse UPDATE, DELETE, TRUNCATE for everyone |
| Who writes | any signed-in account, naming any actor it liked; the server | pages call `record_event(...)`, which stamps the actor from the session and refuses non-office callers; the server inserts with its key |
| Who reads | any signed-in account on the shared project | office members of Caring Companions (`hub_office_ok()`, built on the My Desk helpers) |
| Server helper `_shared/events.ts` | defaulted the actor name to "Cara" | a row is a person (email + name) or a job (the function's name as actor_id, kind job); contract fields optional |
| Vocabulary | none; ~80 spellings across both sides | `_shared/verbs.js` = `cc-hub-live/verbs.js`: verb, label, area, severity, diagnostic flag; the Hub filters diagnostics out of Since You Left |
| Feeds: calls-feed, interview-feed, ghl-thread, reports-rollup | any signed-in account on the shared project (reports: owners by email list) | `requireStaff(OFFICE_ROLES)`; reports: `requireStaff(['owner_admin'])` and the owners list |
| Event emitters | clockin-alert's events signed as "Cara"; seven jobs' events unsigned | the person on the link is the actor; each job names itself |

Browser side (separate pull requests, merged after the step): `cc-hub-live` opEvent() and the profile-gate override call
`record_event`; the Hub loads `verbs.js`; `team-hub/admin.html`'s three direct inserts call `record_event` with via `admin`.

## Her additions of 2026-10-10, built in

- Every event of an action carries the request id; a `started` row goes down before any external effect and the `done` / `refused` / `uncertain` row follows with the same id.
- Concurrency: the unique partial index on (request_id) where outcome = 'started' is the lock. The step proves it by racing two inserts.
- Retention: nothing is deleted or archived. Seven years is the planning baseline; any future archival needs encryption, restricted access, verified restoration, legal hold and a schedule by record type, each approved first.
- Readable history: the vocabulary carries the words a person reads (label, area, severity). The History drawer that shows "who, what, when, did it succeed" on cards and profiles is specified for Slice 4 with the work_item contract.

## Not in this slice

Field-change history for the operational keys (Slice 2). The wrapper, registry and authority table (Slice 3). Retention
and archival (her decision 5: a documented policy first, section 11 of the design). No automation's behaviour changes;
the authority of every person and job is exactly what it was.

## Tests

`node slice1_578_test.mjs`: the events helper never signs a job as a person and carries the contract fields; every verb
the code writes is in the vocabulary (server and Hub); the four feeds refuse no sign-in, a Training-platform sign-in and a
caregiver account, and admit an office member (reports: owners only). The step re-runs it before anything changes.

## Deploy order

1. Merge the Staffing-Coordinator-Hub pull request.
2. Run **578 Slice 1 one record.command**; read the report. It proves the owner cannot rewrite or delete a row, pages hold
   SELECT only, the only rule is the office read rule, the server can still append, the feeds refuse an unsigned caller.
3. Merge the care-coordinator-hub and team-hub pull requests (pages write through the door).

Between steps 2 and 3 the pages' own event writes are refused by the database (console note only); the server's records
are unaffected. Keep the gap short.

## Rollback

`op_events_harden_578_rollback.sql` restores the 159 access rules (columns stay, harmless). Any function: redeploy the
previous build from git history.
