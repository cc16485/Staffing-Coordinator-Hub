#!/usr/bin/env python3
# 526 · MEDICAID VISITS FROM AXISCARE (Medicaid slice D, Samantha 2026-10-08: "missed visits, can those be pulled from
# AxisCare, not manual?" · "clocked times is fine, Medicaid coordinator (Angiel)"). Deploys the new medicaid-visits
# function (gateway sign-in check on) and schedules it every weekday at 9:45am. It reads AxisCare (read only) for each
# client with a current Medicaid care plan uploaded in the Hub: units delivered (clocked time) vs authorized, visits not
# delivered, the risk line (warned before 1 week or 3 in a row). The switch "Missed-visit watch" stays as it is (off):
# switched off it only records for the Payer tab, no card. A practice run at the end writes and sends nothing.
import json, os, re, subprocess, urllib.request, urllib.error, datetime as dt, sys, hashlib, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); BASE = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
SUPA = os.environ.get("SB_SUPA_CLI", ""); FNROOT = os.environ.get("SB_FNROOT", ""); SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}")); BASEP = json.loads(os.environ.get("SB_BASE_SHAS", "{}"))
ROOT = os.path.dirname(os.path.dirname(FNROOT)) if FNROOT else ""; FNS = ["medicaid-visits"]
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for h in HIDE:
        if h: s = s.replace(h, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-526/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
jl = lambda b: (lambda: json.loads(b))() if b and b[:1] in "[{" else {}
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, b[:300]
    try: return True, json.loads(b)
    except Exception: return False, b[:300]
lit = lambda v: "null" if v is None else "'" + str(v).replace("'", "''") + "'"
sha = lambda p_: hashlib.sha256(open(p_, "rb").read()).hexdigest()
def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
def need(fn):
    s = set(); deps(os.path.join(FNROOT, fn, "index.ts"), s)
    return {os.path.relpath(x, ROOT).replace(os.sep, "/") for x in s}
def fmeta(fn):
    s = None
    for i in range(4):
        s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
        if s == 200:
            try: return s, json.loads(b)
            except Exception: pass
        if s == 404: return s, None
        time.sleep(3 * (i + 1))
    return s, None
def live_files(fn):
    for i in range(3):
        tmp = tempfile.mkdtemp(prefix="cc526-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
        d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
        live = {}
        for r_, _, files in os.walk(tmp):
            for f in files:
                lp = os.path.join(r_, f).replace(os.sep, "/")
                if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
        shutil.rmtree(tmp, ignore_errors=True)
        if d.returncode == 0 and live: return True, live
        time.sleep(3 * (i + 1))
    return False, {}


VAULT = "hub_job_secret"; JOB = "medicaid-visits-weekdays"; SCHEDULE = "45 14 * * 1-5"   # 9:45am Central (CDT) on weekdays; 8:45am in winter
lit = lambda v: "'" + str(v).replace("'", "''") + "'"
def command(url, anon, body):
    return ("select net.http_post(url := " + lit(url) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
            "'Authorization', " + lit("Bearer " + anon) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT) + ")), "
            "body := " + lit(json.dumps(body)) + "::jsonb, timeout_milliseconds := 300000);")
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
say("526 · MEDICAID VISITS FROM AXISCARE"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for name, want in SHAS.items():
    p_ = os.path.join(FNROOT, name); have_ = sha(p_) if os.path.exists(p_) else "(missing)"
    say(f"  ✓ {name} is the reviewed build") if have_ == want else bad(f"{name} is not the reviewed build: nothing runs")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(2)
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
sx, mx = fmeta("medicaid-visits")
if sx == 200:
    okd, livef = live_files("medicaid-visits")
    same = okd and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need("medicaid-visits"))
    if not same: bad("a different medicaid-visits is already live; nothing runs. Tell Claude."); done(3)
    say("  · medicaid-visits is already this build (an earlier run)")
elif sx == 404: say("  ✓ medicaid-visits is new")
else: bad(f"could not check medicaid-visits ({sx})"); done(3)
ok, sv = sql(f"select coalesce((select data->>'visit_watch_live' from app_data where key = 'ops_settings'), 'not set') as live, (select count(*) from vault.decrypted_secrets where name = {lit(VAULT)})::int as vault")
if not ok or not sv: bad("couldn't read the settings. Nothing was changed."); done(3)
if sv[0]["vault"] != 1: bad("the jobs' secret isn't there. Nothing was changed."); done(3)
say(f"  · the switch \"Missed-visit watch\" is {'ON' if sv[0]['live'] == 'true' else 'OFF'} (it stays as it is; you turn it on on the Admin page)")
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG())
try: K = {x.get("name"): x.get("api_key", "") for x in json.loads(kb) if isinstance(x, dict)}
except Exception: K = {}
ANON, SVC = K.get("anon", ""), K.get("service_role", "")
if not ANON or not SVC: bad("couldn't read the keys. Nothing was changed."); done(3)
HIDE.extend([ANON, SVC])

