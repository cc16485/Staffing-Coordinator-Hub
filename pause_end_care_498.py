#!/usr/bin/env python3
# 498 · PAUSE CARE AND END CARE (Samantha approved 2026-10-07). The database part (client-journey/client-care.sql: pause and
# care-change records, one journey per episode, the end and return steps) and 13 functions: client-journey (the care
# actions), client-status-review (past clients: a card only when AxisCare shows them Active again; cards go to the client's
# Care Coordinator),
# obligations-run (no check-in work for paused or ended clients), campaign-send / campaign-auto (paused = left out), and the
# shift jobs (timekeeper-watch, late-watch, coverage-watch, coverage-reply, coverage-run, missed-notes, carematch-watch) which
# skip paused and ended clients. identity-backfill is NOT deployed: it was taken down on purpose by 441 (2026-10-04) and stays
# down. Part 1 STOPS if any live file differs from exactly what the 498a look saw live (SB_BASE_SHAS, every file shown to be
# merged code), so nobody else's unreleased change goes out with this. Each keeps its gateway sign-in setting. Nothing is imported; nothing is sent.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}")); BASE = json.loads(os.environ.get("SB_BASE_SHAS", "{}"))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
ROOT = os.path.dirname(os.path.dirname(FNROOT)); CJDIR = os.path.join(ROOT, "client-journey"); FNS = ["client-journey", "client-status-review", "obligations-run", "campaign-send", "campaign-auto", "timekeeper-watch", "late-watch", "coverage-watch", "coverage-reply", "coverage-run", "missed-notes", "carematch-watch"]; FN = FNS[0]
lines = []; fails = []
def say(s=""):
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", str(s)); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=400):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-498/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, b[:200]
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def fmeta(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)
sha = lambda p_: hashlib.sha256(open(p_, "rb").read()).hexdigest()
lit = lambda v: "'" + str(v).replace("'", "''") + "'"
def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
def need(fn):
    s = set(); deps(os.path.join(FNROOT, fn, "index.ts"), s)
    return {os.path.relpath(x, ROOT).replace(os.sep, "/") for x in s}
def live_files(fn):
    tmp = tempfile.mkdtemp(prefix="cc498-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
    d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    live = {}
    for r, _, files in os.walk(tmp):
        for f in files:
            lp = os.path.join(r, f).replace(os.sep, "/")
            if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
    shutil.rmtree(tmp, ignore_errors=True)
    return d.returncode == 0, live

say("498 · PAUSE CARE AND END CARE (and the past-client protections)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for name, want in SHAS.items():
    p_ = os.path.join(CJDIR, name.split("/", 1)[1]) if name.startswith("client-journey/") and not name.endswith(".ts") else os.path.join(FNROOT, "_shared", name.split("/", 1)[1]) if name.startswith("_shared/") else os.path.join(FNROOT, name) if name.endswith(".ts") else os.path.join(FNROOT, name, "index.ts")
    have = sha(p_) if os.path.exists(p_) else "(missing)"
    chk(have == want, f"{name} is the reviewed build" if have == want else f"{name} is not the reviewed build: nothing runs")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(2)
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); say("  RESULT: STOPPED before anything changed."); done(2)

# nobody else's unreleased work goes out with this: every live file must be exactly what 498a saw (all merged code), or this build
VJ = {}
for fn in FNS:
    sx, mx = fmeta(fn)
    if not (sx == 200 and mx is not None and isinstance(mx.get("verify_jwt"), bool)): bad(f"{fn} could not be read"); continue
    VJ[fn] = mx.get("verify_jwt")
    okd, livef = live_files(fn)
    if not okd: bad(f"{fn}: the live copy could not be downloaded"); continue
    odd = [k for k in need(fn) if k in livef and livef[k] != BASE.get(k) and livef[k] != sha(os.path.join(ROOT, k))]
    odd += [k for k in need(fn) if k not in livef and BASE.get(k)]
    chk(not odd, f"{fn} (version {mx.get('version', '?')}): live is exactly what the 498a look saw (merged code), so only reviewed code goes out" if not odd else f"{fn}: the live copy changed since the 498a look ({', '.join(odd)[:200]}); deploying would also ship someone else's unreleased change")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
ok, r = sql("select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name in ('client_pause','client_care_change')")
say("  · pause and care-change tables: " + ("already there (kept)" if ok and r and r[0]["n"] == 2 else "new"))
ok, r = sql("select count(*)::int as n from public.client_journey")
say(f"  · client journeys today: {r[0]['n'] if ok and r else '?'} (one per person until now; one per episode after this)")

say(); say("PART 2 · CHANGE")
ok, r = sql(open(os.path.join(CJDIR, "client-care.sql")).read())
if not ok: bad("the database part didn't install: " + str(r)[:240]); say("  STOP. Nothing else was changed."); done(5)
say("  ✓ pause and care-change records, one journey per episode, the end and return steps")
for fn in FNS:
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if VJ[fn] else ["--no-verify-jwt"]), cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    okd, livef = live_files(fn)
    good = p.returncode == 0 and okd and all(k in livef and livef[k] == sha(os.path.join(ROOT, k)) for k in need(fn))
    chk(good, fn + " deployed: the live copy is this reviewed build" if good else fn + " did not deploy cleanly: " + (p.stderr or p.stdout)[-200:])
    if fails: say("  RESULT: STOPPED (what deployed above stays; the rest did not change). Tell Claude."); done(6)
    sN, mN = fmeta(fn)
    if (mN or {}).get("verify_jwt") != VJ[fn]:
        http("PATCH", f"{API}/v1/projects/{REF}/functions/{fn}", {"verify_jwt": VJ[fn]}, MG()); sN, mN = fmeta(fn)
    chk((mN or {}).get("verify_jwt") == VJ[fn], f"{fn}: version {(mN or {}).get('version', '?')}, gateway sign-in check {'on' if VJ[fn] else 'off'} as before")

say(); say("PART 3 · PROOF (nothing is texted or emailed)")
ok, r = sql("""select (select count(*) from information_schema.tables where table_schema='public' and table_name in ('client_pause','client_care_change'))::int as t,
  (select count(*) from pg_constraint where conname in ('client_journey_lead_id_key','client_journey_axiscare_client_id_key'))::int as old_unique,
  (select count(*) from pg_indexes where indexname in ('client_journey_one_open_lead','client_journey_one_open_ax'))::int as open_unique,
  (select count(*) from pg_proc where proname in ('client_care_end_role','client_care_return_role'))::int as fns,
  (select count(*) from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_name in ('client_pause','client_care_change'))::int as browser""")
x = r[0] if ok and r else {}
chk(x.get("t") == 2 and x.get("fns") == 2, "the pause and care-change records and the end and return steps are in")
chk(x.get("old_unique") == 0 and x.get("open_unique") == 2, "a person can now have one journey per episode (only one open at a time)")
chk(x.get("browser") == 0, "nobody signed in to the Hub can read or change them directly (the service does it)")
ok, r = sql("select tgname from pg_trigger where tgname = 'client_care_change_keep'")
chk(ok and r, "the care-change record is permanent (it can't be deleted or rewritten)")
say()
say("RESULT: " + ("DONE · Pause care and End care are on every client's profile for Care Coordinators and owners. Paused and ended clients drop out of shift alerts, check-in work and campaigns; a returning client starts a new episode only when an owner confirms. Nothing was imported." if not fails else "CHECK THE ✗ LINES."))
say("Nothing was texted or emailed by this step.")
done(0 if not fails else 8)
