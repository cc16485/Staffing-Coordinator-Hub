#!/usr/bin/env python3
# 908 · RESUME CARE FROM A CARE COORDINATOR (Samantha 2026-10-17, SOP 30 "A returning family"): Care Coordinators, not only
# owners, can press Resume care for a returning PAST client. Two pieces, in this order:
#   1. the database rule client_status_decide (client-status-returning-cc.sql): "Returning client" may come from a Care
#      Coordinator's seat too. On its own this changes nothing anyone sees: the server still asks for an owner until 2.
#   2. client-journey redeployed: Care Coordinators and owners see Resume care on a past client; Staffing and everyone else
#      are still refused.
# Part 1 STOPS before anything changes if the build is not the reviewed one, is not GitHub's main, the live client-journey is
# not the code this was built on (someone else's unreleased change), or the live database rule is not the one expected.
# Nothing is sent. Undo: run client-status-returning.sql and redeploy client-journey from the commit before this one.
import json, os, re, subprocess, hashlib
os.environ.setdefault("SB_STEP", "908")
import cc_step_lib as L
from cc_step_lib import say, bad, done, deploy, start, check_build, fmeta, sql, live_files, sha

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
FN = "client-journey"
NEW_SQL = "client-status-returning-cc.sql"; OLD_SQL = "client-status-returning.sql"
MARK = "908: a returning client"; OLD_MARK = "Owner / Decision matter"
ok = lambda s: say("  ✓ " + s)
def run(args): p = subprocess.run(args, capture_output=True, text=True, cwd=ROOT); return p.returncode, (p.stdout or ""), (p.stderr or "")
def stop(msg): bad(msg); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(2)
def body(path):
    s = open(os.path.join(ROOT, path)).read()
    m = re.search(r"create or replace function public\.client_status_decide\(.*?\$\$(.*?)\$\$;", s, re.S)
    return m.group(1).strip() if m else None
def live_rule():
    okq, r = sql(REF, "select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'client_status_decide'")
    return (r[0]["prosrc"].strip() if okq and r and len(r) == 1 else None), okq, r

start("RESUME CARE FROM A CARE COORDINATOR")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
if sha(os.path.join(ROOT, NEW_SQL)) != os.environ.get("SB_SQL_SHA", ""): stop(f"{NEW_SQL} is not the reviewed build")
ok(f"{NEW_SQL} is the reviewed build")
MAIN = os.environ.get("SB_MAIN_REF", "origin/main"); BASE = os.environ.get("SB_BASE", "")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
files = sorted(L.need(FNROOT, FN)) + [NEW_SQL, OLD_SQL]
drift = [k for k in files if (lambda c: c[0] != 0 or c[1] != open(os.path.join(ROOT, k)).read())(run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"]))]
if drift: stop("this build isn't the same as GitHub's main (not merged yet, or changed since): " + ", ".join(drift)[:240])
ok("the build is what is on GitHub's main")
s0, m0 = fmeta(REF, FN)
if s0 != 200 or not m0 or "verify_jwt" not in m0: stop(f"couldn't read how {FN} is set up live ({s0})")
GATE = bool(m0["verify_jwt"]); say(f"  · {FN} is live as version {m0.get('version', '?')}, gateway sign-in check {'on' if GATE else 'off'} (kept)")
okl, live = live_files(REF, FN)
if not okl: stop(f"couldn't download the live {FN} to compare")
odd = []
for k in sorted(L.need(FNROOT, FN)):
    rc, was, _ = run(["git", "-C", ROOT, "show", f"{BASE}:{k}"])
    base_sha = hashlib.sha256(was.encode()).hexdigest() if rc == 0 else None
    if live.get(k) not in (base_sha, sha(os.path.join(ROOT, k))): odd.append(k)
if odd: stop(f"the live {FN} has code that isn't on GitHub's main (someone else's unreleased change): " + ", ".join(odd)[:240])
ok(f"the live {FN} is the code this change was built on (or already this build)")
cur, okq, r = live_rule()
if cur is None: stop(f"couldn't read the live client_status_decide ({str(r)[:160]})")
want_old, want_new = body(OLD_SQL), body(NEW_SQL)
if cur == want_new: ALREADY = True; ok("the database rule already lets a Care Coordinator answer Returning client")
elif cur == want_old: ALREADY = False; ok("the database rule is the expected one (Returning client: owners only)")
else: stop("the live client_status_decide isn't the version this was built on; nothing was changed")

say(); say("PART 2 · CHANGE")
if not ALREADY:
    okq, r = sql(REF, open(os.path.join(ROOT, NEW_SQL)).read())
    cur, _, _ = live_rule()
    if not okq or cur != want_new:
        bad("the database rule did not change: " + str(r)[:200])
        say("  RESULT: STOPPED. It runs as one transaction, so nothing in the database changed. Tell Claude."); done(5)
    ok("database rule: a Care Coordinator or an owner may answer Returning client (read back)")
if not deploy(REF, FNROOT, FN, GATE):
    say(f"  RESULT: STOPPED at {FN}. The database rule is changed, but the server still asks for an owner, so nobody sees a")
    say("  difference yet. Running this step again finishes it. Tell Claude."); done(7)
say(); say("  RESULT: DONE. Care Coordinators and owners can now press Resume care on a past client; Staffing still can't.")
say("  Nothing was sent and no client's care changed.")
done(0)
