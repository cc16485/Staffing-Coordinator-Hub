#!/usr/bin/env python3
# 549 · SLICE 1d, THE HUB SIDE (Samantha: "start slice 1d", 2026-10-09). Hub project. Replaces three functions with the
# reviewed build: outreach-check (its answer carries the step1_auto_live switch), applicant-link (a server door that mints
# START links for the Step 1 sender, nothing else) and offer-sign (kicks the Training Platform once both documents are
# signed; the kick carries the offer id only). Nothing is sent by this step; no record changes; the switch stays off.
import os, json
os.environ.setdefault("SB_STEP", "549")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FNS = ["outreach-check", "applicant-link", "offer-sign"]
start("SLICE 1d, THE HUB SIDE: THE SWITCH IN THE DOOR'S ANSWER, THE START-LINK SERVER DOOR, THE KICK FROM THE SIGNING SERVER")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
VJ = {}
for fn in FNS:
    sx, mx = fmeta(REF, fn)
    if sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool): VJ[fn] = mx["verify_jwt"]; say(f"  ✓ {fn} is live at version {mx.get('version', '?')} (gateway sign-in check {'on' if VJ[fn] else 'off'}); replaced by this build, same setting")
    else: bad(f"{fn} is not live or unreadable: {sx}")
ok_, sec = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
names = {x.get("name") for x in (json.loads(sec) if ok_ == 200 and sec.startswith("[") else [])}
for need_ in ("OUTREACH_SECRET", "HUB_JOB_SECRET"):
    say(f"  ✓ the function secret {need_} is set") if need_ in names else bad(f"the function secret {need_} is not set")
ok_, st = sql(REF, "select coalesce(data->>'step1_auto_live', 'not set') as v from app_data where key = 'ops_settings'")
say(f"  · step1_auto_live is {st[0]['v']} (practice unless true)") if ok_ and st else bad(f"could not read ops_settings: {st}")
say("  · what changes: the three functions. Nothing is sent; no record changes.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, VJ[fn]): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent or changed)")
BASE = f"https://{REF}.supabase.co"
s_, b_ = http("POST", f"{BASE}/functions/v1/applicant-link", {"action": "mint", "kind": "start", "offer_id": "00000000-0000-0000-0000-000000000000"}, {"apikey": "", "Authorization": "Bearer ", "x-outreach-secret": "x" * 40})
say(f"  ✓ the start-link server door refuses a wrong secret ({s_})") if s_ in (401, 403) else bad(f"a wrong secret answered {s_}")
s_, b_ = http("POST", f"{BASE}/functions/v1/applicant-link", {"action": "mint", "kind": "start", "offer_id": "00000000-0000-0000-0000-000000000000"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ minting without a sign-in is still refused ({s_})") if s_ in (401, 403) else bad(f"no sign-in answered {s_}")
s_, b_ = http("POST", f"{BASE}/functions/v1/offer-sign", {"action": "view", "o": "00000000-0000-0000-0000-000000000000", "e": 4102444800, "t": "A" * 43}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ a forged offer link still gets nothing from the signing server ({s_})") if s_ in (401, 403) else bad(f"a forged link answered {s_}")
ok_, st = sql(REF, "select coalesce(data->>'step1_auto_live', 'not set') as v from app_data where key = 'ops_settings'")
say("  ✓ step1_auto_live is still off (practice)") if ok_ and st and st[0]['v'] != 'true' else bad(f"step1_auto_live: {st}")
say("  · tested before deploying: 26 checks on the signing server (incl. the kick once, with the secret, offer id only), 20 on the links (incl. the server door: start only, wrong secret refused), 13 on the door's answer.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the Hub side of Slice 1d is live; the Step 1 switch is off (practice). Nothing was sent; nothing changed."); done(0)
