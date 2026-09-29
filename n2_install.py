#!/usr/bin/env python3
# N2 · FLAG CONCERNING SHIFT NOTES (Desktop 337 = install with the switch OFF + practice run; Desktop 338 = switch ON).
#   337: installs the care-notes build that can flag, schedules it every two hours (it sends its secret from the vault),
#        leaves the switch OFF (so each scheduled run does nothing), proves the schedule's call is accepted, and runs a
#        PRACTICE over the last day: it reads the shifts, asks the AI, and reports COUNTS ONLY. Nothing saved or sent.
#   338 (SB_N2_STEP=on): turns the switch on (ops_settings.care_notes_flag_live = true) and reads it back. From the
#        next scheduled run, a flagged note becomes a Needs Attention item showing the caregiver's words.
# Never contacts anyone. No note's words, name or number is printed.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, time
REPORT = os.environ["SB_REPORT"]; STEP = os.environ.get("SB_N2_STEP", "install")
FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
POLL = float(os.environ.get("SB_POLL", "2")); POLL_MAX = float(os.environ.get("SB_POLL_MAX", "60"))
FN = "care-notes"; JOB = "care-notes-flag"; SCHEDULE = "15 */2 * * *"; VAULT_NAME = "hub_job_secret"
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Nothing was sent to anyone.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=400):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-n2/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, b[:200]
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def lit(v): return "'" + str(v).replace("'", "''") + "'"
def keys():
    s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
    try: return {k.get("name"): k.get("api_key", "") for k in json.loads(b)}
    except Exception: return {}
def flag_now():
    ok, r = sql("select coalesce((data->>'care_notes_flag_live')::boolean, false) as live from app_data where key = 'ops_settings'")
    return (r[0]["live"] if ok and r else None)
fmt = lambda d: ", ".join(f"{k} {v}" for k, v in sorted((d or {}).items(), key=lambda x: -x[1])) or "none"

k = keys(); ANON, SVC = k.get("anon", ""), k.get("service_role", "")
if not ANON or not SVC: say("✗ could not read the project's keys. Nothing was changed."); done(4)
HIDE += [ANON, SVC]

