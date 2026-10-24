#!/usr/bin/env python3
# 1094 · CARA PHASE 1, HER TWO ANSWERS (2026-10-23, Samantha: "Payroll week is Monday-Sunday, no dont drop off"): weekly
# hours and overtime count Monday to Sunday, and a lapsed eligibility check (OIG and the like) never takes a caregiver off a
# call-off list; it shows as a note instead. Same safety as 1093 (which ran DONE). Only coverage-run changes.
# What 1093 said, still true:
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only); every Cara
#     Phase 1 switch is off; whether the retired morning text (shift-confirm) exists live, and whether anything schedules it.
#  2. Deploys coverage-run, coverage-reply, coverage-watch, call-disposition and match-dark (gateway settings kept). No
#     database change, no switch touched. With the switches off they behave as today, except that what Cara WOULD do is kept
#     on the cases for comparison: the shift a texted call-off belongs to (visit_match_practice) and the urgency level and
#     who a Critical text would reach (urgency_practice, critical_alerted_practice). Removes shift-confirm if it is live and
#     nothing schedules it (decision 5: retired).
#  3. Proves it: strangers are refused; the server key is let in (a sign-in check only; nothing is run by hand); the
#     switches are still off.
# Sends nothing to anyone. Safe to run again.
import json, os, subprocess, shutil, tempfile, time
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta

REF = HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
if NODE == "none": NODE = ""   # the rehearsal's way to skip the tests
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
FNS = ["coverage-run"]
SWITCHES = ["cara_list_live", "cara_visit_match_live", "cara_urgency_live", "cara_reply_ai_practice", "cara_reply_ai_live", "cara_today_live"]
HUB_REPO = os.environ.get("SB_HUB_REPO", "/Users/samantha/Claude/Projects/cc-hub-live")
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None, env=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True, env=env); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def keys():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q_ in ("?reveal=true", ""):
        s_, b_ = http("GET", f"{L.API}/v1/projects/{REF}/api-keys{q_}", headers=L.MG())
        if s_ != 200: continue
        try: arr = json.loads(b_)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict) and usable(k.get("api_key", ""))}
        if got.get("service_role"): return got
    return {}
def switches():
    okq, st = sql(HUB, "select data from app_data where key = 'ops_settings'")
    if not okq or not st: return None
    d = st[0].get("data") or {}
    if isinstance(d, str):
        try: d = json.loads(d)
        except Exception: d = {}
    return {k: d.get(k) for k in SWITCHES}

start("CARA PHASE 1: Monday weeks, nobody dropped for a lapsed check")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = []
for fn in FNS:
    for k in sorted(L.need(FNROOT, fn)):
        c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
        if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(sorted(set(drift)))[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE:
    hubdir = tempfile.mkdtemp(prefix="cc1093hub-")
    run(["git", "-C", HUB_REPO, "fetch", "-q", "origin", "main"])
    for rf in ("match-rules.js", "eligibility-rules.js"):
        c0, mr = run(["git", "-C", HUB_REPO, "show", f"origin/main:{rf}"])
        if c0 != 0: stop(f"couldn't read the Hub's {rf} from GitHub's main (needed by the tests)")
        open(os.path.join(hubdir, rf), "w").write(mr)
    env = dict(os.environ, HUB=hubdir, HUB_ROOT=hubdir)
    for t, must in (("cara_p1_test.mjs", "64/64"), ("prn3_coverage_test.mjs", "27/27"), ("driver_coverage_test.mjs", "26/26"), ("open_hours_coverage_test.mjs", "14/14"),
                    ("match_dark_test.mjs", "30/30"), ("ci3_test.mjs", ""), ("callin_test.mjs", ""), ("coverage_reply_open_hours_test.mjs", "12/12"), ("coverage_reply_picker_test.mjs", "6/6")):
        c, o = run([NODE, t], cwd=ROOT, env=env)
        if c != 0 or (must and must not in o) or "\nFAIL" in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    ok("Cara Phase 1 tests and the coverage tests pass (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
sw = switches()
if sw is None: stop("couldn't read the settings", 3)
on_ = [k for k, v in sw.items() if v not in (None, False, "false")]
if on_: stop("a Cara Phase 1 switch is already on (" + ", ".join(on_) + "); this step expects them all off")
ok("every Cara Phase 1 switch is off: " + ", ".join(SWITCHES))
gates = {}
for fn in FNS:
    s_, m = fmeta(HUB, fn)
    if s_ != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s_})", 3)
    gates[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gates[fn] else 'off'} (kept)")
s_sc, _ = fmeta(HUB, "shift-confirm")
okq, crons = sql(HUB, "select jobname from cron.job where command ilike '%shift-confirm%'")
sc_live = s_sc == 200
sc_sched = [c.get("jobname") for c in (crons or [])] if okq else None
say(f"  · shift-confirm (retired): {'live' if sc_live else 'not live'}; schedules that call it: {', '.join(sc_sched) if sc_sched else ('none' if sc_sched is not None else 'could not check')}")

say(); say("PART 2 · CHANGE")
for fn in FNS:
    if not deploy(HUB, FNROOT, fn, gates[fn]): say(f"  STOP at {fn}. Tell Claude. (The functions before it are deployed; nothing else was changed.)"); done(5)
if sc_live:
    if sc_sched:
        bad("shift-confirm is live AND a schedule calls it (" + ", ".join(sc_sched) + "): left alone; tell Claude")
    elif sc_sched is None:
        bad("shift-confirm is live but its schedules couldn't be checked: left alone; tell Claude")
    else:
        s_d, _ = http("DELETE", f"{L.API}/v1/projects/{REF}/functions/shift-confirm", headers=L.MG())
        chk(s_d in (200, 204), "shift-confirm removed from the live project (retired, nothing scheduled it)", f"shift-confirm could not be removed ({s_d})")
else: ok("shift-confirm was never live: nothing to remove")

say(); say("PART 3 · PROOF")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
K = keys(); SERVICE = (K or {}).get("service_role", "")
if SERVICE: L.HIDE.append(SERVICE)
for fn in FNS:
    s_, _ = http("POST", f"{FNB}/functions/v1/{fn}?auth_check=1", {}, {"Content-Type": "application/json"})
    chk(s_ is not None and s_ != 200 and s_ < 500, f"{fn}: a caller with no key gets nothing ({s_})", f"{fn} answered a caller with no key ({s_})")
if SERVICE:
    for fn in ("coverage-run",):
        s_, b = http("POST" if fn != "match-dark" else "GET", f"{FNB}/functions/v1/{fn}?auth_check=1" if fn != "match-dark" else f"{FNB}/functions/v1/{fn}?rules_check=1", {} if fn != "match-dark" else None, {"Authorization": "Bearer " + SERVICE, "Content-Type": "application/json"})
        chk(s_ == 200, f"{fn}: the server key is let in (a sign-in check only; nothing ran)", f"{fn}: the server key was not let in ({s_})")
else: say("  · couldn't read the server key, so the sign-in checks were skipped")
sw2 = switches()
chk(sw2 is not None and not [k for k, v in sw2.items() if v not in (None, False, "false")], "the Cara Phase 1 switches are still all off", "a Cara Phase 1 switch is on after the step: tell Claude")
say()
say("  1094: " + ("DONE. Weekly hours count Monday to Sunday, and nobody is dropped for a lapsed check. Every switch is still off." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
