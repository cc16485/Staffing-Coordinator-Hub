#!/usr/bin/env python3
# 477 · TEXT SEVERAL PEOPLE AT ONCE FROM THE TEAM BUILDER. Samantha 2026-10-06: "build texting several people at once".
# Updates team-ask so anyone listed on a shift (not only the main person) can be asked about it. The board's "Text several"
# sends one text per person through team-ask, so every text gets every check on its own (the switch, the roster number,
# opt-outs, Do Not Disturb, a rejected number). Same sender, same switch (team_ask_live): this run does NOT change the switch.
# Part 1 (read only): the reviewed build; GoHighLevel set up; the switch as it is. Part 2: deploy team-ask.
# Part 3: a page without a staff sign-in is refused; the browser's preflight answers. Nothing is texted by this run.
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
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-477/1.0"}, **(headers or {})))
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
FN = "team-ask"
say("477 · TEXT SEVERAL PEOPLE AT ONCE FROM THE TEAM BUILDER"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for name, want in SHAS.items():
    p = os.path.join(FNROOT, "_shared", name.split("/", 1)[1] + ".ts") if name.startswith("_shared/") else os.path.join(FNROOT, name, "index.ts")
    if hashlib.sha256(open(p, "rb").read()).hexdigest() != want: bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say("  ✓ the reviewed build of team-ask")
k = keys(); ANON, SVC = k.get("anon", ""), k.get("service_role", "")
if not ANON or not SVC: bad("could not read the project's keys. Nothing was changed."); done(4)
HIDE += [ANON, SVC]
s, b = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
try: names = {x.get("name") for x in json.loads(b)} if s == 200 else set()
except Exception: names = set()
if not (("GHL_TOKEN" in names or "GHL_API_KEY" in names) and "GHL_LOCATION_ID" in names): bad("GoHighLevel's secrets aren't set on this project. Nothing was changed."); done(4)
say("  ✓ GoHighLevel is set up (texts go from the office number, as now)")
ok, r = sql("select coalesce((data->>'team_ask_live')::boolean, false) as live from public.app_data where key = 'ops_settings'")
was = bool(ok and r and r[0]["live"])
say("  · Team Builder texting is " + ("ON" if was else "OFF") + " right now; this run leaves it as it is")

say(); say("PART 2 · CHANGE")
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"],
                   cwd=os.path.dirname(os.path.dirname(FNROOT)), env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: bad("deploy failed: " + (p.stderr or p.stdout)[-240:]); say("  STOP. Nothing else was changed; texting works as before."); done(6)
say("  ✓ team-ask updated")

say(); say("PART 3 · PROOF (nothing is texted)")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
s1, _ = http("POST", f"{FNB}/functions/v1/{FN}", {"action": "draft", "plan_id": "x", "caregiver_name": "x"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
chk(s1 in (401, 403), f"a page without a staff sign-in is refused ({s1})")
s2, _ = http("OPTIONS", f"{FNB}/functions/v1/{FN}", None, {"Origin": "https://cc.mo-care.com", "Access-Control-Request-Method": "POST"})
chk(s2 in (200, 204), f"the browser's preflight is answered ({s2})")
ok, r = sql("select coalesce((data->>'team_ask_live')::boolean, false) as live from public.app_data where key = 'ops_settings'")
chk(ok and r and bool(r[0]["live"]) == was, "the switch is unchanged (" + ("ON" if was else "OFF") + ")")
say()
say("RESULT: " + ("DONE · On the Team Builder, \"Text several people\" can now text anyone listed on a shift, one text each, after you read them and press Send." if not fails else "CHECK THE ✗ LINES."))
say("Nothing was texted by this run." + ("" if was else " Team Builder texting is OFF: nothing can be sent until it is turned on."))
done(0 if not fails else 8)
