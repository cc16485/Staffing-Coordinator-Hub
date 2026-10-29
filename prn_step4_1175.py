#!/usr/bin/env python3
# 1175 · STAFFING SERVER + TRAINING PLATFORM · PRN STEP 4: TEAM WELCOME (2026-10-29, Samantha: "continue to step 4"; her picks the
# same day: the welcome wording as shown, sent once they're linked in AxisCare, the identity line on both postings and the apply
# page, her video on the orientation home page for PRN hires only)
#  1. Checks first (nothing changes): both reviewed builds are GitHub's main; the tests pass (fake data and a throwaway Postgres
#     only); the welcome switch is off; her video is live on mo-care.com; each function's gateway setting is read, so it is kept.
#  2. Lets the PRN records keep the welcome text and the welcome call, and puts her line at the top of both PRN postings (only
#     where the posting still opens "Start PRN. Stay flexible.") (prn_welcome.sql, one transaction). The Training Platform learns
#     which caregivers are on a PRN Team, by their own link, for the video (prn-welcome-video.sql, one transaction). Deploys
#     prn-week (the welcome call line and its answers) and prn-welcome (new: the welcome text, off), and schedules prn-welcome
#     on weekdays at 16:00 UTC (10 or 11am Springfield), carrying the jobs' secret.
#  3. Proof (nothing is sent or saved): each function refuses outsiders and the schedule gets in; a practice run lists who would
#     be welcomed; both postings carry the line; the Training Platform answers for a link that isn't a PRN hire with nothing;
#     the switch is still off.
# Texts nobody. Safe to run again.
import json, os, subprocess, shutil, time
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, deploy, start, check_build, fmeta, MG, API, sql, lit

REF = "zngsgedlsxinbygwmxwn"; TREF = "rdqujxiycycwhskyvrwa"
FNROOT = L.FNROOT; ROOT = L.ROOT
TROOT = os.environ.get("SB_TRAINING_ROOT", "")
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
if NODE == "none": NODE = ""
PGLITE = os.environ.get("SB_PGLITE", "/Users/samantha/Claude/Projects/.pglite/node_modules/@electric-sql/pglite/dist/index.js")
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
TFNB = os.environ.get("SB_TRAINING_BASE", f"https://{TREF}.supabase.co")
VIDEO = os.environ.get("SB_VIDEO_URL", "https://mo-care.com/assets/video/welcome-to-the-prn-team")
FNS = ("prn-week", "prn-welcome"); SWITCH = "prn_welcome_live"
JOB = "prn-welcome"; SCHEDULE = os.environ.get("SB_SCHEDULE", "0 16 * * 1-5"); VAULT_NAME = "hub_job_secret"
POLL = float(os.environ.get("SB_POLL", "2")); POLL_MAX = float(os.environ.get("SB_POLL_MAX", "40"))
LINE = "Join our PRN Team. We stand in the gap so families never go without care."
ok = lambda s: say("  ✓ " + s)
def run(args, cwd=None, env=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True, env=env); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def keys(ref):
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{ref}/api-keys{q}", headers=MG())
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
def switch_on():
    okS, st = sql(REF, f"select data->'{SWITCH}' as v from public.app_data where key='ops_settings'")
    return None if not okS or not st else st[0].get("v") is True
def command(url, anon):
    return ("select net.http_post(url := " + lit(url) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
            "'Authorization', " + lit("Bearer " + anon) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
            "body := '{}'::jsonb, timeout_milliseconds := 60000);")
def jget(b, k):
    try: return json.loads(b).get(k)
    except Exception: return None

start("STAFFING SERVER + TRAINING PLATFORM · PRN STEP 4: TEAM WELCOME (switch OFF)")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
if not TROOT or not os.path.exists(os.path.join(TROOT, "supabase/prn-welcome-video.sql")): stop("the reviewed Training Platform build isn't here")
for root, files in ((ROOT, sorted({k for fn in FNS for k in L.need(FNROOT, fn)} | {"prn_welcome.sql"})), (TROOT, ["supabase/prn-welcome-video.sql"])):
    run(["git", "-C", root, "fetch", "-q", "origin", "main"])
    drift = [k for k in files if (lambda r: r[0] != 0 or r[1] != open(os.path.join(root, k)).read())(run(["git", "-C", root, "show", f"origin/main:{k}"]))]
    if drift: stop("this isn't the same as GitHub's main yet (merge the pull requests first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("both reviewed builds are what is on GitHub's main (the Hub's server and the Training Platform)")
if NODE and os.path.exists(PGLITE):
    env = dict(os.environ, PGLITE=PGLITE)
    for t, must, root in (("prn_welcome_test.mjs", "35/35", ROOT), ("prn_week_test.mjs", "52/52", ROOT), ("prn_familiar_test.mjs", "33/33", ROOT), ("prn_welcome_video_sql_test.mjs", "7/7", TROOT)):
        c, o = run([NODE, t], cwd=root, env=env)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    ok("the welcome, This week, familiar clients and video tests pass (fake data and a throwaway Postgres only)")
else: say("  · node or the throwaway Postgres is not on this Mac, so the tests were not re-run here (they passed when built)")
sw = switch_on()
if sw is None: stop("couldn't read the Hub's switches", 3)
if sw: stop(f"{SWITCH} is already on. Turn it off in the Hub first.")
ok(f"the new switch is off: {SWITCH}")
vs = [http("HEAD", VIDEO + ext)[0] for ext in (".mp4", "-poster.jpg", ".vtt")]
if any(s != 200 for s in vs): stop(f"her video isn't live on mo-care.com yet (the video, its cover and captions answered {vs}); merge the website pull request first")
ok("her welcome video, its cover and captions are live on mo-care.com")
meta = {}
for fn in FNS:
    s_, m_ = fmeta(REF, fn)
    if s_ == 404 and fn == "prn-welcome": meta[fn] = True; continue
    if s_ != 200 or not m_ or "verify_jwt" not in m_: stop(f"couldn't read how {fn} is set up live ({s_})", 3)
    meta[fn] = bool(m_["verify_jwt"])
