#!/usr/bin/env python3
# 645 · THE NOT HIRING MESSAGE GOES THE NEXT MORNING (Samantha 2026-10-13: "make the decline text send to the applicant
# hours after the interview so it looks like we thought about it, or have it send next day").
#   1. decline_next_day_645.sql: two columns on job_applicants (when the booked message goes; why one could not go). Adds only.
#   2. Deploys applicant-decision-msg: OK on "Not hiring" books the message for 10am Central the next day; "Send it now"
#      and "Don't send it" on their profile; the candidate pool message is unchanged.
#   3. Schedules applicant-decision-due: every hour at :07 it sends the booked ones that are due, only if they are still
#      marked Not hiring, 8am to 6pm, carrying the jobs' secret from the vault.
# Replaced only when the live copy is main's build or an older version of it. Nothing is sent by this step.
# Prints counts only: no name, number, email, key or secret.
import os, json, subprocess, hashlib
os.environ.setdefault("SB_STEP", "645")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FN = "applicant-decision-msg"; JOB = "applicant-decision-due"; SCHEDULE = "7 * * * *"; VAULT = "hub_job_secret"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
_HIST = {}
def in_history(rel, live_sha):
    if not live_sha: return False
    if rel not in _HIST:
        shas = set()
        try:
            for c in subprocess.run(["git", "-C", ROOT, "log", "--format=%H", "--", rel], capture_output=True, text=True, timeout=120).stdout.split():
                b = subprocess.run(["git", "-C", ROOT, "show", f"{c}:{rel}"], capture_output=True, timeout=60).stdout
                if b: shas.add(hashlib.sha256(b).hexdigest())
        except Exception: pass
        _HIST[rel] = shas
    return live_sha in _HIST[rel]
def anon_key():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_publishable_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        for k in arr:
            if isinstance(k, dict) and k.get("name") == "anon" and usable(k.get("api_key")): return k["api_key"]
    return ""
def command(url, anon):
    return ("select net.http_post(url := " + lit(url) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
            "'Authorization', " + lit("Bearer " + anon) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT) + ")), "
            "body := '{}'::jsonb, timeout_milliseconds := 120000);")
def jget(b, k):
    try: return json.loads(b).get(k)
    except Exception: return None

start("THE NOT HIRING MESSAGE GOES THE NEXT MORNING")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
ANON = anon_key(); HIDE.append(ANON)
if not ANON: bad("could not read the project's public key (the schedule needs it)")
ok, r = sql(REF, f"""select (select count(*)::int from vault.decrypted_secrets where name = {lit(VAULT)}) as vault,
  (select count(*)::int from pg_extension where extname in ('pg_cron','pg_net')) as ext,
  (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'job_applicants' and column_name in ('decision_msg_due_at','decision_msg_problem')) as cols,
  (select count(*)::int from public.job_applicants where decision_msg_held_at is not null) as held""")
if not ok: bad("could not read the project: " + str(r)); done(3)
x = r[0]
say(("  ✓ " if x["vault"] == 1 else "  ✗ ") + "the jobs' secret is in the vault"); 
if x["vault"] != 1: fails.append("vault")
say(("  ✓ " if x["ext"] == 2 else "  ✗ ") + "scheduling is switched on (pg_cron, pg_net)")
if x["ext"] != 2: fails.append("ext")
say(f"  · the two new columns: {'already there' if x['cols'] == 2 else 'not there yet (they will be added)'}")
say(f"  · messages waiting today for texting hours (unchanged by this step): {x['held']}")
sx, mx = fmeta(REF, FN); VJ = None
if sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool):
    VJ = mx["verify_jwt"]; okl, livef = live_files(REF, FN)
    differ = [k for k in need(FNROOT, FN) if livef.get(k) != sha(os.path.join(ROOT, k))] if okl else []
    unknown = [k for k in differ if livef.get(k) is not None and not in_history(k, livef.get(k))]
    if not okl: bad(f"could not read {FN}'s live files")
    elif unknown: bad(f"{FN}'s live copy holds {', '.join(unknown[:3])} in a version that was never on main (someone's unmerged work). Tell Claude.")
    else: say(f"  ✓ {FN} is live at version {mx.get('version', '?')}" + (f": will be brought up to this build ({', '.join(k.split('/')[-1] for k in differ[:4])})" if differ else ": already this build"))
