#!/usr/bin/env python3
# One client profile 5b B + D · "Is this family already known?" · install (Desktop 263).
#  1. sha-checks the migration, client-lookup and its shared rule file
#  2. applies client-status-returning.sql: "Returning client" keeps the Journey a returning family's
#     linked inquiry already opened (never a second one); no rows move
#  3. deploys client-lookup (read only: AxisCare live + Family Circles; names and reasons only)
#  4. checks the hub can reach it (CORS) and that it refuses anyone not signed in, including the public key
import json, os, hashlib, subprocess, urllib.request, urllib.error, datetime as dt
MIG = open(os.environ["SB_MIGFILE"], "rb").read(); MIG_SHA = os.environ["SB_MIG_SHA"]
FNROOT = os.environ["SB_FNROOT"]; FN_SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "")
SUPA = os.environ.get("SB_SUPA_CLI", ""); SKIP_FN = os.environ.get("SB_SKIP_FUNCTION") == "1"
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
lines = []
def say(s=""): print(s, flush=True); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None, timeout=240):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-known-family/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace"), dict(r.headers)
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace"), dict(e.headers)
    except Exception as e: return None, "%s: %s" % (type(e).__name__, e), {}
def sql(q):
    s, b, _ = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, {"Authorization": "Bearer " + TOKEN}, 300)
    if s not in (200, 201): return False, f"HTTP {s}: {b[:500]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:400]
def keys():
    s, kb, _ = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers={"Authorization": "Bearer " + TOKEN})
    try: return {k.get("name"): k.get("api_key", "") for k in json.loads(kb) if isinstance(k, dict)}
    except Exception: return {}

say('"IS THIS FAMILY ALREADY KNOWN?" · INSTALL')
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
sha = hashlib.sha256(MIG).hexdigest()
say("  migration sha256 " + sha[:16] + "…" + ("  ✓ proven build" if sha == MIG_SHA else "  ✗ NOT the proven build"))
if sha != MIG_SHA: say("  STOP. Nothing was run."); done(2)
for fn, want in FN_SHAS.items():
    path = os.path.join(FNROOT, fn) if fn.endswith(".ts") else os.path.join(FNROOT, fn, "index.ts")
    got = hashlib.sha256(open(path, "rb").read()).hexdigest()
    say(f"  {fn} sha256 {got[:16]}…" + ("  ✓ reviewed source" if got == want else "  ✗ differs"))
    if got != want: say("  STOP. Nothing was run."); done(2)
ok, r = sql(MIG.decode())
if not ok: say("  ✗ STOPPED: the returning-client fix did not complete (self-check); nothing changed: " + str(r)[:500]); done(4)
ok, r = sql("select position('journey_already_open' in prosrc) > 0 as new from pg_proc where proname = 'client_status_decide'")
if not (ok and r and r[0].get("new") in (True, "true")): say("  ✗ the returning-client fix is not the live version: " + str(r)[:200]); done(4)
say("  ✓ \"Returning client\" now keeps the Journey a returning family's inquiry already opened (never a second one)")
if SKIP_FN: say("  (test target: function deploy skipped)")
else:
    for fn in [f for f in FN_SHAS if not f.endswith(".ts")]:
        p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"], cwd=os.path.dirname(os.path.dirname(FNROOT)),
                           env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
        if p.returncode != 0: say(f"  ✗ {fn} deploy failed: " + (p.stderr or p.stdout)[-400:]); done(5)
        say(f"  ✓ {fn} deployed")
s, _, h = http("OPTIONS", f"{FNB}/functions/v1/client-lookup", headers={"Origin": "https://cc.mo-care.com", "Access-Control-Request-Method": "POST"})
cors = s == 200 and (h.get("Access-Control-Allow-Origin") or h.get("access-control-allow-origin")) == "*"
say("  " + ("✓ the hub can reach the lookup (CORS answered)" if cors else f"✗ CORS preflight answered {s}"))
s1, _, _ = http("POST", f"{FNB}/functions/v1/client-lookup", {"action": "find", "phones": ["4175550000"]}, {})
anon = keys().get("anon", "")
s2, b2, _ = http("POST", f"{FNB}/functions/v1/client-lookup", {"action": "find", "phones": ["4175550000"]}, {"Authorization": "Bearer " + anon, "apikey": anon}) if anon else (None, "", {})
refuses = s1 in (401, 403) and s2 in (401, 403)
say("  " + ("✓ the lookup refuses anyone not signed in to the hub, including the public key" if refuses else f"✗ not signed in got HTTP {s1}, the public key got HTTP {s2}"))
say()
allok = cors and refuses
say("RESULT: " + ("INSTALLED · a new inquiry and Convert now check for a returning family first" if allok else "CHECK THE ✗ LINES"))
done(0 if allok else 9)
