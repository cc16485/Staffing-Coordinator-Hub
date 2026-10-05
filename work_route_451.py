#!/usr/bin/env python3
# 451 · TODAY PHASE 3: RIGHT PERSON FIRST, THEN ESCALATE. Samantha approved the plan 2026-10-05
# (https://claude.ai/artifact/DbCMKyppvK2mRVPnZr9TWN) and chose: escalation goes to the Owner Escalation seat; the owner
# keeps the work; overdue work shows on a separate "Escalated to you" list.
#   work-route (new, every 2 minutes): routes new job-made scheduling work to whoever holds the Staffing seat now and
#     pulls in whoever holds Owner Escalation when nobody takes it (5 min: shift within the hour; 15 min: other urgent
#     staffing; overdue otherwise). Writes ops_items only; sends nothing.
#   timekeeper-watch: missed clock-in texts go to the person on Staffing first, after 15 minutes also to Owner
#     Escalation (daytime only).
#   coverage-run: rewriting an Uncovered shift card keeps owner, who took it, history, routing and escalation.
#   Everything waits for her switch (ops_settings.routing_live, Owners Hub Admin page), except the coverage-run fix.
# Part 1 (read only): the reviewed build (pinned); the live jobs are what this was built on; the tests pass here; the
#   jobs' secret is there. Part 2: deploy, schedule work-route every 2 minutes. Part 3: live copies are the reviewed
#   build; they answer their owner and refuse others; the schedule gets in; one practice run (dry) prints counts.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
HUB_REF = "zngsgedlsxinbygwmxwn"
HUB = os.environ["SB_REPO"]; HUB_BASE = os.environ.get("SB_BASE", "")
HUB_SHAS = json.loads(os.environ["SB_SHAS"])
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB_REF}.supabase.co")
FNS = ["work-route", "timekeeper-watch", "coverage-run"]
VAULT_NAME = "hub_job_secret"; SCHEDULE = "*/2 * * * *"; JOB = "work-route"
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-451/1.0"}, **(headers or {})))
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
    tmp = tempfile.mkdtemp(prefix="wr451-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
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

def jget(b, k):
    try: return json.loads(b).get(k)
    except Exception: return None
def lit(v): return "'" + str(v).replace("'", "''") + "'"
def command(url, anon, body):
    return ("select net.http_post(url := " + lit(url) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
            "'Authorization', " + lit("Bearer " + anon) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
            "body := " + lit(json.dumps(body)) + "::jsonb, timeout_milliseconds := 120000);")


say("451 · TODAY PHASE 3: RIGHT PERSON FIRST, THEN ESCALATE"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
reviewed(HUB, HUB_BASE, HUB_SHAS, "the Hub server")
pinned = {pinpath(k) for k in HUB_SHAS}
for fn in FNS:
    other = sorted(k for k in need(HUB, fn) if k not in pinned and base_sha(HUB, HUB_BASE, k) != sha(os.path.join(HUB, k)))
    if other: bad(f"other changes merged since the review touch {fn} ({', '.join(other)[:200]}). Ask Claude to refresh 451."); say("  STOP. Nothing was run."); done(2)
say("  ✓ the routing job, the two updated jobs and the duty rules are the reviewed build")
ST = {}
for fn in FNS:
    st, vj = state(HUB_REF, HUB, HUB_BASE, fn, pinned); ST[fn] = (st, vj)
    ok_states = ("new", "this") if fn == "work-route" else ("base", "this")
    if st not in ok_states: bad(f"the live {fn} isn't what this was built on ({st}). Nothing was changed. Tell Claude."); done(3)
    say(f"  ✓ {fn}: " + {"new": "is new", "base": "live matches GitHub", "this": "already has this build (an earlier run)"}[st])
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    for t in ("duty_phase3_test.mjs", "loops_phase2_test.mjs", "c1_missed_clockin_test.mjs", "j1_job_locks_test.mjs"):
        p = subprocess.run([NODE, t], cwd=HUB, capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0 or re.search(r"^FAIL", p.stdout, re.M): bad(f"{t} failed: {last}"); say("  STOP. Nothing was changed."); done(2)
        say(f"  ✓ {t}: {last.strip()} (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
ok, sv = sql(f"select coalesce((select data->>'routing_live' from app_data where key = 'ops_settings'), 'not set') as live, (select count(*) from vault.decrypted_secrets where name = {lit(VAULT_NAME)})::int as vault")
if not ok or not sv: bad("couldn't read the settings. Nothing was changed."); done(3)
if sv[0]["vault"] != 1: bad("the jobs' secret isn't there. Nothing was changed."); done(3)
say(f"  · the switch \"Right person first, then escalate\" is {('ON' if sv[0]['live'] == 'true' else 'OFF')} (it stays as it is; you turn it on on the Admin page)")
K = keys(HUB_REF); ANON, SERVICE = K.get("anon", ""), K.get("service_role", ""); HIDE += [ANON, SERVICE]
if not ANON or not SERVICE: bad("couldn't read the Hub's keys. Nothing was changed."); done(3)

say(); say("PART 2 · CHANGE")
for fn in FNS:
    st, vj = ST[fn]
    if st == "this": say(f"  ✓ {fn} already had it"); continue
    if not deploy(HUB_REF, HUB, fn, True if st == "new" else vj, "Hub"): say("  STOP. Tell Claude. (Anything above this line is in; the rest is unchanged.)"); done(6)
URL = f"{FNB}/functions/v1/work-route"
sql(f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
ok, r = sql(f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(command(URL, ANON, {}))}) as id")
ok2, jb = sql(f"select schedule, command from cron.job where jobname = {lit(JOB)}")
chk(ok and ok2 and jb and jb[0]["schedule"] == SCHEDULE and "x-cron-secret" in jb[0]["command"], "the routing check runs every 2 minutes (switched off it only lists what it would do)")
say("  ✓ with the switch off: routing only lists, missed clock-in texts go to the alert list as before; always: taking an Uncovered shift card is no longer undone by the next coverage run")

say(); say("PART 3 · PROOF AND PRACTICE RUN (practice mode: nothing is written, nothing is sent)")
for fn in FNS:
    okd, live = live_files(HUB_REF, fn)
    chk(okd and all(k in live and live[k] == sha(os.path.join(HUB, k)) for k in need(HUB, fn)), f"{fn}: the live copy is exactly the reviewed build")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
S = {"Authorization": "Bearer " + SERVICE, "Content-Type": "application/json"}
for fn in FNS:
    s, b = http("POST", f"{FNB}/functions/v1/{fn}?auth_check=1", {}, S)
    chk(s == 200 and jget(b, "caller") == "owner", f"{fn}: answers its owner (a who-is-calling check only){'' if s == 200 else f' ({s})'}")
    s2, _ = http("POST", f"{FNB}/functions/v1/{fn}?auth_check=1", {}, {"Content-Type": "application/json"})
    chk(s2 == 401, f"{fn}: still refuses anyone else ({s2})")
ok, rq = sql(command(URL + "?auth_check=1", ANON, {}).rstrip(";") + " as id")
got = None; waited = 0.0
while ok and rq and waited <= POLL_MAX:
    ok3, rr = sql(f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
    if ok3 and rr: got = rr[0]; break
    time.sleep(POLL); waited += POLL
chk(got and got["status_code"] == 200 and jget(got["content"], "caller") == "cron", "its schedule gets in (a who-is-calling check only)" + ("" if got and got["status_code"] == 200 else f" ({got['status_code'] if got else 'no answer'})"))
s, b = http("POST", f"{URL}?dry=1", {}, S, timeout=200)
try: wr = json.loads(b) if s == 200 else {}
except Exception: wr = {}
if s != 200 or "routed" not in wr: bad(f"the routing practice run didn't answer ({s})")
else:
    se = wr.get("seats") or {}
    say("  ✓ routing practice run (nothing written):")
    say(f"      Staffing now: {(se.get('staffing') or {}).get('first') or 'nobody'} ({(se.get('staffing') or {}).get('from')}) · Owner Escalation now: {(se.get('escalation') or {}).get('first') or 'nobody'} ({(se.get('escalation') or {}).get('from')})")
    say(f"      new scheduling work that would be routed: {wr.get('routed', 0)} (only work made after you switch it on is routed)")
    say(f"      urgent escalations that would pull in Owner Escalation now: {wr.get('escalated_urgent', 0)}")
    say(f"      overdue items that would go on the \"Escalated to you\" list: {wr.get('escalated_overdue', 0)}")
ok, sv2 = sql("select coalesce((select data->>'routing_live' from app_data where key = 'ops_settings'), 'not set') as live")
chk(ok and sv2 and sv2[0]["live"] == sv[0]["live"], "the switch was not touched")
say()
say("RESULT: " + ("DONE · Phase 3's server side is installed, switched off. Next: Claude merges the Hub and Admin page changes, then you turn on \"Right person first, then escalate\" on the Owners Hub Admin page." if not fails else "PARTLY DONE · the ✗ lines above need Claude."))
say("Nothing was texted or emailed. The practice run prints counts and the two seat holders' first names only.")
say("Rollback: turn the switch off (Admin page). Claude can unschedule work-route and put the two jobs back.")
done(0 if not fails else 8)