else: bad(f"{FN} is not live or unreadable: {sx}")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
ok, r = sql(REF, open(os.path.join(ROOT, "decline_next_day_645.sql")).read())
if not ok: bad("the two columns did not go in (nothing changed): " + str(r)); done(6)
say("  ✓ applicants can carry a booked message and why one could not go")
if not deploy(REF, FNROOT, FN, VJ): say("  RESULT: the columns are in, but the message service did not deploy. Tell Claude."); done(6)
URL = f"{FNB}/functions/v1/{FN}?due=1"
sql(REF, f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
ok, r = sql(REF, f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(command(URL, ANON))}) as id")
ok2, jb = sql(REF, f"select schedule, command from cron.job where jobname = {lit(JOB)}")
if ok and ok2 and jb and jb[0]["schedule"] == SCHEDULE and "x-cron-secret" in jb[0]["command"] and "?due=1" in jb[0]["command"]:
    say("  ✓ the next-morning send is scheduled: every hour at :07 (it only sends 8am to 6pm), carrying the jobs' secret")
else: bad("the schedule did not go in: " + str(r)[:200]); done(6)

say(); say("PART 3 · PROOF (nothing is sent)")
okl, livef = live_files(REF, FN)
say(f"  ✓ {FN}: the live copy is exactly this build") if okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need(FNROOT, FN)) else bad(f"{FN}'s live copy is not this build")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
A = {"apikey": ANON, "Authorization": "Bearer " + ANON}
DU = f"{FNB}/functions/v1/{FN}"
d1 = http("POST", DU, {"action": "send", "id": "00000000-0000-0000-0000-000000000000", "kind": "declined"}, A)[0]
d2 = http("POST", DU + "?due=1", {}, A)[0]; d3 = http("POST", DU + "?due=1&dry=1", {}, A)[0]
if d1 in (401, 403) and d2 == 401 and d3 == 401: say(f"  ✓ the public key gets nothing (send {d1}, the run {d2}, a counts-only look {d3})")
else: bad(f"something answered the public key (send {d1}, the run {d2}, counts-only {d3})")
c1 = http("OPTIONS", DU, None, {"Origin": "https://cc.mo-care.com", "Access-Control-Request-Method": "POST"})[0]
say(f"  ✓ the Hub can reach it ({c1})") if c1 == 200 else bad(f"the Hub cannot reach it ({c1})")
ok, rq = sql(REF, command(URL + "&auth_check=1", ANON).rstrip(";") + " as id")
got = None; waited = 0.0
while ok and rq and waited <= 40:
    ok3, rr = sql(REF, f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
    if ok3 and rr: got = rr[0]; break
    time.sleep(2); waited += 2
if got and got["status_code"] == 200 and jget(got["content"], "caller") == "cron": say("  ✓ its schedule gets in (checked who is calling only, nothing sent)")
else: bad("its schedule did not get in" + (f" ({got['status_code']})" if got else " (no answer)"))
SK = ""
s_, b_ = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG())
try:
    for k in (json.loads(b_) if s_ == 200 else []):
        if isinstance(k, dict) and k.get("name") == "service_role" and str(k.get("api_key", "")).startswith("eyJ"): SK = k["api_key"]
except Exception: pass
HIDE.append(SK)
if SK:
    s4, b4 = http("POST", DU + "?due=1&dry=1", {}, {"apikey": SK, "Authorization": "Bearer " + SK})
    if s4 == 200 and jget(b4, "ok"):
        j = json.loads(b4)
        say(f"  ✓ counts-only look: {j.get('due', 0)} booked and due now" if "due" in j else "  ✓ counts-only look: " + str(j.get("waiting", "")))
    else: bad(f"the counts-only look failed ({s4})")
say("  · tested before deploying: next morning in Central time (incl. the clock change), OK books it, Send it now, Don't send it,")
say("    the hourly run (due only, still Not hiring only, 8am to 6pm, once), a refused message shows on the profile, outsiders refused.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · OK on Not hiring now books the message for 10am the next morning. Nothing was sent by this step."); done(0)
