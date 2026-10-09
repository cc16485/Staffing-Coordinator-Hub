#!/usr/bin/env python3
# 551 · SLICE 1e, THE HUB SIDE (Samantha: "start slice 1e", 2026-10-09). Hub project. Replaces outreach-check (its answer
# carries the reminder days and the reminders switch) and applicant-link (the server door may mint offer links with the
# offer's own expiry, for the scheduled reminders). Nothing is sent; no record changes; the switch stays off.
import os, json
os.environ.setdefault("SB_STEP", "551")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FNS = ["outreach-check", "applicant-link"]
start("SLICE 1e, THE HUB SIDE: REMINDER DAYS AND SWITCH IN THE DOOR'S ANSWER, OFFER LINKS THROUGH THE SERVER DOOR")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
VJ = {}
for fn in FNS:
    sx, mx = fmeta(REF, fn)
    if sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool): VJ[fn] = mx["verify_jwt"]; say(f"  ✓ {fn} is live at version {mx.get('version', '?')} (gateway sign-in check {'on' if VJ[fn] else 'off'}); replaced by this build, same setting")
    else: bad(f"{fn} is not live or unreadable: {sx}")
ok_, st = sql(REF, "select coalesce(data->>'offer_reminders_live', 'not set') as v, coalesce(data->'onboarding'->>'offer_days', 'not set (2 and 5 apply)') as days from app_data where key = 'ops_settings'")
say(f"  · offer_reminders_live is {st[0]['v']} (practice unless true); reminder days on the Admin page: {st[0]['days']}") if ok_ and st else bad(f"could not read ops_settings: {st}")
say("  · what changes: the two functions. Nothing is sent; no record changes.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, VJ[fn]): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent or changed)")
BASE = f"https://{REF}.supabase.co"
s_, b_ = http("POST", f"{BASE}/functions/v1/applicant-link", {"action": "mint", "kind": "offer", "offer_id": "00000000-0000-0000-0000-000000000000", "exp": 4102444800}, {"apikey": "", "Authorization": "Bearer ", "x-outreach-secret": "x" * 40})
say(f"  ✓ the server door refuses a wrong secret ({s_})") if s_ in (401, 403) else bad(f"a wrong secret answered {s_}")
s_, b_ = http("POST", f"{BASE}/functions/v1/outreach-check", {"onboarding_path": True}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ the door still refuses a caller with no sign-in ({s_})") if s_ in (401, 403) else bad(f"no sign-in answered {s_}")
ok_, st = sql(REF, "select coalesce(data->>'offer_reminders_live', 'not set') as v from app_data where key = 'ops_settings'")
say("  ✓ offer_reminders_live is still off (practice)") if ok_ and st and st[0]['v'] != 'true' else bad(f"offer_reminders_live: {st}")
say("  · tested before deploying: 17 checks on the door's answer (days from the Admin page, junk and out-of-order days fall back to 2 and 5, the switch), 22 on the links (the server door mints offer links only with the offer's expiry; orientation links refused).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the Hub side of Slice 1e is live; the reminders switch is off (practice). Nothing was sent; nothing changed."); done(0)
