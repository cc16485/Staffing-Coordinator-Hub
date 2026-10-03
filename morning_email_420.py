#!/usr/bin/env python3
# 420 · THE MORNING EMAIL AT 8AM, WITH TODAY'S INTERVIEWS AND ASSESSMENTS. Samantha 2026-10-02: "can interviews and
# booked assessments be on 'Today' and also be in the email that goes out every morning - also make that email send at
# 8am not 7am - also mark interviews 2pm and after as Samantha's interviews".
# The Hub project (zngsgedlsxinbygwmxwn) only:
#   lead-digest (the Morning Brief) lists today's interviews (2pm and later marked as Samantha's) and today's booked
#   assessments, sends only in Chicago's 8 o'clock hour, and says so in the email if either list can't be loaded.
#   morning_email_420.sql moves its two weekday schedules from 11:45/12:45 UTC to 13:00/14:00 UTC (times only).
# Part 1 (read only): the reviewed builds (pinned, the SQL too), the tests pass, the two schedules are found as expected,
#   the tables the email reads exist, how many interviews are on today's list.
# Part 2, in this order: the schedule times FIRST (the old code still sends inside its 6-9am window, so if the deploy
#   then fails the brief simply arrives at 8am); then lead-digest, only if its live copy is today's GitHub main (or
#   already this build), keeping its gateway setting.
# Part 3 (proof, NOTHING is sent): the schedules read back with their commands untouched; the live copy is the reviewed
#   build; the public key is refused; the schedule's own door answers a sign-in check only (auth_check, which returns
#   before anything is read or sent); when the next brief goes.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
REF = "zngsgedlsxinbygwmxwn"
ROOT = os.environ["SB_REPO"]; BASE = os.environ.get("SB_BASE", "")
SHAS = json.loads(os.environ["SB_SHAS"]); SQL_SHA = os.environ.get("SB_SQL_SHA", "")
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
SQLFILE = "morning_email_420.sql"
JOBS = {"daily-lead-digest": ("45 11 * * 1-5", "0 13 * * 1-5"), "daily-lead-digest-winter": ("45 12 * * 1-5", "0 14 * * 1-5")}
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
def http(method, url, body=None, headers=None, timeout=150):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-morning420/1.0"}, **(headers or {})))
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
def fmeta(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
def keys():
    """The project's keys. Lesson from 412: ask with ?reveal=true first, then without it. A value that isn't a usable
    key counts as missing."""
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
shab = lambda b: hashlib.sha256(b).hexdigest()
sha = lambda p: shab(open(p, "rb").read())
def git(*a): return subprocess.run(["git", *a], cwd=ROOT, capture_output=True)
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)

def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
pinpath = lambda k: f"supabase/functions/{k}.ts" if k.startswith("_shared/") else f"supabase/functions/{k}/index.ts"
def deps_of(fn):
    s = set(); deps(os.path.join(ROOT, f"supabase/functions/{fn}/index.ts"), s)
    return {os.path.relpath(x, ROOT).replace(os.sep, "/") for x in s}

