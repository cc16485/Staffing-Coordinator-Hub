#!/usr/bin/env python3
# Step 6 · deploy promise-run with its switch OFF and read one dry run. Writes no work, schedules nothing.
import json, os, hashlib, subprocess, urllib.request, urllib.error, datetime as dt

FN_DIR = os.environ["SB_FNDIR"]; FN_SHA = os.environ["SB_FN_SHA"]; REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "")
SUPA = os.environ.get("SB_SUPA_CLI", ""); SKIP_FN = os.environ.get("SB_SKIP_FUNCTION") == "1"
API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
ENGINE = os.environ.get("SB_ENGINE_URL", "https://cc.mo-care.com/promise-engine.js")

lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None, timeout=120):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-promise-run/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, "%s: %s" % (type(e).__name__, e)
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, {"Authorization": "Bearer " + TOKEN}, 300)
    if s not in (200, 201): return False, f"HTTP {s}: {b[:400]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:400]

say("STEP 6 · FAMILY UPDATES AND JOURNEY DECISIONS INTO MY WORK · DRY RUN")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"))
say()
fsha = hashlib.sha256(open(os.path.join(FN_DIR, "index.ts"), "rb").read()).hexdigest()
say("  promise-run sha256 " + fsha + ("  ✓ reviewed source" if fsha == FN_SHA else "  ✗ differs"))
if fsha != FN_SHA: say("  STOP. Nothing was run."); done(2)
s, eng = http("GET", ENGINE + "?v=" + dt.datetime.now().strftime("%H%M%S"))
if s != 200 or "workItems" not in eng:
    say("  ✗ STOP: the live hub does not serve the new promise engine yet (merge the Step 6 hub update first). Nothing was run."); done(3)
say("  ✓ the live hub serves the shared promise engine with work items (" + str(len(eng)) + " bytes)")

COUNT = """select jsonb_array_length(case when jsonb_typeof(data) = 'array' then data else '[]'::jsonb end) as n from app_data where key = 'ops_items'"""
ok, b = sql(COUNT); before = (b[0]["n"] if ok and b else None)
ok, st = sql("select coalesce((data->>'promises_live')::boolean, false) as live from app_data where key = 'ops_settings'")
live = bool(ok and st and st[0].get("live"))
if live: say("  ✗ STOP: the switch (ops_settings.promises_live) is already ON. This script only does a dry run. Nothing was run."); done(4)
say("  ✓ the switch is off (ops_settings.promises_live is not set), so nothing can be written")

if SKIP_FN: say("  (test target: function deploy skipped)")
else:
    p = subprocess.run([SUPA, "functions", "deploy", "promise-run", "--project-ref", REF, "--use-api"],
                       cwd=os.path.dirname(os.path.dirname(os.path.dirname(FN_DIR))),
                       env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: say("  ✗ deploy failed: " + (p.stderr or p.stdout)[-400:]); done(5)
    say("  ✓ promise-run deployed (dry by default)")

s, keys = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers={"Authorization": "Bearer " + TOKEN})
svc = ""
try: svc = next((k.get("api_key", "") for k in json.loads(keys) if isinstance(k, dict) and k.get("name") == "service_role"), "")
except Exception: pass
if not svc: say("  ✗ could not get the server key to run the dry run: HTTP " + str(s)); done(6)
s, body = http("POST", f"{FNB}/functions/v1/promise-run?dry=1", {}, {"Authorization": "Bearer " + svc, "apikey": svc}, 180)
svc = ""
try: r = json.loads(body)
except Exception: r = {"error": body[:300]}
if s != 200 or r.get("dry") is not True:
    say("  ✗ the dry run did not complete: HTTP " + str(s) + " " + json.dumps(r)[:400]); done(7)
ok, b = sql(COUNT); after = (b[0]["n"] if ok and b else None)
unchanged = before is not None and before == after
say("  " + ("✓ My Work unchanged: " + str(after) + " items before and after" if unchanged else "✗ My Work item count changed: " + str(before) + " -> " + str(after)))
ok, lg = sql("""select e->>'at' as at, e->>'dry' as dry, e->>'rows_seen' as rows_seen from app_data ad,
  lateral jsonb_array_elements(case when jsonb_typeof(ad.data) = 'array' then ad.data else '[]'::jsonb end) e
  where ad.key = 'automation_log' and e->>'automation' = 'promises' order by e->>'at' desc limit 1""")
logged = bool(ok and lg and lg[0].get("dry") == "true")
say("  " + ("✓ the dry run is in the automation log" if logged else "✗ no dry-run entry found in the automation log"))
say()
say("WHAT IT WOULD DO IF SWITCHED ON (dry run, nothing created)")
say(f"  Start Contracts read: {r.get('contracts_seen')} · open Journey reviews read: {r.get('reviews_seen')}")
say(f"  would create {r.get('would_create')} My Work item(s) · would close {r.get('would_close')}"
    f" · already in My Work {r.get('skipped_existing')} · older than {r.get('max_age_days')} days (counted, not created) {r.get('too_old')}"
    f" · over the {r.get('max_per_run')}-per-run ceiling (next run) {r.get('deferred')}")
for i in (r.get("create_preview") or []):
    say(f"    + {i.get('title')}  ·  for {i.get('owner')}  ·  due {str(i.get('due'))[:10]}  ·  {i.get('urgency')}")
for c in (r.get("close_preview") or []):
    say(f"    - close: {c.get('title')} ({c.get('why')})")
if not (r.get("create_preview") or r.get("close_preview")): say("    (nothing: no family is owed an update today and no Journey decision is waiting)")
say()
allok = unchanged and logged
say("RESULT: " + ("DRY RUN READ · nothing was created; the switch stays off until you turn it on" if allok else "CHECK THE ✗ LINES"))
done(0 if allok else 8)