if STEP == "on":
    say("N2 · FLAG CONCERNING SHIFT NOTES · SWITCH ON"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
    ok, r = sql(f"select count(*)::int as n from cron.job where jobname = {lit(JOB)} and active")
    if not ok or not r or r[0]["n"] != 1: bad("the every-two-hours schedule isn't installed (run 337 first). Nothing was changed."); done(4)
    ok, _ = sql("""update app_data set data = jsonb_set(coalesce(data, '{}'::jsonb), '{care_notes_flag_live}', 'true'::jsonb)
                   where key = 'ops_settings' and jsonb_typeof(data) = 'object'""")
    live = flag_now()
    (say if live is True else bad)(("  ✓ " if live is True else "") + "the switch is ON: from the next run (quarter past every other hour), a concerning shift note becomes a Needs Attention item")
    say(); say("RESULT: " + ("ON · to turn it off, tell Claude (a one-line step sets the switch back)." if not fails else "CHECK THE ✗ LINES."))
    done(0 if not fails else 7)

say("N2 · FLAG CONCERNING SHIFT NOTES · INSTALL (SWITCH OFF) AND PRACTICE"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
for name, want in SHAS.items():
    p = os.path.join(FNROOT, "_shared", "job-auth.ts") if name == "_shared/job-auth" else os.path.join(FNROOT, name, "index.ts")
    if hashlib.sha256(open(p, "rb").read()).hexdigest() != want: bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say("  ✓ the reviewed builds")
s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
try: vj = json.loads(b).get("verify_jwt") if s == 200 else None
except Exception: vj = None
if not isinstance(vj, bool): bad("could not read care-notes' setting. Nothing was changed."); done(4)
ok, r = sql(f"select count(*)::int as n from vault.decrypted_secrets where name = {lit(VAULT_NAME)}")
if not ok or not r or r[0]["n"] != 1: bad("the scheduled jobs' secret isn't in the vault (S3 / Desktop 329). Nothing was changed."); done(4)
live = flag_now()
say(f"  ✓ care-notes' gateway setting read and kept · the jobs' vault secret is there · the switch is {'ON (it will stay as it is)' if live else 'off'}")

say(); say("PART 2 · CHANGE")
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"] + ([] if vj else ["--no-verify-jwt"]),
                   cwd=os.path.dirname(os.path.dirname(FNROOT)), env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: bad("deploy failed: " + (p.stderr or p.stdout)[-240:]); done(6)
say("  ✓ care-notes deployed")
command = ("select net.http_post(url := " + lit(f"{FNB}/functions/v1/{FN}?flag=1") + ", headers := jsonb_build_object('Content-Type', 'application/json', "
           "'Authorization', " + lit("Bearer " + ANON) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
           "body := '{}'::jsonb, timeout_milliseconds := 300000);")
ok, r = sql(f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(command)}) as id")
ok2, r2 = sql(f"select schedule, active, command from cron.job where jobname = {lit(JOB)}")
c = (r2[0]["command"] or "") if ok2 and r2 else ""
good = ok and ok2 and r2 and r2[0]["schedule"] == SCHEDULE and r2[0]["active"] and "x-cron-secret" in c and "vault.decrypted_secrets" in c
(say if good else bad)(("  ✓ " if good else "") + "scheduled at quarter past every other hour, sending its secret from the vault")

say(); say("PART 3 · CHECK AND THE PRACTICE RUN (nothing saved or sent)")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
s1, _ = http("POST", f"{FNB}/functions/v1/{FN}?flag=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
(say if s1 == 401 else bad)(("  ✓ " if s1 == 401 else "") + f"the public key → refused ({s1})")
if not live:
    ok, rq = sql("select net.http_post(url := " + lit(f"{FNB}/functions/v1/{FN}?flag=1") + ", headers := jsonb_build_object('Content-Type', 'application/json', "
                 "'Authorization', " + lit("Bearer " + ANON) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), body := '{}'::jsonb) as id")
    got = None; waited = 0.0
    while ok and rq and waited <= POLL_MAX:
        ok3, rr = sql(f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
        if ok3 and rr: got = rr[0]; break
        time.sleep(POLL); waited += POLL
    offok = bool(got and got["status_code"] == 200 and '"off":true' in str(got["content"]).replace(" ", ""))
    (say if offok else bad)(("  ✓ " if offok else "") + "the schedule's own call is accepted, and with the switch off it does nothing" + ("" if offok else f" ({got['status_code'] if got else 'no answer'})"))
say("  running the practice over the last day (this can take a couple of minutes)…")
s2, b2 = http("POST", f"{FNB}/functions/v1/{FN}?flag=1&practice=1&hours=24", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
try: j = json.loads(b2)
except Exception: j = None
if s2 != 200 or not isinstance(j, dict) or j.get("error"): bad(f"the practice run did not answer ({s2}): " + str((j or {}).get("error") if isinstance(j, dict) else b2)[:160])
else:
    say(f"  ✓ practice, last {j['window_hours']} hours: {j['visits_finished']} shifts finished · {j['days_with_words']} caregiver-client-days with words to read")
    say(f"    the AI read {j['asked']}: would flag {j['flagged']} ({j['urgent']} urgent) · could not read {j['ai_could_not_read']} (those are flagged for a person)")
    say(f"    by kind: {fmt(j.get('by_kind'))}" + (" · AxisCare asked us to slow down, so some weren't read" if j.get("stopped_early") else ""))
say()
say("RESULT: " + ("INSTALLED WITH THE SWITCH OFF · nothing is flagged or sent until you run 338." if not fails else "CHECK THE ✗ LINES."))
say("No note's words, name or number was printed. Rollback: unschedule care-notes-flag; care-notes from the commit before this one.")
done(0 if not fails else 8)