say(); say("PART 2 · CHANGE")
if sx != 200:
    p = subprocess.run([SUPA, "functions", "deploy", "medicaid-visits", "--project-ref", REF, "--use-api"], cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    okd, livef = live_files("medicaid-visits")
    good = p.returncode == 0 and okd and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need("medicaid-visits"))
    say("  ✓ medicaid-visits deployed: the live copy is this reviewed build") if good else bad("medicaid-visits did not deploy cleanly: " + (p.stderr or p.stdout)[-200:])
    if fails: say("  RESULT: STOPPED. Nothing else was changed. Tell Claude."); done(6)
    sN, mN = fmeta("medicaid-visits")
    if (mN or {}).get("verify_jwt") is not True:
        http("PATCH", f"{API}/v1/projects/{REF}/functions/medicaid-visits", {"verify_jwt": True}, MG()); sN, mN = fmeta("medicaid-visits")
    say(f"  ✓ medicaid-visits: version {(mN or {}).get('version', '?')}, gateway sign-in check on") if (mN or {}).get("verify_jwt") is True else bad("the gateway sign-in check is not on")
URL = f"{FNB}/functions/v1/medicaid-visits"
sql(f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
ok, r = sql(f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(command(URL, ANON, {}))}) as id")
ok2, jb = sql(f"select schedule, command from cron.job where jobname = {lit(JOB)}")
say("  ✓ scheduled every weekday at 9:45am (switched off it only records, no card)") if ok and ok2 and jb and jb[0]["schedule"] == SCHEDULE and "x-cron-secret" in jb[0]["command"] else bad(f"it was not scheduled: {r} {jb}")

say(); say("PART 3 · PROOF AND A PRACTICE RUN (reads AxisCare; writes, texts and emails nothing)")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
s2, _ = http("POST", URL, {}, {"Content-Type": "application/json", "apikey": ANON, "Authorization": "Bearer " + ANON})
say(f"  ✓ it refuses anyone without the schedule's secret ({s2})") if s2 in (401, 403) else bad(f"it answered someone without the secret ({s2})")
s, b = http("POST", URL + "?dry=1", {}, {"Content-Type": "application/json", "apikey": SVC, "Authorization": "Bearer " + SVC}, timeout=300)
try: j = json.loads(b) if s == 200 else {}
except Exception: j = {}
SVC = ""
if s == 200 and j.get("ok") and j.get("dry") is True:
    say(f"  ✓ practice run: {j.get('clients', 0)} client(s) with a current Medicaid care plan, {j.get('checked', 0)} month(s) read from AxisCare, AxisCare failed {j.get('axiscare_failed', 0)}")
    say(f"  ✓ the cards would go to Staffing ({j.get('staffing', '?')}) and the Medicaid coordinator ({j.get('medicaid', '?')})")
    for x in (j.get("at_risk") or [])[:30]: say(f"      · at risk today: {x.get('name')} ({x.get('in_a_row')} in a row not delivered, {x.get('days_without')} days without a visit)")
    for x in (j.get("reviews") or [])[:30]: say(f"      · a review would be due: {x.get('name')} for {x.get('month')}")
    if not j.get("clients"): say("  · nothing to read yet: no client has a current Medicaid care plan uploaded (each client's Payer tab)")
    if j.get("axiscare_failed"): bad("AxisCare did not answer for some clients; nothing is assumed for them. Tell Claude if this repeats.")
else: bad(f"the practice run did not answer ({s}): " + str(b)[:200])
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · every weekday at 9:45am medicaid-visits reads AxisCare for each Medicaid client and the Payer tab shows it. The cards wait for the Admin switch \"Missed-visit watch\"" + (" (already ON)." if sv[0]["live"] == "true" else " (OFF, yours to turn on).") + " Nothing was texted or emailed.")
done(0)
