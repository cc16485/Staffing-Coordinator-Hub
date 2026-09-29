#!/usr/bin/env python3
# S3 · AUTOMATED JOBS GET THEIR OWN KEY (Desktop 329). The two backups, the reference follow-up, the reference check-in
# and the SSN purge used to answer anyone (three of them with names in a practice run). Now each answers only its own
# schedule (a secret kept in the database's vault), the owner's server key, or (the reference follow-up only)
# signed-in office staff.
# Part 1 (read only): the five functions and the shared lock are the reviewed builds; each function's gateway setting
#   is read and kept; the three schedules are found, each calling its function with an empty body.
# Part 2: a new server-only secret (never printed or saved to disk) goes into the function settings and the vault;
#   the three schedules are rebuilt to send it (same time, same on/off, same address); THEN the five functions deploy.
#   The old code ignores the extra header, so the order never breaks a run.
# Part 3 (live proof, nothing runs): every function refuses no key, the public key and a wrong secret; accepts the
#   owner's key; each schedule's exact call from the database is accepted as the schedule.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, time, secrets as pysecrets
FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
POLL = float(os.environ.get("SB_POLL", "2")); POLL_MAX = float(os.environ.get("SB_POLL_MAX", "40"))
FNS = ["shared-backup", "backup-verify", "reference-chase", "hire-intake-purge", "references-run"]
JOBS = {"weekly-hub-backup": "shared-backup", "daily-reference-chase": "reference-chase", "daily-ssn-purge": "hire-intake-purge"}
VAULT_NAME = "hub_job_secret"; FN_SECRET = "HUB_JOB_SECRET"
lines = []; fails = []; HIDE = []
def scrub(s):
    s = str(s)
    for v in HIDE:
        if v: s = s.replace(v, "(hidden)")
    return re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s)
