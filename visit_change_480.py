#!/usr/bin/env python3
# 480 · CLICK A VISIT ON THE LIVE SCHEDULE AND CHANGE IT. Samantha 2026-10-06, after the 479 look: "yes build it".
# Installs visit-change: office staff change one visit's caregiver, take the caregiver off, or change its time or day, after a
# preview and with one of AxisCare's own change reasons; the change is read back and can be undone the same day. Visits that
# have started or are verified are never changed. Nobody is texted. The switch (visit_change_live) stays as it is (off until
# an owner turns it on: Owners Hub Admin page, or above the Live Schedule).
# Part 1 (read only): the reviewed build; the switch as it is. Part 2: deploy visit-change. Part 3: the public key is refused;
# the browser's preflight answers. This run changes nothing in AxisCare.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, time
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FN = "care-notes"
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Nothing was sent to anyone. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=400):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-480/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, b[:200]
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def probe(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    texts = []
    try:
        j = json.loads(b); texts.append(j.get("message") if isinstance(j, dict) else str(j))
    except Exception: pass
    texts.append(b.replace('\\"', '"'))
    for t in texts:
        if not t or "PROBE_RESULT: " not in t: continue
        try: return json.JSONDecoder().raw_decode(t[t.index("PROBE_RESULT: ") + len("PROBE_RESULT: "):])[0], None
        except Exception: continue
    return None, f"HTTP {s}: {b[:240]}"
def keys():
    s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG())
    try: return {k.get("name"): k.get("api_key", "") for k in json.loads(b)}
    except Exception: return {}
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)

lit = lambda v: "'" + str(v).replace("'", "''") + "'"
FN = "visit-change"
say("480 · CLICK A VISIT ON THE LIVE SCHEDULE AND CHANGE IT"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for name, want in SHAS.items():
    p = os.path.join(FNROOT, "_shared", name.split("/", 1)[1] + ".ts") if name.startswith("_shared/") else os.path.join(FNROOT, name, "index.ts")
    if hashlib.sha256(open(p, "rb").read()).hexdigest() != want: bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say("  ✓ the reviewed build of visit-change")
k = keys(); ANON, SVC = k.get("anon", ""), k.get("service_role", "")
if not ANON or not SVC: bad("could not read the project's keys. Nothing was changed."); done(4)
HIDE += [ANON, SVC]
ok, r = sql("select coalesce((data->>'visit_change_live')::boolean, false) as live from public.app_data where key = 'ops_settings'")
was = bool(ok and r and r[0]["live"])
say("  · changing visits from the Hub is " + ("ON" if was else "OFF") + " right now; this run leaves it as it is")

say(); say("PART 2 · CHANGE")
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"],
                   cwd=os.path.dirname(os.path.dirname(FNROOT)), env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: bad("deploy failed: " + (p.stderr or p.stdout)[-240:]); say("  STOP. Nothing else was changed."); done(6)
say("  ✓ visit-change installed (office staff only)")

say(); say("PART 3 · PROOF (changes nothing in AxisCare)")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
s1, _ = http("POST", f"{FNB}/functions/v1/{FN}", {"action": "reasons"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
chk(s1 in (401, 403), f"a page without a staff sign-in is refused ({s1})")
s2, _ = http("OPTIONS", f"{FNB}/functions/v1/{FN}", None, {"Origin": "https://cc.mo-care.com", "Access-Control-Request-Method": "POST"})
chk(s2 in (200, 204), f"the browser's preflight is answered ({s2})")
ok, r = sql("select coalesce((data->>'visit_change_live')::boolean, false) as live from public.app_data where key = 'ops_settings'")
chk(ok and r and bool(r[0]["live"]) == was, "the switch is unchanged (" + ("ON" if was else "OFF") + ")")
say()
say("RESULT: " + ("DONE · Click a visit on the Live Schedule to change it" + ("." if was else ", once an owner turns it on (Owners Hub Admin page, or above the Live Schedule).") if not fails else "CHECK THE ✗ LINES."))
say("Nothing in AxisCare was changed by this run. Nobody was contacted.")
done(0 if not fails else 8)
