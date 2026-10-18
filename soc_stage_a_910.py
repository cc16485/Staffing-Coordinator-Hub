#!/usr/bin/env python3
# 910 · START OF CARE STAGE A (Samantha approved 2026-10-17: "Start stage A"). Safe fixes from the Start of Care audit:
#   * Medicare GUIDE is its own payer (database rule + the payer question); new families are no longer offered Medicaid;
#     the Medicaid-only steps stop applying to journeys opened from 2026-10-17 on (older journeys keep every record).
#   * "First visit happened" (the Hub's own step) no longer gives Samantha and Zachary a "Nobody is assigned" card;
#     with no Staffing Coordinator, staffing steps go to the client's Care Coordinator, not the first owner.
#   * Reopening a step the Hub ticks now holds (the Hub stops re-ticking it until a person finishes it or asks it to
#     check again).
#   * The emailed copy of the Client Care Agreement no longer shows the driver's license number.
#   * Filling a new client's open shift (nobody called off) no longer sends the family "your caregiver has changed".
# Part 1 is read only and STOPS before anything changes if the build is not the reviewed one, is not GitHub's main, any
# live function has code that isn't on main, or the database isn't the version this was built on. Nothing is sent.
# Undo: soc_stage_a_910_rollback.sql, then redeploy the functions below from the commit before this one.
import json, os, subprocess, hashlib
os.environ.setdefault("SB_STEP", "910")
import cc_step_lib as L
from cc_step_lib import say, bad, done, deploy, start, check_build, fmeta, sql, live_files, sha

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
NEW_SQL = "soc_stage_a_910.sql"; OLD_SQL = "soc_stage_a_910_rollback.sql"
# the changed functions first; then every function that imports a changed shared file, so no live copy is left "other"
FNS = ["client-journey", "client-agreement", "coverage-run", "late-alert", "late-watch",
       "caregiver-journey", "caregiver-export", "offer-sign", "reference-send", "step2-handoff", "welcome-call"]
MED = ("med.emomed", "med.fusion", "med.notices", "med.careplan", "med.decision", "ready.state")
ok = lambda s: say("  ✓ " + s)
def run(args): p = subprocess.run(args, capture_output=True, text=True, cwd=ROOT); return p.returncode, (p.stdout or ""), (p.stderr or "")
def stop(msg): bad(msg); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(2)
def q(text):
    okq, r = sql(REF, text)
    return (r if okq else None), r

def db_state():
    """'old' (built on), 'new' (already this step), or None (something else)"""
    rows, raw = q("select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'client_journey_payer_check'")
    if rows is None or len(rows) != 1: return None, f"couldn't read the payer rule ({str(raw)[:160]})"
    guide = "'guide'" in rows[0]["d"]
    rows2, raw2 = q("select def->'answer'->'fields'->0->'options' as o from public.client_journey_step_def where key = 'intake.payer'")
    if rows2 is None or len(rows2) != 1: return None, f"couldn't read the payer question ({str(raw2)[:160]})"
    o = rows2[0]["o"]; o = json.loads(o) if isinstance(o, str) else o
    vals = [x.get("v") for x in (o or [])]
    rows3, raw3 = q("select count(*)::int as n from public.client_journey_step_def where def->>'opened_before' = '2026-10-17' and key in ('" + "', '".join(MED) + "')")
    if rows3 is None: return None, f"couldn't read the Medicaid steps ({str(raw3)[:160]})"
    marked = rows3[0]["n"]
    if not guide and vals == ["private", "medicaid", "va", "ltc", "other"] and marked == 0: return "old", ""
    if guide and vals == ["private", "va", "ltc", "guide", "other"] and marked == 6: return "new", ""
    return None, f"the database isn't the version this was built on (payer rule guide={guide}, question {vals}, {marked} of 6 Medicaid steps marked)"

start("START OF CARE STAGE A")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
if sha(os.path.join(ROOT, NEW_SQL)) != os.environ.get("SB_SQL_SHA", ""): stop(f"{NEW_SQL} is not the reviewed build")
ok(f"{NEW_SQL} is the reviewed build")
MAIN = os.environ.get("SB_MAIN_REF", "origin/main"); BASE = os.environ.get("SB_BASE", "")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
files = sorted(set().union(*[L.need(FNROOT, f) for f in FNS])) + [NEW_SQL, OLD_SQL]
drift = [k for k in files if (lambda c: c[0] != 0 or c[1] != open(os.path.join(ROOT, k)).read())(run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"]))]
if drift: stop("this build isn't the same as GitHub's main (not merged yet, or changed since): " + ", ".join(drift)[:240])
ok("the build is what is on GitHub's main")
GATES = {}
for fn in FNS:
    s0, m0 = fmeta(REF, fn)
    if s0 != 200 or not m0 or "verify_jwt" not in m0: stop(f"couldn't read how {fn} is set up live ({s0})")
    GATES[fn] = bool(m0["verify_jwt"])
    okl, live = live_files(REF, fn)
    if not okl: stop(f"couldn't download the live {fn} to compare")
    odd = []
    for k in sorted(L.need(FNROOT, fn)):
        rc, was, _ = run(["git", "-C", ROOT, "show", f"{BASE}:{k}"])
        base_sha = hashlib.sha256(was.encode()).hexdigest() if rc == 0 else None
        if live.get(k) not in (base_sha, sha(os.path.join(ROOT, k))): odd.append(k)
    if odd: stop(f"the live {fn} has code that isn't on GitHub's main (someone else's unreleased change): " + ", ".join(odd)[:240])
    say(f"  ✓ {fn}: live version {m0.get('version', '?')} is the code this was built on (gateway check {'on' if GATES[fn] else 'off'}, kept)")
state, why = db_state()
if state is None: stop(why)
ALREADY = state == "new"
ok("the database already has stage A" if ALREADY else "the database is the version this was built on")
rows, raw = q("select count(*) filter (where created_at >= '2026-10-17') ::int as new_med, count(*)::int as all_med from public.client_journey where subject = 'client' and payer = 'medicaid' and status <> 'closed'")
if rows is None: stop(f"couldn't count Medicaid journeys ({str(raw)[:160]})")
if rows[0]["new_med"] and not ALREADY: stop(f"{rows[0]['new_med']} open Medicaid journey(s) were opened on or after Oct 17; they would lose their Medicaid steps. Nothing was changed.")
ok(f"{rows[0]['all_med']} open Medicaid journey(s), all opened before Oct 17: they keep every step and record")

say(); say("PART 2 · CHANGE")
if not ALREADY:
    okq, r = sql(REF, open(os.path.join(ROOT, NEW_SQL)).read())
    state, why = db_state()
    if not okq or state != "new":
        bad("the database change did not take: " + (str(r) if not okq else why)[:200])
        say("  RESULT: STOPPED. It runs as one transaction, so nothing in the database changed. Tell Claude."); done(5)
    ok("database: GUIDE payer allowed, payer question updated, 6 Medicaid steps retired for new journeys (read back)")
for i, fn in enumerate(FNS):
    if not deploy(REF, FNROOT, fn, GATES[fn]):
        left = ", ".join(FNS[i:])
        say(f"  RESULT: STOPPED at {fn}. The database part is done and safe on its own; still to deploy: {left}.")
        say("  Running this step again finishes it. Tell Claude."); done(7)
say(); say("  RESULT: DONE. GUIDE is a payer, new families aren't offered Medicaid, first-week cards no longer go to the owners,")
say("  a reopened step stays open, the emailed agreement hides the driver's license, and a new client's first caregiver")
say("  no longer triggers the 'caregiver changed' text. Nothing was sent.")
done(0)
