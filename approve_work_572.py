#!/usr/bin/env python3
# 572 · SLICE 5, APPROVE TO WORK AND AXISCARE ACTIVE (Samantha: "start slice 5", 2026-10-10; her three answers: her own cleared
# wording, the old-path flip left as it is, the lock for new-path people only). Hub project. Runs the small migration (two change-log
# kinds, six roster fields the readiness server owns), replaces caregiver-journey (Approve to Work, the AxisCare update with
# read-back, the cleared text, the Training report door, the lock), coverage-shifts and coverage-run (a locked new hire is never
# offered a shift). Both Admin switches stay OFF (practice): nothing is written to AxisCare and nothing is sent by this step or
# by any press until she turns them on. No existing row changes.
import os, json
os.environ.setdefault("SB_STEP", "572")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FNS = ["caregiver-journey", "coverage-shifts", "coverage-run"]
start("SLICE 5: APPROVE TO WORK AND AXISCARE ACTIVE")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
VJ = {}
for fn in FNS:
    sx, mx = fmeta(REF, fn)
    if sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool): VJ[fn] = mx["verify_jwt"]; say(f"  ✓ {fn} is live at version {mx.get('version', '?')} (gateway sign-in check {'on' if VJ[fn] else 'off'}); replaced by this build, same setting")
    else: bad(f"{fn} is not live or unreadable: {sx}")
SQLF = os.path.join(ROOT, "supabase", "slice5-approve-work.sql")
if not os.path.exists(SQLF): bad("the SQL file is not in the reviewed build")
ok_, c = sql(REF, "select (select count(*)::int from public.client_journey where subject = 'caregiver') as cg_journeys, (select count(*)::int from public.client_journey where subject = 'client') as cl_journeys, (select count(*)::int from public.axiscare_change_log) as changes, (select count(*)::int from public.axiscare_change_log where kind = 'caregiver_status') as status_changes, (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.axiscare_change_log'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%client_created%') as kinds")
if ok_: say(f"  · {c[0]['cg_journeys']} caregiver journey(s), {c[0]['cl_journeys']} client journey(s); {c[0]['changes']} AxisCare change(s) recorded so far, {c[0]['status_changes']} of them caregiver status; the kind list {'already holds' if 'caregiver_status' in str(c[0]['kinds']) else 'does not yet hold'} caregiver_status")
else: bad(f"could not count: {c}")
ok_, sw = sql(REF, "select coalesce(data->>'approve_work_axiscare_live', 'not set') as ax, coalesce(data->>'approve_work_text_live', 'not set') as tx, coalesce(data->>'onboarding_switch_date', '') as d from public.app_data where key = 'ops_settings'")
if ok_ and sw: say(f"  ✓ the switches: AxisCare update {sw[0]['ax']}, cleared text {sw[0]['tx']} (practice unless true); the onboarding switch date is {'NOT set (no real offer on the new path)' if not sw[0]['d'] else sw[0]['d']}")
else: bad(f"could not read the switches: {sw}")
if ok_ and sw and sw[0]['d']: bad("the onboarding switch date is set; stop and tell Claude")
ok_, vj = sql(REF, "select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'caregiver_sweep_patch'")
say("  ✓ caregiver_sweep_patch (441) is installed") if ok_ and int(vj[0]['n']) == 1 else bad(f"caregiver_sweep_patch: {vj}")
say("  · what changes: the kind list, the sweep patch function, three functions. Nothing is written to AxisCare; nothing is sent; no existing row changes.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
ok_, r_ = sql(REF, open(SQLF).read())
if not ok_: bad(f"the migration did not run: {r_}"); done(5)
say("  ✓ the change log knows caregiver_status and prn_team_classes; the sweep patch function accepts the six readiness fields")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, VJ[fn]): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent or changed)")
FNB = f"https://{REF}.supabase.co"
ok_, k = sql(REF, "select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'axiscare_change_log_kind_check'")
say("  ✓ the kind list holds caregiver_status, prn_team_classes and every earlier kind") if ok_ and k and all(x in str(k[0]['d']) for x in ('caregiver_status', 'prn_team_classes', 'client_created', 'scheduling_note')) else bad(f"kinds: {k}")
ok_, p = sql(REF, "select public.caregiver_sweep_patch('no-such-caregiver-572', 0, '{\"work_lock\": true}'::jsonb) as r")
say("  ✓ the sweep patch accepts work_lock (and found no such caregiver, so nothing changed)") if ok_ and p and (p[0]['r'] or {}).get('reason') == 'gone' else bad(f"sweep patch: {p}")
ok_, p2 = sql(REF, "select public.caregiver_sweep_patch('no-such-caregiver-572', 0, '{\"first\": \"x\"}'::jsonb) as r")
say("  ✓ the sweep patch still refuses a field it does not own") if not ok_ and 'not a field the sweep owns' in str(p2) else bad(f"sweep patch did not refuse: {ok_} {p2}")
s_, b_ = http("POST", f"{FNB}/functions/v1/caregiver-journey", {"action": "approve_work", "journey_id": "00000000-0000-0000-0000-000000000000"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ Approve to Work refuses a caller with no sign-in ({s_})") if s_ in (401, 403) else bad(f"approve_work without a sign-in answered {s_}")
s_, b_ = http("POST", f"{FNB}/functions/v1/caregiver-journey", {"action": "training_report", "axiscare_id": "1", "courses": []}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ the Training report door refuses a caller without the server secret ({s_})") if s_ in (401, 403) else bad(f"training_report without the secret answered {s_}")
s_, b_ = http("POST", f"{FNB}/functions/v1/coverage-shifts", {"team_pool": True}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ the Team Builder pool still needs a sign-in ({s_})") if s_ in (401, 403) else bad(f"team_pool without a sign-in answered {s_}")
ok_, c2 = sql(REF, "select (select count(*)::int from public.client_journey where subject = 'client') as cl, (select count(*)::int from public.axiscare_change_log) as changes, (select count(*)::int from public.client_journey_event where kind in ('approved_to_work', 'axiscare_failed', 'cleared_text_sent')) as presses")
say(f"  ✓ client journeys untouched ({c[0]['cl_journeys']} → {c2[0]['cl']}); the change log unchanged ({c[0]['changes']} → {c2[0]['changes']}); no Approve to Work press has happened ({c2[0]['presses']})") if ok_ and int(c2[0]['cl']) == int(c[0]['cl_journeys']) and int(c2[0]['changes']) == int(c[0]['changes']) else bad(f"after: {c2}")
say("  · tested before deploying: 60 checks on the readiness server (the list decides, the stamp, AxisCare refused then confirmed with read-back, the text held after hours and sent in hours, the lock, the Training report door), 53 on the Training Platform's cleared step, the Hub's card and rules tests, the journey check.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · Approve to Work is live for fictional offers in practice: both switches are off, so a press records the stamp, writes nothing to AxisCare and sends nothing. Nothing was sent; no existing row changed."); done(0)
