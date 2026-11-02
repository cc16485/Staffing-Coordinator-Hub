#!/usr/bin/env python3
# 1229 · STAFFING SERVER · ACTIVE IN AXISCARE WHEN ORIENTATION IS DONE (2026-11-01, Samantha: "Switch them to Active in AxisCare
# as soon as orientation is complete, even if other readiness steps are still open")
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (no real data); nothing live was
#     changed by someone else; the gateway setting is read, so it is kept.
#  2. Deploys caregiver-journey (the readiness sweep and the Training Platform's report).
#  3. Proof (nothing is sent or saved): caregiver-journey refuses a caller without the job secret; the switches are read back.
# The new behavior stays OFF until Samantha turns on Admin > "Active in AxisCare when orientation is done". Texts nobody.
# Safe to run again.
import json, os, subprocess, shutil, time
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, deploy, start, check_build, fmeta, MG, API, sql as SQL

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
if NODE == "none": NODE = ""
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FN = "caregiver-journey"
TESTS = (("orientation_active_test.mjs", "15/15 passed"), ("caregiver_journey_6_test.mjs", "128/128 passed"), ("in_training_test.mjs", "21/21 passed"))
ok = lambda s: say("  ✓ " + s)
def run(args, cwd=None, env=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True, env=env); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def main_shas(path, n=80):
    import hashlib
    c, o = run(["git", "-C", ROOT, "log", "-n", str(n), "--format=%H", "origin/main", "--", path])
    out = set()
    for h in (o.split() if c == 0 else []):
        c2, o2 = run(["git", "-C", ROOT, "show", f"{h}:{path}"])
        if c2 == 0: out.add(hashlib.sha256(o2.encode()).hexdigest())
    return out

start("STAFFING SERVER · ACTIVE IN AXISCARE WHEN ORIENTATION IS DONE")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
main = os.environ.get("SB_MAIN_REF", "origin/main")
drift = [k for k in sorted(L.need(FNROOT, FN)) if (lambda r: r[0] != 0 or r[1] != open(os.path.join(ROOT, k)).read())(run(["git", "-C", ROOT, "show", f"{main}:{k}"]))]
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE:
    for t, want in TESTS:
        c, o = run([NODE, t], cwd=ROOT)
        if c != 0 or want not in o: stop(f"{t} failed: " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    ok("the tests pass (" + ", ".join(w.split()[0] for _, w in TESTS) + "; no real data)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
s_, m_ = fmeta(REF, FN)
if s_ != 200 or not m_ or "verify_jwt" not in m_: stop(f"couldn't read how {FN} is set up live ({s_})", 3)
VJ = bool(m_["verify_jwt"])
okL, livef = L.live_files(REF, FN)
if not okL: stop(f"couldn't read the live {FN} to compare", 3)
foreign = [k for k in L.need(FNROOT, FN) if livef.get(k) and livef.get(k) != L.sha(os.path.join(ROOT, k)) and livef.get(k) not in main_shas(k)]
if foreign: stop(f"{FN} live has code that was never on GitHub's main ({', '.join(x.replace('supabase/functions/', '') for x in foreign)[:200]}): someone else's work may be live. Tell Claude before going on.", 3)
ok(f"{FN} live is GitHub's main (gateway sign-in check {'on' if VJ else 'off'}, kept)")

say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, FN, VJ): say(f"  STOP at {FN}. Tell Claude. (Run this again to finish.)"); done(6)

say(); say("PART 3 · PROOF (nothing is sent or saved)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
s0 = http("POST", f"{FNB}/functions/v1/{FN}", {"action": "sweep"}, {"x-cron-secret": "wrong" * 10})[0]
(ok if s0 in (401, 403) else bad)(f"{FN} refuses a sweep without the job secret ({s0})")
good, rows = SQL(REF, "select data->>'axiscare_active_at_orientation_live' as orient, data->>'approve_work_axiscare_live' as axwrite from public.app_data where key = 'ops_settings'")
if good and rows:
    r = rows[0]; on = r.get("orient") == "true"; ax = r.get("axwrite") == "true"
    say(f"  · Active in AxisCare when orientation is done: {'ON' if on else 'off'}")
    say(f"  · Approve to Work updates AxisCare (new path): {'ON' if ax else 'off'}" + ("" if ax else "  (this one must be on too, or nothing is written to AxisCare)"))
else: bad("couldn't read the switches back")
say()
say("  1229: " + ("DONE. Installed and still OFF. Next: in Admin, turn on \"Active in AxisCare when orientation is done\". "
    "Within the hour, every new hire who has finished orientation is switched to Active in AxisCare, with their orientation day "
    "as the hire date. They still get no shift offers until Approve to Work. Tell Claude \"ran 1229\"."
    if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
