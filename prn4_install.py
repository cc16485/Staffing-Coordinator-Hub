#!/usr/bin/env python3
# PRN4 · KEEPING THE BENCH AT 20+ (Desktop 358). Samantha approved 2026-09-29 ("yes to all").
# Part 1 (read only): the reviewed builds; the live availability function is exactly GitHub (prn4_accept.json; stops
#   and keeps a copy otherwise); the jobs' secret is there; the check-in job is new (or ours from an earlier run).
# Part 2: prn4.sql (the check-in record); deploy caregiver-availability (gateway setting kept) and the new prn-reconfirm
#   (sign-in check on); its weekday schedule (11:30am CDT / 10:30am CST, the jobs' secret from the vault).
#   The check-in texts stay in PRACTICE until Samantha turns them on in Settings.
# Part 3 (proof; nothing is sent): the check-in job refuses outsiders and lets its schedule in; a practice run (counts
#   only); the availability page refuses a forged link and still answers by phone; the public can't read check-ins.
# Prints counts only: no name, number, email, key or secret.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, time, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPO = os.path.dirname(os.path.dirname(FNROOT))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
POLL = float(os.environ.get("SB_POLL", "2")); POLL_MAX = float(os.environ.get("SB_POLL_MAX", "40"))
KEEP = os.environ.get("SB_KEEP_DIR", os.path.expanduser("~/Claude/prn4-live-copy"))
VAULT_NAME = "hub_job_secret"; JOB = "prn-reconfirm"; SCHEDULE = "30 16 * * 1-5"
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

