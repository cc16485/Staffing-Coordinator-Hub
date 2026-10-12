#!/usr/bin/env python3
# 635 · NEW HIRES WAITING FOR HOURS (Samantha 2026-10-12: "a good place to put so clearly a new hires until they are
# scheduled ... show what their availability is and make them a priority", and "B"). Installs coverage-shifts (the Team
# Builder list now carries each caregiver's AxisCare hire date and a "new hire, needs hours" flag, which the Hub's card
# on Cara, Hours & matching reads) and coverage-run (Cara's ask lists tag them and put them first among people who fit
# equally well). Nobody becomes eligible or ineligible. No switch changes. Nothing is sent.
import os, json
os.environ.setdefault("SB_STEP", "635")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FNS = ["coverage-shifts", "coverage-run"]
start("NEW HIRES WAITING FOR HOURS")
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
    s4, b4 = http("POST", f"https://{REF}.supabase.co/functions/v1/{fn}", {"team_pool": True}, {})
    say(f"  ✓ {fn} refuses a stranger ({s4})") if s4 in (401, 403) else bad(f"{fn} answered a stranger: {s4}")
say("  · next: open Cara, Hours & matching. New hires waiting for hours are at the top (it reads AxisCare when the tab opens).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · new hires who need hours are listed on Cara, Hours & matching, tagged and first among equal fits. Nothing was sent."); done(0)
