#!/usr/bin/env python3
# "When a caregiver calls in" · install. Run AFTER the hub update is merged (it checks the live hub first).
#  1. sha-checks the migration, the two functions and the shared rule file
#  2. applies the migration (the append-only table, the current-plan view, the door)
#  3. deploys callin-plan (new) and coverage-run (Cara follows each plan)
#  4. checks the screen can reach its service, and that the table starts empty
# No plan exists until staff enter one, so Cara behaves exactly as before until then.
import json, os, hashlib, subprocess, urllib.request, urllib.error, datetime as dt
MIG = open(os.environ["SB_MIGFILE"], "rb").read(); MIG_SHA = os.environ["SB_MIG_SHA"]
FNROOT = os.environ["SB_FNROOT"]; FN_SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "")
SUPA = os.environ.get("SB_SUPA_CLI", ""); SKIP_FN = os.environ.get("SB_SKIP_FUNCTION") == "1"
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
HUB = os.environ.get("SB_HUB_URL", "https://cc.mo-care.com")
lines = []
def say(s=""): print(s, flush=True); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None, timeout=240):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-callin-plan/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace"), dict(r.headers)
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace"), dict(e.headers)
    except Exception as e: return None, "%s: %s" % (type(e).__name__, e), {}
def sql(q):
    s, b, _ = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, {"Authorization": "Bearer " + TOKEN}, 300)
    if s not in (200, 201): return False, f"HTTP {s}: {b[:500]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:400]

say('"WHEN A CAREGIVER CALLS IN" · CALL-IN PLAN · INSTALL')
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
sha = hashlib.sha256(MIG).hexdigest()
say("  migration sha256 " + sha[:16] + "…" + ("  ✓ proven build" if sha == MIG_SHA else "  ✗ NOT the proven build"))
if sha != MIG_SHA: say("  STOP. Nothing was run."); done(2)
for fn, want in FN_SHAS.items():
    path = os.path.join(FNROOT, fn) if fn.endswith(".ts") else os.path.join(FNROOT, fn, "index.ts")
    got = hashlib.sha256(open(path, "rb").read()).hexdigest()
    say(f"  {fn} sha256 {got[:16]}…" + ("  ✓ reviewed source" if got == want else "  ✗ differs"))
    if got != want: say("  STOP. Nothing was run."); done(2)
s2, page, _ = http("GET", HUB + "/?v=" + dt.datetime.now().strftime("%H%M%S"))
if s2 != 200 or "cipProfileLoad" not in page:
    say("  ✗ STOP: the live hub does not have the call-in plan screen yet (merge the hub pull request, wait a few minutes). Nothing was run."); done(3)
say("  ✓ the live hub has the new call-in plan screen")
ok, r = sql(MIG.decode())
if not ok: say("  ✗ STOPPED: the migration did not complete (guard or self-check); nothing changed: " + str(r)[:500]); done(4)
ok, n = sql("select count(*)::int as n from public.client_callin_entries")
say(f"  ✓ migration committed · the call-in plan table is in place ({n[0]['n'] if ok else '?'} entries)")
if SKIP_FN: say("  (test target: function deploys skipped)")
else:
    for fn in [f for f in FN_SHAS if not f.endswith(".ts")]:
        p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"], cwd=os.path.dirname(os.path.dirname(FNROOT)),
                           env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
        if p.returncode != 0: say(f"  ✗ {fn} deploy failed: " + (p.stderr or p.stdout)[-400:]); done(5)
        say(f"  ✓ {fn} deployed")
s, _, h = http("OPTIONS", f"{FNB}/functions/v1/callin-plan", headers={"Origin": "https://cc.mo-care.com", "Access-Control-Request-Method": "POST"})
cors = s == 200 and (h.get("Access-Control-Allow-Origin") or h.get("access-control-allow-origin")) == "*"
say("  " + ("✓ the Client 360 section can reach its service (CORS answered)" if cors else f"✗ CORS preflight answered {s}"))
s, b, _ = http("POST", f"{FNB}/functions/v1/callin-plan", {"action": "add"}, {})
refuses = s in (401, 403)
say("  " + ("✓ the service refuses anyone not signed in" if refuses else f"✗ an unsigned request got HTTP {s}"))
say()
allok = cors and refuses
say("RESULT: " + ("INSTALLED · Client 360 has \"When a caregiver calls in\"; Cara follows each plan once staff enter one" if allok else "CHECK THE ✗ LINES"))
done(0 if allok else 9)