def say(s=""): s = scrub(s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=120):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-s3/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:200]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def lit(v): return "'" + str(v).replace("'", "''") + "'"
def vjwt(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    try: v = json.loads(b).get("verify_jwt") if s == 200 else None
    except Exception: v = None
    return v if isinstance(v, bool) else None
def keys():
    s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
    try: return {k.get("name"): k.get("api_key", "") for k in json.loads(b) if isinstance(k, dict)}
    except Exception: return {}
def jget(b, k):
    try: return json.loads(b).get(k)
    except Exception: return None

say("S3 · AUTOMATED JOBS GET THEIR OWN KEY"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
badb = False
for name, want in SHAS.items():
    path = os.path.join(FNROOT, "_shared", "job-auth.ts") if name == "_shared/job-auth" else os.path.join(FNROOT, name, "index.ts")
    got = hashlib.sha256(open(path, "rb").read()).hexdigest()
    if got != want: bad(f"{name} is not the reviewed build"); badb = True
if badb or set(SHAS) != set(FNS) | {"_shared/job-auth"}: say("  STOP. Nothing was run."); done(2)
say("  ✓ the five functions and the shared lock are the reviewed builds")
before = {fn: vjwt(fn) for fn in FNS}
if any(v is None for v in before.values()): bad("could not read how these functions are set: " + ", ".join(f for f, v in before.items() if v is None)); say("  Nothing was changed."); done(4)
say("  ✓ each function's gateway setting read; kept on redeploy")
ok, vx = sql("""select to_regclass('vault.decrypted_secrets') is not null and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'vault' and p.proname = 'create_secret') as v, exists (select 1 from pg_extension where extname = 'pg_net') as n""")
if not ok or not vx or not vx[0]["v"] or not vx[0]["n"]: bad("the vault or pg_net is not available. Nothing was changed."); done(4)
jobs = {}
for job, fn in JOBS.items():
    ok, r = sql(f"select jobid, schedule, active, command from cron.job where jobname = {lit(job)}")
    if not ok or not r or len(r) != 1: bad(f"the schedule {job} was not found (exactly once). Nothing was changed."); done(4)
    cmd = r[0]["command"] or ""
    m = re.search(r"url\s*:=\s*'([^']+)'", cmd); body = re.search(r"body\s*:=\s*'([^']*)'::jsonb", cmd); to = re.search(r"timeout_milliseconds\s*:=\s*(\d+)", cmd)
    if not m or not m.group(1).split("?")[0].endswith("/functions/v1/" + fn) or (body and body.group(1).strip() != "{}"):
        bad(f"{job} does not look as expected (it should call {fn} with an empty body). Nothing was changed."); done(4)
    jobs[job] = {"schedule": r[0]["schedule"], "active": r[0]["active"], "url": m.group(1).split("?")[0], "timeout": int(to.group(1)) if to else None}
    say(f"  ✓ {job}: {r[0]['schedule']}, {'on' if r[0]['active'] else 'paused'}, calls {fn}")
k = keys(); ANON = k.get("anon", ""); SVC = k.get("service_role", "")
if not ANON or not SVC: bad("could not read the project's keys. Nothing was changed."); done(4)
HIDE += [ANON, SVC]

say(); say("PART 2 · CHANGE")
SECRET = pysecrets.token_urlsafe(48); HIDE.append(SECRET)
s, _ = http("POST", f"{API}/v1/projects/{REF}/secrets", [{"name": FN_SECRET, "value": SECRET}], MG())
if s not in (200, 201): bad(f"could not save the functions' secret (HTTP {s}). Nothing else was changed."); done(5)
ok, _ = sql(f"""do $v$ begin
  if exists (select 1 from vault.secrets where name = {lit(VAULT_NAME)}) then
    perform vault.update_secret((select id from vault.secrets where name = {lit(VAULT_NAME)}), {lit(SECRET)});
  else
    perform vault.create_secret({lit(SECRET)}, {lit(VAULT_NAME)}, 'scheduled Hub jobs: server-only secret (S3 2026-09-28)');
  end if; end $v$;""")
ok2, rv = sql(f"select count(*)::int as n, bool_and(decrypted_secret = {lit(SECRET)}) as same from vault.decrypted_secrets where name = {lit(VAULT_NAME)}")
if not ok or not ok2 or not rv or rv[0]["n"] != 1 or rv[0]["same"] is not True: bad("the secret could not be stored in the vault. Functions were not deployed; the schedules are unchanged."); done(5)
say("  ✓ a new server-only secret saved in the function settings and the vault (not shown)")
for job, j in jobs.items():
    command = ("select net.http_post(url := " + lit(j["url"]) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
               "'Authorization', " + lit("Bearer " + ANON) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
               "body := '{}'::jsonb" + (f", timeout_milliseconds := {j['timeout']}" if j["timeout"] else "") + ");")
    ok, r = sql(f"select cron.schedule({lit(job)}, {lit(j['schedule'])}, {lit(command)}) as id")
    if ok and r and j["active"] is False: sql(f"select cron.alter_job({int(r[0]['id'])}, active := false)")
    ok2, r2 = sql(f"select schedule, active, command from cron.job where jobname = {lit(job)}")
    c = (r2[0]["command"] or "") if ok2 and r2 else ""
    if ok and ok2 and r2 and len(r2) == 1 and r2[0]["schedule"] == j["schedule"] and r2[0]["active"] == j["active"] and "x-cron-secret" in c and "vault.decrypted_secrets" in c and SECRET not in c:
        say(f"  ✓ {job} now sends the secret from the vault: same time ({j['schedule']}), {'on' if j['active'] else 'paused'} as before")
    else: bad(f"{job} could not be updated. Functions were not deployed (the old code ignores the new header, so nothing is broken)."); done(6)
for fn in FNS:
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if before[fn] else ["--no-verify-jwt"]),
                       cwd=os.path.dirname(os.path.dirname(FNROOT)), env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: bad(f"{fn} deploy failed: " + (p.stderr or p.stdout)[-240:]); say("  STOP. Functions above this line have the lock; the rest run as before. Tell Claude."); done(7)
    say(f"  ✓ {fn} deployed")
after = {fn: vjwt(fn) for fn in FNS}
if after != before: bad("a gateway setting changed: " + str(after))
else: say("  ✓ every gateway setting is exactly as before")

say(); say("PART 3 · LIVE PROOF (auth checks only; no job runs, nothing is sent or written)")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
F = lambda fn: f"{FNB}/functions/v1/{fn}?auth_check=1"
for fn in FNS:
    r0 = http("POST", F(fn), {}, {})[0]
    r1 = http("POST", F(fn), {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
    r2 = http("POST", F(fn), {}, {"apikey": ANON, "Authorization": "Bearer " + ANON, "x-cron-secret": "x" * 64})[0]
    s3, b3 = http("POST", F(fn), {}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
    good = r0 == 401 and r1 == 401 and r2 == 401 and s3 == 200 and jget(b3, "caller") == "owner"
    (say if good else bad)(("  ✓ " if good else "") + f"{fn}: no key {r0}, public key {r1}, wrong secret {r2} → refused · your server key {s3} → accepted")
for job, fn in JOBS.items():
    ok, rq = sql("select net.http_post(url := " + lit(F(fn)) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
                 "'Authorization', " + lit("Bearer " + ANON) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), body := '{}'::jsonb) as id")
    got = None; waited = 0.0
    while ok and rq and waited <= POLL_MAX:
        ok3, rr = sql(f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
        if ok3 and rr: got = rr[0]; break
        time.sleep(POLL); waited += POLL
    if got and got["status_code"] == 200 and jget(got["content"], "caller") == "cron": say(f"  ✓ {job}: the schedule's own call from the database is accepted (check only; nothing ran)")
    else: bad(f"{job}: the schedule's call was not accepted: " + (f"HTTP {got['status_code']}" if got else "no answer"))
say()
say("RESULT: " + ("DONE · the five jobs answer only their schedules, your server key, and (the reference follow-up) signed-in office staff." if not fails else "CHECK THE ✗ LINES."))
say("No secret, key, name or number was printed. Rollback if ever needed: redeploy the five functions from the commit before this one (the schedules can stay: the old code ignores the header).")
done(0 if not fails else 8)
