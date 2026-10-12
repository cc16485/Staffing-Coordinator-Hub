#!/usr/bin/env python3
# 632 · CARA NEVER TEXTS ON HER OWN (Samantha 2026-10-12 "go", decision 6, after 631: manual select on since the 09-19
# redesign, last automatic text Sep 16). Installs coverage-run with the automatic waves and their escalation retired:
# a caregiver is only ever texted about a shift when a person picked them. Everything else Cara does stays. No switch
# changes. Nothing is sent.
import os, json
os.environ.setdefault("SB_STEP", "632")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FN = "coverage-run"
start("CARA NEVER TEXTS ON HER OWN")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
ok, r = sql(REF, "select coalesce(data->>'coverage_send_live','not set') as s, coalesce(data->>'coverage_manual_select','not set') as m from public.app_data where key = 'ops_settings'")
if ok and r: say(f"  · open-shift texts {r[0]['s']}; \"you choose who gets asked\" {r[0]['m']} (left as it is; from now on it no longer matters)")
sx, mx = fmeta(REF, FN)
say(f"  · {FN} is live at version {mx.get('version', '?')}; replaced by this build") if sx == 200 else bad(f"{FN} is not live: {sx}")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, FN, mx.get("verify_jwt", True) if isinstance(mx, dict) else True): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent)")
okl, livef = live_files(REF, FN)
say(f"  ✓ {FN} is live as tested") if okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need(FNROOT, FN)) else bad("the live copy is not this build")
# No practice round is called here: a direct call to Cara's round can still send office call-in alerts (PRN3 lesson).
# The proof is the live code itself (the build tested: waves_retired_test.mjs 5/5) and that it refuses strangers.
s5, b5 = http("POST", f"https://{REF}.supabase.co/functions/v1/{FN}", {"action": "candidates", "case_id": "x"}, {})
say(f"  ✓ it refuses anyone not signed in ({s5})") if s5 in (401, 403) else bad(f"it answered someone not signed in: {s5}")
say("  · from now: a caregiver is texted about a shift only when a person picks them (Build the ask list, then send).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · Cara's automatic waves are retired: a caregiver is only texted about a shift when a person picked them. Nothing was sent."); done(0)
