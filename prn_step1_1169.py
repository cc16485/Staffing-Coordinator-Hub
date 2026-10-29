#!/usr/bin/env python3
# 1169 · STAFFING SERVER · PRN STEP 1 (2026-10-28, Samantha: "now you do the prn steps")
# Puts PRN step 1 on the server with EVERY new switch OFF, so nothing changes for anyone until she turns one on in the Hub:
#   working_now_live   never text anyone clocked in on a visit right now (coverage-run)
#   prn_order_live     familiar first, then the PRN Teams, then everyone else, with her approved PRN texts (coverage-run)
#   prn_count_live     a covered PRN shift is counted on its own (coverage-assign, callin-alert)
#   prn_autolink_live  each morning, link a PRN hire to AxisCare when sure, card the rest (prn-team + its schedule)
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only); the four new
#     switches are not on; each function's gateway setting is read so it is kept.
#  2. Deploys coverage-run, prn-team, coverage-assign and callin-alert. Schedules the auto-link every morning
#     (7:15am CDT / 6:15am CST), carrying the jobs' secret from the vault. No database change.
#  3. Proof (nothing is sent, linked or tagged): the auto-link refuses the public key and lets its schedule in; a practice
#     auto-link run says what it would do; the "already working then" probe reads AxisCare and every open shift's Ready
#     list holds nobody working then.
# Safe to run again.
import json, os, subprocess, shutil, tempfile, time, urllib.request
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, deploy, start, check_build, fmeta, MG, API, sql, lit

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
if NODE == "none": NODE = ""
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
HUB_URL = os.environ.get("SB_HUB_URL", "https://cc.mo-care.com")
FNS = ("coverage-run", "prn-team", "coverage-assign", "callin-alert")
SWITCHES = ("working_now_live", "prn_order_live", "prn_count_live", "prn_autolink_live")
JOB = "prn-autolink"; SCHEDULE = os.environ.get("SB_SCHEDULE", "15 12 * * *"); VAULT_NAME = "hub_job_secret"
POLL = float(os.environ.get("SB_POLL", "2")); POLL_MAX = float(os.environ.get("SB_POLL_MAX", "40"))
TESTS = (("prn_step1_test.mjs", "34/34"), ("prn_autolink_test.mjs", "25/25"), ("prn2_team_test.mjs", "46/46"),
         ("prn_caregiver_1037_team_test.mjs", "11/11"), ("overlap_test.mjs", "26/26"), ("wave_rules_test.mjs", "50/50"),
         ("prn3_coverage_test.mjs", "27/27"))
ok = lambda s: say("  ✓ " + s)
def run(args, cwd=None, env=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True, env=env); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def keys():
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        out = {}
        for k in arr:
            v = k.get("api_key", "") if isinstance(k, dict) else ""
            if isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_")) and "·" not in v and "*" not in v: out[k.get("name")] = v
        if out.get("service_role") and out.get("anon"): return out
    return {}
def command(url, anon):
    return ("select net.http_post(url := " + lit(url) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
            "'Authorization', " + lit("Bearer " + anon) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
            "body := '{}'::jsonb, timeout_milliseconds := 120000);")
def jget(b, k):
    try: return json.loads(b).get(k)
    except Exception: return None

start("STAFFING SERVER · PRN STEP 1 (every new switch stays OFF)")
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
    hub = tempfile.mkdtemp(prefix="cc1169hub-")
    try:
        with urllib.request.urlopen(HUB_URL + "/match-rules.js", timeout=60) as r: open(os.path.join(hub, "match-rules.js"), "wb").write(r.read())
    except Exception as e: stop("couldn't read the Hub's matching rules from cc.mo-care.com for the tests (" + type(e).__name__ + ")")
    env = dict(os.environ, HUB=hub, HUB_ROOT=hub)
    for t, must in TESTS:
        c, o = run([NODE, t], cwd=ROOT, env=env)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "✗" in l or "FAIL" in l)[:240])
    shutil.rmtree(hub, ignore_errors=True)
    ok("the PRN step 1, auto-link, PRN team, overlap and wave tests pass (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
okS, st = sql(REF, "select " + ", ".join(f"data->'{k}' as \"{k}\"" for k in SWITCHES) + " from public.app_data where key='ops_settings'")
if not okS or not st: stop("couldn't read the Hub's switches", 3)
on = [k for k in SWITCHES if st[0].get(k) is True]
if on: stop("these new switches are already on, so this step would change things right away: " + ", ".join(on) + ". Turn them off in the Hub first.")
ok("the four new switches are all off: " + ", ".join(SWITCHES))
meta = {}
for fn in FNS:
    s_, m_ = fmeta(REF, fn)
    if s_ != 200 or not m_ or "verify_jwt" not in m_: stop(f"couldn't read how {fn} is set up live ({s_})", 3)
    meta[fn] = bool(m_["verify_jwt"])
ok("each function's gateway setting is read, so it is kept: " + ", ".join(f"{fn} {'on' if v else 'off'}" for fn, v in meta.items()))
okV, vr = sql(REF, f"select (select count(*) from vault.decrypted_secrets where name = {lit(VAULT_NAME)})::int as vault, (select count(*) from cron.job where jobname = {lit(JOB)})::int as job")
if not okV or not vr or vr[0]["vault"] != 1: stop("the jobs' secret isn't in the vault", 4)
ok("the jobs' secret is there · the morning auto-link schedule is " + ("already there (an earlier run)" if vr[0]["job"] else "new"))
K = keys(); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); L.HIDE += [ANON, SVC]
if not (ANON and SVC): stop("couldn't read the Hub's keys", 3)

