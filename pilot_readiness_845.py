#!/usr/bin/env python3
# 845 · FAMILY APP PILOT CHECK (read only). Samantha 2026-10-16: "Yes, build the pilot check".
# Deploys the one-time reader pilot-readiness, calls it once (it reads AxisCare and the Hub; writes nothing), puts the report in
# this file, then deletes the reader. For every ACTIVE client: Missouri address, who can sign in, rate, About box, and how
# many of their recent caregivers can get the offer text. Contacts nobody.
import json, os, re, subprocess, sys, time, hashlib, urllib.request, urllib.error
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); SUPA = os.environ.get("SB_SUPA_CLI", "")
REPO = os.environ["SB_REPO"]; PINS = json.loads(os.environ["SB_PINS"]); HUB = "zngsgedlsxinbygwmxwn"
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co"); FN = "pilot-readiness"
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for h in HIDE:
        if h: s = s.replace(h, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_)[A-Za-z0-9._\-]{8,}", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def http(method, url, body=None, headers=None, timeout=280):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-845/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
say("845 · FAMILY APP PILOT CHECK (read only)"); say(time.strftime("%Y-%m-%d %H:%M")); say()
for rel, want in PINS.items():
    p = os.path.join(REPO, rel)
    if not os.path.exists(p) or sha(p) != want: bad(f"{rel} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
s, b = http("GET", f"{API}/v1/projects/{HUB}/api-keys?reveal=true", headers=MG())
if s == 401: bad("Supabase didn't accept that access token"); say("  STOP. Nothing was run."); done(2)
try: svc = next(k["api_key"] for k in json.loads(b) if k.get("name") == "service_role")
except Exception: svc = ""
if not svc.startswith("eyJ"): bad("couldn't read the Hub's server key"); say("  STOP. Nothing was run."); done(2)
HIDE.append(svc)
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", HUB, "--use-api"], cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: bad(f"the reader didn't deploy: {(p.stderr or p.stdout)[-200:]}"); done(1)
time.sleep(float(os.environ.get("SB_SETTLE", "5")))
try:
    s, b = http("POST", f"{FNB}/functions/v1/{FN}", {}, {"Authorization": "Bearer " + svc, "apikey": svc})
    try: out = json.loads(b)
    except Exception: out = {}
    if s == 200 and out.get("ok"): say(out.get("text", ""))
    else: bad(f"the check didn't finish ({s}: {str(out.get('error') or b)[:200]})")
finally:
    http("DELETE", f"{API}/v1/projects/{HUB}/functions/{FN}", headers=MG())
    s3, _ = http("GET", f"{API}/v1/projects/{HUB}/functions/{FN}", headers=MG())
    if s3 != 404: bad("the one-time reader was NOT deleted. Tell Claude.")
say(); say("  845: " + ("DONE. Nothing was changed. Pick your pilot families from the READY list (or fix what a client is missing)." if not fails else "NOT COMPLETE. Send this report to Claude.")); done(0 if not fails else 1)
