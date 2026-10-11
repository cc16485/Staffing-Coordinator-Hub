#!/usr/bin/env python3
# 597 · STEP 1 BEFORE CHECKS, THE MAIN PROFILE, CASE.NET (Samantha 2026-10-11, "yes to all" + "also make sure every send,
# receive, completed time stamp is recorded in their main profile..." + "also add, check case.net ... as one of the background
# checks"). Hub project.
#   · the server door step1_candidate_create (server only): on the new path a person enters Background & References only when
#     their Step 1 is complete, by the server; Case.net becomes a readiness row both approvals wait for; its value history is kept
#   · step1-sign: at the last signature, in to Background & References, every form landed, ONE card for Recruiting & Orientation
#   · hire-profile (new): the main profile (every send, receipt and completion; every signed document, opened by a logged link)
#   · caregiver-journey (the Case.net verdict) and caregiver-export (the Case.net row)
# Each service is deployed only when its live copy is main's build or an older version of it (never someone's unmerged work).
# Nothing is sent; no existing record changes.
import os, json, subprocess, hashlib
os.environ.setdefault("SB_STEP", "597")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FNS = ["step1-sign", "hire-profile", "caregiver-journey", "caregiver-export"]; NEW = {"hire-profile"}
_HIST = {}
def in_history(rel, live_sha):
    if not live_sha: return False
    if rel not in _HIST:
        shas = set()
        try:
            for c in subprocess.run(["git", "-C", ROOT, "log", "--format=%H", "--", rel], capture_output=True, text=True, timeout=120).stdout.split():
                b = subprocess.run(["git", "-C", ROOT, "show", f"{c}:{rel}"], capture_output=True, timeout=60).stdout
                if b: shas.add(hashlib.sha256(b).hexdigest())
        except Exception: pass
        _HIST[rel] = shas
    return live_sha in _HIST[rel]
start("STEP 1 BEFORE CHECKS, THE MAIN PROFILE, CASE.NET")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
SQLF = os.path.join(ROOT, "supabase", "step1-before-checks.sql")
if not os.path.exists(SQLF): bad("the SQL file is not in the reviewed build")
VJ = {}
short = lambda ks: ', '.join(d.split('/')[-2] + '/' + d.split('/')[-1] for d in ks[:4])
for fn in FNS:
    sx, mx = fmeta(REF, fn)
    if sx == 404 and fn in NEW: VJ[fn] = True; say(f"  · {fn} is new; deployed with the gateway sign-in check on (office staff by their own sign-in)"); continue
    if not (sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool)): bad(f"{fn} is not live or unreadable: {sx}"); continue
    VJ[fn] = mx["verify_jwt"]
    okl, livef = live_files(REF, fn)
    if not okl: bad(f"could not read {fn}'s live files"); continue
    differ = [k for k in need(FNROOT, fn) if livef.get(k) != sha(os.path.join(ROOT, k))]
    missing = [k for k in differ if livef.get(k) is None]
    unknown = [k for k in differ if livef.get(k) is not None and not in_history(k, livef.get(k))]
    if unknown: bad(f"{fn}'s live copy holds {short(unknown)} in a version that was never on main (someone's unmerged work); deploying would overwrite it. Tell Claude.")
    else: say(f"  ✓ {fn} is live at version {mx.get('version', '?')}" + (f": brought up to main ({short(differ)})" if differ else ": already main's build apart from today's change"))
ok_, c = sql(REF, "select (select count(*)::int from public.app_data, jsonb_array_elements(data) x where key = 'candidates') as cands, (select count(*)::int from public.client_journey_step_def where key like 'cg.%' and active) as rows, "
                  "(select count(*)::int from public.domains where entity = 'cc_ihs' and code = 'recruiting_orientation' and owner_person is not null) as owned")
if ok_:
    say(f"  · {c[0]['cands']} Background & References record(s) (unchanged by this step); {c[0]['rows']} active caregiver readiness rows")
    say("  ✓ Recruiting & Orientation has an owner on the Admin page (the Step 1 complete card goes to them)") if int(c[0]['owned']) else say("  ! Recruiting & Orientation has no owner on the Admin page: the Step 1 complete card will show on Needs Attention unowned until you name one")
else: bad(f"could not read: {c}")
say("  · what changes: one server-only door, the Case.net readiness row (both approvals wait for it), four services. Nothing is sent; no record changes.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
ok_, r_ = sql(REF, open(SQLF).read())
if not ok_: bad(f"the migration did not run: {r_}"); done(5)
say("  ✓ step1_candidate_create installed (server only); Case.net is a readiness row that Approve to Advance and Approve to Work wait for")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, VJ[fn]): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent)")
FNB = f"https://{REF}.supabase.co"
s_, b_ = http("POST", f"{FNB}/functions/v1/hire-profile", {"action": "get", "offer_id": "00000000-0000-0000-0000-000000000000"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ the profile refuses a caller with no sign-in ({s_})") if s_ in (401, 403) else bad(f"hire-profile without a sign-in answered {s_}")
ok_, g = sql(REF, "select count(*)::int as n from information_schema.routine_privileges where routine_schema = 'public' and routine_name = 'step1_candidate_create' and grantee in ('anon', 'authenticated', 'PUBLIC')")
say("  ✓ no browser can call the door") if ok_ and int(g[0]['n']) == 0 else bad(f"door grants: {g}")
ok_, d = sql(REF, "select (select active from public.client_journey_step_def where key = 'cg.check.casenet') as cn, (select count(*)::int from public.client_journey_step_def where key in ('cg.approve.advance', 'cg.approve.work') and (def->'after') @> '[\"cg.check.casenet\"]'::jsonb) as appr, "
                  "(select count(*)::int from public.app_data, jsonb_array_elements(data) x where key = 'candidates') as cands")
if ok_: say(f"  ✓ Case.net row active; both approvals wait for it ({d[0]['appr']} of 2); Background & References records unchanged ({c[0]['cands']} to {d[0]['cands']})") if d[0]['cn'] and int(d[0]['appr']) == 2 and int(d[0]['cands']) == int(c[0]['cands']) else bad(f"after: {d}")
say("  · tested before deploying: the door in a real Postgres (12), Step 1 signing with a hire who is not in Background & References until the last form (67), the profile (14), the readiness, export and client tests, the Hub looks (17 and 14).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · from the next Step 1 completed on the new path, the Hub moves the person into Background & References and tells Recruiting; the main profile is live; Case.net is a background check. Nothing was sent."); done(0)
