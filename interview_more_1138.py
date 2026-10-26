#!/usr/bin/env python3
# 1138 · THREE MORE INTERVIEW QUESTIONS (Samantha 2026-10-26). Adds to the caregiver interview, all or nothing:
#   "Have you ever worked for Caring Companions before?" (first), then after "Your story": "Are you working right now?"
#   and "Tell me about your last 3 jobs." The Hub's interview screens and the AI review read them from here.
# Nothing is sent; no applicant record changes; questions edited in the Hub are never overwritten. Safe to re-run.
import os
os.environ.setdefault("SB_STEP", "1138")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
Q = "select seeded_as, section, sort from public.interview_questions where position = 'caregiver' and active order by sort"
def show(rows):
    for i, x in enumerate(rows): say(f"    {i + 1}. {x['section']}" + ("   (new)" if (x.get('seeded_as') or '').startswith('v3-') else ""))
start("THREE MORE INTERVIEW QUESTIONS")
say("PART 1 · READ ONLY (nothing changes)")
ok, r = sql(REF, "select to_regclass('public.interview_questions') is not null as t")
if not ok: bad("could not read the project: " + str(r)); done(3)
if not r[0]["t"]: bad("the interview questions table is not there (step 622 never ran?). Tell Claude."); done(3)
ok, r = sql(REF, Q)
if not ok: bad("could not read the questions: " + str(r)); done(3)
say(f"  · the caregiver interview now has {len(r)} questions:"); show(r)

say(); say("PART 2 · CHANGE")
ok, r = sql(REF, open(os.path.join(ROOT, "interview_more_1138.sql")).read())
if not ok: bad("the questions did not go in (undone as a whole, nothing changed): " + str(r)); done(6)
say("  ✓ the three questions are in")

say(); say("PART 3 · PROOF")
ok, r = sql(REF, Q)
if not ok: bad("could not check: " + str(r)); done(9)
say(f"  · the caregiver interview now has {len(r)} questions, in this order:"); show(r)
ids = [x["seeded_as"] for x in r]
if not all(k in ids for k in ("v3-01", "v3-02", "v3-03")): bad("one of the three new questions is missing")
elif ids[0] != "v3-01": bad("\"Worked with us before\" is not first")
say("  · tested before running: install twice (no doubles), the order, no scores, and a Hub-edited question keeps its words (5 checks).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the next interview asks all three. Nothing was sent."); done(0)
