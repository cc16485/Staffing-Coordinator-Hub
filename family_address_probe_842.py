#!/usr/bin/env python3
# 842 · READ TEST CLIENT 5'S ADDRESS FROM AXISCARE (one time, read only). Samantha 2026-10-16: 840 couldn't read a state
# for Test Client 5 after she added a Missouri address. Deploys client-address-probe, calls it once (it reads ONLY AxisCare
# client #290 and only its address parts), prints what AxisCare sent back, then deletes the probe. Writes nothing anywhere.
import json, os, re, subprocess, sys, time, hashlib, urllib.request, urllib.error
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); SUPA = os.environ.get("SB_SUPA_CLI", "")
REPO = os.environ["SB_REPO"]; PINS = json.loads(os.environ["SB_PINS"]); HUB = "zngsgedlsxinbygwmxwn"
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co"); FN = "client-address-probe"
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for h in HIDE:
        if h: s = s.replace(h, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_)[A-Za-z0-9._\-]{8,}", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def ok(s): say("  ✓ " + s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def http(method, url, body=None, headers=None, timeout=90):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-842/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
say("842 · TEST CLIENT 5'S ADDRESS IN AXISCARE (read only)"); say(time.strftime("%Y-%m-%d %H:%M")); say()
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
if p.returncode != 0: bad(f"the probe didn't deploy: {(p.stderr or p.stdout)[-200:]}"); done(1)
ok("one-time probe in place"); time.sleep(float(os.environ.get("SB_SETTLE", "5")))
try:
    s, b = http("POST", f"{FNB}/functions/v1/{FN}", {}, {"Authorization": "Bearer " + svc, "apikey": svc})
    say(); say("WHAT AXISCARE SENDS FOR TEST CLIENT 5 (#290):")
    for ln in (b or "").splitlines(): say("    " + ln)
    (ok if s == 200 else bad)(f"read ({s})")
finally:
    s2, b2 = http("DELETE", f"{API}/v1/projects/{HUB}/functions/{FN}", headers=MG())
    s3, _ = http("GET", f"{API}/v1/projects/{HUB}/functions/{FN}", headers=MG())
    (ok if s3 == 404 else bad)("probe deleted again" if s3 == 404 else f"probe NOT deleted ({s2}/{s3}). Tell Claude.")
say(); say("  842: " + ("DONE. Send this report to Claude." if not fails else "NOT COMPLETE. Send this report to Claude.")); done(0 if not fails else 1)
