#!/usr/bin/env python3
# 1202 · AXISCARE READER AND READ CARDS, INSTALLED WITH BOTH SWITCHES OFF (Staffing server; her go 2026-10-30 on A and B of plan
#   9A5aLmXRpT5SWneSW5hWWg: "Yes, build the Desktop install step for A and B. Keep both switches off.").
#   Part 1 (read only): the reviewed build, the tests (fake data, plus the SQL in a local Postgres), each live job is the build
#     this builds on, every switch read.
#   Part 2: database A (read log, limit, copies) and its self-test, database B (Settings summary, 150 s scheduler wait for 4
#     jobs, the axis-health job) and its self-test. Both self-tests undo everything they do. A self-test that fails stops
#     the step BEFORE any job is deployed. Then axis-health (new) and the five jobs that read AxisCare most are deployed,
#     each keeping its gateway setting. NO switch is changed: axis_shared_reader_live and axis_failure_cards_live stay off,
#     so every job reads AxisCare exactly as before; the only new thing is that each read is counted.
#   Part 3 (proof): live copies are this build, axis-health refuses the public key and does one practice look, AxisCare reads
#     are being counted, the Settings summary answers, the scheduler waits are in, every switch exactly as before.
#   Never texts, emails or calls anyone. Safe to run again.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
HUB_REF = "zngsgedlsxinbygwmxwn"
HUB = os.environ["SB_REPO"]; HUB_BASE = os.environ.get("SB_BASE", "")
HUB_SHAS = json.loads(os.environ["SB_SHAS"]); SQL_SHAS = json.loads(os.environ.get("SB_SQL_SHAS", "{}"))
PRIOR = json.loads(os.environ.get("SB_PRIOR", "{}")); PRIOR_USED = set()
PRIOR = {k: (v if isinstance(v, list) else [v]) for k, v in PRIOR.items()}   # each job may hold its own earlier copy of a shared file   # a shared file whose earlier copy is what is live now (merged on main since these jobs were last deployed)
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB_REF}.supabase.co")
POLL = float(os.environ.get("SB_POLL", "15")); POLL_MAX = float(os.environ.get("SB_POLL_MAX", "420"))
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
def http(method, url, body=None, headers=None, timeout=200):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-1202/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql_raw(q): return http("POST", f"{API}/v1/projects/{HUB_REF}/database/query", {"query": q}, MG())
def sql(q):
    s, b = sql_raw(q)
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def selftest(tag, q):
    """a self-test ends by raising AXISTEST_<tag> {result}, which undoes all it did; the result rides in the error message"""
    s, b = sql_raw(q)
    try: msg = json.loads(b).get("message", b)
    except Exception: msg = b
    i = str(msg).find("AXISTEST_" + tag + " ")
    if i < 0: return {"ok": False, "why": f"HTTP {s}: " + str(b)[:240]}
    try: return json.JSONDecoder().raw_decode(str(msg)[i + len(tag) + 10:])[0]
    except Exception: return {"ok": False, "why": str(msg)[i:i + 240]}
