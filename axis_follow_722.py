#!/usr/bin/env python3
# 722 · AXISCARE IS THE TRUTH FOR ACTIVE + TEAM BUILDER ONBOARDING (Samantha, 2026-10-14).
# Her rule: "axiscare is the truth for if a caregiver is active or not, we should never have the option to send an open
# shift to someone who is not active in axiscare". Her choices: the Hub follows AxisCare nightly (Caregivers page lists who
# changed; practice until the Admin switch); Team Builder shows onboarding people and their stage, with a goal (the client's
# start date, changeable) and a Needs Attention card for the onboarding owner 3 days out.
# Part 1 (read only): the reviewed build; team-ask and hire-profile are live as some version GitHub main had (else STOP);
#   the jobs' secret is there.
# Part 2: roster_axis_follow.sql (one server-only database function); deploy team-ask and hire-profile (gateway kept),
#   the new roster-axis-follow and onboard-goal-watch (sign-in check on); their schedules (nightly 3am CDT; weekdays 9am CDT).
# Part 3 (proof; nothing is sent, no caregiver is changed): services live as tested; the database function is server only;
#   both jobs refuse outsiders and let their schedules in; ONE practice run of the nightly check writes the "Hub vs
#   AxisCare" list for the Caregivers page (no caregiver changes while the switch is off); a counts-only goal check.
# Prints counts only: no name, number, email, key or secret.
import os, json, subprocess
os.environ.setdefault("SB_STEP", "722")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
ROOT = os.path.dirname(os.path.dirname(FNROOT))
BASE = os.environ.get("SB_BASE_COMMIT", "e631029")   # main before this change: what each service must be live as now
CHANGED = ["team-ask", "hire-profile"]
JOBS = {"roster-axis-follow": "0 8 * * *", "onboard-goal-watch": "0 14 * * 1-5"}; VAULT_NAME = "hub_job_secret"
SQLF = "roster_axis_follow.sql"
def keys():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_secret_") or v.startswith("sb_publishable_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict) and usable(k.get("api_key", ""))}
        if got.get("service_role") and got.get("anon"): return got
    return {}
def lit(v): return "'" + str(v).replace("'", "''") + "'"
def jget(b, k):
    try: return json.loads(b).get(k)
    except Exception: return None
_ON_MAIN = {}
def on_main(rel):
    """every version of this file that was ever on GitHub main up to BASE (a live copy deployed from an older main is fine)"""
    if rel not in _ON_MAIN:
        got = set()
        cs = subprocess.run(["git", "-C", ROOT, "log", "--format=%H", "-n", "300", BASE, "--", rel], capture_output=True, text=True).stdout.split()
        for c in cs:
            p = subprocess.run(["git", "-C", ROOT, "show", f"{c}:{rel}"], capture_output=True)
            if p.returncode == 0: got.add(hashlib.sha256(p.stdout).hexdigest())
        _ON_MAIN[rel] = got
    return _ON_MAIN[rel]
def command(url, anon):
    return ("select net.http_post(url := " + lit(url) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
            "'Authorization', " + lit("Bearer " + anon) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
            "body := '{}'::jsonb, timeout_milliseconds := 120000);")


start("AXISCARE IS THE TRUTH FOR ACTIVE + TEAM BUILDER ONBOARDING")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
if hashlib.sha256(open(os.path.join(ROOT, SQLF), "rb").read()).hexdigest() != os.environ.get("SB_SQL_SHA", ""): bad(f"{SQLF} is not the reviewed build")
VJ = {}
for fn in CHANGED:
    s_, m_ = fmeta(REF, fn)
    if s_ != 200 or not isinstance((m_ or {}).get("verify_jwt"), bool): bad(f"could not read {fn}'s settings"); continue
    VJ[fn] = m_["verify_jwt"]
    okl, livef = live_files(REF, fn)
    if not okl: bad(f"could not download the live {fn} to compare"); continue
    off = [k for k, v in livef.items() if v not in on_main(k)]
    if off: bad(f"{fn} is live with changes that are not on GitHub ({len(off)} file(s)): deploying would overwrite them")
    else: say(f"  ✓ {fn} is live as GitHub main had it (version {(m_ or {}).get('version', '?')}, gateway sign-in check {'on' if VJ[fn] else 'off'}, kept)")
