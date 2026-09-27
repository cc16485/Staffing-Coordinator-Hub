#!/usr/bin/env python3
# Change 2 · install client-convert (sha-checked), answer CORS, and prove the shared project's AxisCare
# connection may change a client, by writing Test Client 5's own priority note back unchanged.
# Run BEFORE merging the hub update: if AxisCare refuses, don't merge, and Convert keeps today's path.
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
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-client-convert/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace"), dict(r.headers)
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace"), dict(e.headers)
    except Exception as e: return None, "%s: %s" % (type(e).__name__, e), {}

say("CHANGE 2 · CONVERT SENDS THE WHOLE CLIENT · INSTALL + PERMISSION CHECK")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"))
say()
got = hashlib.sha256(open(os.path.join(FN_DIR, "index.ts"), "rb").read()).hexdigest()
say("  client-convert sha256 " + got[:16] + "…" + ("  ✓ reviewed source" if got == FN_SHA else "  ✗ differs"))
if got != FN_SHA: say("  STOP. Nothing was run."); done(2)
if SKIP_FN: say("  (test target: function deploy skipped)")
else:
    p = subprocess.run([SUPA, "functions", "deploy", "client-convert", "--project-ref", REF, "--use-api"],
                       cwd=os.path.dirname(os.path.dirname(os.path.dirname(FN_DIR))),
                       env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: say("  ✗ deploy failed: " + (p.stderr or p.stdout)[-400:]); done(3)
    say("  ✓ client-convert deployed (nothing uses it until the hub update is merged)")
s, _, h = http("OPTIONS", f"{FNB}/functions/v1/client-convert", headers={"Origin": "https://cc.mo-care.com", "Access-Control-Request-Method": "POST"})
cors = s == 200 and (h.get("Access-Control-Allow-Origin") or h.get("access-control-allow-origin")) == "*"
say("  " + ("✓ the hub can reach it from the browser (CORS answered)" if cors else f"✗ CORS preflight answered {s}"))
s, kb, _ = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers={"Authorization": "Bearer " + TOKEN})
svc = ""
try: svc = next((k.get("api_key", "") for k in json.loads(kb) if isinstance(k, dict) and k.get("name") == "service_role"), "")
except Exception: pass
if not svc: say("  ✗ could not get the server key for the permission check"); done(4)
s, body, _ = http("POST", f"{FNB}/functions/v1/client-convert", {"action": "permission_check"}, {"Authorization": "Bearer " + svc, "apikey": svc})
svc = ""
try: out = json.loads(body)
except Exception: out = {"ok": False, "detail": body[:300]}
perm = s == 200 and out.get("ok") is True
say("  " + (f"✓ AxisCare lets this connection change a client: {out.get('client')} (#290), {out.get('detail')}" if perm
            else "✗ permission check failed: " + str(out.get("detail") or out)[:300]))
say()
allok = cors and perm
say("RESULT: " + ("READY · merge the hub update and Convert uses the new path" if allok
                  else "NOT READY · do NOT merge the hub update; Convert keeps today's path. Send Claude this report."))
done(0 if allok else 5)
