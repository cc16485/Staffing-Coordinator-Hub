#!/usr/bin/env python3
# 715 · STEP 4 PART 1: THE SERVER MATCHES ATTENDANCE AND WRITE-UPS BY AXISCARE NUMBER (Samantha 2026-10-14, "yes start
# part 1"). Hub project: deploys coverage-shifts, coverage-watch, coverage-run and missed-notes from the reviewed build,
# together (the readers understand numbers before the writers start saving them). Each keeps its gateway setting. Before
# anything changes, every live copy must be today's main (or already this build): a copy with work that is not on main
# stops the step. Sends nothing; no table, no switch, no person's record changes.
import os
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
FNS = ["coverage-shifts", "coverage-watch", "coverage-run", "missed-notes"]
SHAS = {"coverage-shifts/index.ts": "85580ebe1e4ddf1df5c68a69c378971bb28a63ce8ccd945524d361663cda8021",
        "coverage-watch/index.ts":  "80e9a4d5311ee8a7205b2406af659ac71db8777d7342bc71eb61879bd8264950",
        "coverage-run/index.ts":    "6c2ced7b5e7d50c4927c921d20838dc32866c36b86a61fe7c9ecf443f3342278",
        "missed-notes/index.ts":    "1ef0ae14aa226098813520e2ea04d3ecc9e913f2e55127c6647609d37122799d"}
BEFORE = {"coverage-shifts": "f5b83c9305fb929ebcf3f2b091351bb4c2b1cbdd9889965dfe8360de49fe8fcf",
          "coverage-watch":  "25db3cae21625771b1a059a2f3d853bb519d9fa7e0c87d33430edf0e7245f5c5",
          "coverage-run":    "24ca21b05bb0ee3b8a9310d3e11f1da1ed4e2aa88c44749ad00146c0f29cc2c1",
          "missed-notes":    "76419e2b9e91381647fe2612259468ec5ea39fee190a98016b37ba21b1aec4c1"}
start("STEP 4 PART 1: THE SERVER MATCHES ATTENDANCE AND WRITE-UPS BY AXISCARE NUMBER")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
if not SUPA or not os.path.exists(SUPA): bad("the Supabase command-line tool was not found"); done(2)
gate = {}
for fn in FNS:
    s, m = fmeta(REF, fn)
    if not m: bad(f"{fn}: could not read it (HTTP {s})"); continue
    gate[fn] = bool(m.get("verify_jwt"))
    ok, live = live_files(REF, fn)
    have = live.get(f"supabase/functions/{fn}/index.ts") if ok else None
    want = SHAS[f"{fn}/index.ts"]
    if have == want: say(f"  · {fn} is already this build (version {m.get('version','?')})")
    elif have == BEFORE[fn]: say(f"  ✓ {fn} is live as today's main (version {m.get('version','?')}, gateway check {'on' if gate[fn] else 'off'})")
    else: bad(f"{fn}: the live copy is neither today's main nor this build, so another change is live there; nothing was deployed")
if fails: say(); say("RESULT: STOPPED before anything changed. Tell Claude."); done(3)
say(); say("  · what changes: these four functions read a record's AxisCare number first (a name only when a record has none), and the call-in log and the nightly lateness watch save the number they already have. Nothing is sent; no record changes now.")
say(); say("PART 2 · CHANGE (four deploys, together)")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, gate[fn]): break
say(); say("PART 3 · PROOF")
for fn in FNS:
    ok, live = live_files(REF, fn)
    if ok and live.get(f"supabase/functions/{fn}/index.ts") == SHAS[f"{fn}/index.ts"]: say(f"  ✓ {fn} is live as tested")
    else: bad(f"{fn} is not live as tested")
say("  · tested before this step: step4_id_match 9/9, loops_phase2 46/46, missed_notes 51/51; the Hub's own reading (Hub PR step4-reads) 21/21.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE. Tell Claude."); done(9)
say("RESULT: DONE · the server matches attendance and write-ups by AxisCare number first. Nothing was sent; no record changed.")
say("NEXT: merge the Hub pull request (step4-reads) and the Owners Hub pull request, then part 2 connects the old records.")
done(0)
