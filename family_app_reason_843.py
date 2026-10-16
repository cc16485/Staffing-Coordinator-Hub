#!/usr/bin/env python3
# 843 · LABEL APP VISITS IN AXISCARE. Samantha 2026-10-16: "Do option 1 (a 'Booked by family in app' change reason)".
# Checks AxisCare has the visit change reason "Booked by family in app" switched on (a one-time READ ONLY reader lists the
# reasons, then is deleted), then sets the Hub to put that reason on every visit the family app creates
# (ops_settings family_app_create_reason). Changes nothing in AxisCare. Contacts nobody. Safe to run again.
import json, os, re, subprocess, sys, time, hashlib, urllib.request, urllib.error
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); SUPA = os.environ.get("SB_SUPA_CLI", "")
REPO = os.environ["SB_REPO"]; PINS = json.loads(os.environ["SB_PINS"]); HUB = "zngsgedlsxinbygwmxwn"
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co"); FN = "visit-reasons-probe"; WANT = "Booked by family in app"
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-843/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
norm = lambda s: re.sub(r"\s+", " ", str(s or "")).strip().lower()
say("843 · LABEL APP VISITS IN AXISCARE"); say(time.strftime("%Y-%m-%d %H:%M")); say()
for rel, want in PINS.items():
    p = os.path.join(REPO, rel)
    if not os.path.exists(p) or sha(p) != want: bad(f"{rel} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
s, b = http("GET", f"{API}/v1/projects/{HUB}/api-keys?reveal=true", headers=MG())
if s == 401: bad("Supabase didn't accept that access token"); say("  STOP. Nothing was run."); done(2)
try: svc = next(k["api_key"] for k in json.loads(b) if k.get("name") == "service_role")
except Exception: svc = ""
if not svc.startswith("eyJ"): bad("couldn't read the Hub's server key"); say("  STOP. Nothing was run."); done(2)
HIDE.append(svc)
say("1 · IS THE REASON IN AXISCARE?")
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", HUB, "--use-api"], cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: bad(f"the reader didn't deploy: {(p.stderr or p.stdout)[-200:]}"); done(1)
time.sleep(float(os.environ.get("SB_SETTLE", "5")))
reasons = None
try:
    s, b = http("POST", f"{FNB}/functions/v1/{FN}", {}, {"Authorization": "Bearer " + svc, "apikey": svc})
    try: reasons = json.loads(b).get("reasons") if s == 200 else None
    except Exception: reasons = None
finally:
    http("DELETE", f"{API}/v1/projects/{HUB}/functions/{FN}", headers=MG())
    s3, _ = http("GET", f"{API}/v1/projects/{HUB}/functions/{FN}", headers=MG())
    if s3 != 404: bad("the one-time reader was NOT deleted. Tell Claude.")
if reasons is None: bad(f"couldn't read AxisCare's change reasons ({s})"); done(1)
hit = next((r for r in reasons if norm(r.get("name")) == norm(WANT)), None)
if not hit:
    bad(f'AxisCare has no change reason called "{WANT}" yet')
    say("  · the reasons AxisCare has now: " + ", ".join(sorted(r["name"] for r in reasons if not r.get("disabled"))))
    say(f'  STOP. Add "{WANT}" in AxisCare (spelled exactly like that), then run 843 again. Nothing was changed.'); done(1)
if hit.get("disabled"): bad(f'"{WANT}" is in AxisCare but switched off. Turn it on, then run 843 again.'); say("  STOP. Nothing was changed."); done(1)
ok(f'AxisCare has "{hit["name"]}" (switched on)')
say(); say("2 · USE IT ON APP VISITS")
q = ("update public.app_data set data = coalesce(data, '{}'::jsonb) || jsonb_build_object('family_app_create_reason', '" + str(hit["name"]).replace("'", "''") + "') "
     "where key = 'ops_settings' returning data->>'family_app_create_reason' as r")
s, b = http("POST", f"{API}/v1/projects/{HUB}/database/query", {"query": q}, MG())
try: r = (json.loads(b) or [{}])[0].get("r") if s in (200, 201) else None
except Exception: r = None
(ok if r == hit["name"] else bad)(f'every visit the family app puts on AxisCare now carries "{hit["name"]}"' if r == hit["name"] else f"not saved ({s}: {str(b)[:200]})")
say(); say("  843: " + ("DONE. App visits are labelled in AxisCare (open a visit and look at its change reason)." if not fails else "NOT COMPLETE. See the ✗ lines above.")); done(0 if not fails else 1)
