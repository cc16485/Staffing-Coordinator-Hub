#!/usr/bin/env python3
# Change 5 · install careplan-tasks (sha-checked), answer CORS, and prove the shared project's AxisCare connection
# may add care tasks WITHOUT adding one: an empty task request on an Active client must be refused as invalid
# (allowed caller) rather than as not allowed. Run BEFORE merging the hub update.
import json, os, hashlib, subprocess, urllib.request, urllib.error, datetime as dt

FN_DIR = os.environ["SB_FNDIR"]; FN_SHA = os.environ["SB_FN_SHA"]; REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "")
SUPA = os.environ.get("SB_SUPA_CLI", ""); SKIP_FN = os.environ.get("SB_SKIP_FUNCTION") == "1"
API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")

lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None, timeout=120):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-careplan-tasks/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace"), dict(r.headers)
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace"), dict(e.headers)
    except Exception as e: return None, "%s: %s" % (type(e).__name__, e), {}

say("CHANGE 5 · CARE PLAN TASKS GO INTO AXISCARE · INSTALL + PERMISSION CHECK")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"))
say()
got = hashlib.sha256(open(os.path.join(FN_DIR, "index.ts"), "rb").read()).hexdigest()
say("  careplan-tasks sha256 " + got[:16] + "…" + ("  ✓ reviewed source" if got == FN_SHA else "  ✗ differs"))
if got != FN_SHA: say("  STOP. Nothing was run."); done(2)
if SKIP_FN: say("  (test target: function deploy skipped)")
else:
    p = subprocess.run([SUPA, "functions", "deploy", "careplan-tasks", "--project-ref", REF, "--use-api"],
                       cwd=os.path.dirname(os.path.dirname(os.path.dirname(FN_DIR))),
                       env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: say("  ✗ deploy failed: " + (p.stderr or p.stdout)[-400:]); done(3)
    say("  ✓ careplan-tasks deployed (nothing uses it until the hub update is merged)")
s, _, h = http("OPTIONS", f"{FNB}/functions/v1/careplan-tasks", headers={"Origin": "https://cc.mo-care.com", "Access-Control-Request-Method": "POST"})
cors = s == 200 and (h.get("Access-Control-Allow-Origin") or h.get("access-control-allow-origin")) == "*"
say("  " + ("✓ the hub can reach it from the browser (CORS answered)" if cors else f"✗ CORS preflight answered {s}"))
s, kb, _ = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers={"Authorization": "Bearer " + TOKEN})
svc = ""
try: svc = next((k.get("api_key", "") for k in json.loads(kb) if isinstance(k, dict) and k.get("name") == "service_role"), "")
except Exception: pass
if not svc: say("  ✗ could not get the server key for the permission check"); done(4)
s, body, _ = http("POST", f"{FNB}/functions/v1/careplan-tasks", {"action": "permission_check"}, {"Authorization": "Bearer " + svc, "apikey": svc})
svc = ""
try: out = json.loads(body)
except Exception: out = {"ok": False, "detail": body[:300]}
perm = s == 200 and out.get("ok") is True
say("  " + (f"✓ AxisCare lets this connection add care tasks. {out.get('detail')} Nothing was added." if perm
            else "✗ permission check failed: " + str(out.get("detail") or out)[:300]))
say()
allok = cors and perm
say("RESULT: " + ("READY · merge the hub update and Save & Push sends the care tasks too" if allok
                  else "NOT READY · do NOT merge the hub update; the care plan keeps going as a note only. Send Claude this report."))
done(0 if allok else 5)
