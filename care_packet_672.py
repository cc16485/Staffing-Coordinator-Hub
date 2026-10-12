#!/usr/bin/env python3
# 672 · CAREGIVER PACKET CARD FIX (2026-10-12). Samantha could not see the packet card on any client. Server half:
# care-packet's browser rules did not allow the x-cc-via header the Hub sends on every call, so the browser blocked
# every call ("Failed to fetch"). Redeploys care-packet with x-cc-via + x-cc-employee allowed. Nothing else changes:
# no tables, no switches, nothing texted. Undo: redeploy care-packet from 663's build.
import os, json
os.environ.setdefault("SB_STEP", "672")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
U = f"https://{REF}.supabase.co/functions/v1/care-packet"
PRE = {"Origin": "https://cc.mo-care.com", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,apikey,content-type,x-cc-via"}
def allowed():
    import urllib.request
    try:
        with urllib.request.urlopen(urllib.request.Request(U, method="OPTIONS", headers=PRE), timeout=30) as r:
            return "x-cc-via" in (r.headers.get("access-control-allow-headers") or "").lower()
    except Exception as e:
        return None
start("CAREGIVER PACKET CARD FIX (the Hub's calls were blocked)")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
s1, m1 = fmeta(REF, "care-packet")
say(f"  ✓ care-packet is live (version {(m1 or {}).get('version', '?')})") if s1 == 200 else bad(f"care-packet is not deployed ({s1}). Tell Claude.")
a0 = allowed()
say("  · right now the Hub's calls are blocked (this is the bug)") if a0 is False else say(f"  · right now the Hub's header is {'already allowed' if a0 else 'not readable'}")
say("  · what changes: care-packet's browser rules only. No tables, no switches, no texts.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, "care-packet", False): say("  RESULT: STOPPED. Tell Claude."); done(6)

say(); say("PART 3 · PROOF (nothing is sent, nothing is saved)")
say("  ✓ the Hub's calls are allowed through now (x-cc-via)") if allowed() else bad("the Hub's header is still not allowed. Tell Claude.")
sx, bx = http("POST", U, {"action": "get", "ax": "1"})
say("  ✓ care-packet still refuses anyone not signed in (401)") if sx == 401 else bad(f"without sign-in it answered {sx}: {bx[:120]}")
say("  · tested before deploying: care-packet 88 checks (1 new: the browser rules allow the Hub's header, fails on the old build), packet watch 19, the card in a browser 45.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the server half is fixed. Merge the Hub pull request #369 next."); done(0)
