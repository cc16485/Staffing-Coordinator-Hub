#!/usr/bin/env python3
# 912 · START OF CARE STAGE C: CAREGIVER MATCHING (Samantha approved 2026-10-17). The server half, switched OFF:
#   * the shared journey rules gain her recheck rule (a yes needs a recheck when the shift changed or 14 days passed
#     before care starts; never once the shift is on the real AxisCare schedule)
#   * client-journey redeployed: the first visit's yes honours that rule, and the sweep keeps ONE My Work card per plan
#     listing its rechecks, only while "Caregiver Matching checks" is on
#   * every other function that reads the shared journey rules, redeployed with the same rules file
# No database change. Nothing is texted. Nothing changes until an owner turns on "Caregiver Matching checks".
# Part 1 is read only and STOPS before anything changes if the build is not the reviewed one, is not GitHub's main, any
# live function has code that isn't on main, or the database isn't the version this was built on. Nothing is sent.
# Undo: redeploy these functions from the commit before this one.
import json, os, subprocess, hashlib
os.environ.setdefault("SB_STEP", "912")
import cc_step_lib as L
from cc_step_lib import say, bad, done, deploy, start, check_build, fmeta, sql, live_files, sha

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
# the changed functions first; then every function that imports a changed shared file, so no live copy is left "other"
FNS = ["client-journey", "caregiver-journey", "caregiver-export", "offer-sign", "reference-send", "step2-handoff", "welcome-call"]
MED = ("med.emomed", "med.fusion", "med.notices", "med.careplan", "med.decision", "ready.state")
ok = lambda s: say("  ✓ " + s)
def run(args): p = subprocess.run(args, capture_output=True, text=True, cwd=ROOT); return p.returncode, (p.stdout or ""), (p.stderr or "")
def stop(msg): bad(msg); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(2)
def q(text):
    okq, r = sql(REF, text)
    return (r if okq else None), r

start("START OF CARE STAGE C: CAREGIVER MATCHING")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
MAIN = os.environ.get("SB_MAIN_REF", "origin/main"); BASE = os.environ.get("SB_BASE", "")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
files = sorted(set().union(*[L.need(FNROOT, f) for f in FNS]))
drift = [k for k in files if (lambda c: c[0] != 0 or c[1] != open(os.path.join(ROOT, k)).read())(run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"]))]
if drift: stop("this build isn't the same as GitHub's main (not merged yet, or changed since): " + ", ".join(drift)[:240])
ok("the build is what is on GitHub's main")
import re as _re
def base_need(fn):
    """the files the build this was made on imported for fn (the same reading as cc_step_lib.need, from git)"""
    seen, todo = set(), [f"supabase/functions/{fn}/index.ts"]
    while todo:
        k = todo.pop()
        if k in seen: continue
        rc, src, _ = run(["git", "-C", ROOT, "show", f"{BASE}:{k}"])
        if rc != 0: continue
        seen.add(k)
        src = "\n".join(l for l in src.split("\n") if not _re.match(r"\s*import\s+type\b", l))
        for m in _re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", src):
            todo.append(os.path.normpath(os.path.join(os.path.dirname(k), m[0] or m[1])))
    return seen
GATES = {}
for fn in FNS:
    s0, m0 = fmeta(REF, fn)
    if s0 != 200 or not m0 or "verify_jwt" not in m0: stop(f"couldn't read how {fn} is set up live ({s0})")
    GATES[fn] = bool(m0["verify_jwt"])
    okl, live = live_files(REF, fn)
    if not okl: stop(f"couldn't download the live {fn} to compare")
    odd, BN = [], base_need(fn)
    for k in sorted(L.need(FNROOT, fn)):
        rc, was, _ = run(["git", "-C", ROOT, "show", f"{BASE}:{k}"])
        base_sha = hashlib.sha256(was.encode()).hexdigest() if rc == 0 else None
        # a file this build newly imports is not in the live copy yet: that is expected
        if live.get(k) is None and k not in BN: continue
        if live.get(k) not in (base_sha, sha(os.path.join(ROOT, k))): odd.append(k)
    if odd: stop(f"the live {fn} has code that isn't on GitHub's main (someone else's unreleased change): " + ", ".join(odd)[:240])
    say(f"  ✓ {fn}: live version {m0.get('version', '?')} is the code this was built on (gateway check {'on' if GATES[fn] else 'off'}, kept)")
say(); say("PART 2 · CHANGE")
for i, fn in enumerate(FNS):
    if not deploy(REF, FNROOT, fn, GATES[fn]):
        left = ", ".join(FNS[i:])
        say(f"  RESULT: STOPPED at {fn}. The functions before it are on the new build, which is safe on its own; still to deploy: {left}.")
        say("  Running this step again finishes it. Tell Claude."); done(7)
say(); say("  RESULT: DONE. Caregiver Matching's server half is in place and switched OFF. Nothing was texted.")
say("  Next: merge the Hub and Admin page changes; then turn on Caregiver Matching checks from Admin, Switches, Clients.")
done(0)
