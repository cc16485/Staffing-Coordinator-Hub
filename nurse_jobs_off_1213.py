#!/usr/bin/env python3
# 1213 · NURSE JOBS OFF (Samantha, 2026-10-31: "Remove Nurse Scheduling now. Nobody needs it for the last IHS clients", then
# "build the Desktop step to turn off the GHE reminders, RN review and nurse visit check jobs"). Nurse Scheduling left the
# CC Hub in care-coordinator-hub #728, so these three schedules have nowhere to show what they make:
#   daily-ghe-reminders     (ghe-reminders, daily 10am Central): GHE digest emails + the AxisCare GHE watch
#   rn-review-pass          (rn-review, every hour): cards for the RN's review queue and late Fusion uploads
#   nurse-visit-check-pass  (nurse-visit-check, every 30 min): reads AxisCare nurse visits 120 days back, license reminders
# Part 1 (read only): each job is there; how many schedules are on in all.
# Part 2: PAUSES each job (cron.alter_job active := false). Nothing is deleted: the schedule, its time and its secret stay,
#   so turning one back on is one line. The functions stay deployed (rn.html still answers); nothing is sent.
# Part 3 (proof): all three are paused, and no other schedule changed.
# Prints counts only: no name, number, email, key or secret. Safe to run again.
import os
os.environ.setdefault("SB_STEP", "1213")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
JOBS = ["daily-ghe-reminders", "rn-review-pass", "nurse-visit-check-pass"]
NAMES = {"daily-ghe-reminders": "GHE reminders (daily 10am Central)", "rn-review-pass": "RN review (every hour)",
         "nurse-visit-check-pass": "Nurse visit check (every 30 minutes)"}
IN = "(" + ", ".join(lit(j) for j in JOBS) + ")"

start("NURSE JOBS OFF (GHE reminders, RN review, nurse visit check)")
say("PART 1 · READ ONLY (nothing changes)")
ok, rows = sql(REF, f"select jobname, active from cron.job where jobname in {IN} order by jobname")
if not ok: bad("could not read the schedules"); done(3)
have = {r["jobname"]: r["active"] for r in rows}
for j in JOBS:
    if j not in have: say(f"  · {NAMES[j]}: not scheduled (nothing to pause)")
    else: say(f"  ✓ {NAMES[j]}: {'on' if have[j] else 'already paused'}")
ok, before = sql(REF, f"select count(*)::int as n from cron.job where active and jobname not in {IN}")
if not ok or not before: bad("could not count the other schedules"); done(3)
OTHERS = before[0]["n"]
say(f"  · {OTHERS} other schedules are on; this step leaves every one of them alone")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
for j in JOBS:
    if not have.get(j): continue
    ok, r = sql(REF, f"select cron.alter_job(jobid, active := false) from cron.job where jobname = {lit(j)}")
    say(f"  ✓ paused {NAMES[j]}") if ok else bad(f"could not pause {NAMES[j]}: {str(r)[:160]}")

say(); say("PART 3 · PROOF")
ok, after = sql(REF, f"select jobname, active from cron.job where jobname in {IN}")
still = [r["jobname"] for r in (after or []) if r["active"]] if ok else JOBS
say("  ✓ all three are paused (kept, not deleted)") if ok and not still else bad(f"still on: {', '.join(NAMES[j] for j in still)}")
ok, now = sql(REF, f"select count(*)::int as n from cron.job where active and jobname not in {IN}")
n = now[0]["n"] if ok and now else None
say(f"  ✓ the other {n} schedules are as they were") if n == OTHERS else bad(f"the other schedules changed: {OTHERS} before, {n} now")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · The GHE reminders, RN review and nurse visit check no longer run. Nothing was deleted or sent.")
say("Undo: cron.alter_job(jobid, active := true) for the one you want back (Claude can).")
done(0)
