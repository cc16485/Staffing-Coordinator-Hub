#!/usr/bin/env python3
# identity-backfill caller lock (Desktop 262). No database change, nothing written.
#  1. sha-checks identity-backfill (the reviewed source only)
#  2. deploys it, and stops if the function isn't checking that keys are genuine
#  3. proves the lock on the LIVE function: the public key is refused for every mode that writes or
#     shows names; the nightly Family Circle sync still runs on it and gets counts only; the service
#     key still gets through
import json, os, hashlib, subprocess, urllib.request, urllib.error, datetime as dt
FNROOT = os.environ.get("SB_FNROOT", ""); FN_SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}")); REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "")
SUPA = os.environ.get("SB_SUPA_CLI", ""); SKIP_FN = os.environ.get("SB_SKIP_FUNCTION") == "1"
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FN = FNB + "/functions/v1/identity-backfill"
lines = []
def say(s=""): print(s, flush=True); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None, timeout=300):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-identity-lock/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read()
    except urllib.error.HTTPError as e: return e.code, e.read()
    except Exception as e: return None, ("%s: %s" % (type(e).__name__, e)).encode()
def keys():
    s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers={"Authorization": "Bearer " + TOKEN})
    try: return {k.get("name"): k.get("api_key", "") for k in json.loads(kb) if isinstance(k, dict)}
    except Exception: return {}
def call(qs, key):
    s, b = http("GET", FN + qs, None, {"Authorization": "Bearer " + key, "apikey": key})
    try: return s, json.loads(b)
    except Exception: return s, None

say("IDENTITY-BACKFILL · CALLER LOCK")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
for fn, want in FN_SHAS.items():
    got = hashlib.sha256(open(os.path.join(FNROOT, fn, "index.ts"), "rb").read()).hexdigest()
    say(f"  {fn} sha256 {got[:16]}…" + ("  ✓ reviewed source" if got == want else "  ✗ differs"))
    if got != want: say("  STOP. Nothing was run."); done(2)
if SKIP_FN: say("  (test target: function deploy skipped)")
else:
    p = subprocess.run([SUPA, "functions", "deploy", "identity-backfill", "--project-ref", REF, "--use-api"], cwd=os.path.dirname(os.path.dirname(FNROOT)),
                       env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: say("  ✗ deploy failed: " + (p.stderr or p.stdout)[-400:]); done(4)
    say("  ✓ identity-backfill deployed")
s, b = http("GET", f"{API}/v1/projects/{REF}/functions/identity-backfill", headers={"Authorization": "Bearer " + TOKEN})
try: vj = json.loads(b).get("verify_jwt")
except Exception: vj = None
if vj is not True:
    say(f"  ✗ identity-backfill is not checking that keys are genuine (verify_jwt {vj!r}), so the lock could be faked. Tell Claude."); done(5)
say("  ✓ the function checks every key is genuine before it runs")
k = keys(); anon, svc = k.get("anon", ""), k.get("service_role", "")
if not anon or not svc: say("  ✗ could not read the project's keys, so the lock could not be proven"); done(6)
bad = []
for qs in ("?clients=1", "?clients=1&commit=1", "?ghl_clients=1", "?grade=1", "?roster_roles=1", "?apply_phones=1", "?recover=1", ""):
    st, _ = call(qs, anon)
    if st != 403: bad.append(f"{qs or '(default)'} → HTTP {st}")
if bad: say("  ✗ the public key still reaches: " + ", ".join(bad) + ". Tell Claude."); done(7)
say("  ✓ the public key is now refused for every mode that writes or shows names (tried 8)")
st, d = call("?circles=1", anon)
leaks = [kk for kk, v in (d or {}).items() if isinstance(v, (str, list, dict)) and kk not in ("mode", "error")]
if st != 200 or not isinstance(d, dict) or d.get("error") or leaks:
    say(f"  ✗ the nightly Family Circle sync would break or show names (HTTP {st}: {str(d)[:200]}). Tell Claude."); done(8)
say(f"  ✓ the nightly Family Circle sync still runs on the public key, counts only ({d.get('clients', 0)} clients read, preview, nothing written)")
st, d = call("?circles=1", svc)
if st != 200 or not isinstance(d, dict) or d.get("error"): say(f"  ✗ the service key was not let through (HTTP {st}: {str(d)[:200]}). Tell Claude."); done(9)
say("  ✓ your Desktop scripts (the service key) still get through")
say(); say("RESULT: LOCKED · only the nightly Family Circle sync is open to the public key, and it sees counts only")
done(0)
