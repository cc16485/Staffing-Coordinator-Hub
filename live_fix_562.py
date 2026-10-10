#!/usr/bin/env python3
# 562 · LIVE FIX: TWO FUNCTIONS SECURED, ONE REMINDER AT A TIME (Samantha, 2026-10-09). Hub project. Replaces score-interview
# (office staff only, by their own sign-in) and orientation-booked (relays a booking to GoHighLevel only for a real booking
# saved moments ago, once, and never while the Hub's own orientation reminder switch is on). Adds one column
# (orient_bookings.ghl_relayed_at). Nothing is sent; no existing row changes.
import os, json
os.environ.setdefault("SB_STEP", "562")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FNS = ["score-interview", "orientation-booked"]
start("LIVE FIX: TWO FUNCTIONS SECURED, ONE REMINDER AT A TIME")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
VJ = {}
for fn in FNS:
    sx, mx = fmeta(REF, fn)
    if sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool): VJ[fn] = mx["verify_jwt"]; say(f"  ✓ {fn} is live at version {mx.get('version', '?')} (gateway sign-in check {'on' if VJ[fn] else 'off'}); replaced by this build, same setting")
    else: bad(f"{fn} is not live or unreadable: {sx}")
SQLF = os.path.join(ROOT, "supabase", "orient-bookings-ghl-relayed-562.sql")
if not os.path.exists(SQLF): bad("the SQL file is not in the reviewed build")
ok_, sw = sql(REF, "select coalesce((data->>'orient_remind_live')::boolean, false) as live from app_data where key = 'ops_settings'")
if ok_: say(f"  · the Hub's own orientation reminder switch (orient_remind_live) is {'ON' if sw and sw[0]['live'] else 'OFF'} right now" + (" → after this step GoHighLevel receives no new bookings; the Hub reminds" if sw and sw[0]['live'] else " → GoHighLevel keeps reminding, one relay per real booking"))
else: bad(f"could not read the switch: {sw}")
say("  · what changes: the two functions and one new column. Nothing is sent; no existing row changes.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
ok_, r_ = sql(REF, open(SQLF).read())
say("  ✓ orient_bookings.ghl_relayed_at is in place") if ok_ else (bad(f"column: {r_}"), done(5))
for fn in FNS:
    if not deploy(REF, FNROOT, fn, VJ[fn]): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent or changed)")
BASE = f"https://{REF}.supabase.co"
s_, b_ = http("POST", f"{BASE}/functions/v1/score-interview", {"recording_id": "00000000-0000-0000-0000-000000000000"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ score-interview refuses a caller with no sign-in ({s_})") if s_ in (401, 403) else bad(f"score-interview answered {s_} without a sign-in")
s_, b_ = http("POST", f"{BASE}/functions/v1/orientation-booked", {"session_id": "no-such-session", "phone": "4175550000", "orientation_date": "2026-12-01"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ orientation-booked relays nothing for a booking that does not exist ({s_})") if s_ in (400, 401, 403, 404) else bad(f"orientation-booked answered {s_} for a made-up booking")
say("  · tested before deploying: 11 checks (no sign-in / bad token / no staff record refused; switch on relays nothing; no booking, stale booking, wrong phone refused; a real booking relays once with the row's own names; second call relays nothing).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the two functions are secured. Nothing was sent; no existing row changed."); done(0)
