#!/usr/bin/env python3
# 630 · ONE WAY TO ASK THE TEAM (scheduling review step 3, Samantha 2026-10-12 "continue"). Installs team-ask with Cara's
# checks (No shift texts, this client's Do Not Return list, active in AxisCare, new-hire readiness; fails closed) and
# coverage-run that lets an older Cara new-client check, turned into a Team Builder plan, keep its answers. No switch
# changes. Nothing is sent.
import os, json
os.environ.setdefault("SB_STEP", "630")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FNS = ["team-ask", "coverage-run"]
start("ONE WAY TO ASK THE TEAM")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
ok, r = sql(REF, """select jsonb_array_length(coalesce((select data::jsonb from public.app_data where key = 'coverage_do_not_offer'), '[]'::jsonb)) as dno,
  jsonb_array_length(coalesce((select data::jsonb from public.app_data where key = 'dnr_log'), '[]'::jsonb)) as dnr,
  (select count(*) from public.app_data, jsonb_array_elements(data::jsonb) c where key = 'coverage_cases' and c->>'kind' = 'interest' and c->>'status' = 'open' and coalesce(c->>'open_hours','') <> 'true') as old_open""")
if ok and r: say(f"  · No shift texts list: {r[0]['dno']} · Do Not Return entries: {r[0]['dnr']} · older Cara new-client checks still open: {r[0]['old_open']} (they show at the top of Team Builder)")
meta = {}
for fn in FNS:
    sx, mx = fmeta(REF, fn); meta[fn] = mx if isinstance(mx, dict) else {}
    say(f"  · {fn} is live at version {meta[fn].get('version', '?')}; replaced by this build") if sx == 200 else bad(f"{fn} is not live: {sx}")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, meta[fn].get("verify_jwt", True)): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent)")
for fn in FNS:
    okl, livef = live_files(REF, fn)
    say(f"  ✓ {fn} is live as tested") if okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need(FNROOT, fn)) else bad(f"{fn}: the live copy is not this build")
s4, b4 = http("POST", f"https://{REF}.supabase.co/functions/v1/team-ask", {"action": "draft", "plan_id": "x", "caregiver_name": "x"}, {})
say(f"  ✓ Team Builder's Text still refuses anyone not signed in ({s4})") if s4 in (401, 403) else bad(f"team-ask answered someone not signed in: {s4}")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · Team Builder's Text makes Cara's checks; older new-client checks keep their answers when turned into a plan. Nothing was sent."); done(0)
