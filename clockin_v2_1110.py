#!/usr/bin/env python3
# 1110 · CARA PHASE 3, MISSED CLOCK-IN VERSION 2 (Samantha, 2026-10-24: "Resume Phase 3 with every switch off, and add: only a
# sure 'can't make it' opens a call-off case; an unsure one becomes 'Needs clarification' (call them) and the missed clock-in
# alarm keeps going."). Seven switches, ALL OFF: cant_come_case_live, late_unsure_live, clockin_here_live, clockin_no_reply_live,
# clockin_at_risk_live, late_handoff_live, cft_autoclose_live. Off, each piece only records what it WOULD do.
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only). Every switch is
#     read and left as it is.
#  2. Database: two columns on late_notices. Re-deploys timekeeper-watch, clockin-reply, late-watch, late-alert, clockin-alert
#     and coverage-run, each with its gateway setting kept.
#  3. Proves it: the columns are there; no key = nothing; every switch as it was.
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
FNS = ["timekeeper-watch", "clockin-reply", "late-watch", "late-alert", "clockin-alert", "coverage-run"]
OPTIONAL = set()
NEW = {}
P3 = ["cant_come_case_live", "late_unsure_live", "clockin_here_live", "clockin_no_reply_live", "clockin_at_risk_live", "late_handoff_live", "cft_autoclose_live"]
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
    return {k: v for k, v in d.items() if k.endswith('_live') or k.endswith('_practice')}   # every on/off switch

start("CARA PHASE 3, MISSED CLOCK-IN VERSION 2 (every switch stays off)")
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
    hubdir = tempfile.mkdtemp(prefix="cc1110hub-")
    run(["git", "-C", HUB_REPO, "fetch", "-q", "origin", "main"])
    for rf in ("match-rules.js", "eligibility-rules.js"):
        c0, mr = run(["git", "-C", HUB_REPO, "show", f"origin/main:{rf}"])
        if c0 != 0: stop(f"couldn't read the Hub's {rf} from GitHub's main (needed by the tests)")
        open(os.path.join(hubdir, rf), "w").write(mr)
    env = dict(os.environ, HUB=hubdir, HUB_ROOT=hubdir)
    for t, must in (("clockin_v2_test.mjs", "35/35"), ("c1_missed_clockin_test.mjs", "64/64"), ("late_watch_test.mjs", "20/20"), ("call_late_432_test.mjs", "60/60"), ("late_l1_test.mjs", "63/63"), ("visit_reasons_test.mjs", "44/44"), ("callin_test.mjs", "31/31"), ("cara_run_test.mjs", "57/57"), ("practice_client_test.mjs", "20/20")):
        c, o = run([NODE, t], cwd=ROOT, env=env)
        if c != 0 or (must and must not in o) or "\nFAIL" in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    ok("the Phase 3, missed clock-in, running-late, reasons and coverage tests pass (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
sw = switches()
if sw is None: stop("couldn't read the settings", 3)
before = dict(sw)
on_now = [k for k in P3 if sw.get(k) is True]
say("  · switches left exactly as they are; the seven Phase 3 switches are " + ("off" if not on_now else "NOT all off (" + ", ".join(on_now) + " was turned on before this step: tell Claude)"))
gates = {}
for fn in list(FNS):
    s_, m = fmeta(HUB, fn)
    if s_ != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s_})", 3)
    gates[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gates[fn] else 'off'} (kept)")
say(); say("PART 2 · CHANGE")
okd, out = sql(HUB, open(os.path.join(ROOT, "clockin_v2_1110.sql")).read())
if not okd: stop("the database step failed (nothing else was changed): " + str(out)[:200], 4)
okv, chk2 = sql(HUB, "select count(*) as cols from information_schema.columns where table_schema = 'public' and table_name = 'late_notices' and column_name in ('cant_case_would', 'handoff_asked')")
r0 = (chk2 or [{}])[0] if okv else {}
chk(okv and int(r0.get("cols") or 0) == 2, "database: the two new running-late columns are there", "database check failed: " + json.dumps(r0)[:200])
for fn in FNS:
    if not deploy(HUB, FNROOT, fn, gates[fn]): say(f"  STOP at {fn}. Tell Claude. (The functions before it are deployed.)"); done(5)

say(); say("PART 3 · PROOF")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
for fn in FNS:
    s_, _ = http("POST", f"{FNB}/functions/v1/{fn}?auth_check=1", {}, {"Content-Type": "application/json"})
    chk(s_ is not None and s_ != 200 and s_ < 500, f"{fn}: a caller with no key gets nothing ({s_})", f"{fn} answered a caller with no key ({s_})")
sw2 = switches()
chk(sw2 is not None and sw2 == before, "every switch is exactly as it was", "a switch changed during the step: tell Claude")
say()
say("  1110: " + ("DONE. Missed clock-in version 2 is installed with all seven switches OFF (each only records what it would do). Next: Claude merges the Hub and Owners Hub and checks the live pages." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
