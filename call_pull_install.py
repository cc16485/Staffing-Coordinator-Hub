#!/usr/bin/env python3
# 372 · CALLS REACH THE HUB BY THEMSELVES. Samantha approved 2026-09-30 ("yes to all": start from now, practice a day, turn
#   the GHL workflow off). Part 1 (read only): reviewed builds; secrets there. Part 2: call_pull.sql; deploy call-followup
#   (practice option) + call-pull (new); every-10-minutes schedule. Part 3: refusals, the schedule gets in, one practice run.
# Prints counts only: no name, number, email, key or secret.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, time, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPO = os.path.dirname(os.path.dirname(FNROOT))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
POLL = float(os.environ.get("SB_POLL", "2")); POLL_MAX = float(os.environ.get("SB_POLL_MAX", "40"))
VAULT_NAME = "hub_job_secret"; JOB = "call-pull"; SCHEDULE = "*/10 * * * *"
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE:
        if v: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=150):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-372/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def lit(v): return "'" + str(v).replace("'", "''") + "'"
def fmeta(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
def jget(b, k):
    try: return json.loads(b).get(k)
    except Exception: return None
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
def src_path(name):
    if name.startswith("_shared/"): return os.path.join(FNROOT, name + ".ts")
    if name.endswith((".sql", ".json")): return os.path.join(REPO, name)
    return os.path.join(FNROOT, name, "index.ts")
def command(url, anon):
    return ("select net.http_post(url := " + lit(url) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
            "'Authorization', " + lit("Bearer " + anon) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
            "body := '{}'::jsonb, timeout_milliseconds := 120000);")

say("372 · CALLS REACH THE HUB BY THEMSELVES"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
for name, want in SHAS.items():
    if sha(src_path(name)) != want: bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
if not {"call-pull", "call-followup", "_shared/job-auth", "call_pull.sql"} <= set(SHAS): bad("the reviewed list is incomplete"); done(2)
say("  ✓ the new call fetcher, the call reader, the key check and the record are the reviewed builds")
ok, st = sql("""select (select count(*) from vault.decrypted_secrets where name = """ + lit(VAULT_NAME) + """)::int as vault""")
s, b = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
try: names = {x.get("name") for x in json.loads(b)} if s == 200 else set()
except Exception: names = set()
need = {"HUB_JOB_SECRET", "CALL_FOLLOWUP_TOKEN", "ANTHROPIC_API_KEY", "GHL_LOCATION_ID"}
if not ok or not st or st[0]["vault"] != 1 or not need <= names or not ({"GHL_TOKEN", "GHL_API_KEY"} & names):
    bad("a needed secret isn't there (" + ", ".join(sorted((need | {"GHL_TOKEN"}) - names)) + "). Nothing was changed."); done(4)
sR, mR = fmeta("call-followup")
if sR != 200 or (mR or {}).get("verify_jwt") is not False: bad("the call reader isn't deployed as expected. Nothing was changed."); done(4)
say("  ✓ the jobs' secret, the call reader's code, the AI key and the GoHighLevel key are there")

say(); say("PART 2 · CHANGE")
ok, r = sql("begin;\n" + open(os.path.join(REPO, "call_pull.sql")).read() + "\ncommit;")
if not ok: bad("the database change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
ok, sp = sql("select data->>'call_pull_since' as since, data->>'call_pull_live' as live from public.app_data where key = 'ops_settings'")
say(f"  ✓ the call record is in place · calls are picked up from {sp[0]['since'] if ok and sp else '?'} on · " + ("LIVE" if ok and sp and sp[0]['live'] == 'true' else "PRACTICE (nothing created until you switch it on)"))
for fn, extra in (("call-followup", ["--no-verify-jwt"]), ("call-pull", [])):
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + extra, cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: bad(f"{fn}: deploy failed: " + (p.stderr or p.stdout)[-240:]); say("  STOP. Tell Claude."); done(6)
    sN, mN = fmeta(fn)
    want = False if fn == "call-followup" else True
    if (mN or {}).get("verify_jwt") is not want: bad(f"{fn}: its gateway setting isn't as intended ({(mN or {}).get('verify_jwt')})")
    else: say(f"  ✓ {fn} deployed" + (" (now with its practice option)" if fn == "call-followup" else " (new)"))
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
try: keys = {k.get("name"): k.get("api_key", "") for k in json.loads(kb)}
except Exception: keys = {}
ANON, SVC = keys.get("anon", ""), keys.get("service_role", ""); HIDE += [ANON, SVC]
URL = f"{FNB}/functions/v1/{JOB}"
ok, r = sql(f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
ok, r = sql(f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(command(URL, ANON))}) as id")
ok2, jb = sql(f"select schedule, command from cron.job where jobname = {lit(JOB)}")
g = ok and ok2 and jb and jb[0]["schedule"] == SCHEDULE and "x-cron-secret" in jb[0]["command"]
(say if g else bad)(("  ✓ " if g else "") + "its schedule: every 10 minutes, carrying the jobs' secret from the vault")

say(); say("PART 3 · PROOF (nothing is created or sent)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
a1 = http("POST", URL + "?auth_check=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
(say if a1 == 401 else bad)(("  ✓ " if a1 == 401 else "") + f"the call fetcher refuses the public key ({a1})")
ok, rq = sql(command(URL + "?auth_check=1", ANON).rstrip(";") + " as id")
got = None; waited = 0.0
while ok and rq and waited <= POLL_MAX:
    ok3, rr = sql(f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
    if ok3 and rr: got = rr[0]; break
    time.sleep(POLL); waited += POLL
g = got and got["status_code"] == 200 and jget(got["content"], "caller") == "cron"
(say if g else bad)(("  ✓ " if g else "") + "its schedule gets in" + ("" if g else f" ({got['status_code'] if got else 'no answer'})"))
r2 = http("POST", f"{FNB}/functions/v1/call-followup?token=" + "x" * 48 + "&dry=1", {"transcript": "x"})[0]
(say if r2 == 401 else bad)(("  ✓ " if r2 == 401 else "") + f"the call reader still refuses a wrong code ({r2})")
sD, bD = http("POST", URL + "?dry=1", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 300)
try: j = json.loads(bD)
except Exception: j = {}
if sD == 200 and j.get("ok"):
    say(f"  ✓ a practice run: {j.get('calls_seen', 0)} answered call(s) since go-live, {j.get('practice', 0)} read in practice, "
        f"{j.get('waiting_transcript', 0)} waiting for GoHighLevel's transcript")
else: bad(f"the practice run didn't answer as expected ({sD}): " + str(j.get("error") or bD)[:160])
sC, bC = http("GET", f"{FNB}/rest/v1/call_pull_seen?select=message_id&limit=1", None, {"apikey": ANON, "Authorization": "Bearer " + ANON})
g = sC != 200 or bC.strip() in ("[]", "")
(say if g else bad)(("  ✓ " if g else "") + f"the public can't read the call record ({sC})")
say()
say("RESULT: " + ("DONE · every 10 minutes the Hub fetches finished calls itself, in PRACTICE: it shows what it would do and creates nothing. After a day, look at Settings → Calls from GoHighLevel and switch it on. Turn off the 'Calls to the Hub' workflow in GoHighLevel." if not fails else "CHECK THE ✗ LINES."))
say("Rollback: unschedule call-pull (Claude can); the call reader keeps working as before.")
done(0 if not fails else 8)
