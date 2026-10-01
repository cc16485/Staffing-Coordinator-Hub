#!/usr/bin/env python3
# RUNNING LATE L1 (Desktop 363). Samantha approved 2026-09-29 ("yes to all", "build L1 now").
# Part 1 (read only): the reviewed builds; the jobs' secret is there; the page's server (late-alert) is new.
# Part 2: late1.sql (the record); deploy late-watch (the job, replacing the L0 look it grew from) and late-alert (the
#   admin link page and the Needs Attention card); the job's every-5-minutes schedule (the jobs' secret from the
#   vault). EVERYTHING STAYS IN PRACTICE until Samantha turns it on in Settings, Running late. The missed clock-in
#   hold: 349 ran before L1 merged, so this step deploys the missed clock-in watcher too (2026-10-01), but ONLY if the
#   live watcher is exactly GitHub's pre-L1 version (timekeeper-watch@main); its gateway setting is kept.
# Part 3 (proof; nothing is sent): the job refuses outsiders and lets its schedule in; a practice look (?dry=1: counts
#   only, records nothing, sends nothing); the page refuses no link, a forged link and anyone not signed in; the
#   record isn't public; the switches are off.
# Prints counts only: no name, number, email, key or secret.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, time, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPO = os.path.dirname(os.path.dirname(FNROOT))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
POLL = float(os.environ.get("SB_POLL", "2")); POLL_MAX = float(os.environ.get("SB_POLL_MAX", "40"))
VAULT_NAME = "hub_job_secret"; JOB = "late-watch"; PAGEFN = "late-alert"; SCHEDULE = "*/5 * * * *"
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-late1/1.0"}, **(headers or {})))
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

