#!/usr/bin/env python3
# 1106 · CARA PHASE 2 PART A, "LET CARA RUN IT" (Samantha, 2026-10-24). A coordinator hands one open shift to Cara; she
# asks in waves, pauses at the first full-shift yes for the office to confirm, and resumes on "Not this one" or no answer.
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only). Every switch is
#     read and left as it is. "cara_run_live" stays OFF (owners can only try it as practice: nobody is texted).
#  2. Database: the run store and its history (no browser access). Re-deploys coverage-run with its gateway setting kept.
#  3. Proves it: no key = nothing; the new read-only route answers for a real case with the owner's key (no run on it);
#     every switch as it was.
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
OPTIONAL = set()
NEW = {}
SWITCHES = ["caregiver_preview_live"]
CARA = ["cara_list_live", "cara_visit_match_live", "cara_urgency_live", "cara_reply_ai_practice", "cara_reply_ai_live", "cara_today_live", "cara_board_live", "shift_page_live"]
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

start("LET CARA RUN IT (switch stays off)")
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
    hubdir = tempfile.mkdtemp(prefix="cc1106hub-")
    run(["git", "-C", HUB_REPO, "fetch", "-q", "origin", "main"])
    for rf in ("match-rules.js", "eligibility-rules.js"):
        c0, mr = run(["git", "-C", HUB_REPO, "show", f"origin/main:{rf}"])
        if c0 != 0: stop(f"couldn't read the Hub's {rf} from GitHub's main (needed by the tests)")
        open(os.path.join(hubdir, rf), "w").write(mr)
    env = dict(os.environ, HUB=hubdir, HUB_ROOT=hubdir)
    for t, must in (("cara_run_test.mjs", "57/57"), ("cara_p1_test.mjs", "89/89"), ("ci1_test.mjs", "25/25"), ("prn3_coverage_test.mjs", "27/27"), ("shift_link_texts_test.mjs", "20/20"), ("waves_retired_test.mjs", "5/5"), ("callin_test.mjs", "31/31"), ("followup_test.mjs", "19/19")):
        c, o = run([NODE, t], cwd=ROOT, env=env)
        if c != 0 or (must and must not in o) or "\nFAIL" in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    ok("the Let Cara run it, call-in and coverage tests pass (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
sw = switches()
if sw is None: stop("couldn't read the settings", 3)
before = dict(sw)
say("  · switches left exactly as they are; Let Cara run it is " + ("ON (it was turned on before this step: tell Claude)" if sw.get("cara_run_live") is True else "off"))
gates = {}
for fn in list(FNS):
    s_, m = fmeta(HUB, fn)
    if s_ == 404 and fn in OPTIONAL:   # never installed live (pilot-readiness): left alone, nothing to update
        FNS.remove(fn); say(f"  · {fn} is not installed live, so it is left alone"); continue
    if s_ != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s_})", 3)
    gates[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gates[fn] else 'off'} (kept)")
say(); say("PART 2 · CHANGE")
okd, out = sql(HUB, open(os.path.join(ROOT, "cara_run_1106.sql")).read())
if not okd: stop("the database step failed (nothing else was changed): " + str(out)[:200], 4)
okv, chk2 = sql(HUB, "select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('cara_run', 'cara_run_event')) as tbl, (select count(*) from information_schema.role_table_grants where table_name in ('cara_run', 'cara_run_event') and grantee in ('anon', 'authenticated')) as open_grants")
r0 = (chk2 or [{}])[0] if okv else {}
chk(okv and int(r0.get("tbl") or 0) == 2 and int(r0.get("open_grants") or 0) == 0, "database: the run store and its history are there, no browser access", "database check failed: " + json.dumps(r0)[:200])
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
okc, cid = sql(HUB, "select x->>'id' as id from app_data a, jsonb_array_elements(a.data) x where a.key = 'coverage_cases' and coalesce(x->>'id', '') <> '' order by (x->>'status' = 'open') desc limit 1")
case_id = ((cid or [{}])[0] or {}).get("id") if okc else None
if SERVICE and case_id:
    s_, b_ = http("POST", f"{FNB}/functions/v1/coverage-run", {"action": "cara_run_get", "case_id": case_id}, {"Content-Type": "application/json", "Authorization": "Bearer " + SERVICE, "apikey": SERVICE})
    try: j_ = json.loads(b_ or "{}")
    except Exception: j_ = {}
    chk(s_ == 200 and "run" in j_ and isinstance(j_.get("events"), list) and j_.get("switch_on") is not True, "coverage-run: the new Let Cara run it route answers for a real case (read only; switch reads off)", f"the new route did not answer as expected ({s_}): " + str(b_)[:200])
else: say("  · the read-only check of the new route was skipped (" + ("no case on the board" if SERVICE else "the owner's key could not be read") + ")")
s_, b_ = http("POST", f"{FNB}/functions/v1/coverage-run", {"action": "cara_run_start", "case_id": case_id or "x"}, {"Content-Type": "application/json"})
chk(s_ is not None and s_ in (401, 403), f"coverage-run: starting Cara without signing in is refused ({s_})", f"coverage-run answered a start without sign-in ({s_})")
sw2 = switches()
chk(sw2 is not None and sw2 == before, "every switch is exactly as it was", "a switch changed during the step: tell Claude")
say()
say("  1106: " + ("DONE. Let Cara run it is installed with its switch OFF: only owners can try it, as practice, and nobody is texted. Next: Claude checks the Hub and shows Samantha a practice run." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
