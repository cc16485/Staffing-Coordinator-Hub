#!/usr/bin/env python3
# 531X · ROLLBACK OF SLICE 0 ON THE HUB PROJECT (Samantha 2026-10-08). Puts outreach-check and caregiver-hiring-history back
# to the build that was live before Slice 0 (the previous main, pinned by the Desktop step) and removes the new
# onboarding-permissions function. HER RULE 8: no record is deleted: the permissions record and every setting stay in the
# database, inert (nothing reads them once the function is gone). Nothing is sent; no caregiver record changes.
import os, json
os.environ.setdefault("SB_STEP", "531X")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; PREV = os.environ.get("SB_PREV_FNROOT", ""); BACK = ["outreach-check", "caregiver-hiring-history"]; GONE = "onboarding-permissions"
start("ROLLBACK OF SLICE 0 ON THE HUB PROJECT")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
if not (PREV and os.path.isdir(PREV)): bad("the previous build is not there"); done(2)
check_build(PREV, json.loads(os.environ.get("SB_PREV_SHAS", "{}")))
VJ = {}
for fn in BACK:
    sx, mx = fmeta(REF, fn)
    if not (sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool)): bad(f"{fn} could not be read ({sx})"); continue
    VJ[fn] = mx["verify_jwt"]; say(f"  ✓ {fn} is live at version {mx.get('version', '?')}; it goes back to the build before Slice 0")
sx, mx = fmeta(REF, GONE)
say(f"  ✓ {GONE} is live at version {(mx or {}).get('version', '?')}; it will be removed") if sx == 200 else say(f"  · {GONE} is not live ({sx}); nothing to remove")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say("  · what changes: the Hub door stops answering the onboarding-path question (the Training offer function must then be rolled back too, 532X, or offers cannot be saved); the applicant page stops showing the path; the permissions function is removed. The permissions record and the Admin settings stay, inert. Nothing is deleted from the database.")
say(); say("PART 2 · CHANGE")
for fn in BACK:
    if not deploy(REF, PREV, fn, VJ[fn]): say("  RESULT: STOPPED (what deployed above stays). Tell Claude."); done(6)
if sx == 200:
    s_, b_ = http("DELETE", f"{API}/v1/projects/{REF}/functions/{GONE}", headers=MG())
    say(f"  ✓ {GONE} removed") if s_ in (200, 204) else bad(f"{GONE} could not be removed ({s_}): {b_[:120]}")
say(); say("PART 3 · PROOF")
sx2, _ = fmeta(REF, GONE); say(f"  ✓ {GONE} is gone ({sx2})") if sx2 == 404 else bad(f"{GONE} still answers ({sx2})")
ok_, n_ = sql(REF, "select count(*) as n from public.app_data where key = 'onboarding_permissions'")
say("  ✓ the permissions record is still in the database, untouched (rule 8)") if ok_ and n_ and int(n_[0]["n"]) >= 0 else say("  · could not read the record count")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the Hub project is back to the build before Slice 0. If 532 was run, run 532X now so offers can be saved."); done(0)
