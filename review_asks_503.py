#!/usr/bin/env python3
# 503 · GOOGLE REVIEW SUGGESTIONS (Samantha 2026-10-07/08; her direct review link verified signed in 2026-10-08). Installs the
# review-ask record (review-asks/review-asks.sql; server only), deploys the new review-moments function (gateway sign-in check
# on) and schedules its daily look (9:15am). The switch "Google review suggestions" stays as it is (off): switched off, the
# look only lists what it would suggest. A practice look at the end lists today's would-be suggestions; nothing is made.
# The Hub never sends a review request: a Care Coordinator does, and records it. Nothing is texted or emailed by this step.
import json, os, re, subprocess, urllib.request, urllib.error, datetime as dt, sys, hashlib, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); BASE = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
SUPA = os.environ.get("SB_SUPA_CLI", ""); FNROOT = os.environ.get("SB_FNROOT", ""); SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}")); BASEP = json.loads(os.environ.get("SB_BASE_SHAS", "{}"))
ROOT = os.path.dirname(os.path.dirname(FNROOT)) if FNROOT else ""; FNS = ["review-moments"]
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
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-503/1.0"}, **(headers or {})))
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
        tmp = tempfile.mkdtemp(prefix="cc503-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
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


VAULT = "hub_job_secret"; JOB = "review-moments-daily"; SCHEDULE = "15 14 * * *"   # 9:15am Central (CDT); 8:15am in winter
lit = lambda v: "'" + str(v).replace("'", "''") + "'"
def command(url, anon, body):
    return ("select net.http_post(url := " + lit(url) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
            "'Authorization', " + lit("Bearer " + anon) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT) + ")), "
            "body := " + lit(json.dumps(body)) + "::jsonb, timeout_milliseconds := 120000);")
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
say("503 · GOOGLE REVIEW SUGGESTIONS"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for name, want in SHAS.items():
    p_ = os.path.join(ROOT, "review-asks", name.split("/", 1)[1]) if name.endswith(".sql") else os.path.join(FNROOT, name); have_ = sha(p_) if os.path.exists(p_) else "(missing)"
    say(f"  ✓ {name} is the reviewed build") if have_ == want else bad(f"{name} is not the reviewed build: nothing runs")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(2)
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
sx, mx = fmeta("review-moments")
if sx == 200:
    okd, livef = live_files("review-moments")
    same = okd and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need("review-moments"))
    if not same: bad("a different review-moments is already live; nothing runs. Tell Claude."); done(3)
    say("  · review-moments is already this build (an earlier run)")
elif sx == 404: say("  ✓ review-moments is new")
else: bad(f"could not check review-moments ({sx})"); done(3)
ok, sv = sql(f"select coalesce((select data->>'review_asks_live' from app_data where key = 'ops_settings'), 'not set') as live, (select count(*) from vault.decrypted_secrets where name = {lit(VAULT)})::int as vault")
if not ok or not sv: bad("couldn't read the settings. Nothing was changed."); done(3)
if sv[0]["vault"] != 1: bad("the jobs' secret isn't there. Nothing was changed."); done(3)
say(f"  · the switch \"Google review suggestions\" is {'ON' if sv[0]['live'] == 'true' else 'OFF'} (it stays as it is; you turn it on on the Admin page or in Hub settings)")
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG())
try: K = {x.get("name"): x.get("api_key", "") for x in json.loads(kb) if isinstance(x, dict)}
except Exception: K = {}
ANON, SVC = K.get("anon", ""), K.get("service_role", "")
if not ANON or not SVC: bad("couldn't read the keys. Nothing was changed."); done(3)
HIDE.extend([ANON, SVC])

