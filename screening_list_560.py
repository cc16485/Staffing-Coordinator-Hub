#!/usr/bin/env python3
# 560 · SLICE 2a, THE SCREENING STAFF LIST (Samantha, decision 6, 2026-10-09: "Restrict SSN, DOB, and license-number reveals to
# specifically authorized screening staff, not all office users"). Hub project. Replaces onboarding-permissions with the build
# that knows a third list, "Screening staff": members only may reveal, only an owner changes it, the list starts empty. The
# Admin page (team-hub) shows the list once its pull request is merged. Nothing is sent; no record changes; no reveal exists yet.
import os, json
os.environ.setdefault("SB_STEP", "560")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FN = "onboarding-permissions"
start("SLICE 2a, THE SCREENING STAFF LIST")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
sx, mx = fmeta(REF, FN); VJ = None
if sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool): VJ = mx["verify_jwt"]; say(f"  ✓ {FN} is live at version {mx.get('version', '?')} (gateway sign-in check {'on' if VJ else 'off'}); replaced by this build, same setting")
else: bad(f"{FN} is not live or unreadable: {sx}")
ok_, r_ = sql(REF, "select coalesce(jsonb_array_length(data->'work'), 0)::int as w, coalesce(jsonb_array_length(data->'advance'), 0)::int as a, coalesce(jsonb_array_length(data->'screening'), 0)::int as s from app_data where key = 'onboarding_permissions' limit 1")
if ok_ and r_: say(f"  · today's lists: Approve to Work {r_[0]['w']}, Approve to Advance {r_[0]['a']}, Screening staff {r_[0]['s']} (the saved record is not touched by this step)")
elif ok_: say("  · no permissions record saved yet (the function makes one on first use)")
else: bad(f"could not read the permissions record: {r_}")
say("  · what changes: the one function. Nothing is sent; no record changes; the screening list starts empty, so nobody can reveal anything.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, FN, VJ): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent or changed)")
BASE = f"https://{REF}.supabase.co"
s_, b_ = http("POST", f"{BASE}/functions/v1/{FN}", {"action": "get"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ a caller with no sign-in is refused ({s_})") if s_ in (401, 403) else bad(f"no sign-in answered {s_}")
s_, b_ = http("POST", f"{BASE}/functions/v1/{FN}", {"action": "add", "kind": "screening", "person_id": "x"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ nobody can be put on the screening list without a sign-in ({s_})") if s_ in (401, 403) else bad(f"an unsigned add answered {s_}")
ok_, r2 = sql(REF, "select coalesce(jsonb_array_length(data->'screening'), 0)::int as s from app_data where key = 'onboarding_permissions' limit 1")
say("  ✓ the screening list is empty: no one may reveal identity details until an owner names them on the Admin page") if ok_ and (not r2 or int(r2[0]['s']) == 0) else bad(f"screening list: {r2}")
say("  · tested before deploying: 29 checks on the permissions rules and function (incl. owner-by-title cannot reveal, coordinator cannot add herself, list may be emptied), 30 on the Admin page.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the Screening staff list exists and is empty. Nothing was sent; no record changed."); done(0)
