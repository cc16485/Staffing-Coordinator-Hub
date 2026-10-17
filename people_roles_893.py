#!/usr/bin/env python3
# 893 · PEOPLE INVOLVED, LINED UP WITH THE AGREEMENT (2026-10-17, Samantha: "line People involved up with the agreement: Medical
# decisions, Health and Financial POA, and HIPAA shown from the signed agreement").
# Database only: the roles a person on a Journey may carry gain Medical decisions, Health care POA and Financial POA. The older
# "Decision maker" and "POA" stay valid (history is never re-labelled). No function deploy, no message. Run it BEFORE merging the
# Hub pull request, so the new choices save the moment the Hub shows them. Safe to run again.
import os, subprocess
import cc_step_lib as L
from cc_step_lib import say, bad, done, sql, start

HUB = "zngsgedlsxinbygwmxwn"; ROOT = L.ROOT; SQLF = "people_roles_agreement.sql"
ok = lambda s: say("  ✓ " + s)
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
CHECK = """select (select bool_or(pg_get_constraintdef(oid) ilike '%medical_decisions%' and pg_get_constraintdef(oid) ilike '%poa_financial%') from pg_constraint
            where conrelid = 'public.journey_person'::regclass and contype = 'c') as tbl,
          (select position('poa_financial' in pg_get_functiondef(p.oid)) > 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'people_on_journey_record') as door"""

start("PEOPLE INVOLVED, LINED UP WITH THE AGREEMENT")
say("PART 1 · READ ONLY (nothing changes)")
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{SQLF}"])
if c2 != 0 or b2 != open(os.path.join(ROOT, SQLF)).read(): stop("the database change isn't the same as GitHub's main yet (merge the Staffing pull request first)")
ok("the reviewed database change is what is on GitHub's main")
good, r = sql(HUB, CHECK)
if not good or not r: stop(f"couldn't read the Hub's database ({str(r)[:160]})", 3)
say("  · " + ("already done before" if r[0]["tbl"] and r[0]["door"] else "the new roles aren't accepted yet"))

say(); say("PART 2 · CHANGE")
good, r2 = sql(HUB, open(os.path.join(ROOT, SQLF)).read())
if not good: stop(f"the database change was refused (nothing in it was kept): {str(r2)[:240]}", 4)

say(); say("PART 3 · PROOF")
good, r = sql(HUB, CHECK)
r = (r or [{}])[0] if good else {}
(ok if r.get("tbl") else bad)("the People involved list accepts Medical decisions, Health care POA and Financial POA")
(ok if r.get("door") else bad)("the one door that records people accepts them too")
say()
say("  893: " + ("DONE. Now merge the Hub pull request: People involved shows the agreement's choices, older answers marked older, and HIPAA from the signed agreement." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
