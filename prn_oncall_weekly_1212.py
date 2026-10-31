#!/usr/bin/env python3
# 1212 · STAFFING SERVER · PRN ON CALL, EVERY WEEK (2026-10-30, Samantha: "Yes to all 7 recommendations. Build recurring
# on-call sign-up.")
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data and a throwaway Postgres
#     only); each function's gateway setting is read, so it is kept; the jobs' secret is in the vault.
#  2. Adds the every-week records (prn_oncall_weekly.sql, one transaction). Deploys prn-week (confirm an every-week shift once,
#     "They called to stop it", a miss ends it, the fill) and prn-page (Just this one or Every week, the list on their page and
#     under My hours). Schedules prn-oncall-fill every day at 11:20 UTC (6:20am Springfield now, 5:20am in winter): it adds the
#     next weeks of every confirmed every-week shift.
#  3. Proof (nothing is sent; the fill only adds weeks to confirmed every-week shifts, and there are none yet): each refuses
#     outsiders and forged links; the schedule gets in and the public key doesn't; the records are in.
# Texts nobody. The on-call switches are left exactly as they are. Safe to run again.
import json, os, subprocess, shutil, time
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, deploy, start, check_build, fmeta, MG, API, sql, lit

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
if NODE == "none": NODE = ""
PGLITE = os.environ.get("SB_PGLITE", "/Users/samantha/Claude/Projects/.pglite/node_modules/@electric-sql/pglite/dist/index.js")
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FNS = ("prn-week", "prn-page"); SWITCHES = ("prn_oncall_signup_live", "prn_oncall_first_live")
VAULT_NAME = "hub_job_secret"; JOB = "prn-oncall-fill"; SCHEDULE = os.environ.get("SB_SCHEDULE", "20 11 * * *")
POLL = float(os.environ.get("SB_POLL", "2")); POLL_MAX = float(os.environ.get("SB_POLL_MAX", "40"))
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
def switches_on():
    okS, st = sql(REF, "select " + ", ".join(f"data->'{k}' as {k}" for k in SWITCHES) + " from public.app_data where key='ops_settings'")
    return None if not okS or not st else [k for k in SWITCHES if st[0].get(k) is True]
def command(url, anon):
    return ("select net.http_post(url := " + lit(url) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
            "'Authorization', " + lit("Bearer " + anon) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
            "body := '{}'::jsonb, timeout_milliseconds := 60000);")
