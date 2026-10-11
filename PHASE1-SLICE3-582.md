# Phase 1 · Slice 3 · the door (582)

Design approved 2026-10-11 with all four decisions (Owners Hub view only; undeclared fields refused by name; discipline
owner-approval as its own slice later; started rows hidden from Since You Left). **Built and tested; not deployed.**

## What it is
- `_shared/contract.ts`: the wrapper (a library, not a gateway). Registry check → authority table → sign-in (requireStaff
  with the roles the table allows) → declared inputs (undeclared field refused by name) → reads run and record nothing →
  changes take the once-only lock (a `started` row, one per request id, 578's unique index) → the function body →
  one outcome row (done / refused / failed; ids and outcome words only) → the function's own answer plus `request_id`.
  A repeated request id answers the first answer with `already: true` and does nothing. If the record cannot be
  written, nothing is done (503). Anything claiming to be an AI employee (`x-cc-employee`) is refused.
- `_shared/registry.js`: the four actions; the SQL seed is tested to match it.
- `action_authority_582.sql`: action_registry, action_authority (person: never|allowed + roles; job/employee:
  never|read|recommend|approve|autonomous), action_authority_log (append-only), `authority_set` (owner-only, needs a
  note, logs + writes an `authority_changed` event). Guards refuse every direct change, the server key and the project
  owner included; truncate always refused. Office roles read; nobody else. Seed: people = the three office roles as
  before; jobs and employees never. Re-runs never overwrite an owner's change.
- client-fact and call-place moved behind it; their logic and database doors unchanged. An older open Hub page with no
  request id still works (the server makes one and notes it); call-place with no action reaches `place`.
- Verbs: fact_recorded, person_recorded, call_placed, authority_changed; diagnostics action_refused, action_failed
  (record_started already was).
- Hub (care-coordinator-hub): `callAction` (request id per press, one retry with the same id, via hub/phone);
  lpfCall and ucPlace use it; verbs.js copy updated. Marker `CC_DOOR_582`.
- Owners Hub (team-hub): "Who may do what" card on the Admin page, view only.

## Tests
- slice3_582_test.mjs 59/59 (Node + PGlite), client_fact_fn_test.mjs 32/32 and call_place_fn_test.mjs 10/10 (updated:
  a recorder or placer named in the request, or a non-word in roles, is now refused by name; were ignored/dropped),
  slice1_578_test.mjs 20/20, phase1_slice3_582_install_test.py 18/18.
- Hub: tests/door-callaction-582-test.js 13/13 (with STAFFING set, the Hub's field lists equal the server's declarations).
- Owners Hub: tests/admin-authority-582-test.js 9/9. admin-onboarding-test (4 failing) and admin-switches-test (crash)
  fail identically on main; untouched.

## Order
1. Merge the Hub PR (and the Owners Hub PR): the page starts sending request ids; today's functions ignore the field.
   Check every script block parses and load the live page (sign-in works, no console errors).
2. Merge this PR. 3. She runs `582 Slice 3 the door.command` (refuses unless the live Hub page carries CC_DOOR_582).
4. A week of office use, then `582b The door, a look (read only).command`.

## Rollback
Redeploy client-fact and call-place from the commit before this PR, then action_authority_582_rollback.sql. The Hub
page can stay (callAction works against the old functions).
