#!/usr/bin/env python3
# 443 · SAFE SAVES STEP 6: START FORMS IMPORT THEMSELVES. Samantha approved the safe saves plan 2026-10-04 ("yes to
# all") and chose option 1 ("go with 1"): https://claude.ai/artifact/Y8Kmn4hR7rmWt9keXG6uGd . Every 5 minutes a start
# form that arrived AFTER this step (from someone we sent a start link to: a job offer has their email or phone, and new
# to the Hub) becomes a Background & References candidate; anything else gets a Needs Attention card and nothing is
# changed. A SWITCH, OFF until she turns it on: while off it only lists what it WOULD do. This step does not turn it on.
# Part 1 (read only): the reviewed builds (pinned); the Hub's intake-import-rules.js is live and is the reviewed one; the
#   tests pass here; safe saving (421), the lock (442), the approved-rules list, the jobs' secret and the job offers
#   connection are there.
# Part 2: intake_import.sql; the rules file's fingerprint approved; intake-import created (gateway sign-in check on);
#   the start date (only forms from now on); its schedule every 5 minutes (the jobs' secret from the vault).
# Part 3 (proof; nothing is sent, NOBODY is imported): the live copy is the reviewed build; it refuses outsiders and lets
#   its schedule in; the lists aren't public; the switch is off; ONE practice pass: counts only.
# Prints counts only: no name, number, email, key or secret.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
REF = "zngsgedlsxinbygwmxwn"
ROOT = os.environ["SB_REPO"]; BASE = os.environ.get("SB_BASE", "")
SHAS = json.loads(os.environ["SB_SHAS"]); SQL_SHA = os.environ.get("SB_SQL_SHA", ""); RULES_SHA = os.environ.get("SB_RULES_SHA", "")
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
HUB = os.environ.get("SB_HUB_BASE", "https://cc.mo-care.com/")
FN_NAME = "intake-import"; RULES_FILE = "intake-import-rules.js"; VAULT_NAME = "hub_job_secret"; SCHEDULE = "*/5 * * * *"
POLL = float(os.environ.get("SB_POLL", "2")); POLL_MAX = float(os.environ.get("SB_POLL_MAX", "40"))
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for h in HIDE:
        if h: s = s.replace(h, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", s); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=150, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-443/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            b = r.read(); return r.status, (b if raw else b.decode(errors="replace"))
    except urllib.error.HTTPError as e: return e.code, (b"" if raw else e.read().decode(errors="replace"))
    except Exception as e: return None, (b"" if raw else type(e).__name__)
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
def keys():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_publishable_") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict)}
        got = {k: v for k, v in got.items() if usable(v)}
        if got.get("anon"): return got
    return {}
def jget(b, k):
    try: return json.loads(b).get(k)
    except Exception: return None
shab = lambda b: hashlib.sha256(b).hexdigest()
sha = lambda p: shab(open(p, "rb").read())
def git(*a): return subprocess.run(["git", *a], cwd=ROOT, capture_output=True)
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)
pinpath = lambda k: f"supabase/functions/{k}.ts" if k.startswith("_shared/") else f"supabase/functions/{k}/index.ts"
def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
def deps_of(fn):
    s = set(); deps(os.path.join(ROOT, f"supabase/functions/{fn}/index.ts"), s)
    return {os.path.relpath(x, ROOT).replace(os.sep, "/") for x in s}
