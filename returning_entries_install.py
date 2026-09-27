#!/usr/bin/env python3
# One client profile 5b C · the automatic front doors never rewrite a closed inquiry · install (Desktop 264).
#  1. sha-checks the five front doors, client-lookup and the two shared rule files
#  2. reads how each function checks callers TODAY (the web form, bookings and call webhooks can't sign in,
#     so they run without sign-in checking and are gated by their own token) and deploys each one exactly
#     the same way; then reads it back and stops loudly if anything changed
#  3. proves each one is reachable and still refuses a wrong token, without creating anything
# No database change. Nobody is contacted by this change.
import json, os, hashlib, subprocess, urllib.request, urllib.error, datetime as dt
FNROOT = os.environ["SB_FNROOT"]; FN_SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "")
SUPA = os.environ.get("SB_SUPA_CLI", ""); SKIP_FN = os.environ.get("SB_SKIP_FUNCTION") == "1"
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
# the functions and how each is called; the webhooks are token-gated (a wrong token must get 401)
DEPLOY = ["assessment-intake", "call-followup", "lead-intake", "call-disposition", "cc-booking", "client-lookup"]
WEBHOOK = {"assessment-intake": "POST", "call-followup": "POST", "lead-intake": "POST", "call-disposition": "POST", "cc-booking": "GET"}
lines = []
def say(s=""): print(s, flush=True); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None, timeout=240):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-returning/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, "%s: %s" % (type(e).__name__, e)
def verify_jwt(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers={"Authorization": "Bearer " + TOKEN})
    if s != 200: return None
    try: v = json.loads(b).get("verify_jwt")
    except Exception: return None
    return v if isinstance(v, bool) else None

say("5b C · THE AUTOMATIC FRONT DOORS NEVER REWRITE A CLOSED INQUIRY · INSTALL")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
for fn, want in FN_SHAS.items():
    path = os.path.join(FNROOT, fn) if fn.endswith(".ts") else os.path.join(FNROOT, fn, "index.ts")
    got = hashlib.sha256(open(path, "rb").read()).hexdigest()
    say(f"  {fn} sha256 {got[:16]}…" + ("  ✓ reviewed source" if got == want else "  ✗ differs"))
    if got != want: say("  STOP. Nothing was run."); done(2)
before = {fn: verify_jwt(fn) for fn in DEPLOY}
unknown = [fn for fn, v in before.items() if v is None]
if unknown: say("  ✗ STOP: could not read how these check callers today: " + ", ".join(unknown) + ". Nothing was deployed."); done(3)
if before["client-lookup"] is not True: say("  ✗ STOP: client-lookup is not checking sign-ins today. Tell Claude. Nothing was deployed."); done(3)
say("  ✓ read how each function checks callers today: " + ", ".join(f"{fn} {'sign-in' if v else 'its own token'}" for fn, v in before.items()))
for fn in DEPLOY:
    args = [SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if before[fn] else ["--no-verify-jwt"])
    if SKIP_FN: say(f"  (test target) would deploy {fn}" + ("" if before[fn] else " --no-verify-jwt")); continue
    p = subprocess.run(args, cwd=os.path.dirname(os.path.dirname(FNROOT)), env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: say(f"  ✗ {fn} deploy failed: " + (p.stderr or p.stdout)[-400:]); done(5)
    say(f"  ✓ {fn} deployed")
after = {fn: verify_jwt(fn) for fn in DEPLOY}
moved = [fn for fn in DEPLOY if after[fn] != before[fn]]
if moved: say("  ✗ HOW THESE CHECK CALLERS CHANGED: " + ", ".join(moved) + ". Tell Claude today (a web form or phone webhook may be refusing real calls)."); done(6)
say("  ✓ every function checks callers exactly as before")
bad = []
for fn, method in WEBHOOK.items():
    s, _ = http(method, f"{FNB}/functions/v1/{fn}?token=wrong-token-check" + ("&action=slots" if method == "GET" else ""), {} if method == "POST" else None)
    if s != 401: bad.append(f"{fn} → HTTP {s}")
if bad: say("  ✗ a wrong token was not refused: " + ", ".join(bad)); done(7)
say(f"  ✓ all {len(WEBHOOK)} front doors are up and still refuse a wrong token (nothing was created)")
s, _ = http("POST", f"{FNB}/functions/v1/client-lookup", {"action": "find", "phones": ["4175550000"]})
if s not in (401, 403): say(f"  ✗ client-lookup answered HTTP {s} to someone not signed in"); done(8)
say("  ✓ the lookup still refuses anyone not signed in")
say(); say("RESULT: INSTALLED · a closed inquiry is never rewritten; a returning family's new inquiry is flagged for a person to answer")
done(0)
