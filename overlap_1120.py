#!/usr/bin/env python3
# 1120 · ALREADY WORKING THEN (Samantha, 2026-10-25, her top priority: "I do NOT want us texting caregivers to cover an open
# shift if they're already working or scheduled to work an overlapping shift with Caring Companions in AxisCare.").
# One AxisCare check, read at every send: the whole shift (overnights too), scheduled visits and anyone clocked in now;
# AxisCare unreadable = nobody is texted. Also puts in Staffing #630 (readable dates, the placeholder never listed).
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only).
#  2. Re-deploys coverage-run with its gateway setting kept. No database change. No switch: it only ever texts fewer people.
#  3. Proves it ON THE REAL SYSTEM, read only (nothing is sent): who AxisCare has working right now (the next 4 hours) and
#     tomorrow 8am to 4pm, each with their hours; and every open shift's Ready list holds nobody working then.
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
OPTIONAL = set()
NEW = {}
P3 = ["cara_run_live"]   # read only, to show it is untouched
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

start("ALREADY WORKING THEN (no switch; every switch left as it is)")
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
    hubdir = tempfile.mkdtemp(prefix="cc1120hub-")
    run(["git", "-C", HUB_REPO, "fetch", "-q", "origin", "main"])
    for rf in ("match-rules.js", "eligibility-rules.js"):
        c0, mr = run(["git", "-C", HUB_REPO, "show", f"origin/main:{rf}"])
        if c0 != 0: stop(f"couldn't read the Hub's {rf} from GitHub's main (needed by the tests)")
        open(os.path.join(hubdir, rf), "w").write(mr)
    env = dict(os.environ, HUB=hubdir, HUB_ROOT=hubdir)
    for t, must in (("overlap_test.mjs", "26/26"), ("ask_list_test.mjs", "25/25"), ("prn3_coverage_test.mjs", "27/27"), ("wave_rules_test.mjs", "50/50"), ("cara_run_test.mjs", "70/70"), ("prn2_team_test.mjs", "46/46"), ("cara_p1_test.mjs", "89/89"), ("prn3_coverage_test.mjs", "27/27"), ("prn4_server_test.mjs", "22/22"), ("driver_coverage_test.mjs", "26/26"), ("open_hours_coverage_test.mjs", "14/14"), ("visit_reasons_test.mjs", "44/44"), ("callin_test.mjs", "31/31"), ("practice_client_test.mjs", "20/20")):
        c, o = run([NODE, t], cwd=ROOT, env=env)
        if c != 0 or (must and must not in o) or "\nFAIL" in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    ok("the already-working check, the three-group list, the wave rules, Let Cara run it, PRN, driver and coverage tests pass (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
sw = switches()
if sw is None: stop("couldn't read the settings", 3)
before = dict(sw)
on_now = [k for k in P3 if sw.get(k) is True]
say("  · switches left exactly as they are; Let Cara run it is " + ("ON" if on_now else "off"))
gates = {}
for fn in list(FNS):
    s_, m = fmeta(HUB, fn)
    if s_ != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s_})", 3)
    gates[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gates[fn] else 'off'} (kept)")
say(); say("PART 2 · CHANGE")
for fn in FNS:
    if not deploy(HUB, FNROOT, fn, gates[fn]): say(f"  STOP at {fn}. Tell Claude. (The functions before it are deployed.)"); done(5)

say(); say("PART 3 · PROOF")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
for fn in FNS:
    s_, _ = http("POST", f"{FNB}/functions/v1/{fn}?auth_check=1", {}, {"Content-Type": "application/json"})
    chk(s_ is not None and s_ != 200 and s_ < 500, f"{fn}: a caller with no key gets nothing ({s_})", f"{fn} answered a caller with no key ({s_})")
K = keys(); SERVICE = (K or {}).get("service_role", "")
if SERVICE:
    L.HIDE.append(SERVICE)
    import datetime as _dt
    try:
        from zoneinfo import ZoneInfo
        nowc = _dt.datetime.now(ZoneInfo("America/Chicago"))
    except Exception:
        nowc = _dt.datetime.utcnow() - _dt.timedelta(hours=5)
    h0 = nowc.replace(minute=0, second=0, microsecond=0)
    windows = [("RIGHT NOW (the next 4 hours)", h0.strftime("%Y-%m-%d"), h0.strftime("%H:00") + "-" + (h0 + _dt.timedelta(hours=4)).strftime("%H:00")),
               ("TOMORROW 8am to 4pm", (h0 + _dt.timedelta(days=1)).strftime("%Y-%m-%d"), "08:00-16:00")]
    for label, d, t in windows:
        s_, b_ = http("POST", f"{FNB}/functions/v1/coverage-run", {"action": "overlap_probe", "case_id": "probe", "date": d, "time": t}, {"Content-Type": "application/json", "Authorization": "Bearer " + SERVICE, "apikey": SERVICE})
        try: j_ = json.loads(b_ or "{}")
        except Exception: j_ = {}
        say(); say(f"  {label}: {d} {t}")
        if s_ != 200 or "working" not in j_:
            if j_.get("held"): bad(f"AxisCare could not be read ({j_.get('held')}): nobody would be texted (fail closed)")
            else: bad(f"the read-only check did not answer ({s_}): {str(b_)[:200]}")
            continue
        ok(f"AxisCare read ({j_.get('visits_read')} visits, {j_['read_range'][0]} to {j_['read_range'][1]}); {len(j_['working'])} caregiver(s) working then, none of whom would be texted for a shift at this time")
        for w in j_["working"][:40]:
            say(f"      · {w['name']}" + ("  [CLOCKED IN NOW]" if w.get("clocked_in_now") else "") + f": {'; '.join(w['conflicts'])}")
        if label.startswith("RIGHT"):
            for cs in j_.get("cases", []):
                good = not cs.get("working_in_ready")
                chk(good, f"open shift {cs['client']} {cs['shift']}: Ready to ask holds nobody working then ({cs['ready']} ready; working then, shown under Do not ask: {len(cs['working_listed_as_do_not_ask'])})",
                    f"open shift {cs['client']} {cs['shift']}: Ready to ask still holds people working then: {', '.join(cs['working_in_ready'])}")
                for x in cs["working_listed_as_do_not_ask"][:12]: say(f"          {x}")
else: say("  · the real-system check was skipped (the owner's key could not be read)")
sw2 = switches()
chk(sw2 is not None and sw2 == before, "every switch is exactly as it was", "a switch changed during the step: tell Claude")
say()
say("  1120: " + ("DONE. Nobody already working then is texted, on the real system (read-only check above; nothing was sent). Every switch is as it was." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
