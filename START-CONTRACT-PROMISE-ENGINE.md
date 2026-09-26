# Start Contract + Promise engine — record

**Status:** BUILT AND PROVEN, not yet installed. Desktop script `232 - Install Start Contract` installs
the database side and deploys the function; the hub screen ships in care-coordinator-hub.

Build sequence Stage 7. It depends on the Journey spine (Stage 2) and on gated, provenanced writes for
the facts the Start Contract owns (Stage 4). This build supplies that provenance for its own facts
directly: every version and update records who, which seat, when, and what it replaced.

## What it is

- **Start Contract** (`start_contract_version`, append-only, one chain per Journey episode): how sure we
  are (early / likely / expected / committed), the target start date, the exact words we told the
  family (to whom, how, when), and the commitment owner. A change is a new version that supersedes the
  last. Changing a *committed* promise requires a reason. A commitment requires recorded words.
- **Family updates** (`start_contract_update`, append-only): each update given (when, to whom, how, what
  we said) and each scheduling of the next update owed. Every update either sets the next one owed or
  says why nothing more is owed.
- **Doors:** `start_contract_record`, `start_contract_update_record` (security invoker, EXECUTE for
  `service_role` only, per-episode advisory lock, idempotent, every call audited including refusals).
- **Edge function `start-contract`:** a signed-in person holding a Journey seat records as themselves.
  CORS + OPTIONS from the first deploy. Nothing here contacts a family.
- **Promise engine** (`promise-engine.js` in care-coordinator-hub): decides, never writes. Next update
  owed becomes due on its day; a committed start date that passes before care starts is a lapsed
  promise. Talking points are a prompt for the caller, not a message.

## Ownership (ratified field map)

Owned here: promised wording, target/committed date with author, next update owed, last family update.
Shown by reference, not copied: payer (`leads[].funding_source`), quoted price, and the promised
call-back (`leads[].promised_callback_at`, which Leads already escalates). Those stay on the lead,
their only writable home, until a later cutover moves them.

## Shadow first

The hub shows what is owed (Journeys tab, "Worth a look"). Turning Promise items into My Work entries is
a separate activation with its own dry run and counts (producer activation checklist).

## Files

| File | Purpose |
|---|---|
| `start-contract.sql` | Migration: guard, tables, triggers, view, Doors, grants, self-check (one transaction) |
| `start-contract-rollback.sql` | Removes everything only while no contract or update exists |
| `start_contract_proof.py` / `start-contract-proof-results.txt` | Disposable-Postgres proof: 25 / 25 |
| `start_contract_install.py` | Production install + verification (embedded in script 232) |
| `start_contract_install_proof.py` / `start-contract-install-proof-results.txt` | Installer proof: 3 / 3 |
| `start_contract_helpers_test.ts` | Edge-function helper tests: 6 / 6 (`node start_contract_helpers_test.ts`) |
| `promise_engine_test.js` | Promise engine tests: 12 / 12 (`node promise_engine_test.js <path to promise-engine.js>`) |
| `supabase/functions/start-contract/` | The edge function |

## Identity (SHA-256)

- `start-contract.sql` `52c924b532dc12e300904b610bdfe35a27426cb67a6923b189735685e82a4a42`
- `start-contract/index.ts` `e841db68aed36e0b29fd3b959278821693be1d2d0c3a56fd5078b80250c64341`
