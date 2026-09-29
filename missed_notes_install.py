#!/usr/bin/env python3
# MISSED SHIFT NOTES M1–M3 (Desktop 361). Samantha approved 2026-09-29 ("go for the missed shift notes M0-M3",
#   "yes to all", "go and merge").
# Part 1 (read only): the reviewed builds; the jobs' secret is there; the missed-notes job is new (or ours).
# Part 2: missed_notes.sql (the record); deploy missed-notes (sign-in check on); its every-5-minutes schedule (the
#   jobs' secret from the vault). The texts stay in PRACTICE until Samantha turns them on in Settings.
# Part 3 (proof; nothing is sent): the job refuses outsiders and lets its schedule in; a practice look (?dry=1, counts
#   only, records nothing); "Put it in AxisCare" refuses anyone who isn't signed-in office staff; the record isn't public.
# Prints counts only: no name, number, email, key or secret.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, time, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPO = os.path.dirname(os.path.dirname(FNROOT))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
POLL = float(os.environ.get("SB_POLL", "2")); POLL_MAX = float(os.environ.get("SB_POLL_MAX", "40"))
VAULT_NAME = "hub_job_secret"; JOB = "missed-notes"; SCHEDULE = "*/5 * * * *"
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-prn4/1.0"}, **(headers or {})))
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

say("361 · MISSED SHIFT NOTES"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
for name, want in SHAS.items():
    if sha(src_path(name)) != want: bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
if not {"missed-notes", "_shared/outreach", "missed_notes.sql"} <= set(SHAS): bad("the reviewed list is incomplete"); done(2)
say("  ✓ the missed-notes job, the shared texting door and the record are the reviewed builds")
ok, st = sql("""select (select count(*) from vault.decrypted_secrets where name = """ + lit(VAULT_NAME) + """)::int as vault,
  (select count(*) from cron.job where jobname = """ + lit(JOB) + """)::int as job""")
s, b = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
try: names = {x.get("name") for x in json.loads(b)} if s == 200 else set()
except Exception: names = set()
if not ok or not st or st[0]["vault"] != 1 or "HUB_JOB_SECRET" not in names: bad("the jobs' secret (S3) isn't there. Nothing was changed."); done(4)
sR, mR = fmeta(JOB)
if sR == 200 and not os.environ.get("SB_RERUN_OK", "1") == "1": bad("a missed-notes function already exists (unexpected). Nothing was changed."); done(4)
say(f"  ✓ the jobs' secret is there · the missed-notes job is {'already there (an earlier run)' if sR == 200 else 'new'}")

say(); say("PART 2 · CHANGE")
ok, r = sql("begin;\n" + open(os.path.join(REPO, "missed_notes.sql")).read() + "\ncommit;")
if not ok: bad("the database change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
say("  ✓ the missed-notes record is in place")
p = subprocess.run([SUPA, "functions", "deploy", JOB, "--project-ref", REF, "--use-api"], cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: bad("deploy failed: " + (p.stderr or p.stdout)[-240:]); say("  STOP. Tell Claude."); done(6)
sN, mN = fmeta(JOB)
if (mN or {}).get("verify_jwt") is not True: bad(f"its sign-in check isn't on ({(mN or {}).get('verify_jwt')})")
say("  ✓ the missed-notes job deployed (sign-in check on)")
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
try: keys = {k.get("name"): k.get("api_key", "") for k in json.loads(kb)}
except Exception: keys = {}
ANON, SVC = keys.get("anon", ""), keys.get("service_role", ""); HIDE += [ANON, SVC]
URL = f"{FNB}/functions/v1/{JOB}"
ok, r = sql(f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
ok, r = sql(f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(command(URL, ANON))}) as id")
ok2, jb = sql(f"select schedule, command from cron.job where jobname = {lit(JOB)}")
g = ok and ok2 and jb and jb[0]["schedule"] == SCHEDULE and "x-cron-secret" in jb[0]["command"] and "vault.decrypted_secrets" in jb[0]["command"]
(say if g else bad)(("  ✓ " if g else "") + "its schedule: every 5 minutes, carrying the jobs' secret from the vault · texts stay in PRACTICE until you turn them on in Settings, Missed care notes")

say(); say("PART 3 · PROOF (nothing is sent)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
a1 = http("POST", URL + "?auth_check=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
(say if a1 == 401 else bad)(("  ✓ " if a1 == 401 else "") + f"the missed-notes job refuses the public key ({a1})")
ok, rq = sql(command(URL + "?auth_check=1", ANON).rstrip(";").replace("select net.http_post(", "select net.http_post(", 1) + " as id")
got = None; waited = 0.0
while ok and rq and waited <= POLL_MAX:
    ok3, rr = sql(f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
    if ok3 and rr: got = rr[0]; break
    time.sleep(POLL); waited += POLL
g = got and got["status_code"] == 200 and jget(got["content"], "caller") == "cron"
(say if g else bad)(("  ✓ " if g else "") + "its schedule gets in" + ("" if g else f" ({got['status_code'] if got else 'no answer'})"))
sD, bD = http("POST", URL + "?dry=1", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 300)
try: j = json.loads(bD)
except Exception: j = {}
if sD == 200 and j.get("dry") is True:
    say(f"  ✓ a practice look (records nothing, sends nothing): {j.get('groups_checked', 0)} finished shifts checked, {j.get('with_note', 0)} with a note, "
        + f"{j.get('practice_found', 0) + j.get('missed_found', 0)} without one" + (" (AxisCare asked it to slow down; the rest wait for the next run)" if j.get("slowed_down") else ""))
else: bad(f"the practice look didn't answer as expected ({sD}): " + str(j.get("error") or bD)[:160])
e1 = http("POST", URL, {"action": "enter", "id": 1, "note": "x"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
(say if e1 == 401 else bad)(("  ✓ " if e1 == 401 else "") + f"\"Put it in AxisCare\" refuses anyone who isn't signed-in office staff ({e1})")
sC, bC = http("GET", f"{FNB}/rest/v1/missed_notes?select=id&limit=1", None, {"apikey": ANON, "Authorization": "Bearer " + ANON})
g = sC != 200 or bC.strip() in ("[]", "")
(say if g else bad)(("  ✓ " if g else "") + f"the public can't read the missed-notes record ({sC})")
say()
say("RESULT: " + ("DONE · missed care notes are found every 5 minutes, in practice until you turn the texts on (Settings, Missed care notes)." if not fails else "CHECK THE ✗ LINES."))
say("Rollback: switch it off in Settings, or unschedule missed-notes (Claude can); the record stays.")
done(0 if not fails else 8)