say(); say("PART 2 · CHANGE")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, meta[fn]): say(f"  STOP at {fn}. Tell Claude. (Every new switch is off; nothing new sends.)"); done(6)
URL = f"{FNB}/functions/v1/prn-team?auto_link=1"
sql(REF, f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
okC, rc = sql(REF, f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(command(URL, ANON))}) as id")
okJ, jb = sql(REF, f"select schedule, command from cron.job where jobname = {lit(JOB)}")
g = okC and okJ and jb and jb[0]["schedule"] == SCHEDULE and "x-cron-secret" in jb[0]["command"] and "vault.decrypted_secrets" in jb[0]["command"]
(ok if g else bad)("the auto-link runs every morning at 7:15am CDT (6:15am in winter), carrying the jobs' secret from the vault · it links nothing until you turn it on in the Hub")

say(); say("PART 3 · PROOF (nothing is sent, linked or tagged)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
a1 = http("POST", URL + "&auth_check=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
(ok if a1 == 401 else bad)(f"the auto-link refuses the public key ({a1})")
okR, rq = sql(REF, command(URL + "&auth_check=1", ANON).rstrip(";") + " as id")
got = None; waited = 0.0
while okR and rq and waited <= POLL_MAX:
    ok3, rr = sql(REF, f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
    if ok3 and rr: got = rr[0]; break
    time.sleep(POLL); waited += POLL
g = got and got["status_code"] == 200 and jget(got["content"], "caller") == "cron"
(ok if g else bad)("its morning schedule gets in" + ("" if g else f" ({got['status_code'] if got else 'no answer'})"))
sD, bD = http("POST", URL + "&dry=1", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 200)
try: j = json.loads(bD)
except Exception: j = {}
if sD == 200 and j.get("ok") is True and j.get("live") is False and not j.get("linked"):
    ok(f"a practice auto-link run (nothing linked, tagged or carded): {j.get('seen', 0)} PRN hire(s) not linked yet · "
       f"{j.get('would_link', 0)} would be linked and tagged · {j.get('cards', 0)} would get a Needs Attention card · {j.get('waiting', 0)} still new (under 7 days)")
else: bad(f"the practice auto-link run answered {sD}: {str(bD)[:200]}")
today = time.strftime("%Y-%m-%d")
sP, bP = http("POST", f"{FNB}/functions/v1/coverage-run", {"action": "overlap_probe", "date": today, "time": "08:00-17:00"}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 200)
try: p = json.loads(bP)
except Exception: p = {}
if sP == 200 and p.get("read_only") and "held" not in p:
    badReady = [c for c in p.get("cases") or [] if c.get("working_in_ready")]
    ok(f"coverage-run reads AxisCare ({p.get('visits_read', 0)} visits, {len(p.get('working') or [])} caregiver(s) working today 8am to 5pm) and sent nothing")
    (ok if not badReady else bad)(f"open shifts checked: {len(p.get('cases') or [])}; anyone working then in a Ready list: {sum(len(c['working_in_ready']) for c in badReady)}")
elif sP == 200 and p.get("held"): bad("coverage-run couldn't read AxisCare just now: " + str(p["held"])[:160] + " (nobody is texted while it can't; run 1169 again later)")
else: bad(f"the overlap probe answered {sP}: {str(bP)[:200]}")
say()
say("  1169: " + ("DONE. PRN step 1 is on the server with every new switch OFF. Next: Claude merges the Hub pull request (#670), "
    "then you turn each switch on when you're ready in Hub Settings, PRN Teams."
    if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