def via_cron(url, anon):
    okR, rq = sql(REF, command(url, anon).rstrip(";") + " as id")
    waited = 0.0
    while okR and rq and waited <= POLL_MAX:
        ok3, rr = sql(REF, f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
        if ok3 and rr: return rr[0]
        time.sleep(POLL); waited += POLL
    return None
def jparse(b):
    try: return json.loads(b)
    except Exception: return {}

start("STAFFING SERVER · PRN ON CALL, EVERY WEEK")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")   # the rehearsal compares with its own commit
if MAIN == "origin/main": run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = [k for k in sorted({k for fn in FNS for k in L.need(FNROOT, fn)} | {"prn_oncall_weekly.sql"})
         if (lambda r: r[0] != 0 or r[1] != open(os.path.join(ROOT, k)).read())(run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"]))]
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE and os.path.exists(PGLITE):
    env = dict(os.environ, PGLITE=PGLITE)
    for t, must in (("prn_oncall_weekly_test.mjs", "48/48"), ("prn_oncall_calendar_test.mjs", "73/73"), ("prn_oncall_shift_test.mjs", "12/12"), ("prn_page_test.mjs", "43/43"),
                    ("prn_week_test.mjs", "52/52"), ("prn_open_shifts_test.mjs", "66/66"), ("prn_mentor_test.mjs", "57/57"), ("prn_more_hours_test.mjs", "12/12")):
        c, o = run([NODE, t], cwd=ROOT, env=env)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    ok("the every-week, on-call calendar, on-call shift, PRN Team page, This week, open shift, Field Support and more-hours tests pass (fake data and a throwaway Postgres only)")
else: say("  · node or the throwaway Postgres is not on this Mac, so the tests were not re-run here (they passed when built)")
on = switches_on()
if on is None: stop("couldn't read the Hub's switches", 3)
ok("the on-call switches are left as they are: " + (", ".join(on) + " ON (members see Every week as soon as this finishes)" if on else "both off (members see nothing new yet)"))
meta = {}
for fn in FNS:
    s_, m_ = fmeta(REF, fn)
    if s_ != 200 or not m_ or "verify_jwt" not in m_: stop(f"couldn't read how {fn} is set up live ({s_})", 3)
    meta[fn] = bool(m_["verify_jwt"])
ok("each function's gateway setting is read, so it is kept: " + ", ".join(f"{k} {'on' if v else 'off'}" for k, v in meta.items()))
okV, vr = sql(REF, f"select (select count(*) from vault.decrypted_secrets where name = {lit(VAULT_NAME)})::int as vault, (select count(*) from cron.job where jobname = {lit(JOB)})::int as job")
if not okV or not vr or vr[0]["vault"] != 1: stop("the jobs' secret isn't in the vault", 4)
ok("the jobs' secret is there · the daily fill schedule is " + ("already there (an earlier run)" if vr[0]["job"] else "new"))
K = keys(); ANON = K.get("anon", ""); L.HIDE += [ANON, K.get("service_role", "")]
if not ANON: stop("couldn't read the Hub's keys", 3)

say(); say("PART 2 · CHANGE")
okQ, r = sql(REF, "begin;\n" + open(os.path.join(ROOT, "prn_oncall_weekly.sql")).read() + "\ncommit;")
if not okQ: bad("the record change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
ok("the every-week records are in: each every-week shift, and which on-call weeks belong to one")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, meta[fn]): say(f"  STOP at {fn}. Tell Claude. (On call works as before.)"); done(6)
URL = f"{FNB}/functions/v1/prn-week?fill=1"
sql(REF, f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
okC, _ = sql(REF, f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(command(URL, ANON))}) as id")
okJ, jb = sql(REF, f"select schedule, command from cron.job where jobname = {lit(JOB)}")
g = okC and okJ and jb and jb[0]["schedule"] == SCHEDULE and "x-cron-secret" in jb[0]["command"]
(ok if g else bad)("the daily fill runs every day at 11:20 UTC (6:20am Springfield now, 5:20am in winter)")

say(); say("PART 3 · PROOF (nothing is sent)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
A = {"apikey": ANON, "Authorization": "Bearer " + ANON}
s1 = http("POST", f"{FNB}/functions/v1/prn-week", {"action": "oncall_series_end", "series_id": 1}, A)[0]
(ok if s1 in (401, 403) else bad)(f"prn-week refuses anyone not signed in to the office ({s1})")
s2 = http("POST", URL, {}, A)[0]
(ok if s2 == 401 else bad)(f"the daily fill refuses the public key ({s2})")
s3, b3 = http("POST", f"{FNB}/functions/v1/prn-page", {"action": "oncall_ask", "p": "00000000-0000-4000-8000-000000000000", "e": 4102444800, "t": "x" * 43, "slots": [{"date": "2030-01-05", "slot": "day", "weekly": True}]}, A)
(ok if s3 == 401 else bad)(f"the page refuses a forged link ({s3})")
got = via_cron(f"{FNB}/functions/v1/prn-week?auth_check=1", ANON)
(ok if got and got["status_code"] == 200 and jparse(got["content"]).get("caller") == "cron" else bad)("its daily schedule gets in" + ("" if got else " (no answer)"))
okN, nn = sql(REF, "select count(*)::int n from public.prn_oncall_series where status = 'confirmed'")
fill = via_cron(URL, ANON)
fj = jparse(fill["content"]) if fill else {}
(ok if fill and fill["status_code"] == 200 and fj.get("ok") is True else bad)(
  "a fill run now: " + (f"{fj.get('added', 0)} week(s) added, {fj.get('skipped', 0)} skipped (someone else holds them)" if fj.get("ok") else str(fill and fill.get("content"))[:200])
  + (f" · {nn[0]['n']} confirmed every-week shift(s) so far" if okN and nn else ""))
okC2, cc = sql(REF, "select (select count(*) from information_schema.tables where table_schema='public' and table_name='prn_oncall_series')::int t, "
                    "(select count(*) from information_schema.columns where table_schema='public' and table_name='prn_oncall' and column_name='series_id')::int c, "
                    "(select count(*) from pg_indexes where indexname='prn_oncall_series_one_live')::int i, "
                    "has_table_privilege('anon', 'public.prn_oncall_series', 'select') as a")
(ok if okC2 and cc and cc[0]["t"] == 1 and cc[0]["c"] == 1 and cc[0]["i"] == 1 and cc[0]["a"] is False else bad)(
  "the every-week records are in, one live every-week shift per person, weekday and shift; the public can't read them" + ("" if okC2 and cc else " (couldn't read them)"))
(ok if switches_on() == on else bad)("the on-call switches are as they were")
say()
say("  1212: " + ("DONE. Every-week on call is on the server. Next: Claude merges the Hub pull request, then the office sees "
    "Every week on the On call calendar, and PRN CNAs see Just this one or Every week on their page once on-call sign-up is on."
    if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