def fmeta(ref, fn):
    s, b = http("GET", f"{API}/v1/projects/{ref}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
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
    src = "\n".join(l for l in open(path).read().split("\n") if not re.match(r"\s*import\s+type\b", l))
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", src):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
def need(root, fn):
    s = set(); deps(os.path.join(root, f"supabase/functions/{fn}/index.ts"), s)
    return {os.path.relpath(x, root).replace(os.sep, "/") for x in s}
def live_files(ref, fn):
    for i in range(3):
        tmp = tempfile.mkdtemp(prefix="cl1202-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
        d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", ref, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
        live = {}
        for r, _, files in os.walk(tmp):
            for f in files:
                lp = os.path.join(r, f).replace(os.sep, "/")
                if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
        shutil.rmtree(tmp, ignore_errors=True)
        if d.returncode == 0 and live: return True, live
        time.sleep(float(os.environ.get("SB_SETTLE", "3")))
    return False, {}
def base_sha(root, base, rel):
    b = git(root, "show", f"{base}:{rel}")
    return shab(b.stdout) if b.returncode == 0 else None
def state(ref, root, base, fn, pinned):
    """'new' | 'base' | 'this' | 'other' | 'unreadable' for one live function, with its gateway setting."""
    s, m = fmeta(ref, fn)
    if s == 404: return "new", None
    vj = (m or {}).get("verify_jwt")
    okd, live = live_files(ref, fn)
    if not okd or not isinstance(vj, bool): return "unreadable", vj
    nd = need(root, fn)
    if all(k in live and live[k] == sha(os.path.join(root, k)) for k in nd): return "this", vj
    if all((k in live and (live[k] == base_sha(root, base, k) or live[k] in PRIOR.get(k, []))) or (k not in live and base_sha(root, base, k) is None and k in pinned) for k in nd):
        PRIOR_USED.update(k for k in nd if k in live and live[k] in PRIOR.get(k, []) and live[k] != base_sha(root, base, k))
        return "base", vj
    return "other", vj
def deploy(ref, root, fn, vj):
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", ref, "--use-api"] + ([] if vj else ["--no-verify-jwt"]), cwd=root, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    okd, live = live_files(ref, fn)
    good = okd and all(k in live and live[k] == sha(os.path.join(root, k)) for k in need(root, fn))
    if not good: bad(f"{fn} didn't deploy: " + (p.stderr or p.stdout)[-200:]); return False
    sN, mN = fmeta(ref, fn)
    if (mN or {}).get("verify_jwt") != vj:
        http("PATCH", f"{API}/v1/projects/{ref}/functions/{fn}", {"verify_jwt": vj}, MG()); sN, mN = fmeta(ref, fn)
    chk((mN or {}).get("verify_jwt") == vj, f"{fn} deployed, version {(mN or {}).get('version', '?')} (gateway sign-in check {'on' if vj else 'off'})")
    return (mN or {}).get("verify_jwt") == vj
def switches():
    ok, st = sql("select data from public.app_data where key = 'ops_settings'")
    if not ok or not st: return None
    d = st[0].get("data") or {}
    if isinstance(d, str):
        try: d = json.loads(d)
        except Exception: d = {}
    return {k: v for k, v in d.items() if k.endswith("_live") or k.endswith("_practice")}

FNS = ["client-journey", "late-watch", "timekeeper-watch", "coverage-watch", "coverage-run"]   # least urgent first; Cara's jobs last
NEWFN = "axis-health"
SQLS = ["axis_reader_A.sql", "axis_reader_A_selftest.sql", "axis_health_B.sql", "axis_health_B_selftest.sql", "axis_reader_A_rollback.sql", "axis_health_B_rollback.sql"]
TESTS = [("axis_reader_test.mjs", "plain"), ("axis_health_test.mjs", "plain"), ("axis_sql_test.mjs", "pglite"), ("quiet_cards_test.mjs", "plain"),
         ("loops_phase2_test.mjs", "plain"), ("open_shift_cards_test.mjs", "plain"), ("late_watch_test.mjs", "plain")]
BUSY = "('coverage-run', 'coverage-watch', 'timekeeper-watch', 'launch-evidence')"

say("1202 · STAFFING SERVER · AXISCARE READER AND READ CARDS (BOTH SWITCHES OFF)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
if not HUB_BASE or git(HUB, "cat-file", "-e", HUB_BASE + "^{commit}").returncode != 0: bad("the reviewed starting point isn't in the server's history"); say("  STOP. Nothing was run."); done(2)
changed = set(git(HUB, "diff", "--name-only", HUB_BASE, "HEAD").stdout.decode().split())
for rel, want in [(pinpath(k), v) for k, v in HUB_SHAS.items()] + [(k, v) for k, v in SQL_SHAS.items()]:
    if rel not in changed or not os.path.exists(os.path.join(HUB, rel)) or sha(os.path.join(HUB, rel)) != want:
        bad(f"{rel.split('functions/')[-1]} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
if set(SQLS) - set(SQL_SHAS): bad("the database files are not all pinned"); say("  STOP. Nothing was run."); done(2)
pinned = {pinpath(k) for k in HUB_SHAS}
other = sorted({k for fn in FNS + [NEWFN] for k in need(HUB, fn) if k not in pinned and base_sha(HUB, HUB_BASE, k) != sha(os.path.join(HUB, k))})
if other: bad("other changes merged since the review touch these jobs (" + ", ".join(other)[:200] + "). Ask Claude to refresh 1202."); say("  STOP. Nothing was run."); done(2)
say("  ✓ the six jobs, the shared reader and the database files are the reviewed build")
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
pg = os.environ.get("PGLITE") or os.path.expanduser("~/Claude/Projects/.pglite/node_modules/@electric-sql/pglite/dist/index.js")
if os.environ.get("SB_NODE") == "none": NODE = ""   # the rehearsal's way to skip the tests
if NODE:
    for t, kind in TESTS:
        if kind == "pglite" and not os.path.exists(pg): say(f"  · {t}: skipped (the local Postgres for tests is not on this Mac; it passed when built)"); continue
        env = dict(os.environ); env.pop("PGLITE", None)
        if kind == "pglite": env["PGLITE"] = pg
        p = subprocess.run([NODE, t], cwd=HUB, capture_output=True, text=True, env=env)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0 or "\nFAIL" in p.stdout: bad(f"{t} failed: {last}"); say("  STOP. Nothing was changed."); done(2)
        say(f"  ✓ {t}: {last.strip()}")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
st = {}
for fn in FNS + [NEWFN]:
    s_, vj = state(HUB_REF, HUB, HUB_BASE, fn, pinned)
    if fn == NEWFN:
        if s_ not in ("new", "this"): bad(f"{fn} is already on the server as something else ({s_}). Nothing was changed. Tell Claude."); done(3)
        vj = False   # started by its schedule's secret (checked inside), like the other job functions
    elif s_ not in ("base", "this"):
        bad(f"{fn} on the server is not the build this builds on ({s_}); someone may have deployed a newer one. Nothing was changed. Tell Claude."); done(3)
    st[fn] = (s_, vj)
    say(f"  ✓ {fn}: " + {"base": "live is the build this builds on", "this": "already this build", "new": "new (not on the server yet)"}[s_]
        + ("" if fn == NEWFN else f", gateway sign-in check {'on' if vj else 'off'} (kept)"))
if PRIOR_USED: say("  · these jobs also pick up the newer copy on GitHub's main of: " + ", ".join(sorted(k.split("functions/")[-1] for k in PRIOR_USED))
    + " (other work merged and reviewed earlier, not yet live in these jobs)")
before = switches()
if before is None: bad("couldn't read the Hub's settings. Nothing was changed."); done(3)
say("  · Shared AxisCare reader: " + ("ON" if before.get("axis_shared_reader_live") is True else "OFF") + " · Tell me when AxisCare can't be read: "
    + ("ON" if before.get("axis_failure_cards_live") is True else "OFF") + " (this step changes neither)")
ok, inst = sql("select to_regclass('public.axis_read_log') is not null as a, to_regprocedure('public.axis_connection(int)') is not null as b")
say("  · database part: " + ("already installed (it is put in again, safely)" if ok and inst and inst[0]["a"] else "not installed yet"))
ok, cj = sql(f"select jobname, command like '%timeout_milliseconds%' as has_wait from cron.job where jobname in {BUSY} order by jobname")
if ok and cj: say("  · scheduler waits now: " + ", ".join(f"{r['jobname']} {'set' if r['has_wait'] else '5 s (default)'}" for r in cj))
K = keys(HUB_REF); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); HIDE += [ANON, SVC]
if not ANON or not SVC: bad("couldn't read the Hub's keys. Nothing was changed."); done(3)

say(); say("PART 2 · CHANGE")
rd = lambda f: open(os.path.join(HUB, f)).read()
ok, out = sql(rd("axis_reader_A.sql"))
if not ok: bad("database A didn't go in (nothing else changed): " + str(out)[:200]); done(4)
ok, g = sql("""select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('axis_read_log', 'axis_gate', 'axis_cache'))::int as t,
  (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('axis_read_log', 'axis_gate', 'axis_cache') and grantee in ('anon', 'authenticated'))::int as open_grants""")
chk(ok and g and g[0]["t"] == 3 and g[0]["open_grants"] == 0, "database A: the read log, the limit and the copies are in, no browser access")
r = selftest("A", rd("axis_reader_A_selftest.sql"))
if not r.get("ok"): bad("database A self-test: " + json.dumps(r)[:240]); say("  STOP before any job was deployed. Database A is in but nothing uses it yet. Tell Claude."); done(4)
say(f"  ✓ database A self-test: {r.get('checks')} checks passed (limit, urgent reserve, AxisCare's wait after a 429, combining, copies, log), and it undid everything")
ok, out = sql(rd("axis_health_B.sql"))
if not ok: bad("database B didn't go in: " + str(out)[:200]); say("  STOP before any job was deployed. Tell Claude."); done(4)
r = selftest("B", rd("axis_health_B_selftest.sql"))
if not r.get("ok"): bad("database B self-test: " + json.dumps(r)[:240]); say("  STOP before any job was deployed. Tell Claude."); done(4)
say(f"  ✓ database B self-test: {r.get('checks')} checks passed (each kind of AxisCare information on its own line, 429s counted, scheduling NOT current when visits fail, the 150 s waits, axis-health scheduled), and it undid everything")
for fn in [NEWFN] + FNS:
    s_, vj = st[fn]
    if s_ == "this": say(f"  ✓ {fn} already had it"); continue
    if not deploy(HUB_REF, HUB, fn, vj): say(f"  STOP at {fn}. The jobs before it are deployed (switches off, so they read AxisCare as before). Tell Claude."); done(5)
t_deploy = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S+00")

say(); say("PART 3 · PROOF (nothing is sent)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
for fn in [NEWFN] + FNS:
    okd, live = live_files(HUB_REF, fn)
    chk(okd and all(k in live and live[k] == sha(os.path.join(HUB, k)) for k in need(HUB, fn)), f"{fn}: the live copy is exactly the reviewed build")
URL = f"{FNB}/functions/v1/{NEWFN}"
a1 = http("POST", URL + "?auth_check=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
chk(a1 == 401, f"axis-health refuses the public key ({a1})")
sR, bR = http("POST", URL + "?dry=1", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 120)
try: j = json.loads(bR)
except Exception: j = {}
chk(sR == 200 and j.get("ok") and j.get("mode") == "practice", "axis-health practice look: answered, changed no card" + (f" ({j.get('note')})" if j.get("note") else ""))
say("  · waiting for the jobs to read AxisCare on their own schedule (up to 7 minutes) ...")
seen, waited = [], 0.0
while waited <= POLL_MAX:
    ok, rows = sql(f"select job, count(*)::int as n, count(*) filter (where status = 429)::int as r429, bool_or(live) as live from public.axis_read_log where at >= '{t_deploy}' group by job order by job")
    seen = rows if ok and rows else []
    if {"timekeeper-watch", "coverage-watch"} <= {x["job"] for x in seen}: break
    time.sleep(POLL); waited += POLL
chk(bool(seen), "AxisCare reads are being counted: " + (", ".join(f"{x['job']} {x['n']}" + (f" ({x['r429']} turned away)" if x["r429"] else "") for x in seen) or "none yet"))
chk(not any(x.get("live") for x in seen), "every read went exactly as before (shared reader off)")
ok, c = sql("select public.axis_connection(60) as c")
cc = (c[0]["c"] if ok and c else None) or {}
if isinstance(cc, str):
    try: cc = json.loads(cc)
    except Exception: cc = {}
chk(ok and "scheduling_current" in cc, "the Settings summary answers: scheduling information is " + ("current" if cc.get("scheduling_current") else "NOT current yet (it needs a good visit read in the last 10 minutes)"))
ok, cj = sql(f"""select count(*) filter (where jobname in {BUSY} and command like '%timeout_milliseconds := 150000%')::int as waits,
  count(*) filter (where jobname = 'axis-health' and active)::int as health, count(*) filter (where jobname = 'axis-read-log-trim')::int as trim from cron.job""")
chk(ok and cj and cj[0]["waits"] == 4 and cj[0]["health"] == 1 and cj[0]["trim"] == 1, "the scheduler waits 150 s for the four busy jobs; axis-health every 5 minutes; the nightly trim is set")
after = switches()
chk(after is not None and after == before, "every switch is exactly as it was (both AxisCare switches " + ("OFF" if not (after or {}).get("axis_shared_reader_live") and not (after or {}).get("axis_failure_cards_live") else "as you had them") + ")")
say()
say("RESULT: " + ("DONE · the AxisCare reader and read cards are installed with both switches OFF. Every AxisCare read is now counted, which is the baseline for the 24-hour comparison. Next: Claude publishes Settings > AxisCare connection and checks it live." if not fails else "CHECK THE ✗ LINES ABOVE and tell Claude."))
say("Nothing was texted, emailed or called.")
done(0 if not fails else 8)
