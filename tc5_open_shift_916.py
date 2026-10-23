#!/usr/bin/env python3
# 916 · THE OPEN-SHIFT TEST ON THE PRACTICE CLIENT (2026-10-23, after 915 stopped 4 times because AxisCare kept reading Test
# Client 5 as Inactive). Samantha: "Point the open-shift test at the AxisCare Practice client instead of Test Client 5."
# The probe finds the Practice client by its exact name (the only Active client named "Practice" or "Practice Client"),
# tries each service code the agency uses until AxisCare takes one, with NO caregiver (one 2-hour shift 35+ days out), reads
# it back, deletes only what it made, and reads back that the Practice client's own schedules and visits are untouched.
# The Practice client's status is never changed and no preferred-caregiver test runs. The Hub's shift jobs already skip the
# Practice client by name, so nothing is texted.
import os, json
os.environ.setdefault("SB_STEP", "916")
import cc_step_lib as L
from cc_step_lib import say, bad, done, deploy, start, check_build, fmeta, http, sha, API, MG

REF = "zngsgedlsxinbygwmxwn"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FNROOT = L.FNROOT; ROOT = L.ROOT
FN = "axiscare-tc5-probe"
ok = lambda s: say("  ✓ " + s)
def stop(msg): bad(msg); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(2)
def run(args):
    import subprocess; p = subprocess.run(args, capture_output=True, text=True, cwd=ROOT); return p.returncode, (p.stdout or ""), (p.stderr or "")
def keys():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict) and usable(k.get("api_key", ""))}
        if got.get("service_role"): return got["service_role"]
    return ""

start("THE OPEN-SHIFT TEST ON THE PRACTICE CLIENT")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
files = sorted(L.need(FNROOT, FN))
drift = [k for k in files if (lambda c: c[0] != 0 or c[1] != open(os.path.join(ROOT, k)).read())(run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"]))]
if drift: stop("this build isn't the same as GitHub's main (not merged yet, or changed since): " + ", ".join(drift)[:240])
ok("the build is what is on GitHub's main")
SVC = keys(); L.HIDE.append(SVC)
if not SVC: stop("couldn't read the project's service key (the probe only answers the owner script)")
ok("the owner script can call the probe")

say(); say("PART 2 · THE TEST")
if not deploy(REF, FNROOT, FN, True): say("  RESULT: STOPPED. The probe did not deploy, so nothing touched AxisCare. Tell Claude."); done(5)
H = {"apikey": SVC, "Authorization": "Bearer " + SVC}
ONLY = {"only": "open_shift", "client": "practice"}
s, b = http("POST", f"{FNB}/functions/v1/{FN}", dict(ONLY, go=False), H, 120)
try: d = json.loads(b)
except Exception: d = {}
if s == 409 and d.get("not_active"): stop("the Practice client is " + (d.get("client", {}).get("client_status", {}).get("label") or "not Active") + " in AxisCare. Set it to Active in AxisCare, then run this again. Nothing was changed.")
if s == 409: stop("the Practice client could not be picked out, so nothing was tried: " + str(d.get("refused", ""))[:200])
if s != 200 or "plan" not in d: stop(f"the probe's read-only look answered {s}: {str(b)[:200]}")
p = d["plan"]
ok(f"the Practice client (#{d.get('test_client')}) found and Active. Plan: one open shift {p['day']} {p['start']} to {p['end']}, 9 to 11am, trying the agency's services: {', '.join(p.get('service_codes') or []) or '(none found)'}")
s, b = http("POST", f"{FNB}/functions/v1/{FN}", dict(ONLY, go=True), H, 300)
try: r = json.loads(b)
except Exception: r = {}
if s != 200: bad(f"the probe answered {s}: {str(b)[:240]}"); say("  RESULT: STOPPED. Tell Claude; look at the Practice client in AxisCare for a 9-11am shift with no caregiver on " + p["start"] + "."); done(7)
A = r.get("open_shift") or {}
say(); say("A · OPEN SHIFT (a schedule with no caregiver)")
if A.get("skipped"): bad("not tried: " + A["skipped"])
elif A.get("accepted_without_caregiver"):
    ok(f"AxisCare ACCEPTED a schedule with no caregiver (answered {A['create']['status']}, service {A.get('service_code')})")
    rs, rv = A.get("readback_schedule") or {}, A.get("readback_visits") or {}
    ok(f"read back: {rs.get('found', 0)} schedule, {rv.get('found', 0)} visit, {rv.get('unassigned', 0)} of them with no caregiver") if rs.get("found") else bad("read back: the schedule was not found after creating it")
    if A.get("clean"): ok("deleted and read back: the test shift is gone and the Practice client's own shifts are untouched")
    else: bad(f"cleanup did NOT finish: {A.get('after_cleanup')}. In AxisCare, remove the Practice client's 9-11am shift with no caregiver starting {p['start']} (ids {A.get('created_ids')}), and check its other shifts")
else:
    why = json.dumps(A.get('create', {}).get('errors'))[:200]
    if A.get("reason") == "caregiver_required":
        ok(f"AxisCare REFUSED a schedule with no caregiver (answered {A.get('create', {}).get('status')}): {why}")
        say("  · so open shifts can't be sent; the Hub will list them for the coordinator to add in AxisCare instead")
    elif A.get("reason") == "service_not_on_client":
        bad("none of the agency's services is set up on the Practice client's Billing tab (" + ", ".join(t.get("code", "") for t in (A.get("tried") or [])) + "), so the open-shift question is still not answered. Add one in AxisCare, then run this again")
    elif A.get("reason") == "client_inactive":
        bad(f"AxisCare says the Practice client is inactive ({why}), so the open-shift question is still not answered")
    else:
        bad(f"AxisCare refused the schedule for another reason (answered {A.get('create', {}).get('status')}): {why}. The open-shift question is not answered; Claude reads this before building on it")
say()
if L.fails: say("  RESULT: DONE WITH NOTES. The answers are above; anything marked ✗ needs a look. Nothing was texted.")
else: say("  RESULT: DONE. The open-shift answer is in, the Practice client is as it was, and nothing was texted.")
done(0)
