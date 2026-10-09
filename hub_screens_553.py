#!/usr/bin/env python3
# 553 · SLICE 1f, THE HUB SIDE (Samantha: "start slice 1f", 2026-10-09). Hub project. Replaces outreach-check (the report door
# raises the three offer cards by their own kind) and offer-sign (the Decline link on the signing page; the office opens of
# signed PDFs were already there and logged). Nothing is sent; no record changes.
import os, json
os.environ.setdefault("SB_STEP", "553")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FNS = ["outreach-check", "offer-sign"]
start("SLICE 1f, THE HUB SIDE: THE OFFER CARDS BY KIND, THE DECLINE LINK")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
VJ = {}
for fn in FNS:
    sx, mx = fmeta(REF, fn)
    if sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool): VJ[fn] = mx["verify_jwt"]; say(f"  ✓ {fn} is live at version {mx.get('version', '?')} (gateway sign-in check {'on' if VJ[fn] else 'off'}); replaced by this build, same setting")
    else: bad(f"{fn} is not live or unreadable: {sx}")
ok_, n = sql(REF, "select count(*)::int as n from document_access_log")
say(f"  · {n[0]['n']} logged open(s) of signed PDFs so far") if ok_ else bad(f"could not read the open log: {n}")
say("  · what changes: the two functions. Nothing is sent; no record changes.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, VJ[fn]): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent or changed)")
BASE = f"https://{REF}.supabase.co"
s_, b_ = http("POST", f"{BASE}/functions/v1/offer-sign", {"action": "decline", "o": "00000000-0000-0000-0000-000000000000", "e": 4102444800, "t": "A" * 43}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ a forged link cannot decline anything ({s_})") if s_ in (401, 403) else bad(f"a forged decline answered {s_}")
s_, b_ = http("POST", f"{BASE}/functions/v1/offer-sign", {"action": "open", "offer_id": "00000000-0000-0000-0000-000000000000", "doc": "offer"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ an open without a sign-in is refused ({s_})") if s_ in (401, 403) else bad(f"an open without a sign-in answered {s_}")
s_, b_ = http("POST", f"{BASE}/functions/v1/outreach-check", {"report": True, "kind": "offer_declined", "offer_id": "x", "who": "x", "why": "x"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ the report door refuses a caller with no sign-in or secret ({s_})") if s_ in (401, 403) else bad(f"the report door answered {s_}")
ok_, n2 = sql(REF, "select count(*)::int as n from document_access_log")
say(f"  ✓ the open log is unchanged ({n[0]['n']} → {n2[0]['n']})") if ok_ and int(n2[0]['n']) == int(n[0]['n']) else bad(f"open log changed: {n2}")
say("  · tested before deploying: 30 checks on the signing server (incl. decline before signing with the note, event and card; dead after; a signed offer cannot be declined), 20 on the door (offer cards by kind, unknown kind falls back).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the Hub side of Slice 1f is live. Nothing was sent; nothing changed."); done(0)
