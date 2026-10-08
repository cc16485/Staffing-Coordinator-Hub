#!/usr/bin/env python3
# 521 · GHE OVERSIGHT FROM AXISCARE (GHE fix slice 3, Samantha 2026-10-08: nurses book GHEs in AxisCare as T1001 and
# can add visits themselves). ghe-reminders now reads AxisCare every weekday for each GHE month (last, this and next
# month) and keeps what it saw in app_data 'ghe_watch' for Nurse Scheduling. With the Admin switch "GHE oversight"
# (ops_settings.ghe_watch_live, OFF until Samantha turns it on): the 10th, 20th, last-week and Missed GHE steps for the
# Medicaid coordinator (owner of Payer Programs). Deploys ghe-reminders only, keeping its gateway setting; stops if it
# changed since 398. The proof is a practice run: it reads AxisCare and writes, texts and emails nothing.
import json, os, re, subprocess, urllib.request, urllib.error, datetime as dt, sys, hashlib, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); BASE = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
SUPA = os.environ.get("SB_SUPA_CLI", ""); FNROOT = os.environ.get("SB_FNROOT", ""); SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}")); BASEP = json.loads(os.environ.get("SB_BASE_SHAS", "{}"))
ROOT = os.path.dirname(os.path.dirname(FNROOT)) if FNROOT else ""; FNS = ["ghe-reminders"]
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for h in HIDE:
        if h: s = s.replace(h, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-521/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
jl = lambda b: (lambda: json.loads(b))() if b and b[:1] in "[{" else {}
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, b[:300]
    try: return True, json.loads(b)
    except Exception: return False, b[:300]
lit = lambda v: "null" if v is None else "'" + str(v).replace("'", "''") + "'"
sha = lambda p_: hashlib.sha256(open(p_, "rb").read()).hexdigest()
def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
def need(fn):
    s = set(); deps(os.path.join(FNROOT, fn, "index.ts"), s)
    return {os.path.relpath(x, ROOT).replace(os.sep, "/") for x in s}
def fmeta(fn):
    s = None
    for i in range(4):
        s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
        if s == 200:
            try: return s, json.loads(b)
            except Exception: pass
        if s == 404: return s, None
        time.sleep(3 * (i + 1))
    return s, None
def live_files(fn):
    for i in range(3):
        tmp = tempfile.mkdtemp(prefix="cc521-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
        d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
        live = {}
        for r_, _, files in os.walk(tmp):
            for f in files:
                lp = os.path.join(r_, f).replace(os.sep, "/")
                if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
        shutil.rmtree(tmp, ignore_errors=True)
        if d.returncode == 0 and live: return True, live
        time.sleep(3 * (i + 1))
    return False, {}

say("521 · GHE OVERSIGHT FROM AXISCARE"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for name, want in SHAS.items():
    p_ = os.path.join(FNROOT, name); have_ = sha(p_) if os.path.exists(p_) else "(missing)"
    say(f"  ✓ {name} is the reviewed build") if have_ == want else bad(f"{name} is not the reviewed build: nothing runs")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(2)
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
VJ = {}
for fn in FNS:   # nobody else's unreleased work goes out: live must be exactly what 398 put there, or this build
    sx, mx = fmeta(fn)
    if not (sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool)): bad(f"{fn} could not be read ({sx})"); continue
    VJ[fn] = mx["verify_jwt"]; okd, livef = live_files(fn)
    if not okd: bad(f"{fn}: the live copy could not be downloaded"); continue
    odd = [k for k in need(fn) if livef.get(k) != BASEP.get(k) and livef.get(k) != sha(os.path.join(ROOT, k))]
    say(f"  ✓ {fn} (version {mx.get('version', '?')}): live is what 398 deployed, so only this change goes out") if not odd else bad(f"{fn}: the live copy changed since 398 ({', '.join(odd)[:200]}); nothing runs")
s0, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG()); k = jl(kb)
keys = {x.get("name"): x.get("api_key", "") for x in (k if isinstance(k, list) else []) if isinstance(x, dict)}
SVC = keys.get("service_role", ""); HIDE.append(SVC)
if not SVC: bad("the server key could not be read (needed for the practice run)")
ok_, st_ = sql("select data from public.app_data where key = 'ops_settings'")
live_sw = bool(ok_ and st_ and isinstance(st_[0].get("data"), dict) and st_[0]["data"].get("ghe_watch_live") is True)
say("  · the Admin switch GHE oversight is " + ("ON" if live_sw else "OFF (it stays off; it is yours to turn on)"))
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
for fn in FNS:
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if VJ[fn] else ["--no-verify-jwt"]), cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    okd, livef = live_files(fn)
    good = p.returncode == 0 and okd and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need(fn))
    say(f"  ✓ {fn} deployed: the live copy is this reviewed build") if good else bad(f"{fn} did not deploy cleanly: " + (p.stderr or p.stdout)[-200:])
    if fails: say("  RESULT: STOPPED (what deployed above stays). Tell Claude."); done(6)
    sN, mN = fmeta(fn)
    if (mN or {}).get("verify_jwt") != VJ[fn]:
        http("PATCH", f"{API}/v1/projects/{REF}/functions/{fn}", {"verify_jwt": VJ[fn]}, MG()); sN, mN = fmeta(fn)
    say(f"  ✓ {fn}: version {(mN or {}).get('version', '?')}, gateway sign-in check {'on' if VJ[fn] else 'off'} as before") if (mN or {}).get("verify_jwt") == VJ[fn] else bad(f"{fn}: the gateway setting did not come back")
say(); say("PART 3 · PROOF: A PRACTICE RUN (reads AxisCare; writes, texts and emails nothing)")
j = {}
for i in range(3):
    sP, bP = http("POST", f"{BASE}/functions/v1/ghe-reminders?dry=1&force=1", {}, {"Authorization": "Bearer " + SVC, "apikey": SVC}, timeout=300); j = jl(bP)
    if sP == 200 and j.get("ok"): break
    time.sleep(4 * (i + 1))
if not (j.get("ok") and j.get("dry") is True): bad(f"the practice run did not answer ({sP}): " + str(bP)[:200])
else:
    say(f"  ✓ practice run: {j.get('watched', 0)} GHE month(s) looked at (last, this and next month), AxisCare failed {j.get('axiscare_failed', 0)}, not linked to AxisCare {j.get('not_linked', 0)}")
    say(f"  ✓ the Medicaid coordinator it would warn: {(j.get('coordinator') or {}).get('email', '?')} ({(j.get('coordinator') or {}).get('why', '')})")
    for x in (j.get("seen") or [])[:40]: say(f"      · {x.get('name')}: {x.get('month')} · AxisCare says {x.get('state')} · {x.get('stage')}" + (f" · would: {', '.join(x.get('actions') or [])}" if x.get('actions') else ""))
    if not j.get("watched"): say("  · nothing to look at yet: no client on the nurse board has a GHE month in last, this or next month (upload care plans on each client's Payer tab)")
    if j.get("axiscare_failed"): bad("AxisCare did not answer for some clients; those are never assumed missed. Tell Claude if this repeats.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · every weekday ghe-reminders reads AxisCare for each GHE month and Nurse Scheduling shows it. The warnings and cards wait for the Admin switch GHE oversight" + (" (already ON)." if live_sw else " (OFF, yours to turn on).") + " Nothing was texted or emailed by this step.")
done(0)
