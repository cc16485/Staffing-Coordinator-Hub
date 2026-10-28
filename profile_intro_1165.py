#!/usr/bin/env python3
# 1165 · STAFFING SERVER · CAREGIVER PROFILES: AXISCARE'S EMPTY WEEKS (follow-up to 1164, 2026-10-28)
# 1164 found AxisCare's visit list answers 404 for weeks with no visits (the year it learns starts before the 2026-08 go-live),
# and the history stopped there every 15 minutes. Nothing was sent (the switch is OFF and the job fails closed).
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only).
#  2. Deploys profile-intro-watch only, keeping its gateway setting. No database change.
#  3. Practice runs (?dry=1, send nothing) until the year of visits is learned, then shows the practice list.
# Texts and emails nobody: the switch stays OFF. Safe to run again.
import json, os, subprocess, shutil
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, deploy, start, check_build, fmeta, MG, API

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
if NODE == "none": NODE = ""
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FN = "profile-intro-watch"; RUNS = int(os.environ.get("SB_RUNS", "6"))
TESTS = (("profile_intro_test.mjs", "51/51"), ("family_change_text_test.mjs", "17/17"))
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def service_key():
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        for k in arr:
            v = k.get("api_key", "") if isinstance(k, dict) else ""
            if k.get("name") == "service_role" and isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v: return v
    return ""

start("STAFFING SERVER · CAREGIVER PROFILES: AXISCARE'S EMPTY WEEKS (switch OFF)")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = []
for k in sorted(L.need(FNROOT, FN)):
    c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
    if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE:
    for t, must in TESTS:
        c, o = run([NODE, t], cwd=ROOT)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "✗" in l or "FAIL" in l)[:240])
    ok("the profile and change text tests pass (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
s_, m_ = fmeta(REF, FN)
if s_ != 200 or not m_ or "verify_jwt" not in m_: stop(f"couldn't read how {FN} is set up live ({s_})", 3)
SVC = service_key(); L.HIDE += [SVC]
if not SVC: stop("couldn't read the Hub's keys", 3)

say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, FN, bool(m_["verify_jwt"])): say(f"  STOP at {FN}. Tell Claude. (The switch is off; nothing sends.)"); done(6)

say(); say("PART 3 · PRACTICE RUNS (nothing is sent; each learns about four months of visits)")
j = {}
for n in range(RUNS):
    sD, bD = http("POST", f"{FNB}/functions/v1/{FN}?dry=1", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 300)
    try: j = json.loads(bD)
    except Exception: j = {}
    if not (sD == 200 and j.get("ok") is True and j.get("dry") is True and not j.get("sent")):
        bad(f"practice run {n + 1} answered {sD}: {str(bD)[:200]}"); break
    probs = [str(p) for p in j.get("problems") or []]
    learning = [p for p in probs if "still learning" in p]
    if learning: say(f"  · practice run {n + 1}: {learning[0]}"); continue
    ok(f"practice run {n + 1}: the whole year of visits is learned, and it sent nothing")
    for p in probs: bad("couldn't read: " + p)
    break
else: bad("the year of visits still isn't learned after " + str(RUNS) + " practice runs: " + "; ".join(str(p) for p in j.get("problems") or [])[:240])
say()
would, cards = j.get("would") or [], j.get("cards") or []
say(f"  The practice list right now: {len(would)} would get a profile, {len(cards)} card(s) for the office.")
for w in would[:25]:
    say(f"    Would send: {w.get('caregiver')} to {w.get('client')}'s family ({', '.join(t.get('name', '') for t in w.get('to') or [])}) for {w.get('visit')}")
for c in cards[:25]: say(f"    Would make a card: {c.get('title')}")
say()
say("  1165: " + ("DONE. The practice week is running: every 15 minutes the Hub lists which families would get a caregiver's profile. "
    "Nobody was texted or emailed, and the switch is OFF. See it in Hub Settings, Caregiver profiles to families, \"Show the last 14 days\"."
    if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