say("363 · RUNNING LATE (L1)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
for name, want in SHAS.items():
    if name.endswith("@main"): continue
    if sha(src_path(name)) != want: bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
if not {"late-watch", "late-alert", "_shared/outreach", "_shared/late-notice", "_shared/late-links", "late1.sql", "timekeeper-watch", "timekeeper-watch@main"} <= set(SHAS): bad("the reviewed list is incomplete"); done(2)
say("  ✓ the job, the page's server, the shared texting door and the record are the reviewed builds")
ok, st = sql("""select (select count(*) from vault.decrypted_secrets where name = """ + lit(VAULT_NAME) + """)::int as vault,
  (select count(*) from cron.job where jobname = """ + lit(JOB) + """)::int as job""")
s, b = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
try: names = {x.get("name") for x in json.loads(b)} if s == 200 else set()
except Exception: names = set()
if not ok or not st or st[0]["vault"] != 1 or "HUB_JOB_SECRET" not in names: bad("the jobs' secret isn't there. Nothing was changed."); done(4)
miss = [n for n in ("ANTHROPIC_API_KEY", "GHL_TOKEN", "GHL_LOCATION_ID") if n not in names]
if miss: bad("secrets missing: " + ", ".join(miss) + ". Nothing was changed."); done(4)
sP, mP = fmeta(PAGEFN)
if sP == 200 and os.environ.get("SB_RERUN_OK", "1") != "1": bad("a late-alert function already exists (unexpected). Nothing was changed."); done(4)
sW, mW = fmeta(JOB)
say(f"  ✓ the jobs' secret and the AI and GoHighLevel keys are there · late-watch {'is the L0 look (it will be replaced)' if sW == 200 else 'is new'} · late-alert {'is already there (an earlier run)' if sP == 200 else 'is new'}")

say(); say("PART 2 · CHANGE")
ok, r = sql("begin;\n" + open(os.path.join(REPO, "late1.sql")).read() + "\ncommit;")
if not ok: bad("the database change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
say("  ✓ the running-late record is in place")
for fn in (JOB, PAGEFN):
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"], cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: bad(f"{fn} deploy failed: " + (p.stderr or p.stdout)[-240:]); say("  STOP. Tell Claude."); done(6)
    sN, mN = fmeta(fn)
    if (mN or {}).get("verify_jwt") is not True: bad(f"{fn}: its sign-in check isn't on ({(mN or {}).get('verify_jwt')})")
say("  ✓ late-watch and late-alert deployed (sign-in check on)")
# The missed clock-in watcher's running-late hold. Swapped in only over GitHub's own pre-L1 copy, never over unknown code.
TK = "timekeeper-watch"
sT, mT = fmeta(TK); vjT = (mT or {}).get("verify_jwt")
tmp = tempfile.mkdtemp(prefix="tk-live-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
d = subprocess.run([SUPA, "functions", "download", TK, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
live = None
for root, _, files in os.walk(tmp):
    for f in files:
        lp = os.path.join(root, f)
        if f == "index.ts" and lp.replace(os.sep, "/").endswith("timekeeper-watch/index.ts"): live = sha(lp)
if d.returncode != 0 or live is None or not isinstance(vjT, bool):
    bad("couldn't read the live missed clock-in watcher, so it was NOT changed (the running-late hold isn't on yet). Tell Claude.")
elif live == SHAS[TK]:
    say("  ✓ the missed clock-in watcher already has the running-late hold")
elif live != SHAS[TK + "@main"]:
    keep = os.path.expanduser("~/Claude/tk-live-copy"); shutil.rmtree(keep, ignore_errors=True); shutil.copytree(tmp, keep)
    bad(f"the live missed clock-in watcher is NOT GitHub's version, so it was NOT changed (the running-late hold isn't on yet). Live copy kept at {keep}. Tell Claude.")
else:
    p = subprocess.run([SUPA, "functions", "deploy", TK, "--project-ref", REF, "--use-api"] + ([] if vjT else ["--no-verify-jwt"]),
                       cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    sN, mN = fmeta(TK)
    if p.returncode != 0: bad("the missed clock-in watcher didn't deploy: " + (p.stderr or p.stdout)[-200:])
    elif (mN or {}).get("verify_jwt") != vjT: bad("the missed clock-in watcher's gateway setting changed; tell Claude")
    else: say("  ✓ the missed clock-in watcher has the running-late hold (it was exactly GitHub's copy; gateway setting kept)")
shutil.rmtree(tmp, ignore_errors=True)
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
try: keys = {k.get("name"): k.get("api_key", "") for k in json.loads(kb)}
except Exception: keys = {}
ANON, SVC = keys.get("anon", ""), keys.get("service_role", ""); HIDE += [ANON, SVC]
URL = f"{FNB}/functions/v1/{JOB}"; PURL = f"{FNB}/functions/v1/{PAGEFN}"
ok, r = sql(f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
ok, r = sql(f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(command(URL, ANON))}) as id")
ok2, jb = sql(f"select schedule, command from cron.job where jobname = {lit(JOB)}")
g = ok and ok2 and jb and jb[0]["schedule"] == SCHEDULE and "x-cron-secret" in jb[0]["command"] and "vault.decrypted_secrets" in jb[0]["command"]
(say if g else bad)(("  ✓ " if g else "") + "its schedule: every 5 minutes, carrying the jobs' secret from the vault · everything stays in PRACTICE until you turn it on in Settings, Running late")

say(); say("PART 3 · PROOF (nothing is sent)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
a1 = http("POST", URL + "?auth_check=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
(say if a1 == 401 else bad)(("  ✓ " if a1 == 401 else "") + f"the job refuses the public key ({a1})")
ok, rq = sql(command(URL + "?auth_check=1", ANON).rstrip(";") + " as id")
got = None; waited = 0.0
while ok and rq and waited <= POLL_MAX:
    ok3, rr = sql(f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
    if ok3 and rr: got = rr[0]; break
    time.sleep(POLL); waited += POLL
g = got and got["status_code"] == 200 and jget(got["content"], "caller") == "cron"
(say if g else bad)(("  ✓ " if g else "") + "its schedule gets in" + ("" if g else f" ({got['status_code'] if got else 'no answer'})"))
l0 = http("POST", URL + "?l0=1&limit=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
(say if l0 == 401 else bad)(("  ✓ " if l0 == 401 else "") + f"the L0 look still answers only your key ({l0})")
sD, bD = http("POST", URL + "?dry=1", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 300)
try: j = json.loads(bD)
except Exception: j = {}
if sD == 200 and j.get("dry") is True and j.get("live") is False:
    say(f"  ✓ a practice look (records nothing, sends nothing): {j.get('caregivers_watched', 0)} caregivers with a shift in the next 2 hours, {j.get('messages_new', 0)} new messages, "
        + f"{j.get('notices_new', 0)} would be running-late notices" + (f" · no phone on the roster: {j.get('no_phone')}" if j.get("no_phone") else ""))
else: bad(f"the practice look didn't answer as expected ({sD}): " + str(j.get("error") or bD)[:160])
p1 = http("POST", PURL, {"id": 1, "action": "view"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
p2 = http("POST", PURL, {"c": "ln_1", "a": "0" * 16, "e": 9999999999, "t": "A" * 43, "action": "view"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
g = p1 == 401 and p2 == 401
(say if g else bad)(("  ✓ " if g else "") + f"the page's server refuses anyone not signed in ({p1}) and a made-up link ({p2})")
sC, bC = http("GET", f"{FNB}/rest/v1/late_notices?select=id&limit=1", None, {"apikey": ANON, "Authorization": "Bearer " + ANON})
g = sC != 200 or bC.strip() in ("[]", "")
(say if g else bad)(("  ✓ " if g else "") + f"the public can't read the running-late record ({sC})")
ok, so = sql("select coalesce(data->>'late_watch_live','') a, coalesce(data->>'late_cg_reply_live','') b, coalesce(data->>'late_admin_live','') c from app_data where key = 'ops_settings'")
g = ok and so and all(so[0][k] in ("", "false") for k in ("a", "b", "c"))
(say if g else bad)(("  ✓ " if g else "") + "the three switches are off: practice")
say()
say("RESULT: " + ("DONE · running-late messages are read every 5 minutes, in PRACTICE: Settings, Running late lists what would have gone. Next: merge the Hub page, then run 349 (it carries the missed clock-in hold)." if not fails else "CHECK THE ✗ LINES."))
say("Rollback: the switches in Settings, or unschedule late-watch (Claude can); the record stays.")
done(0 if not fails else 8)
