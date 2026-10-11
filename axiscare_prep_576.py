#!/usr/bin/env python3
# 576 · SLICE 7, AXISCARE PREPARATION (Samantha "yes to all", 2026-10-10). Hub project. Runs the small migration (two change-log kinds,
# five catalog rows) and replaces caregiver-journey (the hire date and the approved Level of Care class written once after AxisCare
# reads back Active, the copy sheets, the hire nudge). Both new switches stay OFF (practice): nothing is written to AxisCare.
# No existing row changes; nothing is sent.
import os, json
os.environ.setdefault("SB_STEP", "576")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FNS = ["caregiver-journey"]
start("SLICE 7: AXISCARE PREPARATION")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
VJ = {}
for fn in FNS:
    sx, mx = fmeta(REF, fn)
    if sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool): VJ[fn] = mx["verify_jwt"]; say(f"  ✓ {fn} is live at version {mx.get('version', '?')} (gateway sign-in check {'on' if VJ[fn] else 'off'}); replaced by this build, same setting")
    else: bad(f"{fn} is not live or unreadable: {sx}")
SQLF = os.path.join(ROOT, "supabase", "slice7-axiscare-prep.sql")
if not os.path.exists(SQLF): bad("the SQL file is not in the reviewed build")
ok_, c = sql(REF, "select (select count(*)::int from public.client_journey_step_def where key like 'cg.%' and active) as cg_active, (select count(*)::int from public.client_journey where subject = 'caregiver') as cg, (select count(*)::int from public.axiscare_change_log) as changes, (select pg_get_constraintdef(oid) from pg_constraint where conname = 'axiscare_change_log_kind_check') as kinds")
if ok_: say(f"  · {c[0]['cg_active']} active caregiver catalog rows (42 after this step), {c[0]['cg']} caregiver journey(s), {c[0]['changes']} AxisCare change(s) recorded; the kind list {'already holds' if 'caregiver_level' in str(c[0]['kinds']) else 'does not yet hold'} caregiver_level")
else: bad(f"could not count: {c}")
ok_, sw = sql(REF, "select coalesce(data->>'axiscare_hire_date_live', 'not set') as h, coalesce(data->>'axiscare_level_live', 'not set') as l, coalesce(data->>'approve_work_axiscare_live', 'not set') as a, coalesce(data->>'onboarding_switch_date', '') as d from public.app_data where key = 'ops_settings'")
if ok_ and sw: say(f"  ✓ the switches: hire date {sw[0]['h']}, level class {sw[0]['l']}, Approve to Work AxisCare update {sw[0]['a']} (practice unless true); the onboarding switch date is {'NOT set' if not sw[0]['d'] else sw[0]['d']}")
else: bad(f"could not read the switches: {sw}")
say("  · what changes: the kind list, five catalog rows, one function. Nothing is written to AxisCare; nothing is sent; no existing row changes.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
ok_, r_ = sql(REF, open(SQLF).read())
if not ok_: bad(f"the migration did not run: {r_}"); done(5)
say("  ✓ the change log knows caregiver_hire_date and caregiver_level; the five catalog rows are active")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, VJ[fn]): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent or changed)")
FNB = f"https://{REF}.supabase.co"
ok_, k = sql(REF, "select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'axiscare_change_log_kind_check'")
say("  ✓ the kind list holds caregiver_hire_date, caregiver_level and every earlier kind") if ok_ and k and all(x in str(k[0]['d']) for x in ('caregiver_hire_date', 'caregiver_level', 'caregiver_status', 'prn_team_classes', 'client_created')) else bad(f"kinds: {k}")
ok_, rows = sql(REF, "select key, (def->>'required')::boolean as required, def->>'proof' as proof from public.client_journey_step_def where key like 'cg.axiscare.%' and active order by key")
say("  ✓ the AxisCare rows: " + ", ".join(f"{r['key'].split('.')[-1]} ({r['proof']}{'' if r['required'] else ', optional'})" for r in rows)) if ok_ and len(rows) == 6 else bad(f"rows: {rows}")
s_, b_ = http("POST", f"{FNB}/functions/v1/caregiver-journey", {"action": "copy_sheet", "journey_id": "00000000-0000-0000-0000-000000000000", "which": "attributes"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ the copy sheet refuses a caller with no sign-in ({s_})") if s_ in (401, 403) else bad(f"copy_sheet without a sign-in answered {s_}")
ok_, c2 = sql(REF, "select (select count(*)::int from public.axiscare_change_log) as changes, (select count(*)::int from public.client_journey where subject = 'caregiver') as cg, (select count(*)::int from public.client_journey_step_def where key like 'cg.%' and active) as cg_active")
say(f"  ✓ the change log unchanged ({c[0]['changes']} → {c2[0]['changes']}); caregiver journeys untouched ({c[0]['cg']} → {c2[0]['cg']}); {c2[0]['cg_active']} caregiver rows active") if ok_ and int(c2[0]['changes']) == int(c[0]['changes']) and int(c2[0]['cg']) == int(c[0]['cg']) and int(c2[0]['cg_active']) == 42 else bad(f"after: {c2}")
say("  · tested before deploying: the readiness server test (practice records nothing; live: the hire date and the level class written once by the caregiver's record and read back, unchanged when they already match, refused with a card and Retry; the copy sheets; the hire nudge), the Hub's card tests.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · AxisCare preparation is live for fictional offers in practice: both switches are off, so nothing is written to AxisCare. Nothing was sent; no existing row changed."); done(0)
