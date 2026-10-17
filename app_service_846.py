#!/usr/bin/env python3
# 846 · FAMILY APP: PP - APP SERVICE + ESTIMATE FIX. Samantha 2026-10-16: "Saved PP - App. Merge 481."
#  1. Redeploys family-gateway from GitHub's main: the estimate only uses HOURLY visits (no more "$450/hr" from a daily rate).
#  2. Proves "PP - App" in AxisCare on Test Client 5 ONLY: a one-time checker creates one unassigned visit 30 days out with
#     PP - App and the "Booked by family in app" reason (what the app sends), reads it back, removes it, and is deleted.
#     It is never an app booking, so no caregiver is offered or texted (offers are ON).
#  3. Only if that passed: the app books Missouri visits as PP - App (ops_settings family_app_service_MO).
import json, os, re, subprocess, sys, time, hashlib, urllib.request, urllib.error
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); SUPA = os.environ.get("SB_SUPA_CLI", "")
REPO = os.environ["SB_REPO"]; PINS = json.loads(os.environ["SB_PINS"]); HUB = "zngsgedlsxinbygwmxwn"
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co"); PROBE = "app-service-probe"; SERVICE = "PP - App"
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for h in HIDE:
        if h: s = s.replace(h, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_)[A-Za-z0-9._\-]{8,}", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def ok(s): say("  ✓ " + s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def http(method, url, body=None, headers=None, timeout=120):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-846/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def j(b):
    try: return json.loads(b)
    except Exception: return None
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{HUB}/database/query", {"query": q}, MG())
    return (s in (200, 201)), (j(b) if s in (200, 201) else f"HTTP {s}: {str(b)[:300]}"), s
def deploy(fn, extra=()):
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", HUB, "--use-api", *extra], cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    return p.returncode == 0, (p.stderr or p.stdout)[-200:]
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
say("846 · FAMILY APP: PP - APP SERVICE + ESTIMATE FIX"); say(time.strftime("%Y-%m-%d %H:%M")); say()
for rel, want in PINS.items():
    p = os.path.join(REPO, rel)
    if not os.path.exists(p) or sha(p) != want: bad(f"{rel} is not the reviewed build"); say("  STOP. Nothing was changed."); done(2)
good, rows, s = sql("select data->>'family_app_service_MO' as svc, data->>'family_app_create_reason' as reason from public.app_data where key = 'ops_settings'")
if s == 401: bad("Supabase didn't accept that access token"); say("  STOP. Nothing was changed."); done(2)
if not good: bad(f"couldn't read the Hub settings ({rows})"); done(1)
cur = rows[0]; say(f"  · now: Missouri app visits use \"{cur.get('svc')}\", reason \"{cur.get('reason')}\"")

say(); say("1 · ESTIMATE FIX (family door)")
okd, why = deploy("family-gateway", ["--no-verify-jwt"])
s, b = http("GET", f"{API}/v1/projects/{HUB}/functions/family-gateway", headers=MG())
if okd and s == 200 and (j(b) or {}).get("verify_jwt") is False: ok("family door updated: estimates use only hourly visits")
else: bad(f"family door didn't deploy cleanly ({why})"); say("  STOP. Nothing else was changed."); done(1)

say(); say("2 · PROVE PP - APP ON TEST CLIENT 5 (no caregiver is offered or texted)")
s, b = http("GET", f"{API}/v1/projects/{HUB}/api-keys?reveal=true", headers=MG())
try: svc = next(k["api_key"] for k in json.loads(b) if k.get("name") == "service_role")
except Exception: svc = ""
if not svc.startswith("eyJ"): bad("couldn't read the Hub's server key"); done(1)
HIDE.append(svc)
okd, why = deploy(PROBE)
if not okd: bad(f"the checker didn't deploy: {why}"); done(1)
time.sleep(float(os.environ.get("SB_SETTLE", "5")))
r = {}
try:
    s, b = http("POST", f"{FNB}/functions/v1/{PROBE}", {"service": SERVICE, "reason": cur.get("reason") or ""}, {"Authorization": "Bearer " + svc, "apikey": svc})
    r = j(b) or {}
    if s != 200: bad(f"the checker didn't answer ({s}: {str(b)[:200]})")
finally:
    http("DELETE", f"{API}/v1/projects/{HUB}/functions/{PROBE}", headers=MG())
    s3, _ = http("GET", f"{API}/v1/projects/{HUB}/functions/{PROBE}", headers=MG())
    if s3 != 404: bad("the one-time checker was NOT deleted. Tell Claude.")
if r:
    if not (r.get("create_status") and int(r["create_status"]) < 300): bad(f"AxisCare refused a PP - App visit: {r.get('create_error')}")
    else:
        same = str(r.get("service_code") or "").strip().lower() == SERVICE.lower()
        (ok if same else bad)(f"AxisCare took it as \"{r.get('service_code')}\" ({r.get('service_description')})" if same else f"AxisCare read it back as \"{r.get('service_code')}\", not {SERVICE}")
        (ok if r.get("reason") else bad)(f"labelled \"{r.get('reason')}\"" if r.get("reason") else "no change reason on it (is \"Booked by family in app\" still switched on?)")
        (ok if r.get("caregiver") is None else bad)("no caregiver on it (nobody was told)" if r.get("caregiver") is None else "a caregiver was on it?!")
        say(f"  · billing on it: {r.get('billable_rate_mode')}, ${r.get('charge_rate')} (Test Client 5's rate for PP - App)")
        (ok if r.get("removed") else bad)(f"removed again ({r.get('date')} 10:00)" if r.get("removed") else f"NOT removed: please delete Test Client 5's {r.get('date')} 10:00 visit in AxisCare")

say(); say("3 · THE APP USES PP - APP")
if fails: say("  · not switched: Missouri app visits stay \"" + str(cur.get("svc")) + "\""); say(); say("  846: NOT COMPLETE. See the ✗ lines above."); done(1)
good, rows, _ = sql("update public.app_data set data = data || jsonb_build_object('family_app_service_MO', 'PP - App') where key = 'ops_settings' returning data->>'family_app_service_MO' as svc")
(ok if good and rows and rows[0].get("svc") == SERVICE else bad)("Missouri app visits now go on AxisCare as PP - App" if good else f"not saved ({rows})")
say(); say("  846: " + ("DONE." if not fails else "NOT COMPLETE. See the ✗ lines above.")); done(0 if not fails else 1)
