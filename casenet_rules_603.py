#!/usr/bin/env python3
# 603 · CASE.NET ON THE OLD PROCESS (Samantha 2026-10-11: "yes add case.net to the old process too"). Hub project.
# The Hub's eligibility-rules.js now also needs Case.net Clear before "Ready for Orientation" (Issues Found is Needs Review).
# The server's eligibility sweep, obligations runner, outreach-check and caregiver-connect download and run that same file,
# but ONLY a version whose fingerprint is approved (public.rules_approved). So this step approves the NEW version BEFORE
# the Hub change merges; today's version stays approved, so the server never stops, before or after the merge.
# It also lists who would move back from Ready for Orientation to Awaiting until their Case.net is recorded.
# No function is deployed. Nothing is sent. No record changes.
import os, json, hashlib
os.environ.setdefault("SB_STEP", "603")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; RULES_FILE = "eligibility-rules.js"
NEW_FP = "61d55d9def8e75fe4c99810ee7712c21f66cdefb6237222653203ee6aff57d87"
def lit(v): return "'" + str(v).replace("'", "''") + "'"
start("CASE.NET ON THE OLD PROCESS: APPROVE THE NEW RULES FILE")
say("PART 1 · READ ONLY (nothing changes)")
ok_, cur = sql(REF, f"select sha256, approved_at from public.rules_approved where file = {lit(RULES_FILE)} order by approved_at desc")
if not ok_: bad(f"could not read the approved list: {cur}"); done(3)
say(f"  · {len(cur)} approved fingerprint(s) for {RULES_FILE}; the new version is {NEW_FP[:12]}" + (" (already approved)" if any(r['sha256'] == NEW_FP for r in cur) else ""))
s_, b_ = http("GET", f"https://cc.mo-care.com/{RULES_FILE}?v=603")
live_fp = hashlib.sha256(b_.encode("utf-8")).hexdigest() if s_ == 200 else None
if not live_fp: bad(f"could not read {RULES_FILE} from cc.mo-care.com ({s_})")
elif live_fp == NEW_FP: say("  · cc.mo-care.com already serves the new version (the Hub change is merged)")
elif any(r['sha256'] == live_fp for r in cur): say(f"  ✓ cc.mo-care.com serves {live_fp[:12]} today, and it is approved (it stays approved)")
else: bad(f"cc.mo-care.com serves {live_fp[:12]}, which is NOT approved today; tell Claude before anything changes")
ok_, mv = sql(REF, """select x->>'first' as first, x->>'last' as last, coalesce(x->>'onboarding_path', 'old') as path, coalesce(x->>'casenet', '(none)') as casenet
  from public.app_data, jsonb_array_elements(data) x where key = 'candidates' and coalesce(x->>'not_hired', '') <> 'true'
  and x->>'oig' = 'CLEAR' and x->>'edl' = 'Clear' and x->>'fcsr' = 'Clear' and (coalesce(x->>'oos', '') <> 'yes' or x->>'fp' = 'Clear')
  and coalesce(x->>'casenet', '') <> 'Clear' order by 2, 1""")
if ok_:
    if mv: say(f"  · with every other check clear but no clear Case.net, these {len(mv)} would show Awaiting (not Ready) until their Case.net is recorded:"); [say(f"      {r['first']} {r['last']} ({r['path']} process, Case.net {r['casenet']})") for r in mv]
    else: say("  · nobody with every other check clear is missing Case.net: no one moves back")
else: bad(f"could not read the candidates: {mv}")
say("  · what changes: one approved fingerprint is added. No function, record, switch or message changes.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
ok_, r_ = sql(REF, f"insert into public.rules_approved (file, sha256, note) values ({lit(RULES_FILE)}, {lit(NEW_FP)}, '603 Case.net on the old process (Hub PR)') on conflict (file, sha256) do update set approved_at = now(), note = excluded.note")
say("  ✓ the new version is approved") if ok_ else bad(f"the fingerprint could not be approved: {r_}")
say(); say("PART 3 · PROOF (nothing is sent)")
ok_, after = sql(REF, f"select sha256 from public.rules_approved where file = {lit(RULES_FILE)}")
shas = {r['sha256'] for r in (after or [])} if ok_ else set()
say("  ✓ the new version is on the approved list") if NEW_FP in shas else bad("the new version is not on the approved list")
if live_fp: say("  ✓ the version served today is still approved, so the server keeps running until the Hub change merges") if live_fp in shas else bad("the version served today is not approved")
say("  · tested before: the rule (9 checks: Case.net Clear needed, Issues Found is Needs Review, the outstanding list and hire snapshot), the Hub's 1,300 page tests unchanged, the Background & References looks.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the server will accept the new rules file. Now merge the Hub change. Nothing was sent; no record changed."); done(0)
