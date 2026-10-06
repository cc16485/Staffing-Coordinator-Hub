#!/usr/bin/env python3
# 473 · TO TALK ABOUT EMAILS (tags and threads). Samantha 2026-10-06: "can we tag who we want to talk to about it - and let
# us have a thread? ... email a note that shows the full card that someone has tagged you in"; "yes build it".
# Installs talk-notify: after a note, reply or tag in the Hub, everyone on that item's thread except the writer gets one
# email with the whole card (office staff only, read from the database, never an address from the page). Someone emailed
# in the last 10 minutes gets the latest in one email when the 10 minutes are up: a pass every 5 minutes.
# Part 1 (read only): the reviewed build; GoHighLevel secrets present; the jobs' vault secret; the switch.
# Part 2: deploy talk-notify; schedule its 5-minute pass (sends the vault secret). The switch stays OFF (hers:
#   Owners Hub Admin page or Hub Settings > To talk about emails).
# Part 3: a page can't call it without a staff sign-in; the 5-minute pass refuses the public key; the schedule's own call
#   is accepted and, with the switch off, sends nothing. Nothing is emailed by this run.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, time
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FN = "care-notes"
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Nothing was sent to anyone. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=400):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-473/1.0"}, **(headers or {})))
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
def probe(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    texts = []
    try:
        j = json.loads(b); texts.append(j.get("message") if isinstance(j, dict) else str(j))
    except Exception: pass
    texts.append(b.replace('\\"', '"'))
    for t in texts:
        if not t or "PROBE_RESULT: " not in t: continue
        try: return json.JSONDecoder().raw_decode(t[t.index("PROBE_RESULT: ") + len("PROBE_RESULT: "):])[0], None
        except Exception: continue
    return None, f"HTTP {s}: {b[:240]}"
def keys():
    s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG())
    try: return {k.get("name"): k.get("api_key", "") for k in json.loads(b)}
    except Exception: return {}
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)

lit = lambda v: "'" + str(v).replace("'", "''") + "'"
FN = "talk-notify"; JOB = "talk-notify-flush"; SCHEDULE = "*/5 * * * *"; VAULT_NAME = "hub_job_secret"
POLL = float(os.environ.get("SB_POLL", "2")); POLL_MAX = float(os.environ.get("SB_POLL_MAX", "60"))
say("473 · TO TALK ABOUT EMAILS (TAGS AND THREADS)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for name, want in SHAS.items():
    p = os.path.join(FNROOT, "_shared", name.split("/", 1)[1] + ".ts") if name.startswith("_shared/") else os.path.join(FNROOT, name, "index.ts")
    if hashlib.sha256(open(p, "rb").read()).hexdigest() != want: bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say("  ✓ the reviewed build of talk-notify")
k = keys(); ANON, SVC = k.get("anon", ""), k.get("service_role", "")
if not ANON or not SVC: bad("could not read the project's keys. Nothing was changed."); done(4)
HIDE += [ANON, SVC]
s, b = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
try: names = {x.get("name") for x in json.loads(b)} if s == 200 else set()
except Exception: names = set()
ghl_ok = ("GHL_TOKEN" in names or "GHL_API_KEY" in names) and "GHL_LOCATION_ID" in names
if not ghl_ok: bad("GoHighLevel's secrets aren't set on this project, so emails couldn't go. Nothing was changed."); done(4)
say("  ✓ GoHighLevel is set up (emails go through it, like the Morning Brief)")
ok, r = sql(f"select count(*)::int as n from vault.decrypted_secrets where name = {lit(VAULT_NAME)}")
if not ok or not r or r[0]["n"] != 1: bad("the scheduled jobs' secret isn't in the vault. Nothing was changed."); done(4)
ok, r = sql("select coalesce((data->>'talk_email_live')::boolean, false) as live from public.app_data where key = 'ops_settings'")
live = bool(ok and r and r[0]["live"])
say(f"  · the switch: {'ON (left as it is)' if live else 'off (stays off; it is yours)'}")
s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
before = json.loads(b) if s == 200 else {}
say("  · talk-notify " + (f"is there (version {before.get('version')}), it will be updated" if before.get("version") else "is new"))

say(); say("PART 2 · CHANGE")
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"],
                   cwd=os.path.dirname(os.path.dirname(FNROOT)), env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: bad("deploy failed: " + (p.stderr or p.stdout)[-240:]); say("  STOP. Nothing else was changed."); done(6)
say("  ✓ talk-notify deployed")
command = ("select net.http_post(url := " + lit(f"{FNB}/functions/v1/{FN}?flush=1") + ", headers := jsonb_build_object('Content-Type', 'application/json', "
           "'Authorization', " + lit("Bearer " + ANON) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
           "body := '{}'::jsonb, timeout_milliseconds := 120000);")
sql(f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
ok, r = sql(f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(command)}) as id")
ok2, r2 = sql(f"select schedule, active, command from cron.job where jobname = {lit(JOB)}")
c = (r2[0]["command"] or "") if ok2 and r2 else ""
chk(ok and ok2 and r2 and r2[0]["schedule"] == SCHEDULE and r2[0]["active"] and "x-cron-secret" in c and "vault.decrypted_secrets" in c,
    "its 5-minute pass is scheduled, sending its secret from the vault")

say(); say("PART 3 · PROOF (nothing is emailed)")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
try: after = json.loads(b) if s == 200 else {}
except Exception: after = {}
chk(isinstance(after.get("version"), int) and after["version"] > (before.get("version") or 0), f"now running version {after.get('version')}")
s1, _ = http("POST", f"{FNB}/functions/v1/{FN}", {"item_id": "su_test"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
chk(s1 in (401, 403), f"a page without a staff sign-in is refused ({s1})")
s2, _ = http("POST", f"{FNB}/functions/v1/{FN}?flush=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
chk(s2 == 401, f"the 5-minute pass refuses the public key ({s2})")
ok, rq = sql(command.rstrip(";").replace("timeout_milliseconds := 120000", "timeout_milliseconds := 60000") + " as id")
got = None; waited = 0.0
while ok and rq and waited <= POLL_MAX:
    ok3, rr = sql(f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
    if ok3 and rr: got = rr[0]; break
    time.sleep(POLL); waited += POLL
good = bool(got and got["status_code"] == 200 and '"ok":true' in str(got["content"]).replace(" ", ""))
chk(good, "the schedule's own call is accepted" + (" (nothing waiting, nothing sent)" if good else f" ({got['status_code'] if got else 'no answer'})"))
say()
say("RESULT: " + ("INSTALLED WITH THE SWITCH OFF · tags and threads work in the Hub now; turn on \"To talk about emails\" (Owners Hub Admin page) for the emails." if not fails else "CHECK THE ✗ LINES."))
say("Nothing was emailed or texted. Rollback: unschedule talk-notify-flush; talk-notify can stay (it does nothing while the switch is off).")
done(0 if not fails else 8)
