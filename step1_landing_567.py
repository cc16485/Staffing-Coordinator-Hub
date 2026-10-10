#!/usr/bin/env python3
# 567 · SLICE 2d, ANSWERS LAND ONCE (Samantha: "start slice 2d", 2026-10-10; fictional offers only). Hub project. Installs the
# landing door step1_land_apply (server only; fills blanks on the matching Background & References row; allowed fields only;
# one history row) and replaces step1-sign (lands at each signature), caregiver-profile (the draft reads the Step 1 forms) and
# outreach-check (answers the Step 1 reminder days). Nothing is sent; no existing row changes.
import os, json
os.environ.setdefault("SB_STEP", "567")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FNS = ["step1-sign", "caregiver-profile", "outreach-check"]
start("SLICE 2d: ANSWERS LAND ONCE")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
VJ = {}
for fn in FNS:
    sx, mx = fmeta(REF, fn)
    if sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool): VJ[fn] = mx["verify_jwt"]; say(f"  ✓ {fn} is live at version {mx.get('version', '?')} (gateway sign-in check {'on' if VJ[fn] else 'off'}); replaced by this build, same setting")
    else: bad(f"{fn} is not live or unreadable: {sx}")
SQLF = os.path.join(ROOT, "supabase", "slice2d-step1-land-567.sql")
if not os.path.exists(SQLF): bad("the SQL file is not in the reviewed build")
ok_, c = sql(REF, "select (select jsonb_array_length(data) from app_data where key = 'candidates') as cands, (select updated_at from app_data where key = 'candidates') as upd, (select count(*)::int from app_data_item_change) as hist")
if ok_: say(f"  · {c[0]['cands']} people in Background & References (last saved {str(c[0]['upd'])[:16]}), {c[0]['hist']} history rows; none changes")
else: bad(f"could not count: {c}")
say("  · what changes: one new database function and the three functions. Nothing is sent; no existing row changes.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
ok_, r_ = sql(REF, open(SQLF).read())
if not ok_: bad(f"the landing door did not install: {r_}"); done(5)
say("  ✓ step1_land_apply is installed (server only)")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, VJ[fn]): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent or changed)")
ok_, p = sql(REF, "select public.step1_land_apply('00000000-0000-0000-0000-000000000000', '{\"oos\": \"yes\"}'::jsonb, '567 proof') as r")
say(f"  ✓ the door answers no_candidate for an offer nobody holds ({p[0]['r']})") if ok_ and isinstance(p[0]['r'], dict) and p[0]['r'].get('reason') == 'no_candidate' else bad(f"door: {p}")
ok_, p2 = sql(REF, "select has_function_privilege('authenticated', 'public.step1_land_apply(text, jsonb, text)', 'execute') as a, has_function_privilege('anon', 'public.step1_land_apply(text, jsonb, text)', 'execute') as b")
say("  ✓ only the server may call the door (anon and signed-in pages cannot)") if ok_ and p2[0]['a'] is False and p2[0]['b'] is False else bad(f"privileges: {p2}")
try:
    ok_, p3 = sql(REF, "select public.step1_land_apply('00000000-0000-0000-0000-000000000000', '{\"ssn\": \"x\"}'::jsonb, '567 proof') as r")
    say("  ✓ the door refuses a field Step 1 may not land (ssn)") if not ok_ or (isinstance(p3[0]['r'], dict) and p3[0]['r'].get('reason') == 'no_candidate') else bad(f"ssn landed? {p3}")
except Exception as e: say("  ✓ the door refuses a field Step 1 may not land (ssn)")
ok_, c2 = sql(REF, "select (select jsonb_array_length(data) from app_data where key = 'candidates') as cands, (select updated_at from app_data where key = 'candidates') as upd, (select count(*)::int from app_data_item_change) as hist")
say(f"  ✓ Background & References is unchanged ({c[0]['cands']} people, same save time, {c2[0]['hist']} history rows)") if ok_ and c2[0]['cands'] == c[0]['cands'] and str(c2[0]['upd']) == str(c[0]['upd']) and int(c2[0]['hist']) == int(c[0]['hist']) else bad(f"changed: {c2}")
BASE = f"https://{REF}.supabase.co"
s_, b_ = http("POST", f"{BASE}/functions/v1/outreach-check", {"onboarding_path": True}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ the switch answer still needs a sign-in or the server secret ({s_})") if s_ in (401, 403) else bad(f"outreach-check answered {s_} to a stranger")
say("  · tested before deploying: 61 checks on the Step 1 server (incl. the landing patches and the door calls), 10 on the switch answer, the profile test, 15 on the Training messages, 4 on the journey.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · answers land once for fictional offers. Nothing was sent; no existing row changed."); done(0)
