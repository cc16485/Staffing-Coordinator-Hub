#!/usr/bin/env python3
# 564 · SLICE 2b, THE STEP 1 SCREENS' SERVER (Samantha: "start slice 2b", 2026-10-10; fictional testing only). Hub project.
# Deploys step1-sign (new) and applicant-link (the step1 link kind). The test gate holds: only offers on the NEW onboarding
# path are served, none real until the switch date; no form is approved for real signing. Nothing is sent; no record changes.
import os, json
os.environ.setdefault("SB_STEP", "564")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FNS = ["applicant-link", "step1-sign"]
start("SLICE 2b: THE STEP 1 SCREENS' SERVER")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
VJ = {}
for fn in FNS:
    sx, mx = fmeta(REF, fn)
    if sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool): VJ[fn] = mx["verify_jwt"]; say(f"  ✓ {fn} is live at version {mx.get('version', '?')} (gateway sign-in check {'on' if VJ[fn] else 'off'}); replaced by this build, same setting")
    elif sx == 404 and fn == "step1-sign": VJ[fn] = True; say(f"  · {fn} is new; it will be deployed with the gateway sign-in check on (the page carries the public key, like offer-sign)")
    else: bad(f"{fn} is not live or unreadable: {sx}")
ok_, c = sql(REF, "select (select count(*)::int from public.step1_forms) as f, (select count(*)::int from public.step1_identity) as i")
say(f"  · Step 1 records today: {c[0]['f']} form row(s), {c[0]['i']} identity row(s); none changes") if ok_ else bad(f"could not count: {c}")
say("  · what changes: the two functions. Nothing is sent; no record changes; no applicant can reach a Step 1 form until an office person makes a link for a new-path offer.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, VJ[fn]): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent or changed)")
BASE = f"https://{REF}.supabase.co"
s_, b_ = http("POST", f"{BASE}/functions/v1/step1-sign", {"action": "view", "o": "00000000-0000-0000-0000-000000000000", "e": 4102444800, "t": "A" * 43}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ a forged Step 1 link opens nothing ({s_})") if s_ in (401, 403) else bad(f"a forged link answered {s_}")
s_, b_ = http("POST", f"{BASE}/functions/v1/step1-sign", {"action": "open", "offer_id": "00000000-0000-0000-0000-000000000000", "form": "vehicle"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ the office door refuses a caller with no sign-in ({s_})") if s_ in (401, 403) else bad(f"the office door answered {s_}")
s_, b_ = http("POST", f"{BASE}/functions/v1/applicant-link", {"action": "mint", "kind": "step1", "offer_id": "00000000-0000-0000-0000-000000000000"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ nobody mints a Step 1 link without a sign-in or the server secret ({s_})") if s_ in (401, 403) else bad(f"an unsigned mint answered {s_}")
ok_, c2 = sql(REF, "select (select count(*)::int from public.step1_forms) as f, (select count(*)::int from public.step1_identity) as i")
say(f"  ✓ no Step 1 record changed ({c[0]['f']}/{c[0]['i']} → {c2[0]['f']}/{c2[0]['i']})") if ok_ and c2[0] == c[0] else bad(f"records: {c2}")
say("  · tested before deploying: 42 checks on the server (door, prefill, save, locked identity, signing in order, write-once PDFs, trail, done), 22 on the links, 19 on the page on a phone.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the Step 1 screens' server is live for fictional offers. Nothing was sent; no record changed."); done(0)