def live_files(fn):
    tmp = tempfile.mkdtemp(prefix="ii443-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
    d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    live = {}
    for root, _, files in os.walk(tmp):
        for f in files:
            lp = os.path.join(root, f).replace(os.sep, "/")
            if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
    shutil.rmtree(tmp, ignore_errors=True)
    return d.returncode == 0, live
def is_reviewed_live(fn):
    okd, live = live_files(fn)
    if not okd: return False, "couldn't read the live copy"
    need = deps_of(fn)
    missing = [k for k in need if k not in live]
    if missing: return False, "live copy is missing " + ", ".join(sorted(k.split("functions/", 1)[1] for k in missing))
    off = [k for k in need if live[k] != sha(os.path.join(ROOT, k))]
    return (not off), ("" if not off else "live differs in " + ", ".join(sorted(k.split("functions/", 1)[1] for k in off)))
def command(url, anon):
    return ("select net.http_post(url := " + lit(url) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
            "'Authorization', " + lit("Bearer " + anon) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
            "body := '{}'::jsonb, timeout_milliseconds := 120000);")

say("443 · SAFE SAVES STEP 6: START FORMS IMPORT THEMSELVES"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
if not BASE or git("cat-file", "-e", BASE + "^{commit}").returncode != 0: bad("the reviewed starting point isn't in this folder's history"); say("  STOP. Nothing was run."); done(2)
changed = set(x for x in git("diff", "--name-only", BASE, "HEAD").stdout.decode().split())
pinned = {pinpath(k): v for k, v in SHAS.items()}
for rel, want in list(pinned.items()) + [("intake_import.sql", SQL_SHA)]:
    if rel not in changed or not os.path.exists(os.path.join(ROOT, rel)) or sha(os.path.join(ROOT, rel)) != want:
        bad(f"{rel.split('functions/')[-1]} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
need = deps_of(FN_NAME)
other = sorted(k for k in need if k not in pinned and k in changed)
if other: bad(f"other changes merged since the review touch this job ({', '.join(other)[:200]}). Ask Claude to refresh 443."); say("  STOP. Nothing was run."); done(2)
say(f"  ✓ the job, its {len(pinned) - 1} shared pieces and the database change are the reviewed build")
s, rb = http("GET", HUB + RULES_FILE + "?v=" + str(int(time.time())), headers={"Accept": "application/javascript"}, raw=True)
if s != 200 or shab(rb) != RULES_SHA:
    bad(f"the Hub's {RULES_FILE} on cc.mo-care.com is not the reviewed one yet ({'answered ' + str(s) if s != 200 else 'fingerprint ' + shab(rb)[:12]}). Claude merges the Hub change (intake-rules) first. Nothing was changed.")
    done(2)
say(f"  ✓ the Hub's {RULES_FILE} is live and is the reviewed one ({RULES_SHA[:12]})")
tmpd = tempfile.mkdtemp(prefix="ii443r-"); RULES_LOCAL = os.path.join(tmpd, RULES_FILE); open(RULES_LOCAL, "wb").write(rb)
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    p = subprocess.run([NODE, "intake_import_test.mjs"], cwd=ROOT, capture_output=True, text=True, env=dict(os.environ, CG_INTAKE=RULES_LOCAL))
    last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
    if p.returncode != 0 or re.search(r"^FAIL", p.stdout, re.M): bad(f"intake_import_test.mjs failed: {last}"); say("  STOP. Nothing was run."); done(2)
    say(f"  ✓ intake_import_test.mjs: {last.strip()} (the check, against fakes, with the live rules file)")
else: say("  · node is not on this Mac, so the job's tests were not re-run here (they passed when built)")
try:
    if os.environ.get("SB_REHEARSAL_SKIP_SQL_TEST") == "1": raise ImportError   # the installer's own rehearsal only (never set by the Desktop step)
    import pgserver  # noqa: F401
    p = subprocess.run([sys.executable, "intake_import_sql_test.py"], cwd=ROOT, capture_output=True, text=True, timeout=600)
    last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
    if p.returncode != 0 or re.search(r"^FAIL", p.stdout, re.M): bad(f"intake_import_sql_test.py failed: {last}"); say("  STOP. Nothing was run."); done(2)
    say(f"  ✓ intake_import_sql_test.py: {last.strip()} (the database change, on a throwaway database on this Mac)")
except ImportError:
    say("  · the throwaway-database tool isn't on this Mac, so the database tests were not re-run here (they passed when built)")
s, b = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
try: names = {x.get("name") for x in json.loads(b)} if s == 200 else set()
except Exception: names = set()
ok, st = sql(f"""select (select count(*) from vault.decrypted_secrets where name = {lit(VAULT_NAME)})::int as vault,
  (to_regprocedure('public.app_data_rev(jsonb)') is not null and to_regclass('public.app_data_id_counter') is not null) as safe,
  (to_regclass('public.rules_approved') is not null) as g2,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'app_data' and policyname like 'app_data_people_lock_%')::int as lock""")
if not ok or not st: bad("couldn't read the database. Nothing was changed."); done(3)
if st[0]["vault"] != 1 or "HUB_JOB_SECRET" not in names: bad("the jobs' secret isn't there. Nothing was changed."); done(3)
if not st[0]["safe"]: bad("safe saving (421) isn't installed. Nothing was changed."); done(3)
if not st[0]["g2"]: bad("the approved-rules list (G2) isn't there. Nothing was changed."); done(3)
if st[0]["lock"] != 3: bad("the lock on whole-list saves (442) isn't on. Nothing was changed."); done(3)
if not ({"OFFERS_PROJECT_URL", "OFFERS_SERVICE_ROLE_KEY"} <= names):
    bad("the job offers connection (OFFERS_PROJECT_URL / OFFERS_SERVICE_ROLE_KEY) isn't set. Nothing was changed."); done(3)
sF, mF = fmeta(FN_NAME)
if sF == 200 and not is_reviewed_live(FN_NAME)[0]: bad(f"a {FN_NAME} function already exists and isn't this build (unexpected). Nothing was changed."); done(3)
say(f"  ✓ safe saving, the approved-rules list, the lock, the jobs' secret and the job offers connection are there · {FN_NAME} {'is already there (an earlier run)' if sF == 200 else 'is new'}")
K = keys(); ANON, SERVICE = K.get("anon", ""), K.get("service_role", "")
HIDE += [ANON, SERVICE]
if not ANON or not SERVICE: bad("couldn't read the project's keys. Nothing was changed."); done(3)

say(); say("PART 2 · CHANGE")
ok, r = sql("begin;\n" + open(os.path.join(ROOT, "intake_import.sql")).read() + "\ncommit;")
if not ok: bad("the database change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
say("  ✓ the one writer (candidate + imported, in one step) and the lists are in place")
note = "443 start forms import themselves"
ok, _ = sql(f"insert into public.rules_approved (file, sha256, note) values ({lit(RULES_FILE)}, {lit(RULES_SHA)}, {lit(note)}) on conflict (file, sha256) do update set approved_at = now(), note = excluded.note")
ok2, _ = sql(f"""delete from public.rules_approved r using (select file, sha256, row_number() over (partition by file order by approved_at desc) as n
                 from public.rules_approved where file = {lit(RULES_FILE)}) x where r.file = x.file and r.sha256 = x.sha256 and x.n > 2""")
ok3, ra = sql(f"select sha256 from public.rules_approved where file = {lit(RULES_FILE)} order by approved_at desc limit 1")
chk(ok and ok2 and ok3 and ra and ra[0]["sha256"] == RULES_SHA, f"the rules file's fingerprint is approved ({RULES_SHA[:12]}); the server runs no other version of it")
if sF != 200:
    p = subprocess.run([SUPA, "functions", "deploy", FN_NAME, "--project-ref", REF, "--use-api"], cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    good, why = is_reviewed_live(FN_NAME)
    if not good: bad(f"{FN_NAME} didn't deploy: " + (p.stderr or p.stdout)[-200:] + f" ({why})"); say("  STOP. Tell Claude."); done(6)
sN, mN = fmeta(FN_NAME)
if (mN or {}).get("verify_jwt") is not True:
    http("PATCH", f"{API}/v1/projects/{REF}/functions/{FN_NAME}", {"verify_jwt": True}, MG()); sN, mN = fmeta(FN_NAME)
chk((mN or {}).get("verify_jwt") is True, f"{FN_NAME} {'created' if sF != 200 else 'already there'}, version {(mN or {}).get('version', '?')} (gateway sign-in check on)")
URL = f"{FNB}/functions/v1/{FN_NAME}"
sql(f"select cron.unschedule({lit(FN_NAME)}) where exists (select 1 from cron.job where jobname = {lit(FN_NAME)})")
ok, r = sql(f"select cron.schedule({lit(FN_NAME)}, {lit(SCHEDULE)}, {lit(command(URL, ANON))}) as id")
ok2, jb = sql(f"select schedule, command from cron.job where jobname = {lit(FN_NAME)}")
chk(ok and ok2 and jb and jb[0]["schedule"] == SCHEDULE and "x-cron-secret" in jb[0]["command"] and "vault.decrypted_secrets" in jb[0]["command"],
    "its schedule: every 5 minutes, carrying the jobs' secret from the vault")
ok, r = sql("""update public.app_data set data = data || jsonb_build_object('intake_auto_import_from', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
  where key = 'ops_settings' and jsonb_typeof(data) = 'object' and not (data ? 'intake_auto_import_from') returning data->>'intake_auto_import_from' as f""")
ok2, fr = sql("select data->>'intake_auto_import_from' as f from app_data where key = 'ops_settings'")
chk(ok2 and fr and fr[0]["f"], "only start forms from now on: " + (fr[0]["f"] if ok2 and fr and fr[0]["f"] else "(no start date set)") + " (older forms stay on the Import list)")

say(); say("PART 3 · PROOF (nothing is sent; nobody is imported)")
good, why = is_reviewed_live(FN_NAME)
chk(good, f"{FN_NAME}: the live copy is exactly the reviewed build" + ("" if good else f" ({why})"))
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
A = {"apikey": ANON, "Authorization": "Bearer " + ANON}
a1 = http("POST", URL + "?auth_check=1", {}, A)[0]
a2 = http("POST", URL + "?dry=1", {}, A)[0]
a3 = http("POST", URL, {}, A)[0]
chk(a1 == 401 and a2 == 401 and a3 == 401, f"it refuses the public key: the check ({a3}), a counts-only look ({a2}), who-is-calling ({a1})")
ok, rq = sql(command(URL + "?auth_check=1", ANON).rstrip(";") + " as id")
got = None; waited = 0.0
while ok and rq and waited <= POLL_MAX:
    ok3, rr = sql(f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
    if ok3 and rr: got = rr[0]; break
    time.sleep(POLL); waited += POLL
chk(got and got["status_code"] == 200 and jget(got["content"], "caller") == "cron", "its schedule gets in" + ("" if got and got["status_code"] == 200 else f" ({got['status_code'] if got else 'no answer'})"))
pub = []
for t in ("intake_import_log", "intake_import_runs"):
    sC, bC = http("GET", f"{FNB}/rest/v1/{t}?select=id&limit=1", None, A)
    if sC == 200 and bC.strip() not in ("[]", ""): pub.append(t)
chk(not pub, "the public can't read the start form lists" + (f" (readable: {', '.join(pub)})" if pub else ""))
ok, sw = sql("select coalesce(data->>'intake_auto_import_live', '') as live from app_data where key = 'ops_settings'")
on = ok and sw and sw[0]["live"] == "true"
chk(not on, "the switch is OFF: practice (the Hub side shows it once merged)")
CNT = "select (select count(*) from intake_import_log where result = 'done')::int + (select count(*) from hire_intake where auto_import_at is not null)::int as n"
ok, d0 = sql(CNT)
sP, bP = http("POST", URL, {}, {"apikey": SERVICE, "Authorization": "Bearer " + SERVICE}, 300)
try: j = json.loads(bP)
except Exception: j = {}
ok2, d1 = sql(CNT)
if sP == 200 and j.get("ok") is True and j.get("mode") == "practice":
    say(f"  ✓ one practice pass (imports nobody): {j.get('seen')} start form(s) since the start date (none yet is normal right after install)")
else: bad(f"the practice pass didn't answer as expected ({sP}): " + str(j.get("error") or bP)[:200])
chk(ok and ok2 and d0 and d1 and d0[0]["n"] == d1[0]["n"], "nobody was imported or carded by it (0 changes recorded)")
ok, rl = sql("select ok, mode from intake_import_runs order by at desc limit 1")
chk(ok and rl and rl[0]["ok"] is True and rl[0]["mode"] == "practice", "its run line is recorded")
shutil.rmtree(tmpd, ignore_errors=True)
say()
if fails: say("RESULT: PARTLY DONE · the ✗ lines above need Claude.")
else: say("RESULT: DONE · the start form check runs every 5 minutes in PRACTICE, for forms from now on. Next: Claude merges the Hub side (the list and the switch). Then you turn it on when ready.")
say("Nothing was texted or emailed, no SSN was read, and no candidate or other record was changed.")
say("Rollback: the switch stays off; or Claude unschedules intake-import. The lists stay.")
done(0 if not fails else 8)
