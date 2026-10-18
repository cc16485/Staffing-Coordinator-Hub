#!/usr/bin/env python3
# 914 · TEST CLIENT 5: THE OPEN-SHIFT RETEST (after 913, 2026-10-17). 913 answered the preferred-caregiver question, but
# AxisCare refused its open shift because Test Client 5 was Inactive ("The provided clientId is inactive or does not
# exist"), so the open-shift question was not answered. Samantha sets Test Client 5 to Active in AxisCare first; this
# step then tries ONE open shift (no caregiver), 35+ days out, reads it back, deletes it, reads back, and sets Test
# Client 5 back to Inactive (read back). It refuses, changing nothing, if Test Client 5 is not Active. Nothing is texted.
import os, json
os.environ.setdefault("SB_STEP", "914")
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

start("TEST CLIENT 5: THE OPEN-SHIFT RETEST")
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
ONLY = {"only": "open_shift", "set_status_after": "Inactive"}
s, b = http("POST", f"{FNB}/functions/v1/{FN}", dict(ONLY, go=False), H, 120)
try: d = json.loads(b)
except Exception: d = {}
if s == 409 and d.get("not_active"): stop("Test Client 5 is " + (d.get("client", {}).get("client_status", {}).get("label") or "not Active") + " in AxisCare. Set it to Active in AxisCare, then run this again. Nothing was changed.")
if s == 409: stop("AxisCare client 290 is not \"Test Client 5\" any more, so nothing was tried: " + str(d.get("client", {}).get("name", ""))[:60])
if s != 200 or "plan" not in d: stop(f"the probe's read-only look answered {s}: {str(b)[:200]}")
p = d["plan"]
ok(f"Test Client 5 (#290) found. Plan: one open shift {p['day']} {p['start']} to {p['end']}, 9 to 11am, service {p.get('service_code') or '(none found)'}")
ok("Test Client 5 is Active in AxisCare (it goes back to Inactive after the test)")
s, b = http("POST", f"{FNB}/functions/v1/{FN}", dict(ONLY, go=True), H, 300)
try: r = json.loads(b)
except Exception: r = {}
if s != 200: bad(f"the probe answered {s}: {str(b)[:240]}"); say("  RESULT: STOPPED. Tell Claude; look at Test Client 5 in AxisCare: its status, and any 9-11am shift " + p["start"] + "."); done(7)
A, B = r.get("open_shift") or {}, r.get("preferred") or {}
say(); say("A · OPEN SHIFT (a schedule with no caregiver)")
if A.get("skipped"): bad("not tried: " + A["skipped"])
elif A.get("accepted_without_caregiver"):
    ok(f"AxisCare ACCEPTED a schedule with no caregiver (answered {A['create']['status']})")
    rs, rv = A.get("readback_schedule") or {}, A.get("readback_visits") or {}
    ok(f"read back: {rs.get('found', 0)} schedule, {rv.get('found', 0)} visit, {rv.get('unassigned', 0)} of them with no caregiver") if rs.get("found") else bad("read back: the schedule was not found after creating it")
    if A.get("clean"): ok("deleted and read back: nothing left on Test Client 5")
    else: bad(f"cleanup did NOT finish: {A.get('after_cleanup')} left. In AxisCare, remove Test Client 5's 9-11am schedule starting {p['start']} (ids {A.get('created_ids')})")
else:
    why = json.dumps(A.get('create', {}).get('errors'))[:200]
    if A.get("reason") == "caregiver_required":
        ok(f"AxisCare REFUSED a schedule with no caregiver (answered {A.get('create', {}).get('status')}): {why}")
        say("  · so open shifts can't be sent; the Hub will list them for the coordinator to add in AxisCare instead")
    elif A.get("reason") == "client_inactive":
        bad(f"AxisCare still says Test Client 5 is inactive ({why}), so the open-shift question is still not answered")
    else:
        bad(f"AxisCare refused the schedule for another reason (answered {A.get('create', {}).get('status')}): {why}. The open-shift question is not answered; Claude reads this before building on it")
sa = r.get("status_after") or {}
say(); say("TEST CLIENT 5'S STATUS")
ok("back to Inactive (read back)") if sa.get("restored") else bad(f"NOT back to Inactive (AxisCare answered {sa.get('status')}, reads {sa.get('read_back')!r}). Set Test Client 5 to Inactive in AxisCare.")
say()
if L.fails: say("  RESULT: DONE WITH NOTES. The answers are above; anything marked ✗ needs a look. Nothing was texted.")
else: say("  RESULT: DONE. The open-shift answer is in, Test Client 5 is back to Inactive, and nothing was texted.")
done(0)
