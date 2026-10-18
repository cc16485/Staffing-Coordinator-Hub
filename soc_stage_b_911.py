#!/usr/bin/env python3
# 911 · START OF CARE STAGE B (Samantha approved 2026-10-17: "Start stages B and C. Show me each before it's switched on").
# Puts the nine-step Start of Care in place, switched OFF:
#   * the database: a catalog column on each client journey ('v1' for every journey today) and the nine steps in the catalog
#   * client-journey redeployed: the nine steps' checks, the next-day follow-up from the duty schedule, the move preview
#   * every other function that reads the shared journey rules, redeployed with the same rules file
# Nothing moves and nobody sees anything new until an owner turns on "Nine-step Start of Care" on the Admin page.
# Part 1 is read only and STOPS before anything changes if the build is not the reviewed one, is not GitHub's main, any
# live function has code that isn't on main, or the database isn't the version this was built on. Nothing is sent.
# Undo: soc_stage_b_911_rollback.sql (refuses once a journey has moved), then redeploy from the commit before this one.
import json, os, subprocess, hashlib
os.environ.setdefault("SB_STEP", "911")
import cc_step_lib as L
from cc_step_lib import say, bad, done, deploy, start, check_build, fmeta, sql, live_files, sha

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
NEW_SQL = "soc_stage_b_911.sql"; OLD_SQL = "soc_stage_b_911_rollback.sql"
# the changed functions first; then every function that imports a changed shared file, so no live copy is left "other"
FNS = ["client-journey", "caregiver-journey", "caregiver-export", "offer-sign", "reference-send", "step2-handoff", "welcome-call"]
MED = ("med.emomed", "med.fusion", "med.notices", "med.careplan", "med.decision", "ready.state")
ok = lambda s: say("  ✓ " + s)
def run(args): p = subprocess.run(args, capture_output=True, text=True, cwd=ROOT); return p.returncode, (p.stdout or ""), (p.stderr or "")
def stop(msg): bad(msg); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(2)
def q(text):
    okq, r = sql(REF, text)
    return (r if okq else None), r

def db_state():
    """'old' (built on), 'new' (already this step), or None (something else)"""
    rows, raw = q("select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'client_journey' and column_name = 'catalog'")
    if rows is None: return None, f"couldn't read the journey table ({str(raw)[:160]})"
    col = rows[0]["n"] == 1
    rows2, raw2 = q("select count(*) filter (where def->>'catalog' = 'nine')::int as nine, count(*)::int as all_ from public.client_journey_step_def")
    if rows2 is None: return None, f"couldn't read the step catalog ({str(raw2)[:160]})"
    nine = rows2[0]["nine"]
    if col:
        rows3, raw3 = q("select count(*)::int as n from public.client_journey where catalog = 'nine'")
        if rows3 is None: return None, f"couldn't count moved journeys ({str(raw3)[:160]})"
    if not col and nine == 0: return "old", ""
    if col and nine == 9: return "new", ""
    return None, f"the database isn't the version this was built on (catalog column {'there' if col else 'missing'}, {nine} of 9 nine-step steps)"

start("START OF CARE STAGE B")
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
ok("the database already has stage B" if ALREADY else "the database is the version this was built on (every journey on the old steps)")

say(); say("PART 2 · CHANGE")
if not ALREADY:
    okq, r = sql(REF, open(os.path.join(ROOT, NEW_SQL)).read())
    state, why = db_state()
    if not okq or state != "new":
        bad("the database change did not take: " + (str(r) if not okq else why)[:200])
        say("  RESULT: STOPPED. It runs as one transaction, so nothing in the database changed. Tell Claude."); done(5)
    ok("database: catalog column added (every journey still on the old steps), the nine steps in the catalog (read back)")
for i, fn in enumerate(FNS):
    if not deploy(REF, FNROOT, fn, GATES[fn]):
        left = ", ".join(FNS[i:])
        say(f"  RESULT: STOPPED at {fn}. The database part is done and safe on its own; still to deploy: {left}.")
        say("  Running this step again finishes it. Tell Claude."); done(7)
say(); say("  RESULT: DONE. The nine-step Start of Care is in place and switched OFF. Nothing moved and nobody sees anything new.")
say("  Next: preview the move in Hub settings, Client journeys; then turn it on from Admin, Switches, Clients.")
done(0)
