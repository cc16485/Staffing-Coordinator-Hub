#!/usr/bin/env python3
# 1164 · STAFFING SERVER · CAREGIVER PROFILES TO FAMILIES, PRACTICE WEEK (Samantha 2026-10-28: "Approved as written, including the
# 5 decisions as you suggested. Build it with the switch off and start the practice week.")
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only); the jobs' secret
#     and the AxisCare key are there.
#  2. profile_intro_1164.sql (the intro log learns AxisCare ids; the year of visits; the once-only record; the daily list; Start of
#     Care step 7 ticks "Family told" when the first-visit profile went; her approval in her words; the switch added OFF).
#     Deploys profile-intro-watch (new) and the four it touches, each keeping its gateway setting: caregiver-intro (records who
#     and whom), coverage-run, late-watch and late-alert (the call-in change text records the profile it carried and never
#     treats "Canceled Shift" as a caregiver), client-journey (step 7). Schedules profile-intro-watch every 15 minutes.
#  3. Proves it: the public key gets nothing, the schedule gets in, the public can't read the list, a ?dry=1 run sends nothing
#     (dry even if the switch were on). The 15-minute schedule keeps the day's list from then on.
# Texts and emails nobody: the switch stays OFF. Safe to run again.
import json, os, subprocess, shutil, time, hashlib
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, lit, fmeta, MG, API

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
if NODE == "none": NODE = ""
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
JOB = FN = "profile-intro-watch"; SCHEDULE = "*/15 * * * *"; VAULT_NAME = "hub_job_secret"; SQLF = "profile_intro_1164.sql"
ALSO = ("caregiver-intro", "coverage-run", "late-watch", "late-alert", "client-journey")
TESTS = (("profile_intro_test.mjs", "47/47"), ("family_change_text_test.mjs", "17/17"), ("caregiver_profile_2b_test.mjs", "ALL 48"),
         ("nsf2_families_test.mjs", "ALL 25"), ("optout_0b2_test.mjs", "ALL 29"))
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
            "body := '{}'::jsonb, timeout_milliseconds := 290000);")

start("STAFFING SERVER · CAREGIVER PROFILES TO FAMILIES (practice week, switch OFF)")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
sqh = hashlib.sha256(open(os.path.join(ROOT, SQLF), "rb").read()).hexdigest()
if sqh != os.environ.get("SB_SQL_SHA", ""): stop("the database change is not the reviewed build")
ok("the database change is the reviewed build")
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
need = {SQLF}
for f in (FN,) + ALSO: need |= L.need(FNROOT, f)
drift = []
for k in sorted(need):
    c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
    if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE:
    for t, must in TESTS:
        c, o = run([NODE, t], cwd=ROOT)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "✗" in l or "FAIL" in l)[:240])
    ok("the profile, change text and opt-out tests pass (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
s, b = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
try: names = {x.get("name") for x in json.loads(b)} if s == 200 else set()
except Exception: names = set()
if "HUB_JOB_SECRET" not in names or not ({"AXISCARE_TOKEN", "AXISCARE_API_KEY", "AXISCARE_VISITS_TOKEN"} & names) or not ({"AXISCARE_SITE", "AXISCARE_SITE_NUMBER"} & names):
    stop("the jobs' secret or the AxisCare key isn't there", 4)
okv, v = sql(REF, f"select count(*)::int as n from vault.decrypted_secrets where name = {lit(VAULT_NAME)}")
if not okv or not v or v[0]["n"] != 1: stop("the jobs' secret isn't in the database vault", 4)
ok("the jobs' secret and the AxisCare key are there")
gates = {}
for f in ALSO:
    s_, m_ = fmeta(REF, f)
    if s_ != 200 or not m_ or "verify_jwt" not in m_: stop(f"couldn't read how {f} is set up live ({s_})", 3)
    gates[f] = bool(m_["verify_jwt"])
ok("read how the five it touches are set up live (each keeps its setting)")
K = keys(); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); L.HIDE += [ANON, SVC]
if not ANON or not SVC: stop("couldn't read the Hub's keys", 3)

