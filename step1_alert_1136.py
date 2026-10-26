#!/usr/bin/env python3
# 1136 · STAFFING SERVER · STEP 1 ALERT (Samantha 2026-10-26: "When Step 1 is complete, text and email every active admin right
# away so we start background checks and references"; wording approved; "behind a switch that starts off").
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only); the jobs' secret
#     and the GoHighLevel key are there; who is on the admin list.
#  2. step1_alert_1136.sql (the step1_alerts record, the switch step1_alert_live added OFF); deploys step1-alert (new) and
#     step1-sign (its gateway setting kept); schedules step1-alert every 10 minutes.
#  3. Proves it: the public key gets nothing, the schedule gets in, one run with the switch off sends nothing, the public
#     can't read the record.
# Texts and emails nobody (the switch stays OFF until Samantha turns it on in Hub Settings). Safe to run again.
import json, os, subprocess, shutil, time, hashlib
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta, live_files, lit, MG, API

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
BASE = os.environ.get("SB_BASE", "")
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
if NODE == "none": NODE = ""
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
JOB = FN = "step1-alert"; SCHEDULE = "3-59/10 * * * *"; VAULT_NAME = "hub_job_secret"; SQLF = "step1_alert_1136.sql"
POLL = float(os.environ.get("SB_POLL", "2")); POLL_MAX = float(os.environ.get("SB_POLL_MAX", "40"))
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def keys():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_publishable_") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict) and usable(k.get("api_key", ""))}
        if got.get("anon"): return got
    return {}
def command(url, anon):
    return ("select net.http_post(url := " + lit(url) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
            "'Authorization', " + lit("Bearer " + anon) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
            "body := '{}'::jsonb, timeout_milliseconds := 150000);")

start("STAFFING SERVER · STEP 1 ALERT (every admin, switch OFF)")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
sqh = hashlib.sha256(open(os.path.join(ROOT, SQLF), "rb").read()).hexdigest()
if sqh != os.environ.get("SB_SQL_SHA", ""): stop("the database change is not the reviewed build")
ok("the database change is the reviewed build")
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = []
for k in sorted(L.need(FNROOT, FN) | L.need(FNROOT, "step1-sign") | {SQLF}):
    c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
    if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE:
    for t, must in (("step1_alert_test.mjs", "40/40"), ("step1_sign_2b_test.mjs", "174/174"), ("practice_scenarios_test.mjs", "48/48"), ("step1_experience_test.mjs", "47/47"), ("lpn_step1_708_test.mjs", "30/30")):
        c, o = run([NODE, t], cwd=ROOT)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "✗" in l)[:240])
    ok("the Step 1 alert and Step 1 signing tests pass (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
s, b = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
try: names = {x.get("name") for x in json.loads(b)} if s == 200 else set()
except Exception: names = set()
if "HUB_JOB_SECRET" not in names or "GHL_LOCATION_ID" not in names or not ({"GHL_TOKEN", "GHL_API_KEY"} & names): stop("the jobs' secret or the GoHighLevel key isn't there", 4)
okv, v = sql(REF, f"select count(*)::int as n from vault.decrypted_secrets where name = {lit(VAULT_NAME)}")
if not okv or not v or v[0]["n"] != 1: stop("the jobs' secret isn't in the database vault", 4)
ok("the jobs' secret and the GoHighLevel key are there")
oka, ad = sql(REF, "select coalesce(jsonb_array_length(case when jsonb_typeof(data->'coverage_alert_admins') = 'array' then data->'coverage_alert_admins' end), 0) as n, data->>'step1_alert_live' as live from app_data where key = 'ops_settings'")
if oka and ad: say(f"  · admins on the list (the same list as call-in alerts): {ad[0]['n']}" + (" (empty: the Scheduling and coverage owner + the Springfield lead are used)" if not ad[0]['n'] else "") + f" · switch now: {ad[0]['live'] or 'not set yet'}")
s1, m1 = fmeta(REF, "step1-sign")
if s1 != 200 or not m1 or "verify_jwt" not in m1: stop(f"couldn't read how step1-sign is set up live ({s1})", 3)
gate1 = bool(m1["verify_jwt"]); say(f"  · step1-sign is live as version {m1.get('version', '?')}, gateway sign-in check {'on' if gate1 else 'off'} (kept)")
okl, livef = live_files(REF, "step1-sign")
if not okl: stop("couldn't download the live step1-sign to compare it", 3)
if BASE:
    mine = {"supabase/functions/step1-sign/index.ts", "supabase/functions/_shared/step1-alert.ts", "supabase/functions/_shared/send-problems.ts"}
    newer = []
    for k, h in sorted(livef.items()):
        if k in mine: continue
        g = subprocess.run(["git", "-C", ROOT, "show", f"{BASE}:{k}"], capture_output=True)
        if g.returncode != 0 or hashlib.sha256(g.stdout).hexdigest() != h: newer.append(k)
    if newer: say("  · the live step1-sign will also pick up these already-merged files from main: " + ", ".join(newer)[:300])
    else: ok("the live step1-sign is the version this step was built on; only this step's files change")
K = keys(); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); L.HIDE += [ANON, SVC]
if not ANON or not SVC: stop("couldn't read the Hub's keys", 3)

