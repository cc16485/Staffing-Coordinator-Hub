#!/usr/bin/env python3
# 913 · TEST CLIENT 5: OPEN SHIFTS AND THE PREFERRED CAREGIVER (Start of Care stage D; Samantha approved 2026-10-17:
# "testing open shifts and preferred caregiver fields on Test Client 5, with appropriate cleanup and verification").
# Answers two questions with AxisCare's own answers, before anything is built on them:
#   A. Will AxisCare take a schedule with NO caregiver (an open shift)? One 2-hour shift, 35+ days out, ending a week
#      later, on Test Client 5 (#290) only. Read back, deleted, read back again.
#   B. Which field sets a client's preferred caregiver on an update (preferredCaregiver or referredCaregiver)? On Test
#      Client 5 only, with the placeholder caregiver "Canceled Shift", then put back. Read back each time.
# Part 1 (read only): the reviewed build, on GitHub's main. Part 2: deploy the probe (owner script only), ask it what it
# would do (reads only), then run it. Nothing is texted. No real client or real caregiver is touched.
import os, json
os.environ.setdefault("SB_STEP", "913")
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

start("TEST CLIENT 5: OPEN SHIFTS AND THE PREFERRED CAREGIVER")
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
s, b = http("POST", f"{FNB}/functions/v1/{FN}", {"go": False}, H, 120)
try: d = json.loads(b)
except Exception: d = {}
if s == 409: stop("AxisCare client 290 is not \"Test Client 5\" any more, so nothing was tried: " + str(d.get("client", {}).get("name", ""))[:60])
if s != 200 or "plan" not in d: stop(f"the probe's read-only look answered {s}: {str(b)[:200]}")
p = d["plan"]
ok(f"Test Client 5 (#290) found. Plan: one open shift {p['day']} {p['start']} to {p['end']}, 9 to 11am, service {p.get('service_code') or '(none found)'}")
ok("placeholder caregiver for the preference test: " + ("Canceled Shift (#" + str(d["placeholder"]["id"]) + ")" if d.get("placeholder") else "not found, so that test is skipped"))
s, b = http("POST", f"{FNB}/functions/v1/{FN}", {"go": True}, H, 300)
try: r = json.loads(b)
except Exception: r = {}
if s != 200: bad(f"the probe answered {s}: {str(b)[:240]}"); say("  RESULT: STOPPED. Tell Claude; look at Test Client 5's schedule in AxisCare for a 9-11am shift " + p["start"] + "."); done(7)
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
    ok(f"AxisCare REFUSED a schedule with no caregiver (answered {A.get('create', {}).get('status')}): {json.dumps(A.get('create', {}).get('errors'))[:200]}")
    say("  · so open shifts can't be sent; the Hub will list them for the coordinator to add in AxisCare instead")
say(); say("B · PREFERRED CAREGIVER")
if B.get("skipped"): bad("not tried: " + B["skipped"])
else:
    for f in ("preferredCaregiver", "referredCaregiver"):
        if f in B: say(f"  · {f}: AxisCare answered {B[f]['status']}" + (" and it took (read back)" if B[f].get("took") else " and it did not take") + (f" {json.dumps(B[f].get('errors'))[:120]}" if B[f].get("errors") else ""))
    if B.get("works_with"): ok(f"the preferred caregiver is set with {B['works_with']}")
    else: bad("neither field set the preferred caregiver; the Hub will leave it to AxisCare")
    rt = B.get("restore")
    if rt is not None: ok("put back to what it was (read back)") if rt.get("restored") else bad(f"NOT put back (AxisCare answered {rt.get('status')}): Test Client 5's preferred caregiver is now Canceled Shift. Clear it in AxisCare if you like; it's a test client.")
say()
if L.fails: say("  RESULT: DONE WITH NOTES. The answers are above; anything marked ✗ needs a look. Nothing was texted.")
else: say("  RESULT: DONE. Both answers are in, Test Client 5 is as it was, and nothing was texted.")
done(0)
