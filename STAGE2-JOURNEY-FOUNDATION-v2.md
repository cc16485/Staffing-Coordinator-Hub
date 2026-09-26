# Stage 2 · Journey Foundation v2 — record

**Status:** COMPLETE. Deployed to production 2026-09-26 04:16 UTC and verified.
It supersedes the Phase A foundation (`journey-episode-phaseA*.sql`), which was
deployed, never held a row, and is kept here as the recovery path.

## What it is

- `episode_id` is the canonical, immutable identity of a care lifecycle. There is no `seq`.
- `person_id` says whose lifecycle it is. The AxisCare client ID stays person-level, in the identity layer.
- Lifecycle begin, end, order and earlier history are append-only, attributed facts (`episode_fact`).
  Order and any lifetime ordinal are derived, never stored. The ordinal appears only when complete
  history is documented.
- One operationally active episode per person, defined once in `journey_state_is_active()`.
- Known lifecycle ranges cannot overlap. Undated or ambiguous history goes to review and never
  creates an episode.
- Frozen episode rows never change. Material changes to accepted frozen history need Owner / Decision;
  consistent supporting facts are recorded normally.
- Every write goes through a Door (`security invoker`, EXECUTE for `service_role` only). Signed-in
  users read only; anonymous users get nothing.

## Files

| File | Purpose |
|---|---|
| `journey-foundation-v2.sql` | The migration. One transaction: empty-foundation guard, replace, self-check |
| `journey-foundation-v2-rollback.sql` | Removes v2 only while empty; recovery = rerun `journey-episode-phaseA.sql` |
| `journey-foundation-v2-fingerprint.sql` | Read-only aggregate fingerprint (definitions + effective privileges) |
| `journey-foundation-v2-parts.sql` | Same, as a component list for comparison |
| `journey-v2-expected.json` | Proven components, fingerprint and migration SHA-256 |
| `journey_v2_proof.py` | Disposable-Postgres proof harness |
| `journey_v2_deploy.py` | Production deploy + verification (run by desktop script 219) |
| `journey_v2_deploy_proof.py` | Proof of the deploy script against disposable Postgres |
| `journey_v2_gen_expected.py` | Regenerates `journey-v2-expected.json` from a clean install |
| `journey-v2-proof-results.txt` | Harness output: 73 of 73 pass |
| `journey-v2-deploy-proof-results.txt` | Deploy-script proof output: 6 of 6 pass |
| `journey-v2-production-verification.txt` | The production deployment and verification report |

## Identity of what was deployed

- Migration SHA-256: `2cd4cf7b97cb628ee8c4daadc432f2672dba4821d4d1ca12c881e25f27e32ea1`
- v2 fingerprint: `114105aabad43bb10a5f448a524de47a` (406 components)

## Production verification (2026-09-26, PostgreSQL 17.6)

- Artifact matched; migration ran once; guard and self-check passed.
- Deployed fingerprint identical to the proven build, all 406 components.
- Inventory: 5 tables, 4 views, 24 functions (9 Doors), 11 triggers, 12 indexes, 4 policies.
- Grants, RLS, Door sources, active-state definition and version marker all matched.
- Journey tables empty. Non-Journey definitions (1,696 parts) and row counts (74 tables) unchanged.
- No baseline episodes and no backfill were created.

## Rerun and rollback behavior

- Rerun on an empty v2 install reinstalls the identical foundation. With any Journey row present it
  refuses and changes nothing.
- Rollback refuses while any Journey row exists.