say(); say("PART 2 · CHANGE")
okq, r = sql(REF, "begin;\n" + open(os.path.join(ROOT, SQLF)).read() + "\ncommit;")
if not okq: bad("the database change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
okq, r = sql(REF, "select data->>'step1_alert_live' as live from app_data where key = 'ops_settings'")
ok("the Step 1 alert record (step1_alerts) is in place · the switch is " + ("ON" if r and r[0]["live"] == "true" else "OFF"))
if not deploy(REF, FNROOT, FN, True): say(f"  STOP at {FN}. Tell Claude."); done(6)
if not deploy(REF, FNROOT, "step1-sign", gate1): say("  STOP at step1-sign. Tell Claude."); done(6)
URL = f"{FNB}/functions/v1/{JOB}"
sql(REF, f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
okq, r = sql(REF, f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(command(URL, ANON))}) as id")
ok2, jb = sql(REF, f"select schedule, command from cron.job where jobname = {lit(JOB)}")
chk(okq and ok2 and jb and jb[0]["schedule"] == SCHEDULE and "x-cron-secret" in jb[0]["command"], "its schedule: every 10 minutes, carrying the jobs' secret from the vault", "the schedule didn't go in: " + str(r)[:200])

say(); say("PART 3 · PROOF (nothing is sent: the switch is off)")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
a1 = http("POST", URL + "?auth_check=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
chk(a1 == 401, f"it refuses the public key ({a1})")
okq, rq = sql(REF, command(URL + "?auth_check=1", ANON).rstrip(";") + " as id")
got = None; waited = 0.0
while okq and rq and waited <= POLL_MAX:
    ok3, rr = sql(REF, f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
    if ok3 and rr: got = rr[0]; break
    time.sleep(POLL); waited += POLL
cont = {}
try: cont = json.loads((got or {}).get("content") or "{}")
except Exception: pass
chk(got and got["status_code"] == 200 and cont.get("caller") == "cron", "its schedule gets in" + ("" if got else " (no answer)"))
okq, r = sql(REF, "select data->>'step1_alert_live' as live from app_data where key = 'ops_settings'")
if okq and r and r[0]["live"] != "true":
    sD, bD = http("POST", URL, {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 200)
    try: j = json.loads(bD)
    except Exception: j = {}
    chk(sD == 200 and j.get("live") is False, "one run with the switch off: it sent nothing", f"the proof run answered {sD}: {str(bD)[:160]}")
else: say("  · the switch is already ON, so no proof run was made (it would send what is owed)")
sC, bC = http("GET", f"{FNB}/rest/v1/step1_alerts?select=offer_id&limit=1", None, {"apikey": ANON, "Authorization": "Bearer " + ANON})
chk(sC != 200 or bC.strip() in ("[]", ""), f"the public can't read the Step 1 alert record ({sC})")
say()
say("  1136: " + ("DONE. Every admin gets one text and one email when someone finishes Step 1, once Samantha turns it on: Hub, Settings, Step 1 alert, Turn on." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
say("  Nothing was texted or emailed. Rollback: Claude unschedules step1-alert; the switch off stops it at once.")
done(0 if not L.fails else 1)
