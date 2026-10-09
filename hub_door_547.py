#!/usr/bin/env python3
# 547 · SLICE 1c, THE HUB DOOR (Samantha: "start slice 1c", 2026-10-09). Hub project. Replaces the outreach-check function
# with the reviewed build: its onboarding_path answer now also carries the offer expiry, the offer_send_live switch and
# may_reoffer. Nothing else changes; nothing is sent; no record changes. The switch stays off (practice).
import os, json
os.environ.setdefault("SB_STEP", "547")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FN = "outreach-check"
start("SLICE 1c: THE HUB DOOR ANSWERS THE OFFER EXPIRY, THE SWITCH AND MAY-REOFFER")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
sx, mx = fmeta(REF, FN)
if sx == 200 and mx: say(f"  ✓ {FN} is live at version {mx.get('version', '?')}; it is replaced by this reviewed build")
else: bad(f"{FN} is not live: {sx}")
ok_, st = sql(REF, "select coalesce(data->>'offer_send_live', 'not set') as v, coalesce(jsonb_array_length(data->'company_holidays'), 0) as holidays from app_data where key = 'ops_settings'")
if ok_ and st: say(f"  · offer_send_live is {st[0]['v']} (must stay off: practice); {st[0]['holidays']} company holidays on the calendar")
else: bad(f"could not read ops_settings: {st}")
say("  · what changes: only the outreach-check function. Nothing is sent; no record changes.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, FN, True): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent or changed)")
BASE = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
s_, b_ = http("POST", f"{BASE}/functions/v1/{FN}", {"onboarding_path": True}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ the door still refuses a caller with no sign-in ({s_})") if s_ in (401, 403) else bad(f"no sign-in answered {s_}")
ok_, st = sql(REF, "select coalesce(data->>'offer_send_live', 'not set') as v from app_data where key = 'ops_settings'")
say("  ✓ offer_send_live is still off (practice)") if ok_ and st and st[0]['v'] != 'true' else bad(f"offer_send_live: {st}")
say("  · tested before deploying: 13 checks on the real function (expiry with and without a holiday, the switch, the list by identity, an owner, the server door, nothing written) plus the 10 Slice 0 checks.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the Hub door answers the offer expiry, the switch and may-reoffer. Nothing was sent; nothing changed."); done(0)
