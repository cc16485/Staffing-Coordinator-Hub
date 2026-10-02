#!/usr/bin/env python3
# 408 (2026-10-01): Samantha: the welcome call invite must explain the call is how they get set up to do their orientation
# from their phone or computer. Redeploys ONLY the welcome-call function, and only if its live copy is the 407 build
# (or already this build). Sends nothing.
import os, sys, json, re, hashlib, subprocess, tempfile, shutil, urllib.request, urllib.error
REPORT = os.environ["SB_REPORT"]; REPO = os.environ["SB_REPO"]; WANT = os.environ["SB_WANT_SHA"]; OLD = os.environ["SB_OLD_SHA"]
TOKEN = os.environ.get("SB_TOKEN", "").strip(); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = "https://api.supabase.com"; FN = "welcome-call"
lines = []
def say(s=""):
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", str(s)); print(s, flush=True); lines.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200] + ". Tell Claude."); open(REPORT, "w").write("\n".join(lines) + "\n")
sys.excepthook = _crash
def http(method, url, body=None, headers=None):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-words408/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = {"Authorization": "Bearer " + TOKEN}
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
def meta():
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG)
    return s, (json.loads(b) if s == 200 else None)
def live_sha():
    tmp = tempfile.mkdtemp(prefix="w408-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
    subprocess.run([SUPA, "functions", "download", FN, "--project-ref", REF, "--use-api"], cwd=tmp,
                   env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    p = os.path.join(tmp, "supabase", "functions", FN, "index.ts"); h = sha(p) if os.path.exists(p) else None
    shutil.rmtree(tmp, ignore_errors=True); return h

say("408 · WELCOME CALL INVITE WORDING"); say()
src = os.path.join(REPO, "supabase", "functions", FN, "index.ts")
if sha(src) != WANT: say("  ✗ the welcome-call file is not the reviewed build. Nothing was run."); done(2)
say("  ✓ the new wording is the reviewed build")
s, m = meta()
if s != 200: say(f"  ✗ could not read the live welcome-call step ({s}). Nothing was run."); done(2)
h = live_sha()
if h == WANT: say("  ✓ the live welcome-call step already has the new wording"); done(0)
if h != OLD: say("  ✗ the live welcome-call step is not the 407 build, so it was left alone. Tell Claude."); done(2)
say("  ✓ the live copy is the 407 build")
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"], cwd=REPO,
                   env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
s, m = meta()
if (m or {}).get("verify_jwt") is not True:
    http("PATCH", f"{API}/v1/projects/{REF}/functions/{FN}", {"verify_jwt": True}, MG); s, m = meta()
if live_sha() != WANT: say("  ✗ the deploy did not take: " + (p.stderr or p.stdout)[-200:]); done(1)
if (m or {}).get("verify_jwt") is not True: say("  ✗ its sign-in check is not on. Tell Claude."); done(1)
say("  ✓ the welcome-call step now sends the new invite wording, sign-in check on")
s, _ = http("POST", f"https://{REF}.supabase.co/functions/v1/{FN}", {"action": "preview"})
say(("  ✓" if s == 401 else "  ✗") + f" it still refuses anyone not signed in ({s})")
say(); say("RESULT: DONE. Nothing was sent. The booking page wording updates when the Hub change is merged.")
done(0)