ok, st = sql(REF, "select (select count(*) from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")::int as vault")
if not ok or not st or st[0]["vault"] != 1: bad("the jobs' secret is not in the vault")
else: say("  ✓ the jobs' secret is there")
K = keys(); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); HIDE.extend([ANON, SVC])
if not (ANON and SVC): bad("could not read the project's keys (the schedules and the proofs need them)")
say("  · what changes: one database function, 2 services redeployed + 2 new jobs. No caregiver changes, no switch, nothing texted by this step.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
ok, r = sql(REF, "begin;\n" + open(os.path.join(ROOT, SQLF)).read() + "\ncommit;")
if not ok: bad("the database function did not go in (undone as a whole): " + str(r)[:240]); say("  RESULT: STOPPED. Nothing else changed. Tell Claude."); done(5)
say("  ✓ the database function is in (it changes only active, only from the server)")
for fn in CHANGED + list(JOBS):
    if not deploy(REF, FNROOT, fn, VJ.get(fn, True)): say(f"  RESULT: STOPPED at {fn}. Tell Claude."); done(6)
for job, sch in JOBS.items():
    url = f"{FNB}/functions/v1/{job}"
    sql(REF, f"select cron.unschedule({lit(job)}) where exists (select 1 from cron.job where jobname = {lit(job)})")
    ok, r = sql(REF, f"select cron.schedule({lit(job)}, {lit(sch)}, {lit(command(url, ANON))}) as id")
    ok2, jb = sql(REF, f"select schedule, command from cron.job where jobname = {lit(job)}")
    g = ok and ok2 and jb and jb[0]["schedule"] == sch and "x-cron-secret" in jb[0]["command"] and "vault.decrypted_secrets" in jb[0]["command"]
    say(f"  ✓ {job} is scheduled ({'every night at 3am CDT' if job == 'roster-axis-follow' else 'weekdays at 9am CDT'}), carrying the jobs' secret") if g else bad(f"{job}'s schedule did not go in")

say(); say("PART 3 · PROOF (nothing is sent; no caregiver is changed)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
VIS = {"apikey": ANON, "Authorization": "Bearer " + ANON}; SV = {"apikey": SVC, "Authorization": "Bearer " + SVC}
ok, pr = sql(REF, "select has_function_privilege('authenticated', 'public.caregiver_active_patch(text, bigint, boolean, jsonb)', 'execute') as a, "
                  "has_function_privilege('anon', 'public.caregiver_active_patch(text, bigint, boolean, jsonb)', 'execute') as b")
say("  ✓ only the server can call the database function") if ok and pr and pr[0]["a"] is False and pr[0]["b"] is False else bad(f"the database function's access is not server-only: {pr}")
for fn in CHANGED:
    sx, _ = http("POST", f"{FNB}/functions/v1/{fn}", {"action": "stages"} if fn == "hire-profile" else {"action": "draft"}, VIS)
    say(f"  ✓ {fn} still refuses anyone who isn't signed-in office staff ({sx})") if sx in (401, 403) else bad(f"{fn} answered {sx} without a staff sign-in")
for job in JOBS:
    url = f"{FNB}/functions/v1/{job}"
    a1 = http("POST", url + "?auth_check=1", {}, VIS)[0]
    say(f"  ✓ {job} refuses the public key ({a1})") if a1 == 401 else bad(f"{job} let the public key in ({a1})")
    ok, rq = sql(REF, command(url + "?auth_check=1", ANON).rstrip(";") + " as id")
    got = None; waited = 0.0
    while ok and rq and waited <= 40:
        ok3, rr = sql(REF, f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
        if ok3 and rr: got = rr[0]; break
        time.sleep(2); waited += 2
    g = got and got["status_code"] == 200 and jget(got["content"], "caller") == "cron"
    say(f"  ✓ {job}'s schedule gets in") if g else bad(f"{job}'s schedule was not let in ({got['status_code'] if got else 'no answer'})")
ok, sw = sql(REF, "select coalesce(data->>'roster_follow_axis_live', 'off') as live from public.app_data where key = 'ops_settings'")
if ok and sw and sw[0]["live"] == "true": say("  · the Admin switch \"Caregiver list follows AxisCare\" is already on, so the practice run is skipped (tonight's run applies it)")
else:
    sP, bP = http("POST", f"{FNB}/functions/v1/roster-axis-follow", {}, SV, 200)
    try: j = json.loads(bP)
    except Exception: j = {}
    if sP == 200 and j.get("mode") == "practice" and "changes" in j:
        say(f"  ✓ practice run of the nightly check (no caregiver changed): {j.get('to_inactive', 0)} active in the Hub but not in AxisCare, {j.get('to_active', 0)} the other way, "
            f"{j.get('not_in_axiscare', 0)} with an AxisCare number AxisCare doesn't know, {j.get('no_number', 0)} active with no AxisCare number. The names are on the Caregivers page (Hub vs AxisCare).")
    elif sP == 200 and j.get("held"): say(f"  · the practice run held, nothing changed: {j['held']}")
    else: bad(f"the practice run answered {sP}: {str(bP)[:160]}")
sD, bD = http("POST", f"{FNB}/functions/v1/onboard-goal-watch?dry=1", {}, SV, 200)
try: j = json.loads(bD)
except Exception: j = {}
if sD == 200 and j.get("dry") is True: say(f"  ✓ a counts-only goal check: {j.get('plans_with_goal', 0)} Team Builder plans with a goal, {j.get('onboarding', 0)} people still onboarding on them, {j.get('behind', 0)} within 3 days of the goal (cards start with the first weekday run)")
elif sD == 200 and j.get("held"): say(f"  · the goal check held: {j['held']}")
else: bad(f"the goal check answered {sD}: {str(bD)[:160]}")
say("  · tested before deploying: Hub-follows-AxisCare 13, goal check 11, hire-profile 20, team-ask checks 29 + 38.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · Team Builder's Text asks AxisCare first; Team Builder shows onboarding stages and goals; the Caregivers page shows Hub vs AxisCare. Turn on \"Caregiver list follows AxisCare\" on the Admin page when the list looks right.")
say("Undo: unschedule the two jobs and redeploy team-ask and hire-profile from main before this change; roster_axis_follow_rollback.sql drops the function (Claude can).")
done(0)
