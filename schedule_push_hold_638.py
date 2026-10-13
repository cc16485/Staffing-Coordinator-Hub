#!/usr/bin/env python3
# 638 · TEAM BUILDER: STILL ONBOARDING WAITS FOR AXISCARE (Samantha 2026-10-13: "1st, 2nd, 3rd ... choice" and people who
# have been offered a position "with a note that they are still onboarding"; "yes to a and b"). Installs schedule-push:
# a shift confirmed for someone still onboarding (a new hire awaiting Approve to Work, or an offer not on the AxisCare
# roster yet) is held with the reason and never sent to AxisCare; it goes in once they're approved. If the readiness
# check can't be read, nothing is sent (fail closed). No switch changes. Nothing is sent or written in AxisCare here.
import os, json
os.environ.setdefault("SB_STEP", "638")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FNS = ["schedule-push"]
start("STILL ONBOARDING WAITS FOR AXISCARE")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
meta = {}
for fn in FNS:
    sx, mx = fmeta(REF, fn); meta[fn] = mx if isinstance(mx, dict) else {}
    if sx != 200: bad(f"{fn} is not live: {sx}"); continue
    say(f"  · {fn} is live at version {meta[fn].get('version', '?')}; replaced by this build")
    okl, livef = live_files(REF, fn)
    if okl:
        others = sorted(k[len("supabase/functions/"):] for k, h in livef.items() if k.startswith("supabase/functions/")
                        and not k.endswith(f"{fn}/index.ts") and os.path.exists(os.path.join(ROOT, k)) and sha(os.path.join(ROOT, k)) != h)
        say(f"    shared files that also update with it (all merged): {', '.join(others)}" if others else "    no other shared file changes ride along")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, meta[fn].get("verify_jwt", True)): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent)")
for fn in FNS:
    okl, livef = live_files(REF, fn)
    say(f"  ✓ {fn} is live as tested") if okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need(FNROOT, fn)) else bad(f"{fn}: the live copy is not this build")
    s4, b4 = http("POST", f"https://{REF}.supabase.co/functions/v1/{fn}", {"action": "preview", "plan_id": "x"}, {})
    say(f"  ✓ {fn} refuses a stranger ({s4})") if s4 in (401, 403) else bad(f"{fn} answered a stranger: {s4}")
say("  · next: on a Team Builder plan, a confirmed shift for someone still onboarding shows under \"waiting\" in Send to AxisCare, with the reason.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · shifts for people still onboarding wait until they're approved. Nothing was sent."); done(0)
