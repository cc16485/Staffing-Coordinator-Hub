#!/usr/bin/env python3
# 569 · SLICE 2e, AVAILABILITY AND SKILLS LAND AT CAREGIVER-CONNECT (Samantha: "start slice 2e", 2026-10-10; fictional offers
# only). Hub project. Replaces caregiver-connect with the build that, after a move succeeds (the hourly job with its switch
# on, or Move over on the Connect card), lands the person's Step 1 availability (if none exists) and their own willingness,
# specialties and matching answers as attested skills (blanks only) through the one item door. Nothing is sent; no record
# changes by this step; the connect switch and door are unchanged.
import os, json
os.environ.setdefault("SB_STEP", "569")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FN = "caregiver-connect"
start("SLICE 2e: AVAILABILITY AND SKILLS LAND AT CAREGIVER-CONNECT")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
sx, mx = fmeta(REF, FN); VJ = None
if sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool): VJ = mx["verify_jwt"]; say(f"  ✓ {FN} is live at version {mx.get('version', '?')} (gateway sign-in check {'on' if VJ else 'off'}); replaced by this build, same setting")
else: bad(f"{FN} is not live or unreadable: {sx}")
ok_, c = sql(REF, "select (select coalesce(jsonb_array_length(data), 0) from app_data where key = 'caregiver_availability') as av, (select coalesce(jsonb_array_length(data), 0) from app_data where key = 'caregiver_overlay') as ov, (select coalesce(data->>'cg_connect_live', 'not set') from app_data where key = 'ops_settings') as live, (select count(*)::int from step1_forms where signatures ? 'availability') as s1")
if ok_: say(f"  · {c[0]['av']} availability record(s), {c[0]['ov']} overlay record(s); caregiver connect switch {c[0]['live']}; {c[0]['s1']} Step 1 record(s) with a signed availability form; none changes now")
else: bad(f"could not count: {c}")
say("  · what changes: the one function. Nothing is sent; nothing lands until a Step 1 person is moved onto the roster.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, FN, VJ): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent or changed)")
BASE = f"https://{REF}.supabase.co"
s_, b_ = http("POST", f"{BASE}/functions/v1/{FN}", {"action": "move", "axiscare_id": "0", "candidate_id": "0"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ the Connect card's door still refuses a caller with no sign-in ({s_})") if s_ in (401, 403) else bad(f"an unsigned move answered {s_}")
ok_, c2 = sql(REF, "select (select coalesce(jsonb_array_length(data), 0) from app_data where key = 'caregiver_availability') as av, (select coalesce(jsonb_array_length(data), 0) from app_data where key = 'caregiver_overlay') as ov")
say(f"  ✓ availability and overlay records unchanged ({c[0]['av']}/{c[0]['ov']} → {c2[0]['av']}/{c2[0]['ov']})") if ok_ and c2[0] == {k: c[0][k] for k in ('av', 'ov')} else bad(f"records: {c2}")
say("  · tested before deploying: 13 checks on the converters and the landing (kept records never overwritten; driving and Level 3 land nothing), 49 on the connect job incl. a live move landing both and practice landing nothing.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · from the next move of a Step 1 person, their availability and skills land on their own. Nothing was sent; no record changed."); done(0)