say("PRN4 · KEEPING THE BENCH AT 20+"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
for name, want in SHAS.items():
    if sha(src_path(name)) != want: bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
if not {"prn-reconfirm", "caregiver-availability", "_shared/prn-links", "prn4.sql", "prn4_accept.json"} <= set(SHAS): bad("the reviewed list is incomplete"); done(2)
say("  ✓ the check-in job, the availability function, the link helper, the check-in record and the comparison list are the reviewed builds")
sA, mA = fmeta("caregiver-availability")
if sA != 200 or not isinstance((mA or {}).get("verify_jwt"), bool): bad("could not read the availability function's settings. Nothing was changed."); done(4)
ACC = json.load(open(os.path.join(REPO, "prn4_accept.json")))["caregiver-availability"]["files"]
tmp = tempfile.mkdtemp(prefix="prn4-live-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
d = subprocess.run([SUPA, "functions", "download", "caregiver-availability", "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if d.returncode != 0: bad("could not download the live availability function to compare. Nothing was changed."); done(4)
diff, seen = [], set()
for root, _, files in os.walk(tmp):
    for f in files:
        if not f.endswith(".ts"): continue
        lp = os.path.join(root, f); tail = "/".join(os.path.relpath(lp, tmp).replace(os.sep, "/").split("/")[-2:])
        hits = [r for r in ACC if r.endswith(tail)]
        if len(hits) != 1: diff.append(tail + " (not expected)"); continue
        seen.add(hits[0])
        if sha(lp) not in (ACC[hits[0]]["base"], ACC[hits[0]]["deploy"]): diff.append(hits[0])
for r in ACC:
    if r not in seen: diff.append(r + " (not found live)")
if diff:
    shutil.rmtree(KEEP, ignore_errors=True); shutil.copytree(tmp, KEEP)
    bad("the live availability function is NOT the version on GitHub (" + ", ".join(sorted(set(diff))) + f"). Nothing was changed; the live copy is kept at {KEEP} for Claude.")
    shutil.rmtree(tmp, ignore_errors=True); done(5)
shutil.rmtree(tmp, ignore_errors=True)
say(f"  ✓ the live availability function is exactly GitHub's · gateway sign-in check {'on' if mA['verify_jwt'] else 'off (it is a public page)'} (kept)")
ok, st = sql("""select (select count(*) from vault.decrypted_secrets where name = """ + lit(VAULT_NAME) + """)::int as vault,
  (select count(*) from cron.job where jobname = """ + lit(JOB) + """)::int as job,
  (select count(*) from public.pay_tracks where track = 'prn_team' and axiscare_caregiver_id is not null)::int as active""")
s, b = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
try: names = {x.get("name") for x in json.loads(b)} if s == 200 else set()
except Exception: names = set()
if not ok or not st or st[0]["vault"] != 1 or "HUB_JOB_SECRET" not in names: bad("the jobs' secret (S3), which also seals the links, isn't there. Nothing was changed."); done(4)
sR, mR = fmeta(JOB)
say(f"  ✓ the jobs' secret is there · the check-in job is {'already there (an earlier run)' if sR == 200 else 'new'} · PRN CNAs linked now: {st[0]['active']}")

say(); say("PART 2 · CHANGE")
ok, r = sql("begin;\n" + open(os.path.join(REPO, "prn4.sql")).read() + "\ncommit;")
if not ok: bad("the database change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
say("  ✓ the check-in record is in place")
for fn, vj in (("caregiver-availability", mA["verify_jwt"]), (JOB, True)):
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if vj else ["--no-verify-jwt"]),
                       cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: bad(f"{fn}: deploy failed: " + (p.stderr or p.stdout)[-240:]); say("  STOP. Tell Claude."); done(6)
    sN, mN = fmeta(fn)
    if (mN or {}).get("verify_jwt") != vj: bad(f"{fn}: its gateway setting isn't as intended ({(mN or {}).get('verify_jwt')})")
    say(f"  ✓ {fn} deployed" + (f", now version {(mN or {}).get('version')}, gateway setting kept" if fn != JOB else " (sign-in check on)"))
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
try: keys = {k.get("name"): k.get("api_key", "") for k in json.loads(kb)}
except Exception: keys = {}
ANON, SVC = keys.get("anon", ""), keys.get("service_role", ""); HIDE += [ANON, SVC]
URL = f"{FNB}/functions/v1/{JOB}"
ok, r = sql(f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
ok, r = sql(f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(command(URL, ANON))}) as id")
ok2, jb = sql(f"select schedule, command from cron.job where jobname = {lit(JOB)}")
g = ok and ok2 and jb and jb[0]["schedule"] == SCHEDULE and "x-cron-secret" in jb[0]["command"] and "vault.decrypted_secrets" in jb[0]["command"]
(say if g else bad)(("  ✓ " if g else "") + "its schedule: weekdays 11:30am CDT (10:30am in winter), carrying the jobs' secret from the vault · texts stay in PRACTICE until you turn them on in Settings")

say(); say("PART 3 · PROOF (nothing is sent)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
a1 = http("POST", URL + "?auth_check=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
(say if a1 == 401 else bad)(("  ✓ " if a1 == 401 else "") + f"the check-in job refuses the public key ({a1})")
ok, rq = sql(command(URL + "?auth_check=1", ANON).rstrip(";").replace("select net.http_post(", "select net.http_post(", 1) + " as id")
got = None; waited = 0.0
while ok and rq and waited <= POLL_MAX:
    ok3, rr = sql(f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
    if ok3 and rr: got = rr[0]; break
    time.sleep(POLL); waited += POLL
g = got and got["status_code"] == 200 and jget(got["content"], "caller") == "cron"
(say if g else bad)(("  ✓ " if g else "") + "its schedule gets in" + ("" if g else f" ({got['status_code'] if got else 'no answer'})"))
sD, bD = http("POST", URL + "?dry=1", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 200)
try: j = json.loads(bD)
except Exception: j = {}
if sD == 200 and j.get("held"): say(f"  ✓ a practice run answered (outside its hours right now, so it held: {j['held']})")
elif sD == 200 and j.get("live") is False: say(f"  ✓ a practice run (nothing sent): {j.get('due', 0)} due for a check-in, {j.get('would_text', 0)} would be texted today, {j.get('no_phone', 0)} with no phone on file")
else: bad(f"the practice run didn't answer as expected ({sD})")
AV = f"{FNB}/functions/v1/caregiver-availability"
f1, fb = http("POST", AV, {"c": "1", "e": 9999999999, "t": "A" * 43}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
f2, pb = http("POST", AV, {"phone": "0000000000"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
g = f1 == 401 and "phone number instead" in fb and f2 == 200 and jget(pb, "unknown") is True
(say if g else bad)(("  ✓ " if g else "") + f"the availability page: a forged link is refused ({f1}) and points to the phone number; a phone number still answers as before ({f2})")
sC, bC = http("GET", f"{FNB}/rest/v1/prn_checkins?select=id&limit=1", None, {"apikey": ANON, "Authorization": "Bearer " + ANON})
g = sC != 200 or bC.strip() in ("[]", "")
(say if g else bad)(("  ✓ " if g else "") + f"the public can't read check-ins ({sC})")
say()
say("RESULT: " + ("DONE · the PRN dashboard can count the bench, and the 60-day check-ins run in practice until you turn them on (Settings, PRN CNA Team)." if not fails else "CHECK THE ✗ LINES."))
say("Rollback: unschedule prn-reconfirm and redeploy caregiver-availability from before (Claude can); the check-in record stays.")
done(0 if not fails else 8)