say(); say("PART 2 · CHANGE")
okq, r = sql(REF, "begin;\n" + open(os.path.join(ROOT, SQLF)).read() + "\ncommit;")
if not okq: bad("the database change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
okq, r = sql(REF, "select data->>'profile_intro_live' as live, data->'profile_intro_approved'->>'by' as by from app_data where key = 'ops_settings'")
live = bool(r and r[0]["live"] == "true")
chk(okq and r and r[0]["by"], "your approval is on record, in your words · the switch is " + ("ON" if live else "OFF"))
okq, r = sql(REF, "select (select count(*) from jsonb_array_elements(def->'checks') c where c->>'key' = 'family_told' and c->>'auto' = 'profile_sent_first')::int as n "
    "from client_journey_step_def where key = 'soc.start'")
say("  ✓ Start of Care step 7: \"Family told\" ticks itself when the first-visit profile went" if okq and r and r[0]["n"] == 1
    else "  · Start of Care step 7 isn't in this project's catalog, so it was left alone")
if not deploy(REF, FNROOT, FN, True): say(f"  STOP at {FN}. Tell Claude. (The tables are in; the switch is off; nothing sends.)"); done(6)
for f in ALSO:
    if not deploy(REF, FNROOT, f, gates[f]): say(f"  STOP at {f}. Tell Claude. (The switch is off; nothing new sends.)"); done(6)
URL = f"{FNB}/functions/v1/{JOB}"
sql(REF, f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
okq, r = sql(REF, f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(command(URL, ANON))}) as id")
ok2, jb = sql(REF, f"select schedule, command from cron.job where jobname = {lit(JOB)}")
chk(okq and ok2 and jb and jb[0]["schedule"] == SCHEDULE and "x-cron-secret" in jb[0]["command"], "its schedule: every 15 minutes, carrying the jobs' secret from the vault", "the schedule didn't go in: " + str(r)[:200])

say(); say("PART 3 · PROOF (nothing is sent)")
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
sC, bC = http("GET", f"{FNB}/rest/v1/profile_intro_runs?select=run_day&limit=1", None, {"apikey": ANON, "Authorization": "Bearer " + ANON})
chk(sC != 200 or bC.strip() in ("[]", ""), f"the public can't read the list ({sC})")
say(); say("  A practice run (a minute or two: it starts learning a year of visits from AxisCare)...")
sD, bD = http("POST", URL + "?dry=1", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 300)
try: j = json.loads(bD)
except Exception: j = {}
chk(sD == 200 and j.get("ok") is True and j.get("dry") is True and not j.get("sent"), "a practice run works it out and sends nothing", f"the first run answered {sD}: {str(bD)[:200]}")
probs = j.get("problems") or []
learning = [p for p in probs if "still learning" in str(p)]
for p in probs:
    if p not in learning: bad("couldn't read: " + str(p))
if learning: say("  · " + str(learning[0]) + ". It learns four weeks every 15 minutes, so the whole year is in within about an hour; the practice list starts then.")
for w in (j.get("would") or [])[:15]:
    say(f"    Would send: {w.get('caregiver')} to {w.get('client')}'s family ({', '.join(t.get('name', '') for t in w.get('to') or [])}) for {w.get('visit')}")
for c in (j.get("cards") or [])[:15]: say(f"    Would make a card: {c.get('title')}")
say()
say("  1164: " + ("DONE. The practice week has started: every 15 minutes the Hub lists which families would get a caregiver's profile, and the cards "
    "it would make. Nobody was texted or emailed, and the switch is " + ("ON." if live else "OFF.") + " See it in Hub Settings, Caregiver profiles to families, "
    "\"Show the last 14 days\"." if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
say("  Rollback: Claude unschedules profile-intro-watch. With the switch off it only ever makes a list.")
done(0 if not L.fails else 1)
