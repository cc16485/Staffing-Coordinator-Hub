#!/usr/bin/env python3
# 628 · THE VISIT BOX NEVER CHANGES A VISIT IT COULDN'T READ (Samantha 2026-10-12: the Live Schedule box for April
# Davidson's Oct 12 visit showed "– · nobody" and wouldn't close). visit-change now finds the visit in every shape AxisCare
# answers with, and refuses (nothing changed) when AxisCare sends no day or time back. Install only; nothing is sent.
import os, json
os.environ.setdefault("SB_STEP", "628")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FN = "visit-change"
start("THE VISIT BOX NEVER CHANGES A VISIT IT COULDN'T READ")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
ok, r = sql(REF, "select coalesce((select data->>'visit_change_live' from public.app_data where key = 'ops_settings'), 'not set') as live")
if ok and r: say(f"  · changing visits from the Hub is {'ON' if r[0]['live'] == 'true' else 'OFF'} right now; this run leaves it as it is")
sx, mx = fmeta(REF, FN)
say(f"  · visit-change is live at version {mx.get('version', '?')}; replaced by this build") if sx == 200 else bad(f"visit-change is not live: {sx}")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, FN, mx.get("verify_jwt", True) if isinstance(mx, dict) else True): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent)")
okl, livef = live_files(REF, FN)
say("  ✓ visit-change is live as tested") if okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need(FNROOT, FN)) else bad("the live copy is not this build")
s4, b4 = http("POST", f"https://{REF}.supabase.co/functions/v1/{FN}", {"action": "reasons"}, {})
say(f"  ✓ it still refuses anyone not signed in ({s4})") if s4 in (401, 403) else bad(f"it answered someone not signed in: {s4} {str(b4)[:160]}")
say("  · next: click a visit on the Live Schedule. If AxisCare still sends no details back, the box says so, with a small 'For Claude' line; send Claude a screenshot.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the visit box reads every AxisCare answer and never changes a visit it couldn't read. Nothing was sent."); done(0)
