#!/usr/bin/env python3
# 474 · TELL THE CAREGIVER, FROM THE OFFICE NUMBER. Samantha 2026-10-06: "send from the real office number, send it, also
# put in the caregivers profile under performance if they got a compliment". Installs kind-tell: Tell on a kind word about
# a caregiver drafts the text from the jar and the roster; the person reads it, edits it, presses Send; it goes from the
# office number after the same outbound gate and opt-out checks as every caregiver text, and is recorded as told.
# Part 1 (read only): the reviewed builds; GoHighLevel set up. Part 2: deploy kind-tell; switch ON (her "send it").
# Part 3: a page without a staff sign-in is refused; the browser's preflight answers; the switch reads back on.
# Nothing is texted by this run.
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
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-474/1.0"}, **(headers or {})))
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
FN = "kind-tell"
say("474 · TELL THE CAREGIVER, FROM THE OFFICE NUMBER"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for name, want in SHAS.items():
    p = os.path.join(FNROOT, "_shared", name.split("/", 1)[1] + ".ts") if name.startswith("_shared/") else os.path.join(FNROOT, name, "index.ts")
    if hashlib.sha256(open(p, "rb").read()).hexdigest() != want: bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say("  ✓ the reviewed builds (kind-tell, and the outbound gate that now knows it)")
k = keys(); ANON, SVC = k.get("anon", ""), k.get("service_role", "")
if not ANON or not SVC: bad("could not read the project's keys. Nothing was changed."); done(4)
HIDE += [ANON, SVC]
s, b = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
try: names = {x.get("name") for x in json.loads(b)} if s == 200 else set()
except Exception: names = set()
if not (("GHL_TOKEN" in names or "GHL_API_KEY" in names) and "GHL_LOCATION_ID" in names): bad("GoHighLevel's secrets aren't set on this project. Nothing was changed."); done(4)
say("  ✓ GoHighLevel is set up (texts go from the office number, like Team Builder's)")
ok, r = sql("select coalesce((data->>'kind_tell_live')::boolean, false) as live from public.app_data where key = 'ops_settings'")
was = bool(ok and r and r[0]["live"])

say(); say("PART 2 · CHANGE")
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"],
                   cwd=os.path.dirname(os.path.dirname(FNROOT)), env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: bad("deploy failed: " + (p.stderr or p.stdout)[-240:]); say("  STOP. Nothing else was changed."); done(6)
say("  ✓ kind-tell deployed")
if not was:
    ok, r = sql("update public.app_data set data = jsonb_set(data, '{kind_tell_live}', 'true'::jsonb) where key = 'ops_settings' and jsonb_typeof(data) = 'object' returning key")
    chk(ok and r, "texting kind words to caregivers is ON (your \"send it\"); turn it off any time on the Owners Hub Admin page")
else: say("  · texting kind words was already on")

say(); say("PART 3 · PROOF (nothing is texted)")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
s1, _ = http("POST", f"{FNB}/functions/v1/{FN}", {"action": "draft", "kind_word_id": "00000000-0000-0000-0000-000000000000"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
chk(s1 in (401, 403), f"a page without a staff sign-in is refused ({s1})")
s2, _ = http("OPTIONS", f"{FNB}/functions/v1/{FN}", None, {"Origin": "https://cc.mo-care.com", "Access-Control-Request-Method": "POST"})
chk(s2 in (200, 204), f"the browser's preflight is answered ({s2})")
ok, r = sql("select coalesce((data->>'kind_tell_live')::boolean, false) as live from public.app_data where key = 'ops_settings'")
chk(ok and r and r[0]["live"] is True, "the switch reads back on")
say()
say("RESULT: " + ("DONE · Tell on a kind word about a caregiver now sends from the office number, after you read it and press Send. Compliments show on their Performance tab." if not fails else "CHECK THE ✗ LINES."))
say("Nothing was texted by this run. To stop sends: Owners Hub Admin page, \"Texting kind words to caregivers\".")
done(0 if not fails else 8)
