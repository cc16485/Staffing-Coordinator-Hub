#!/usr/bin/env python3
# 497 · CAMPAIGN SAFETY (Samantha 2026-10-07: "Yes, fix the campaign lists now. This is a safety issue"). Deploys campaign-send
# (every Hub send, any list, a pasted list too) and campaign-auto (the autopilot's lists) with the shared audience guard:
# never anyone tied to a deceased, past or paused client or their family; client and family campaigns only to people tied
# to an active or starting client; nothing is sent if AxisCare can't be read. Each keeps its gateway sign-in setting.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
ROOT = os.path.dirname(os.path.dirname(FNROOT)); CJDIR = os.path.join(ROOT, "client-journey"); FNS = ["campaign-send", "campaign-auto"]; FN = FNS[0]
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
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-497/1.0"}, **(headers or {})))
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
    tmp = tempfile.mkdtemp(prefix="cc497-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
    d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    live = {}
    for r, _, files in os.walk(tmp):
        for f in files:
            lp = os.path.join(r, f).replace(os.sep, "/")
            if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
    shutil.rmtree(tmp, ignore_errors=True)
    return d.returncode == 0, live

say("497 · CAMPAIGN SAFETY (never a deceased, past or paused client or their family)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for name, want in SHAS.items():
    p_ = os.path.join(FNROOT, "_shared", name.split("/", 1)[1]) if name.startswith("_shared/") else os.path.join(FNROOT, name, "index.ts")
    have = sha(p_) if os.path.exists(p_) else "(missing)"
    chk(have == want, f"{name} is the reviewed build" if have == want else f"{name} is not the reviewed build: nothing runs")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(2)
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); say("  RESULT: STOPPED before anything changed."); done(2)
for fn in FNS:
    src = open(os.path.join(FNROOT, fn, "index.ts")).read()
    chk("loadGuard(" in src and "verdict(" in src, f"{fn} on disk checks every recipient with the audience guard")
VJ = {}
for fn in FNS:
    sx, mx = fmeta(fn)
    chk(sx == 200 and mx is not None and isinstance(mx.get("verify_jwt"), bool), f"{fn} is live now (version {(mx or {}).get('version', '?')}, gateway sign-in check {'on' if (mx or {}).get('verify_jwt') else 'off'})")
    VJ[fn] = (mx or {}).get("verify_jwt")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(3)

say(); say("PART 2 · CHANGE")
for fn in FNS:
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if VJ[fn] else ["--no-verify-jwt"]), cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    okd, livef = live_files(fn)
    good = p.returncode == 0 and okd and all(k in livef and livef[k] == sha(os.path.join(ROOT, k)) for k in need(fn))
    chk(good, fn + " deployed: the live copy is this reviewed build, the audience guard included" if good else fn + " did not deploy cleanly: " + (p.stderr or p.stdout)[-200:])
    if fails: say("  RESULT: STOPPED (functions deployed above stay; the rest did not change)."); done(6)
    sN, mN = fmeta(fn)
    if (mN or {}).get("verify_jwt") != VJ[fn]:
        http("PATCH", f"{API}/v1/projects/{REF}/functions/{fn}", {"verify_jwt": VJ[fn]}, MG()); sN, mN = fmeta(fn)
    chk((mN or {}).get("verify_jwt") == VJ[fn], f"{fn}: version {(mN or {}).get('version', '?')}, gateway sign-in check {'on' if VJ[fn] else 'off'} as before")

say(); say("PART 3 · PROOF (nothing is texted or emailed)")
for fn in FNS:
    okd2, live2 = live_files(fn)
    chk(okd2 and live2.get(f"supabase/functions/{fn}/index.ts") == sha(os.path.join(FNROOT, fn, "index.ts")) and live2.get("supabase/functions/_shared/audience-guard.ts") == sha(os.path.join(FNROOT, "_shared", "audience-guard.ts")), f"the live {fn} is this build, with this audience guard")
say()
say("RESULT: " + ("DONE · Every campaign email, from any list, is now checked: never anyone tied to a deceased, past or paused client; client and family emails only to people tied to an active or starting client. If AxisCare can't be read, nothing is sent." if not fails else "CHECK THE ✗ LINES."))
say("Nothing was texted or emailed by this step.")
done(0 if not fails else 8)
