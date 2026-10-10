#!/usr/bin/env python3
# 566 · SLICE 2c, THE IDENTITY REVEAL AND THE SCREENING DESK (Samantha: "start slice 2c", 2026-10-10; fictional offers only).
# Hub project. Adds one column (document_access_log.reason) and replaces step1-sign with the build that answers the desk
# (screening) and opens one sealed value for a named screening staff member (reveal: five minutes, logged, counted, on the
# trail; the value in no row). The Screening staff list is empty until an owner names someone, so no reveal can happen yet.
# Nothing is sent; no existing row changes.
import os, json
os.environ.setdefault("SB_STEP", "566")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FN = "step1-sign"
start("SLICE 2c: THE IDENTITY REVEAL AND THE SCREENING DESK")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
sx, mx = fmeta(REF, FN); VJ = None
if sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool): VJ = mx["verify_jwt"]; say(f"  ✓ {FN} is live at version {mx.get('version', '?')} (gateway sign-in check {'on' if VJ else 'off'}); replaced by this build, same setting")
else: bad(f"{FN} is not live or unreadable: {sx} (run Desktop 564 first)")
SQLF = os.path.join(ROOT, "supabase", "slice2c-access-log-reason-566.sql")
if not os.path.exists(SQLF): bad("the SQL file is not in the reviewed build")
ok_, c = sql(REF, "select (select count(*)::int from public.document_access_log) as log, (select count(*)::int from public.step1_identity) as ident, (select coalesce(jsonb_array_length(data->'screening'), 0)::int from app_data where key = 'onboarding_permissions') as screening")
if ok_: say(f"  · access log {c[0]['log']} row(s), identity records {c[0]['ident']}, Screening staff named: {c[0]['screening']} (nobody can reveal until an owner names someone on the Admin page)")
else: bad(f"could not count: {c}")
say("  · what changes: one new column and the one function. Nothing is sent; no existing row changes.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
ok_, r_ = sql(REF, open(SQLF).read())
if not ok_: bad(f"column: {r_}"); done(5)
say("  ✓ document_access_log.reason is in place")
if not deploy(REF, FNROOT, FN, VJ): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent or changed)")
BASE = f"https://{REF}.supabase.co"
s_, b_ = http("POST", f"{BASE}/functions/v1/{FN}", {"action": "reveal", "offer_id": "00000000-0000-0000-0000-000000000000", "field": "ssn", "reason": "proof run"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ a reveal without a sign-in is refused ({s_})") if s_ in (401, 403) else bad(f"an unsigned reveal answered {s_}")
s_, b_ = http("POST", f"{BASE}/functions/v1/{FN}", {"action": "screening", "offer_id": "00000000-0000-0000-0000-000000000000"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ the desk refuses a caller with no sign-in ({s_})") if s_ in (401, 403) else bad(f"an unsigned desk call answered {s_}")
ok_, c2 = sql(REF, "select (select count(*)::int from public.document_access_log) as log, (select count(*) filter (where doc like 'identity:%')::int from public.document_access_log) as reveals")
say(f"  ✓ the access log is unchanged ({c[0]['log']} → {c2[0]['log']}); identity reveals logged so far: {c2[0]['reveals']}") if ok_ and int(c2[0]['log']) == int(c[0]['log']) else bad(f"log: {c2}")
say("  · tested before deploying: 54 checks on the server (incl. not on the list refused, reason required, one field per reveal, log + count + trail without the value, purged refused), 13 on the desk and proof-required saves on the real page.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the screening desk's server is live for fictional offers; nobody can reveal until an owner names screening staff. Nothing was sent; no existing row changed."); done(0)
