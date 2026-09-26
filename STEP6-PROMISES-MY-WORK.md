# Step 6 · family updates owed and Journey decisions in My Work — record

**Status:** `promise-run` deployed 2026-09-26 by desktop script 235 with its switch OFF; one dry run read
(0 Start Contracts, 0 open reviews, would create 0, My Work unchanged at 132 items). Switch-on: script 236;
undo: script 237.

## How it works
The decision logic is `CCPromise.workItems()` in the hub's `promise-engine.js` (served from cc.mo-care.com).
`promise-run` (obligations-run shape) fetches that exact file, **stops if it cannot**, reads Start Contracts and
open Journey reviews, and, only when `ops_settings.promises_live === true`, creates and closes My Work items
through `upsert_app_data_item`. Every run is logged to `automation_log` (automation `promises`), including dry
and failed runs. It never contacts a family.

Guardrails: item ids come from the source (no duplicates; an id that ever existed is never recreated); it closes
only its own items, when the source no longer calls for them; 60-day age guard (counted, not created); 20 per run,
most urgent first, the rest deferred; the scheduler (public key) gets counts only, and names appear only for a
service-role caller.

## Files
| File | Purpose |
|---|---|
| `supabase/functions/promise-run/` | The producer |
| `promise_run_harness.mjs` | End-to-end test of the real function under Node with a fake database: 9 / 9 |
| `promise_workitems_test.js` | Decision-logic tests: 16 / 16 (`node promise_workitems_test.js <path to promise-engine.js>`) |
| `promise_run_install.py` / proof / results | Script 235 (deploy dry + one dry run): 5 / 5 against fake services |
| `promise_switch.py` / proof / results | Scripts 236 (on) and 237 (off): 6 / 6 against fake services; the switch SQL also run on real Postgres |

## Identity
- `promise-run/index.ts` sha256 `d857216e949e14811ceef46d956742c128802a4d62633627c315c7b376fd890b`
