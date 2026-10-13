#!/usr/bin/env python3
# 637 · THE TEAM BUILDER LIST WORKS AGAIN (2026-10-13). coverage-shifts' team_pool used the new-hire lock (workLock,
# LOCK_WHY) without importing it since Slice 5 (Oct 10), so every Team Builder list, the staffing sheet and the "New hires
# waiting for hours" card failed. Found by the onboarding launch session; one import line. Installs coverage-shifts and
# proves the list answers (it reads AxisCare; nothing is written or sent).
import os, json
os.environ.setdefault("SB_STEP", "637")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FN = "coverage-shifts"
start("THE TEAM BUILDER LIST WORKS AGAIN")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
sx, mx = fmeta(REF, FN)
say(f"  · {FN} is live at version {mx.get('version', '?')}; replaced by this build") if sx == 200 else bad(f"{FN} is not live: {sx}")
okl, livef = live_files(REF, FN)
if okl:
    others = sorted(k[len("supabase/functions/"):] for k, h in livef.items() if k.startswith("supabase/functions/") and not k.endswith(f"{FN}/index.ts")
                    and os.path.exists(os.path.join(ROOT, k)) and sha(os.path.join(ROOT, k)) != h)
    say(f"  · shared files that also update with it (all merged): {', '.join(others)}" if others else "  · no other shared file changes ride along")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, FN, mx.get("verify_jwt", True) if isinstance(mx, dict) else True): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (reads AxisCare; nothing is written or sent)")
okl, livef = live_files(REF, FN)
say(f"  ✓ {FN} is live as tested") if okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need(FNROOT, FN)) else bad("the live copy is not this build")
s2, b2 = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG()); SVC = ""
try:
    arr = json.loads(b2) if s2 == 200 else []
    if isinstance(arr, dict): arr = arr.get("keys") or []
    SVC = next((str(k.get("api_key")) for k in arr if isinstance(k, dict) and k.get("name") == "service_role" and str(k.get("api_key", "")).startswith("eyJ")), "")
except Exception: SVC = ""
s4, b4 = http("POST", f"https://{REF}.supabase.co/functions/v1/{FN}", {"team_pool": True}, {"apikey": SVC, "Authorization": "Bearer " + SVC}) if SVC else (None, "no key")
try: j = json.loads(b4)
except Exception: j = {}
if s4 == 200 and isinstance(j.get("caregivers"), list):
    nh = [c for c in j["caregivers"] if c.get("new_hire")]
    say(f"  ✓ the Team Builder list answers: {j.get('count', len(j['caregivers']))} active caregivers, {j.get('locked', 0)} awaiting Approve to Work, {len(nh)} new hire(s) waiting for hours")
elif s4 == 503: say(f"  · the list answered but is holding: {str(j.get('error', b4))[:200]} (the readiness cards could not be read; nothing is offered until they can)")
else: bad(f"the Team Builder list did not answer: {s4} {str(b4)[:200]}")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the Team Builder list, the staffing sheet and the new-hires card work again. Nothing was sent."); done(0)