def reviewed():
    if not BASE or git("cat-file", "-e", BASE + "^{commit}").returncode != 0: bad("the reviewed starting point isn't in this folder's history"); say("  STOP. Nothing was run."); done(2)
    changed = sorted(x for x in git("diff", "--name-only", BASE, "HEAD", "--", "supabase/functions").stdout.decode().split() if x.endswith(".ts") and os.path.exists(os.path.join(ROOT, x)))
    pinned = {pinpath(k): v for k, v in SHAS.items()}
    if set(changed) != set(pinned): bad(f"the list of changed files isn't the reviewed list ({', '.join(changed)[:200]})"); say("  STOP. Nothing was run."); done(2)
    for rel, want in pinned.items():
        if sha(os.path.join(ROOT, rel)) != want: bad(f"{rel.split('functions/')[1]} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
    users = []
    fnroot = os.path.join(ROOT, "supabase/functions")
    for fn in sorted(os.listdir(fnroot)):
        p = os.path.join(fnroot, fn, "index.ts")
        if fn.startswith("_") or not os.path.exists(p): continue
        used = set(); deps(p, used)
        if any(os.path.normpath(os.path.join(ROOT, c)) in used for c in changed): users.append(fn)
    say(f"  ✓ the {len(changed)} changed function file(s) are the reviewed build; functions to update: {', '.join(users)}")
    return users

def live_files(fn):
    tmp = tempfile.mkdtemp(prefix="me420-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
    d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    live = {}
    for root, _, files in os.walk(tmp):
        for f in files:
            lp = os.path.join(root, f).replace(os.sep, "/")
            if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
    shutil.rmtree(tmp, ignore_errors=True)
    return d.returncode == 0, live

def base_sha(rel):
    b = git("show", f"{BASE}:{rel}")
    return shab(b.stdout) if b.returncode == 0 else None

def deploy(fn):
    sM, m = fmeta(fn)
    if sM == 404: bad(f"{fn} is not deployed. Tell Claude."); return False
    vj = (m or {}).get("verify_jwt")
    if not isinstance(vj, bool): bad(f"{fn}: couldn't read its gateway setting, NOT changed"); return False
    okd, live = live_files(fn)
    mine = f"supabase/functions/{fn}/index.ts"
    if not okd or mine not in live: bad(f"{fn}: couldn't read its live copy, NOT changed"); return False
    need = deps_of(fn)
    if all(k in live and live[k] == sha(os.path.join(ROOT, k)) for k in need):
        say(f"  ✓ {fn} already had it"); return True
    if live[mine] != base_sha(mine):
        bad(f"{fn}: its live code is not today's GitHub main (was something else deployed?), NOT changed"); return False
    other = [k.split("supabase/functions/", 1)[1] for k in need if k != mine and (k not in live or live[k] != sha(os.path.join(ROOT, k)))]
    if other: bad(f"{fn}: live shared code differs from GitHub ({', '.join(sorted(other))[:160]}), NOT changed"); return False
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if vj else ["--no-verify-jwt"]),
                       cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: bad(f"{fn} didn't deploy: " + (p.stderr or p.stdout)[-200:]); return False
    sN, mN = fmeta(fn)
    if (mN or {}).get("verify_jwt") != vj:
        http("PATCH", f"{API}/v1/projects/{REF}/functions/{fn}", {"verify_jwt": vj}, MG()); sN, mN = fmeta(fn)
        if (mN or {}).get("verify_jwt") != vj: bad(f"{fn}: its gateway setting changed and couldn't be put back. Tell Claude."); return False
    say(f"  ✓ {fn} deployed, now version {(mN or {}).get('version', '?')} (was {(m or {}).get('version', '?')}; gateway sign-in check kept {'on' if vj else 'off'})")
    return True

def is_reviewed_live(fn):
    okd, live = live_files(fn)
    if not okd: return False, "couldn't read the live copy"
    need = deps_of(fn)
    missing = [k for k in need if k not in live]
    if missing: return False, "live copy is missing " + ", ".join(sorted(k.split("functions/", 1)[1] for k in missing))
    off = [k for k in need if live[k] != sha(os.path.join(ROOT, k))]
    return (not off), ("" if not off else "live differs in " + ", ".join(sorted(k.split("functions/", 1)[1] for k in off)))

JOBQ = ("select jobname, schedule, active, md5(command) as cmd from cron.job where jobname in ('daily-lead-digest', 'daily-lead-digest-winter') "
        "or command like '%/functions/v1/lead-digest%' order by jobname")

say("420 · THE MORNING EMAIL AT 8AM, WITH TODAY'S INTERVIEWS AND ASSESSMENTS"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
SQLP = os.path.join(ROOT, SQLFILE)
if not os.path.exists(SQLP) or sha(SQLP) != SQL_SHA: bad(f"{SQLFILE} is not the reviewed version"); say("  STOP. Nothing was run."); done(2)
SQLTEXT = open(SQLP).read()
say(f"  ✓ {SQLFILE} is the reviewed version (it changes the two schedule times only)")
users = reviewed()
if users != ["lead-digest"]: bad("only lead-digest should change"); say("  STOP. Nothing was run."); done(2)
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    for t in ("morning_email_420_test.mjs", "lead_digest_auth_test.mjs", "j1_job_locks_test.mjs", "nsf2_families_test.mjs"):
        p = subprocess.run([NODE, t], cwd=ROOT, capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0 or "FAIL" in last or "✗" in p.stdout: bad(f"{t} failed: {last}"); say("  STOP. Nothing was run."); done(2)
        say(f"  ✓ {t}: {last.strip()} (run here, against fakes; nothing sent)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
ok, jobs = sql(JOBQ)
if not ok: bad("couldn't read the schedules: " + str(jobs)[:200]); done(3)
names = sorted(j["jobname"] for j in jobs)
if names != sorted(JOBS): bad(f"the lead-digest schedules aren't the two expected ones (found: {', '.join(names) or 'none'}). Nothing was changed. Tell Claude."); done(3)
BEFORE = {j["jobname"]: j for j in jobs}
for n, (old, new) in JOBS.items():
    j = BEFORE[n]
    if j["schedule"] not in (old, new): bad(f"{n} runs at '{j['schedule']}', not the expected '{old}'. Nothing was changed. Tell Claude."); done(3)
    say(f"  ✓ {n}: now '{j['schedule']}' ({'on' if j['active'] else 'OFF'}){' (already the new time)' if j['schedule'] == new else ''}")
ok, cols = sql("select table_name, string_agg(column_name, ',' order by column_name) as c from information_schema.columns where table_schema = 'public' "
               "and table_name in ('interview_bookings', 'job_applicants') and column_name in ('id', 'applicant_id', 'starts_at', 'status', 'first_name', 'last_name') group by table_name")
cm = {r["table_name"]: set(r["c"].split(",")) for r in (cols or [])} if ok else {}
chk(cm.get("interview_bookings", set()) >= {"id", "applicant_id", "starts_at", "status"} and cm.get("job_applicants", set()) >= {"id", "first_name", "last_name"},
    "the interview tables have what the email reads (interview_bookings: when, status, who; job_applicants: first and last name)")
ok, n = sql("select count(*) filter (where status in ('booked', 'attended', 'noshow'))::int as today, "
            "count(*) filter (where status in ('booked', 'attended', 'noshow') and (starts_at at time zone 'America/Chicago')::time >= time '14:00')::int as pm "
            "from public.interview_bookings where (starts_at at time zone 'America/Chicago')::date = (now() at time zone 'America/Chicago')::date")
if ok and n: say(f"  · interviews on today's list (Chicago): {n[0]['today']}, of them 2pm or later (Samantha's): {n[0]['pm']}")
K = keys(); ANON, SERVICE = K.get("anon", ""), K.get("service_role", "")
HIDE += [ANON, SERVICE]
if not ANON: bad("couldn't read the project's public key. Nothing was changed."); done(3)
say("  ✓ read the project's keys (kept in memory only, never printed)")

say(); say("PART 2 · CHANGE (in order; each step only if the one before it worked)")
ok, r = sql(SQLTEXT)
if not ok: bad("the schedule times didn't change (one statement, so nothing in it changed): " + str(r)[:200]); say("  STOP. lead-digest was not changed. Tell Claude."); done(4)
say("  ✓ the two schedule times changed (commands untouched)")
if not deploy("lead-digest"):
    say("  STOP. The schedules are already at 13:00/14:00 UTC; the OLD brief still sends inside its 6-9am window, so the brief")
    say("  arrives at 8am Central without the new lists until this is fixed. Tell Claude."); done(4)

say(); say("PART 3 · PROOF (nothing is sent)")
ok, jobs2 = sql(JOBQ)
after = {j["jobname"]: j for j in (jobs2 or [])} if ok else {}
for n, (old, new) in JOBS.items():
    a, b = after.get(n), BEFORE[n]
    good = bool(a) and a["schedule"] == new and a["cmd"] == b["cmd"] and a["active"] == b["active"]
    chk(good, f"{n}: '{new}', command unchanged, still {'on' if b['active'] else 'OFF'}" + ("" if good else f" (found: {a})"))
good, why = is_reviewed_live("lead-digest")
chk(good, "lead-digest: the live copy is now exactly the reviewed build" + ("" if good else f" ({why})"))
LD = f"{FNB}/functions/v1/lead-digest"
s1, _ = http("GET", LD, None, {"Authorization": "Bearer " + ANON, "apikey": ANON})
chk(s1 == 401, f"the morning run with the public key is refused ({s1}); nothing read or sent")
s2, _ = http("GET", LD + "?force=1", None, {"Authorization": "Bearer " + ANON, "apikey": ANON})
chk(s2 == 401, f"a forced brief with the public key is refused ({s2}); nothing sent")
if SERVICE:
    s3, b3 = http("GET", LD + "?auth_check=1", None, {"Authorization": "Bearer " + SERVICE, "apikey": ANON})
    chk(s3 == 200 and '"ok":true' in b3.replace(" ", ""), f"the schedule's own door answers (auth_check only: it returns before anything is read or sent) ({s3})")
else: say("  · the server key wasn't readable, so the sign-in check of the schedule's door was skipped (the tests cover it)")
try:
    from zoneinfo import ZoneInfo
    chi = ZoneInfo("America/Chicago"); now = dt.datetime.now(chi); d = now.date()
    while True:
        cand = dt.datetime(d.year, d.month, d.day, 8, 0, tzinfo=chi)
        if cand.weekday() < 5 and cand > now: break
        d += dt.timedelta(days=1)
    say(f"  · the next brief: {cand.strftime('%A %b %-d')}, 8:00am Central ({cand.astimezone(dt.timezone.utc).strftime('%H:%M')} UTC)")
except Exception: pass
say("  · What the email now says is proved by morning_email_420_test.mjs above (the real function against fakes): 8am in")
say("    summer and winter, one email a day, \"Interviews today\" with \"Samantha's interview\" from 2pm, \"Assessments today\",")
say("    and a line saying so if either list can't be loaded.")
say()
if fails: say("RESULT: PARTLY DONE · the ✗ lines above need Claude.")
else: say("RESULT: DONE · the Morning Brief goes out at 8am Central on weekdays with today's interviews and assessments. "
          "Merge the Hub page branch (cc-hub-live, today-interviews) next so Today shows the same two lists.")
say("Nothing was texted or emailed by this installer.")
say("Rollback: the schedule times go back with the two alter_job lines in the comment at the top of morning_email_420.sql; Claude redeploys the previous lead-digest from GitHub.")
done(1 if fails else 0)
