#!/usr/bin/env python3
# 1141 · STAFFING SERVER · FRIENDS & FAMILY INVITE CHECK (Samantha 2026-10-27: "Yes, use this definition for the invitation check,
# including the 30-day wait after serious issues. Continue building step 3 with the switch off.")
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only); the jobs' secret
#     and the AxisCare key are there.
#  2. ff_invites_1141.sql (the daily list ff_invite_runs, the switch ff_invites_live added OFF); deploys ff-invite-check (new);
#     schedules it once a day (9:20 AM Central in winter, 10:20 in summer).
#  3. Proves it: the public key gets nothing, the schedule gets in, the public can't read the list. Then today's real list:
#     who would be invited, who is waiting and until when, who is held and why.
# Texts and emails nobody. Nothing is sent even with the switch on (sending comes with step 4). Safe to run again.
import json, os, subprocess, shutil, time, hashlib
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, lit, MG, API

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
if NODE == "none": NODE = ""
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
JOB = FN = "ff-invite-check"; SCHEDULE = "20 15 * * *"; VAULT_NAME = "hub_job_secret"; SQLF = "ff_invites_1141.sql"
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

start("STAFFING SERVER · FRIENDS & FAMILY INVITE CHECK (lists only, switch OFF)")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
sqh = hashlib.sha256(open(os.path.join(ROOT, SQLF), "rb").read()).hexdigest()
if sqh != os.environ.get("SB_SQL_SHA", ""): stop("the database change is not the reviewed build")
ok("the database change is the reviewed build")
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = []
for k in sorted(L.need(FNROOT, FN) | {SQLF}):
    c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
    if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE:
    for t, must in (("ff_invite_check_test.mjs", "54/54"), ("audience_guard_test.mjs", "21/21"), ("campaign_auto_hold_test.mjs", "8/8")):
        c, o = run([NODE, t], cwd=ROOT)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "✗" in l)[:240])
    ok("the invite check and campaign guard tests pass (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
s, b = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
try: names = {x.get("name") for x in json.loads(b)} if s == 200 else set()
except Exception: names = set()
if "HUB_JOB_SECRET" not in names or not ({"AXISCARE_TOKEN", "AXISCARE_API_KEY", "AXISCARE_VISITS_TOKEN"} & names) or not ({"AXISCARE_SITE", "AXISCARE_SITE_NUMBER"} & names):
    stop("the jobs' secret or the AxisCare key isn't there", 4)
okv, v = sql(REF, f"select count(*)::int as n from vault.decrypted_secrets where name = {lit(VAULT_NAME)}")
if not okv or not v or v[0]["n"] != 1: stop("the jobs' secret isn't in the database vault", 4)
ok("the jobs' secret and the AxisCare key are there")
K = keys(); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); L.HIDE += [ANON, SVC]
if not ANON or not SVC: stop("couldn't read the Hub's keys", 3)

say(); say("PART 2 · CHANGE")
okq, r = sql(REF, "begin;\n" + open(os.path.join(ROOT, SQLF)).read() + "\ncommit;")
if not okq: bad("the database change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
okq, r = sql(REF, "select data->>'ff_invites_live' as live from app_data where key = 'ops_settings'")
live = bool(r and r[0]["live"] == "true")
ok("the daily list (ff_invite_runs) is in place · the switch is " + ("ON" if live else "OFF"))
if not deploy(REF, FNROOT, FN, True): say(f"  STOP at {FN}. Tell Claude."); done(6)
URL = f"{FNB}/functions/v1/{JOB}"
sql(REF, f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
okq, r = sql(REF, f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(command(URL, ANON))}) as id")
ok2, jb = sql(REF, f"select schedule, command from cron.job where jobname = {lit(JOB)}")
chk(okq and ok2 and jb and jb[0]["schedule"] == SCHEDULE and "x-cron-secret" in jb[0]["command"], "its schedule: once a day, 9:20 AM Central (10:20 in summer), carrying the jobs' secret from the vault", "the schedule didn't go in: " + str(r)[:200])

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
sC, bC = http("GET", f"{FNB}/rest/v1/ff_invite_runs?select=run_day&limit=1", None, {"apikey": ANON, "Authorization": "Bearer " + ANON})
chk(sC != 200 or bC.strip() in ("[]", ""), f"the public can't read the list ({sC})")
say(); say("  Today's first run (this takes a minute: it reads AxisCare)...")
sD, bD = http("POST", URL, {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 300)
try: j = json.loads(bD)
except Exception: j = {}
chk(sD == 200 and j.get("sent") == 0 and j.get("saved") is True, "it ran, saved today's list, and sent nothing", f"the first run answered {sD}: {str(bD)[:200]}")
for p in j.get("problems") or []: bad("couldn't read: " + str(p))
rows = j.get("rows") or []; sm = j.get("summary") or {}
if sm:
    c, f = sm.get("caregivers") or {}, sm.get("families") or {}
    say(); say("  TODAY'S LIST (who would get an invitation if it were on)")
    say(f"  Caregivers: {c.get('ready', 0)} ready · {c.get('waiting', 0)} waiting · {c.get('held', 0)} held")
    say(f"  Family members: {f.get('ready', 0)} ready · {f.get('waiting', 0)} waiting · {f.get('held', 0)} held")
    say(f"  Clients with no family email on file: {sm.get('clients_without_family_email', 0)}")
    ni = sm.get("not_invited_by_payer") or {}
    if ni: say("  Clients never invited because of their payer: " + ", ".join(f"{k} {n}" for k, n in sorted(ni.items())))
    def block(title, pick):
        sel = [x for x in rows if pick(x)]
        if not sel: return
        say(); say(f"  {title} ({len(sel)})")
        for x in sorted(sel, key=lambda x: (x.get("kind") != "caregiver", x.get("client") or "", x.get("name") or "")):
            who = x.get("name", "") + (f" (for {x['client']})" if x.get("kind") == "family" else "")
            how = (" · " + " and ".join(x.get("channels") or [])) if x.get("status") == "ready" else ""
            why = ("; ".join(x.get("why") or []))
            say(f"    {'Caregiver' if x.get('kind') == 'caregiver' else 'Family' if x.get('kind') == 'family' else 'Client'}: {who}{how}" + (f" · {why}" if why else "") + (f" · {x['note']}" if x.get("note") else ""))
    block("READY", lambda x: x.get("status") == "ready")
    block("HELD", lambda x: x.get("status") == "held")
    block("WAITING", lambda x: x.get("status") == "waiting")
say()
say("  1141: " + ("DONE. The Friends & Family check now runs every morning and keeps the day's list for 30 days. Nobody was texted or emailed, and the switch is " + ("ON (still nothing is sent until step 4)." if live else "OFF.") if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
say("  Rollback: Claude unschedules ff-invite-check. It only ever makes a list.")
done(0 if not L.fails else 1)
