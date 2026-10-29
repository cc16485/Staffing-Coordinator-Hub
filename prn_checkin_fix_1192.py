#!/usr/bin/env python3
# 1192 · STAFFING SERVER · THE 60-DAY CHECK-IN ANSWERED ON THE PRN TEAM PAGE (2026-10-29). Records only, no functions.
# Why: 1190 was built to run this fix and deploy prn-week and coverage-run. Those two were deployed by 1191 (the on-call calendar)
# from GitHub's main, which already holds 1190's code, so 1190 stopped safely ("newer work landed since"). This step runs only
# the part that hasn't: the 60-day check-in table refused an answer from the PRN Team page (how 'prn_page', step 5a).
#  1. Checks first (nothing changes): prn_team_signs.sql is what is on GitHub's main; the live prn-week and coverage-run already
#     carry the Our teams signs (they are not redeployed here).
#  2. Runs prn_team_signs.sql (one transaction; adds only; safe to run again).
#  3. Proof: the check-in allows an answer from the page and every earlier answer; the Our teams switch is still off.
# Texts nobody.
import json, os, subprocess
import cc_step_lib as L
from cc_step_lib import say, bad, done, start, sql

REF = "zngsgedlsxinbygwmxwn"
ROOT = L.ROOT
ok = lambda s: say("  ✓ " + s)
def run(args): p = subprocess.run(args, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)

start("STAFFING SERVER · THE 60-DAY CHECK-IN ANSWERED ON THE PRN TEAM PAGE")
say("PART 1 · READ ONLY (nothing changes)")
run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
c, main_sql = run(["git", "-C", ROOT, "show", "origin/main:prn_team_signs.sql"])
if c != 0 or main_sql != open(os.path.join(ROOT, "prn_team_signs.sql")).read(): stop("prn_team_signs.sql isn't the same as GitHub's main. Tell Claude.")
ok("the records fix is what is on GitHub's main")
okS, st = sql(REF, "select data->'prn_team_signs_live' as v from public.app_data where key='ops_settings'")
if not okS or not st: stop("couldn't read the Hub's switches", 3)
ok("the Our teams switch is " + ("ON" if st[0].get("v") is True else "off"))
okB, before = sql(REF, "select pg_get_constraintdef(oid) d from pg_constraint where conrelid = 'public.prn_checkins'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%how%'")
if not okB: stop("couldn't read the 60-day check-in table", 3)
already = any("prn_page" in (r.get("d") or "") for r in (before or []))
ok("the check-in table " + ("already allows an answer from the page (running again is harmless)" if already else "refuses an answer from the page today (this fixes it)"))

say(); say("PART 2 · CHANGE")
okQ, r = sql(REF, "begin;\n" + open(os.path.join(ROOT, "prn_team_signs.sql")).read() + "\ncommit;")
if not okQ: bad("the change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
ok("the 60-day check-in can keep an answer from the PRN Team page")

say(); say("PART 3 · PROOF (nothing is sent or saved)")
okC, cc = sql(REF, "select pg_get_constraintdef(oid) d from pg_constraint where conname = 'prn_checkins_how_check'")
(ok if okC and cc and all(k in cc[0]["d"] for k in ("prn_page", "still_right", "updated")) else bad)("the check-in allows an answer from the page, and the earlier answers still")
okS2, st2 = sql(REF, "select data->'prn_team_signs_live' as v from public.app_data where key='ops_settings'")
(ok if okS2 and st2 and st2[0].get("v") is st[0].get("v") else bad)("the Our teams switch is as it was")
say()
say("  1192: " + ("DONE. The 60-day check-in fix is in. Next: Claude merges the Hub pull request for Our teams signs and the Looking for hours tag."
    if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
