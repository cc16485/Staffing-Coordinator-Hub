#!/usr/bin/env python3
# Change 3 follow-up · redeploy client-admission-scan (accepts the project's own server secret) and
# client-status-review (records why a step was refused), both sha-checked, then run the reader once and
# confirm the automatic "Who is this?" check now works. The switch is already on; this run is a normal run.
import json, os, hashlib, subprocess, urllib.request, urllib.error, datetime as dt
FNROOT = os.environ["SB_FNROOT"]; FN_SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip(); REF = os.environ.get("SB_REF", ""); SUPA = os.environ.get("SB_SUPA_CLI", "")
API = "https://api.supabase.com"; FNB = f"https://{REF}.supabase.co"
lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-client-status-fix/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=240) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, str(e)
say("CHANGE 3 FOLLOW-UP · \"WHO IS THIS?\" CHECK · FIX + VERIFY")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
for fn, want in FN_SHAS.items():
    got = hashlib.sha256(open(os.path.join(FNROOT, fn, "index.ts"), "rb").read()).hexdigest()
    say(f"  {fn} sha256 {got[:16]}…" + ("  ✓ reviewed source" if got == want else "  ✗ differs"))
    if got != want: say("  STOP. Nothing was run."); done(2)
for fn in FN_SHAS:
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"], cwd=os.path.dirname(os.path.dirname(FNROOT)),
                       env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: say(f"  ✗ {fn} deploy failed: " + (p.stderr or p.stdout)[-400:]); done(3)
    say(f"  ✓ {fn} deployed")
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers={"Authorization": "Bearer " + TOKEN})
try: svc = next((k.get("api_key", "") for k in json.loads(kb) if isinstance(k, dict) and k.get("name") == "service_role"), "")
except Exception: svc = ""
if not svc: say("  ✗ could not get the server key"); done(4)
s, body = http("POST", f"{FNB}/functions/v1/client-status-review", {"action": "run"}, {"Authorization": "Bearer " + svc, "apikey": svc}); svc = ""
try: out = json.loads(body)
except Exception: out = {"error": body[:300]}
sc = out.get("admission_scan") or {}
scan_ok = s == 200 and isinstance(sc, dict) and "error" not in sc and sc.get("unlinked") is not None
say("  " + (f"✓ \"Who is this?\" ran: {sc.get('active')} Active in AxisCare, {sc.get('unlinked')} with no hub person, {sc.get('opened')} new question(s) opened (an existing open one is not repeated)"
            if scan_ok else "✗ the \"Who is this?\" check still failed: " + json.dumps(sc or out)[:300]))
say(f"  status copy: {out.get('current_refreshed')} client(s) · reviews opened: {out.get('opened')} · errors: {out.get('errors')}")
for e in out.get("error_list") or []: say(f"    ✗ {json.dumps(e)[:300]}")
say(); say("RESULT: " + ("FIXED · the automatic \"Who is this?\" check works" if scan_ok and out.get("errors") == 0 else "CHECK THE ✗ LINES"))
done(0 if scan_ok and out.get("errors") == 0 else 5)
