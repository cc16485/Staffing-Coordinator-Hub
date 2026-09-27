#!/usr/bin/env python3
# PACE is not Medicaid in the profile check (2026-09-27) · install (Desktop 267).
#  1. sha-checks profile-check and the shared care-level rule it imports
#  2. reads how profile-check checks callers today, deploys it exactly the same way, reads it back
#  3. runs the function's own self-test on the LIVE copy: every check must pass, including the new PACE one
# No database change. Nobody is contacted. Nothing is enforced by this change.
import json, os, hashlib, subprocess, urllib.request, urllib.error, datetime as dt
FNROOT = os.environ["SB_FNROOT"]; FN_SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "")
SUPA = os.environ.get("SB_SUPA_CLI", ""); SKIP_FN = os.environ.get("SB_SKIP_FUNCTION") == "1"
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FN = "profile-check"
lines = []
def say(s=""): print(s, flush=True); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, headers=None, timeout=240):
    req = urllib.request.Request(url, method=method, headers=dict({"User-Agent": "cc-medicaid-test/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, "%s: %s" % (type(e).__name__, e)
def verify_jwt():
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{FN}", {"Authorization": "Bearer " + TOKEN})
    try: v = json.loads(b).get("verify_jwt") if s == 200 else None
    except Exception: v = None
    return v if isinstance(v, bool) else None

say("PACE IS NOT MEDICAID IN THE PROFILE CHECK · INSTALL")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
for fn, want in FN_SHAS.items():
    path = os.path.join(FNROOT, fn) if fn.endswith(".ts") else os.path.join(FNROOT, fn, "index.ts")
    got = hashlib.sha256(open(path, "rb").read()).hexdigest()
    say(f"  {fn} sha256 {got[:16]}…" + ("  ✓ reviewed source" if got == want else "  ✗ differs"))
    if got != want: say("  STOP. Nothing was run."); done(2)
before = verify_jwt()
if before is None: say("  ✗ STOP: could not read how profile-check checks callers today. Nothing was deployed."); done(3)
say("  ✓ profile-check checks callers by " + ("sign-in" if before else "its own rules") + " today")
if SKIP_FN: say("  (test target) would deploy profile-check" + ("" if before else " --no-verify-jwt"))
else:
    p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"] + ([] if before else ["--no-verify-jwt"]),
                       cwd=os.path.dirname(os.path.dirname(FNROOT)), env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: say("  ✗ deploy failed: " + (p.stderr or p.stdout)[-400:]); done(4)
    say("  ✓ profile-check deployed")
if verify_jwt() != before: say("  ✗ HOW PROFILE-CHECK CHECKS CALLERS CHANGED. Tell Claude today."); done(5)
say("  ✓ it checks callers exactly as before")
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", {"Authorization": "Bearer " + TOKEN})
try: anon = {k.get("name"): k.get("api_key", "") for k in json.loads(kb) if isinstance(k, dict)}.get("anon", "")
except Exception: anon = ""
s, b = http("GET", f"{FNB}/functions/v1/{FN}?selftest=1", {"Authorization": "Bearer " + anon, "apikey": anon} if anon else {})
try: j = json.loads(b)
except Exception: j = {}
rows = j.get("results") or j.get("checks") or []
fails = [r for r in rows if not r.get("pass")]
pace = [r for r in rows if "PACE" in str(r.get("fixture", ""))]
if s != 200 or not rows or fails or not pace:
    say(f"  ✗ the live self-test did not pass (HTTP {s}; {len(rows)} checks, {len(fails)} failed" + ("" if pace else ", no PACE check: an old copy is still live") + ")")
    for r in fails[:5]: say("     • " + str(r.get("fixture")))
    done(6)
say(f"  ✓ the live self-test passes all {len(rows)} checks, including: PACE is not Medicaid")
say(); say("RESULT: INSTALLED · a PACE client no longer gets the Medicaid authorization or DCN items")
done(0)