say(); say("PART 2 · CHANGE")
ok, r = sql(open(os.path.join(ROOT, "review-asks", "review-asks.sql")).read())
if not ok: bad("the review record didn't install: " + str(r)); say("  STOP. Nothing else was changed."); done(5)
say("  ✓ the review-ask record (kept; only the server reads or writes it)")
if sx != 200:
    p = subprocess.run([SUPA, "functions", "deploy", "review-moments", "--project-ref", REF, "--use-api"], cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    okd, livef = live_files("review-moments")
    good = p.returncode == 0 and okd and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need("review-moments"))
    say("  ✓ review-moments deployed: the live copy is this reviewed build") if good else bad("review-moments did not deploy cleanly: " + (p.stderr or p.stdout)[-200:])
    if fails: say("  RESULT: STOPPED (the record above stays; it is empty and unused). Tell Claude."); done(6)
    sN, mN = fmeta("review-moments")
    if (mN or {}).get("verify_jwt") is not True:
        http("PATCH", f"{API}/v1/projects/{REF}/functions/review-moments", {"verify_jwt": True}, MG()); sN, mN = fmeta("review-moments")
    say(f"  ✓ review-moments: version {(mN or {}).get('version', '?')}, gateway sign-in check on") if (mN or {}).get("verify_jwt") is True else bad("the gateway sign-in check is not on")
URL = f"{FNB}/functions/v1/review-moments"
sql(f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
ok, r = sql(f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(command(URL, ANON, {'action': 'sweep'}))}) as id")
ok2, jb = sql(f"select schedule, command from cron.job where jobname = {lit(JOB)}")
say("  ✓ the daily look is scheduled (9:15am; switched off it only lists, no card)") if ok and ok2 and jb and jb[0]["schedule"] == SCHEDULE and "x-cron-secret" in jb[0]["command"] else bad(f"the daily look was not scheduled: {r} {jb}")

say(); say("PART 3 · PROOF AND A PRACTICE LOOK (nothing is written, nothing is sent)")
ok, r = sql("select relrowsecurity as rls, has_table_privilege('authenticated', 'public.review_ask', 'select') as auth_read, has_table_privilege('anon', 'public.review_ask', 'select') as anon_read from pg_class where relname = 'review_ask'")
x = (r or [{}])[0] if ok else {}
say("  ✓ nobody signed in or anonymous can read the review record directly (the server only)") if ok and x.get("rls") and not x.get("auth_read") and not x.get("anon_read") else bad(f"the review record is readable directly: {x}")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
s2, _ = http("POST", URL, {"action": "sweep"}, {"Content-Type": "application/json", "apikey": ANON, "Authorization": "Bearer " + ANON})
say(f"  ✓ the daily look refuses anyone else ({s2})") if s2 in (401, 403) else bad(f"the daily look answered someone without the secret ({s2})")
s, b = http("POST", URL, {"action": "sweep", "practice": True}, {"Content-Type": "application/json", "apikey": SVC, "Authorization": "Bearer " + SVC}, timeout=200)
try: j = json.loads(b) if s == 200 else {}
except Exception: j = {}
SVC = ""
if s == 200 and j.get("ok") and j.get("live") is False and not j.get("suggested"):
    say(f"  ✓ practice look: today it WOULD suggest {j.get('would_suggest', 0)} ask(s); none was made")
    for x in j.get("list", []): say(f"      {x.get('name')} · {x.get('moment')} · {x.get('on')}" + (f" · {x.get('who')}" if x.get('who') else '') + f" · for {x.get('owner') or '?'}")
    sk = j.get("skipped") or {}
    if sk: say("      not now: " + ", ".join(f"{v} {k}" for k, v in sorted(sk.items(), key=lambda z: -z[1])))
else: bad(f"the practice look answered {s}: {str(b)[:300]}")
ok, r = sql("select count(*)::int as n from public.review_ask")
say("  ✓ the review record is still empty (the practice look made nothing)") if ok and r and r[0]["n"] == 0 else say(f"  · review asks on record: {r[0]['n'] if ok and r else '?'}")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · Google review suggestions are installed and OFF. The Google review box is on current clients' profiles (anyone can choose to ask). Turn suggestions on from the Admin page or Hub settings, Google reviews. Nothing was texted or emailed.")
done(0)
