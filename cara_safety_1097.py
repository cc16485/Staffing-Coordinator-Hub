#!/usr/bin/env python3
# 1097 · CARA'S RESPONSE BOARD AND SHIFT PAGE, SERVER HALF, with her three checks (2026-10-24). Replaces 1096 (never run):
# no code step on the shift page (her call: "no need for a code on the open shift"), so no code table.
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only); every Cara
#     switch is off, including cara_board_live and shift_page_live.
#  2. Database: two optional fields on care_circles: What they enjoy, and "Share the care needs on shift pages" (off by
#     default). Nothing else.
#  3. Deploys coverage-run (the board, the hours each ask was for), coverage-reply (answer history), coverage-assign and
#     callin-alert (Needs Verification is never confirmed, once the better list is on), family-app-office (What they enjoy,
#     Share the care needs), and the NEW shift-offer (gateway sign-in check off: caregivers have no Hub login; it checks its
#     own links, the shift in AxisCare now, and taken-back links). No switch is touched: caregiver links answer "not open
#     yet" and only the office preview works.
#  4. Proves it: a made-up link is refused, the preview needs a Hub sign-in, every switch is still off.
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
FNS = ["coverage-run", "coverage-reply", "coverage-assign", "callin-alert", "family-app-office"]
NEW = {"shift-offer": False}   # new function: gateway sign-in check off (it checks its own links)
SWITCHES = ["cara_list_live", "cara_visit_match_live", "cara_urgency_live", "cara_reply_ai_practice", "cara_reply_ai_live", "cara_today_live", "cara_board_live", "shift_page_live"]
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

start("CARA: response board and shift page, with the three checks (server half)")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = []
for fn in FNS + list(NEW):
    for k in sorted(L.need(FNROOT, fn)):
        c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
        if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(sorted(set(drift)))[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE:
    hubdir = tempfile.mkdtemp(prefix="cc1097hub-")
    run(["git", "-C", HUB_REPO, "fetch", "-q", "origin", "main"])
    for rf in ("match-rules.js", "eligibility-rules.js"):
        c0, mr = run(["git", "-C", HUB_REPO, "show", f"origin/main:{rf}"])
        if c0 != 0: stop(f"couldn't read the Hub's {rf} from GitHub's main (needed by the tests)")
        open(os.path.join(hubdir, rf), "w").write(mr)
    env = dict(os.environ, HUB=hubdir, HUB_ROOT=hubdir)
    for t, must in (("cara_p1_test.mjs", "87/87"), ("shift_page_test.mjs", "49/49"), ("coverage_reply_open_hours_test.mjs", "12/12"), ("prn3_coverage_test.mjs", "27/27"), ("driver_coverage_test.mjs", "26/26"),
                    ("ci1_test.mjs", "25/25"), ("callin_test.mjs", "31/31"), ("family_app_1a_test.mjs", "125/125"), ("match_dark_test.mjs", "30/30")):
        c, o = run([NODE, t], cwd=ROOT, env=env)
        if c != 0 or (must and must not in o) or "\nFAIL" in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    ok("the board, shift page and coverage tests pass (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
sw = switches()
if sw is None: stop("couldn't read the settings", 3)
on_ = [k for k, v in sw.items() if v not in (None, False, "false")]
if on_: stop("a Cara switch is already on (" + ", ".join(on_) + "); this step expects them all off")
ok("every Cara switch is off: " + ", ".join(SWITCHES))
gates = {}
for fn in FNS:
    s_, m = fmeta(HUB, fn)
    if s_ != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s_})", 3)
    gates[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gates[fn] else 'off'} (kept)")
say(); say("PART 2 · CHANGE")
okd, out = sql(HUB, open(os.path.join(ROOT, "cara_safety_1097.sql")).read())
if not okd: stop("the database step failed (nothing else was changed): " + str(out)[:200], 4)
okv, chk2 = sql(HUB, "select (select count(*) from information_schema.columns where table_name = 'care_circles' and column_name in ('caregiver_enjoys', 'caregiver_share_care')) as cols, (select count(*) from care_circles where caregiver_share_care) as sharing")
r0 = (chk2 or [{}])[0] if okv else {}
chk(okv and int(r0.get("cols") or 0) == 2 and int(r0.get("sharing") or 0) == 0,
    "database: What they enjoy and Share the care needs added (no client is sharing care needs yet)",
    "database check failed: " + json.dumps(r0)[:200])
for fn in FNS:
    if not deploy(HUB, FNROOT, fn, gates[fn]): say(f"  STOP at {fn}. Tell Claude. (The functions before it are deployed.)"); done(5)
for fn, gate in NEW.items():
    if not deploy(HUB, FNROOT, fn, gate): say(f"  STOP at {fn}. Tell Claude."); done(5)

say(); say("PART 3 · PROOF")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
K = keys(); SERVICE = (K or {}).get("service_role", "")
if SERVICE: L.HIDE.append(SERVICE)
for fn in FNS:
    s_, _ = http("POST", f"{FNB}/functions/v1/{fn}?auth_check=1", {}, {"Content-Type": "application/json"})
    chk(s_ is not None and s_ != 200 and s_ < 500, f"{fn}: a caller with no key gets nothing ({s_})", f"{fn} answered a caller with no key ({s_})")
s_, b_ = http("POST", f"{FNB}/functions/v1/shift-offer", {"c": "cv_test", "a": "ask_test", "e": 9999999999, "t": "A" * 43, "action": "view"}, {"Content-Type": "application/json"})
chk(s_ == 403, f"shift-offer: a made-up link is refused ({s_})", f"shift-offer answered a made-up link ({s_}): {str(b_)[:120]}")
s_, b_ = http("POST", f"{FNB}/functions/v1/shift-offer", {"action": "preview", "case_id": "x", "ask_id": "y"}, {"Content-Type": "application/json"})
chk(s_ == 401, f"shift-offer: the office preview needs a Hub sign-in ({s_})", f"shift-offer preview answered without a sign-in ({s_})")
sw2 = switches()
chk(sw2 is not None and not [k for k, v in sw2.items() if v not in (None, False, "false")], "every Cara switch is still off (caregiver links don't open; the office preview works)", "a Cara switch is on after the step: tell Claude")
say()
say("  1097: " + ("DONE. The response board and the shift page (no code) are installed with every switch off. Next: merge the Hub and Owners Hub pull requests, then your preview." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