ok("each function's gateway setting is read, so it is kept: " + ", ".join(f"{k} {'on' if v else 'off'}" for k, v in meta.items()))
okV, vr = sql(REF, f"select (select count(*) from vault.decrypted_secrets where name = {lit(VAULT_NAME)})::int as vault, (select count(*) from cron.job where jobname = {lit(JOB)})::int as job")
if not okV or not vr or vr[0]["vault"] != 1: stop("the jobs' secret isn't in the vault", 4)
ok("the jobs' secret is there · the welcome schedule is " + ("already there (an earlier run)" if vr[0]["job"] else "new"))
K = keys(REF); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); TK = keys(TREF); TANON = TK.get("anon", ""); L.HIDE += [ANON, SVC, TANON, TK.get("service_role", "")]
if not (ANON and SVC and TANON): stop("couldn't read the keys", 3)

say(); say("PART 2 · CHANGE")
okQ, r = sql(REF, "begin;\n" + open(os.path.join(ROOT, "prn_welcome.sql")).read() + "\ncommit;")
if not okQ: bad("the record change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
ok("the PRN records can now keep the welcome text and the welcome call; her line is at the top of the PRN postings")
okT, r = sql(TREF, "begin;\n" + open(os.path.join(TROOT, "supabase/prn-welcome-video.sql")).read() + "\ncommit;")
if not okT: bad("the Training Platform change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
ok("the Training Platform can tell a PRN hire's own link, for her video on the orientation home page")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, meta[fn]): say(f"  STOP at {fn}. Tell Claude. (The switch is off; nothing new sends.)"); done(6)
URL = f"{FNB}/functions/v1/prn-welcome"
sql(REF, f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
okC, _ = sql(REF, f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(command(URL, ANON))}) as id")
okJ, jb = sql(REF, f"select schedule, command from cron.job where jobname = {lit(JOB)}")
g = okC and okJ and jb and jb[0]["schedule"] == SCHEDULE and "x-cron-secret" in jb[0]["command"]
(ok if g else bad)("the welcome runs weekdays at 16:00 UTC (11am Springfield now, 10am in winter) · practice only until you turn it on")

say(); say("PART 3 · PROOF (nothing is sent or saved)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
A = {"apikey": ANON, "Authorization": "Bearer " + ANON}
a1 = http("POST", f"{FNB}/functions/v1/prn-week", {"action": "week"}, A)[0]
(ok if a1 in (401, 403) else bad)(f"prn-week refuses anyone not signed in to the office ({a1})")
a2 = http("POST", URL + "?auth_check=1", {}, A)[0]
(ok if a2 == 401 else bad)(f"the welcome refuses the public key ({a2})")
okR, rq = sql(REF, command(URL + "?auth_check=1", ANON).rstrip(";") + " as id")
got = None; waited = 0.0
while okR and rq and waited <= POLL_MAX:
    ok3, rr = sql(REF, f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
    if ok3 and rr: got = rr[0]; break
    time.sleep(POLL); waited += POLL
(ok if got and got["status_code"] == 200 and jget(got["content"], "caller") == "cron" else bad)("its weekday schedule gets in" + ("" if got else " (no answer)"))
sD, bD = http("POST", URL + "?dry=1", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 120)
try: j = json.loads(bD)
except Exception: j = {}
if sD == 200 and j.get("ok") and j.get("live") is False and not j.get("texted"):
    who = j.get("would_welcome") or []
    ok(f"a practice run: {len(who)} new PRN member(s) would get the welcome text, {j.get('no_phone', 0)} with no phone (nothing was sent)")
    for w in who[:10]: say(f"      {w}")
else: bad(f"the practice run answered {sD}: {str(bD)[:200]}")
okC2, cc = sql(REF, "select pg_get_constraintdef(oid) d from pg_constraint where conname = 'prn_touches_kind_check'")
(ok if okC2 and cc and "welcome_call" in cc[0]["d"] and "goback_unclear" in cc[0]["d"] else bad)("the welcome kinds are allowed on the PRN records (and the go-back ones still are)")
okP, pp = sql(REF, "select slug, position(" + lit(LINE) + " in description) > 0 as has from public.job_postings where slug in ('prn-cna-springfield', 'prn-caregiver-springfield') order by slug")
for row in (pp or []): (ok if row["has"] else bad)(f"{row['slug']}: her line is in the posting" + ("" if row["has"] else " (it was edited in the Hub, so it was left alone; add the line there)"))
if okP and not pp: bad("couldn't find the two PRN postings")
sT, bT = http("POST", f"{TFNB}/rest/v1/rpc/get_my_prn_team", {"p_token": "not-a-real-link-1175-check"}, {"apikey": TANON, "Authorization": "Bearer " + TANON, "Content-Type": "application/json"})
(ok if sT == 200 and bT.strip() == "null" else bad)(f"the Training Platform answers a link that isn't a PRN hire with nothing ({sT})")
(ok if switch_on() is False else bad)("the switch is still off")
say()
say("  1175: " + ("DONE. PRN step 4 is on the server with the welcome switch OFF. The job pages pick up her line within the hour. Next: "
    "Claude merges the Hub pull request, then the welcome call and the Settings wording show in the Hub."
    if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
