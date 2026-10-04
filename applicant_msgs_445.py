#!/usr/bin/env python3
# 445 · NOT HIRING / CANDIDATE POOL MESSAGES AND THE ORIENTATION REMINDER. Samantha approved 2026-10-04 ("yes to all",
# decisions 3 and 4 of https://claude.ai/artifact/MQgrEVdZ8Kr65LBLsha1Aq).
#   applicant-decision-msg (new): the office's kind message after "Not hiring" / "Candidate pool" (only on OK).
#   orientation-remind (new, hourly, acts 10am to 6pm Central): the day-before orientation text, replacing the
#     GoHighLevel workflow. Its switch stays OFF (practice) until she turns it on in Settings.
#   applicant_msgs_445.sql: four columns on job_applicants; the reminder lists (staff read, server writes).
# Part 1 (read only): the reviewed builds (pinned); both functions are new (or already this build); the tests pass
#   here; the jobs' secret and the GoHighLevel connection are there. Part 2: the database change, both functions, the
#   hourly schedule. Part 3 (proof; nothing is sent): live copies are the reviewed builds; both refuse outsiders; the
#   schedule gets in; the lists aren't public; the switch is off; one counts-only look writes nothing.
# Prints counts only: no name, number, email, key or secret.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
HUB_REF = "zngsgedlsxinbygwmxwn"
HUB = os.environ["SB_REPO"]; HUB_BASE = os.environ.get("SB_BASE", "")
HUB_SHAS = json.loads(os.environ["SB_SHAS"]); SQL_SHA = os.environ.get("SB_SQL_SHA", "")
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB_REF}.supabase.co")
VAULT_NAME = "hub_job_secret"; SCHEDULE = "2 * * * *"; REMIND = "orientation-remind"; DECIDE = "applicant-decision-msg"
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
def http(method, url, body=None, headers=None, timeout=200, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-445/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            b = r.read(); return r.status, (b if raw else b.decode(errors="replace"))
    except urllib.error.HTTPError as e: return e.code, (b"" if raw else e.read().decode(errors="replace"))
    except Exception as e: return None, (b"" if raw else type(e).__name__)
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{HUB_REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def fmeta(ref, fn):
    s, b = http("GET", f"{API}/v1/projects/{ref}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
def secrets(ref):
    s, b = http("GET", f"{API}/v1/projects/{ref}/secrets", headers=MG())
    try: return {x.get("name") for x in json.loads(b)} if s == 200 else set()
    except Exception: return set()
def keys(ref):
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_publishable_") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{ref}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict)}
        got = {k: v for k, v in got.items() if usable(v)}
        if got.get("anon"): return got
    return {}
shab = lambda b: hashlib.sha256(b).hexdigest()
sha = lambda p: shab(open(p, "rb").read())
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)
pinpath = lambda k: f"supabase/functions/{k}.ts" if k.startswith("_shared/") else f"supabase/functions/{k}/index.ts"
def git(root, *a): return subprocess.run(["git", *a], cwd=root, capture_output=True)
def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
def need(root, fn):
    s = set(); deps(os.path.join(root, f"supabase/functions/{fn}/index.ts"), s)
    return {os.path.relpath(x, root).replace(os.sep, "/") for x in s}
def live_files(ref, fn):
    tmp = tempfile.mkdtemp(prefix="am445-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
    d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", ref, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    live = {}
    for r, _, files in os.walk(tmp):
        for f in files:
            lp = os.path.join(r, f).replace(os.sep, "/")
            if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
    shutil.rmtree(tmp, ignore_errors=True)
    return d.returncode == 0, live
def base_sha(root, base, rel):
    b = git(root, "show", f"{base}:{rel}")
    return shab(b.stdout) if b.returncode == 0 else None
def reviewed(root, base, shas, label, extra=()):
    if not base or git(root, "cat-file", "-e", base + "^{commit}").returncode != 0: bad(f"the reviewed starting point isn't in the {label} history"); say("  STOP. Nothing was run."); done(2)
    changed = set(git(root, "diff", "--name-only", base, "HEAD").stdout.decode().split())
    for rel, want in [(pinpath(k), v) for k, v in shas.items()] + list(extra):
        if rel not in changed or not os.path.exists(os.path.join(root, rel)) or sha(os.path.join(root, rel)) != want:
            bad(f"{label}: {rel.split('functions/')[-1]} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
    return changed
def state(ref, root, base, fn, pinned):
    """'new' | 'base' | 'this' | 'other' for one live function, with its gateway setting."""
    s, m = fmeta(ref, fn)
    if s == 404: return "new", None
    vj = (m or {}).get("verify_jwt")
    okd, live = live_files(ref, fn)
    if not okd or not isinstance(vj, bool): return "unreadable", vj
    nd = need(root, fn)
    if all(k in live and live[k] == sha(os.path.join(root, k)) for k in nd): return "this", vj
    if all((k in live and live[k] == base_sha(root, base, k)) or (k not in live and base_sha(root, base, k) is None and k in pinned) for k in nd): return "base", vj
    return "other", vj
def deploy(ref, root, fn, vj, label):
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", ref, "--use-api"] + ([] if vj in (True, None) else ["--no-verify-jwt"]), cwd=root, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    okd, live = live_files(ref, fn)
    good = okd and all(k in live and live[k] == sha(os.path.join(root, k)) for k in need(root, fn))
    if not good: bad(f"{label} {fn} didn't deploy: " + (p.stderr or p.stdout)[-200:]); return False
    want = True if vj is None else vj
    sN, mN = fmeta(ref, fn)
    if (mN or {}).get("verify_jwt") != want:
        http("PATCH", f"{API}/v1/projects/{ref}/functions/{fn}", {"verify_jwt": want}, MG()); sN, mN = fmeta(ref, fn)
    chk((mN or {}).get("verify_jwt") == want, f"{label}: {fn} deployed, version {(mN or {}).get('version', '?')} (gateway sign-in check {'on' if want else 'off'})")
    return True

def lit(v): return "'" + str(v).replace("'", "''") + "'"
def jget(b, k):
    try: return json.loads(b).get(k)
    except Exception: return None
def command(url, anon):
    return ("select net.http_post(url := " + lit(url) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
            "'Authorization', " + lit("Bearer " + anon) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
            "body := '{}'::jsonb, timeout_milliseconds := 120000);")

say("445 · NOT HIRING / CANDIDATE POOL MESSAGES AND THE ORIENTATION REMINDER"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
reviewed(HUB, HUB_BASE, HUB_SHAS, "the Hub server", [("applicant_msgs_445.sql", SQL_SHA)])
pinned = {pinpath(k) for k in HUB_SHAS}
for fn in (DECIDE, REMIND):
    other = sorted(k for k in need(HUB, fn) if k not in pinned and base_sha(HUB, HUB_BASE, k) != sha(os.path.join(HUB, k)))
    if other: bad(f"other changes merged since the review touch {fn} ({', '.join(other)[:200]}). Ask Claude to refresh 445."); say("  STOP. Nothing was run."); done(2)
say("  ✓ the two new functions, their shared piece and the database change are the reviewed build")
plan = []
for fn in (DECIDE, REMIND):
    st, vj = state(HUB_REF, HUB, HUB_BASE, fn, pinned)
    if st not in ("new", "this"): bad(f"a {fn} function already exists and isn't this build (unexpected). Nothing was changed. Tell Claude."); done(3)
    plan.append((fn, st)); say(f"  ✓ {fn}: " + ("is new" if st == "new" else "already has this build (an earlier run)"))
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    for t in ("applicant_msgs_test.mjs", "noshow_test.mjs"):
        p = subprocess.run([NODE, t], cwd=HUB, capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0 or re.search(r"^FAIL", p.stdout, re.M): bad(f"{t} failed: {last}"); say("  STOP. Nothing was changed."); done(2)
        say(f"  ✓ {t}: {last.strip()}")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
hs = secrets(HUB_REF)
ok, st = sql(f"select (select count(*) from vault.decrypted_secrets where name = {lit(VAULT_NAME)})::int as vault, (to_regclass('public.orient_bookings') is not null) as ob")
if not ok or not st: bad("couldn't read the database. Nothing was changed."); done(3)
if st[0]["vault"] != 1 or "HUB_JOB_SECRET" not in hs: bad("the jobs' secret isn't there. Nothing was changed."); done(3)
if not ({"GHL_TOKEN", "GHL_LOCATION_ID"} <= hs): bad("the GoHighLevel connection (GHL_TOKEN / GHL_LOCATION_ID) isn't set. Nothing was changed."); done(3)
if not st[0]["ob"]: bad("the orientation bookings table isn't there (unexpected). Nothing was changed."); done(3)
say("  ✓ the jobs' secret and the GoHighLevel connection are there")
K = keys(HUB_REF); ANON, SERVICE = K.get("anon", ""), K.get("service_role", ""); HIDE += [ANON, SERVICE]
if not ANON or not SERVICE: bad("couldn't read the Hub's keys. Nothing was changed."); done(3)

say(); say("PART 2 · CHANGE")
ok, r = sql("begin;\n" + open(os.path.join(HUB, "applicant_msgs_445.sql")).read() + "\ncommit;")
if not ok: bad("the database change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
say("  ✓ applicants can carry their message (sent / waiting); the reminder lists are in place")
for fn, st in plan:
    if st == "this": say(f"  ✓ {fn} already had it"); continue
    if not deploy(HUB_REF, HUB, fn, True, "Hub"): say("  STOP. Tell Claude."); done(6)
URL = f"{FNB}/functions/v1/{REMIND}"
sql(f"select cron.unschedule({lit(REMIND)}) where exists (select 1 from cron.job where jobname = {lit(REMIND)})")
ok, r = sql(f"select cron.schedule({lit(REMIND)}, {lit(SCHEDULE)}, {lit(command(URL, ANON))}) as id")
ok2, jb = sql(f"select schedule, command from cron.job where jobname = {lit(REMIND)}")
chk(ok and ok2 and jb and jb[0]["schedule"] == SCHEDULE and "x-cron-secret" in jb[0]["command"] and "vault.decrypted_secrets" in jb[0]["command"],
    "the reminder check's schedule: every hour (it only acts 10am to 6pm Central), carrying the jobs' secret from the vault")

say(); say("PART 3 · PROOF (nothing is sent)")
for fn, st in plan:
    okd, live = live_files(HUB_REF, fn)
    chk(okd and all(k in live and live[k] == sha(os.path.join(HUB, k)) for k in need(HUB, fn)), f"{fn}: the live copy is exactly the reviewed build")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
A = {"apikey": ANON, "Authorization": "Bearer " + ANON}
DU = f"{FNB}/functions/v1/{DECIDE}"
d1 = http("POST", DU, {"action": "preview", "id": "00000000-0000-0000-0000-000000000000", "kind": "declined"}, A)[0]
d2 = http("POST", DU, {"action": "send", "id": "00000000-0000-0000-0000-000000000000", "kind": "declined"}, A)[0]
chk(d1 in (401, 403) and d2 in (401, 403), f"the message service refuses anyone not signed in as office staff (preview {d1}, send {d2})")
c1 = http("OPTIONS", DU, None, {"Origin": "https://cc.mo-care.com", "Access-Control-Request-Method": "POST"})[0]
chk(c1 == 200, f"the Hub can reach it ({c1})")
a1 = http("POST", URL + "?auth_check=1", {}, A)[0]; a2 = http("POST", URL + "?dry=1", {}, A)[0]; a3 = http("POST", URL, {}, A)[0]
chk(a1 == 401 and a2 == 401 and a3 == 401, f"the reminder check refuses the public key (the check {a3}, a counts-only look {a2}, who-is-calling {a1})")
ok, rq = sql(command(URL + "?auth_check=1", ANON).rstrip(";") + " as id")
got = None; waited = 0.0
while ok and rq and waited <= POLL_MAX:
    ok3, rr = sql(f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
    if ok3 and rr: got = rr[0]; break
    time.sleep(POLL); waited += POLL
chk(got and got["status_code"] == 200 and jget(got["content"], "caller") == "cron", "its schedule gets in" + ("" if got and got["status_code"] == 200 else f" ({got['status_code'] if got else 'no answer'})"))
pub = []
for t in ("orient_reminders", "orient_remind_runs"):
    sC, bC = http("GET", f"{FNB}/rest/v1/{t}?select=id&limit=1", None, A)
    if sC == 200 and bC.strip() not in ("[]", ""): pub.append(t)
chk(not pub, "the public can't read the reminder lists" + (f" (readable: {', '.join(pub)})" if pub else ""))
ok, cols = sql("select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'job_applicants' and column_name in ('decision_msg_at','decision_msg_kind','decision_msg_by','decision_msg_held_at')")
chk(ok and cols and cols[0]["n"] == 4, "applicants have the four message columns")
ok, sw = sql("select coalesce(data->>'orient_remind_live', '') as live from app_data where key = 'ops_settings'")
chk(ok and sw and sw[0]["live"] != "true", "the reminder switch is OFF: practice (it lists who it would remind; GoHighLevel keeps sending until you switch over)")
CNT = "select (select count(*) from orient_reminders)::int + (select count(*) from orient_remind_runs)::int as n"
ok, n0 = sql(CNT)
sD, bD = http("POST", URL + "?dry=1", {}, {"apikey": SERVICE, "Authorization": "Bearer " + SERVICE}, 200)
try: j = json.loads(bD)
except Exception: j = {}
ok2, n1 = sql(CNT)
if sD == 200 and j.get("ok") is True and j.get("dry") is True:
    say(f"  ✓ a counts-only look: {j.get('sessions', 0)} orientation session(s) tomorrow, {j.get('due', 0)} person(s) it would remind, {j.get('skipped', 0)} it would skip")
else: bad(f"the counts-only look didn't answer as expected ({sD}): " + str(j.get("error") or bD)[:200])
chk(ok and ok2 and n0 and n1 and n0[0]["n"] == n1[0]["n"], "the look wrote nothing and sent nothing")
say()
say("RESULT: " + ("DONE · the Not hiring / Candidate pool messages are ready (the Hub side shows them once Claude merges it), and the orientation reminder runs in PRACTICE." if not fails else "PARTLY DONE · the ✗ lines above need Claude."))
say("Nothing was texted or emailed, and no applicant or booking was changed.")
say("Rollback: Claude unschedules orientation-remind; the message service is only used when someone presses OK. The lists and columns stay.")
done(0 if not fails else 8)
