# Step 2 · a lead's Journey becomes the client's — record

**Status:** INSTALLED 2026-09-26 17:44 UTC by desktop script 233, all checks passed. Hub screens: care-coordinator-hub PR "Step 2".

Part of the Lead to Client Plan (approved UI direction). A coordinator deliberately entering or choosing the
AxisCare client id for a lead, with the lead and the AxisCare client shown side by side, is the human
confirmation that they are the same person. A name match made by software never is.

## What it does
`lead_journey_connect(lead_id, axiscare_client_id, axiscare_name, how, staff, seat)` in one transaction:
finds the person already linked to that AxisCare client or creates one (identity recorded as human-confirmed,
with who and how), gives them the client role, closes an open admission case for that id as confirmed,
resolves the lead's provisional Journey to that person and marks it converted (same `episode_id`, so its
Start Contract carries on), and records the connection in append-only `lead_journey_connection`.
Refused, with nothing saved, when the AxisCare client already has an active Journey (Owner / Decision),
when the lead doesn't carry that id, or when the inquiry is closed. `how` is `typed`, `convert` or
`confirmed_match`; there is no value for a software name match.

The lead mirror is replaced with one change: a lead marked Lost no longer closes a Journey confirmed as a
client's (it is reported as diverged). The proof checks the replacement differs from the deployed mirror
only in that rule.

New objects are deliberately not named `journey_*` / `episode_*`, because the Journey v2 foundation
fingerprint includes every function with those prefixes.

## Files
| File | Purpose |
|---|---|
| `journey-connect.sql` / `-rollback.sql` | Migration (guard, table, Door, mirror rule, grants, self-check) / rollback while unused |
| `journey_connect_proof.py` / results | Disposable-Postgres proof: 23 / 23 |
| `journey_connect_install.py` / proof / results | Production installer (embedded in script 233): 3 / 3 |
| `journey_connect_helpers_test.ts` | Edge-function helper tests: 6 / 6 |
| `supabase/functions/journey-connect/` | preview (side-by-side lookup, signed-in staff) and connect (Journey seat holders) |

## Identity (SHA-256)
- `journey-connect.sql` `f70ab47ce0a888f61d6115f4252a0548c4f09daa3df77f8dc87789e5b0e9f51f`
- `journey-connect/index.ts` `26d729dfd253039b8c841950170c996361549538335d598811289058aa69923a`

## Production at install
0 connections; 0 existing leads carried an AxisCare id. Nothing existing changed.
