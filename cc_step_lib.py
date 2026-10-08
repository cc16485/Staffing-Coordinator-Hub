#!/usr/bin/env python3
# cc_step_lib.py · the shared bones of a Desktop step (Slice 0, 2026-10-08): the report, the management API, SQL through it,
# the reviewed-build checks and the pinned deploy. Every step that imports this runs from a worktree pinned to one reviewed
# commit, so the helper and the step are always the same build. Nothing here sends a text or an email.
import json, os, re, subprocess, urllib.request, urllib.error, datetime as dt, sys, hashlib, tempfile, shutil, time
STEP = os.environ.get("SB_STEP", "step")
REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
SUPA = os.environ.get("SB_SUPA_CLI", ""); FNROOT = os.environ.get("SB_FNROOT", "")
ROOT = os.path.dirname(os.path.dirname(FNROOT)) if FNROOT else ""
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for h in HIDE:
        if h: s = s.replace(h, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code):
    open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": f"cc-{STEP}/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(ref, q):
    """One statement (or one transaction) through the management API, as the project's owner. (ok, rows | error text)."""
    s, b = http("POST", f"{API}/v1/projects/{ref}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, b[:400]
    try: return True, json.loads(b)
    except Exception: return False, b[:400]
lit = lambda v: "null" if v is None else "'" + str(v).replace("'", "''") + "'"
sha = lambda p_: hashlib.sha256(open(p_, "rb").read()).hexdigest()
def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
def need(fnroot, fn):
    root = os.path.dirname(os.path.dirname(fnroot)); s = set(); deps(os.path.join(fnroot, fn, "index.ts"), s)
    return {os.path.relpath(x, root).replace(os.sep, "/") for x in s}
def fmeta(ref, fn):
    s = None
    for i in range(4):
        s, b = http("GET", f"{API}/v1/projects/{ref}/functions/{fn}", headers=MG())
        if s == 200:
            try: return s, json.loads(b)
            except Exception: pass
        if s == 404: return s, None
        time.sleep(3 * (i + 1))
    return s, None
def live_files(ref, fn):
    for i in range(3):
        tmp = tempfile.mkdtemp(prefix=f"cc{STEP}-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
        d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", ref, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
        live = {}
        for r_, _, files in os.walk(tmp):
            for f in files:
                lp = os.path.join(r_, f).replace(os.sep, "/")
                if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
        shutil.rmtree(tmp, ignore_errors=True)
        if d.returncode == 0 and live: return True, live
        time.sleep(3 * (i + 1))
    return False, {}
def deploy(ref, fnroot, fn, verify_jwt):
    """Deploy fn from fnroot's project, keep the gateway setting, prove the live copy is that build. True when clean."""
    root = os.path.dirname(os.path.dirname(fnroot))
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", ref, "--use-api"] + ([] if verify_jwt else ["--no-verify-jwt"]), cwd=root, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    okd, livef = live_files(ref, fn)
    good = p.returncode == 0 and okd and all(livef.get(k) == sha(os.path.join(root, k)) for k in need(fnroot, fn))
    if not good: bad(f"{fn} did not deploy cleanly: " + (p.stderr or p.stdout)[-200:]); return False
    sN, mN = fmeta(ref, fn)
    if (mN or {}).get("verify_jwt") != verify_jwt:
        http("PATCH", f"{API}/v1/projects/{ref}/functions/{fn}", {"verify_jwt": verify_jwt}, MG()); sN, mN = fmeta(ref, fn)
    if (mN or {}).get("verify_jwt") != verify_jwt: bad(f"{fn}: the gateway setting did not come back"); return False
    say(f"  ✓ {fn} deployed: version {(mN or {}).get('version', '?')}, gateway sign-in check {'on' if verify_jwt else 'off'}"); return True
def start(title):
    say(f"{STEP} · {title}"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
    if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
def check_build(fnroot, shas):
    for name, want in shas.items():
        p_ = os.path.join(fnroot, name); have_ = sha(p_) if os.path.exists(p_) else "(missing)"
        say(f"  ✓ {name} is the reviewed build") if have_ == want else bad(f"{name} is not the reviewed build: nothing runs")
    if fails: say(); say("  RESULT: STOPPED before anything changed."); done(2)
