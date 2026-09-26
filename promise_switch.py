#!/usr/bin/env python3
# Step 6 · turn the promise-run producer ON (switch + hourly schedule + one live run) or OFF (switch + unschedule).
# ON never deletes anything; OFF leaves existing My Work items exactly as they are.
import json, os, urllib.request, urllib.error, datetime as dt

MODE = os.environ["SB_MODE"]            # on | off
REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
ENGINE = os.environ.get("SB_ENGINE_URL", "https://cc.mo-care.com/promise-engine.js")
JOB = "promise-run"
SCHEDULE = "7 * * * *"          # every hour at :07 (the scheduler's clock), internal work items only

lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None, timeout=120):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-promise-switch/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, "%s: %s" % (type(e).__name__, e)
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, {"Authorization": "Bearer " + TOKEN}, 300)
    if s not in (200, 201): return False, f"HTTP {s}: {b[:400]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:400]
def keys():
    s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers={"Authorization": "Bearer " + TOKEN})
    try: return {k.get("name"): k.get("api_key", "") for k in json.loads(b) if isinstance(k, dict)}
    except Exception: return {}

SET = lambda v: f"""insert into public.app_data (key, data, updated_at) values ('ops_settings', jsonb_build_object('promises_live', {v}), now())
  on conflict (key) do update set data = (case when jsonb_typeof(public.app_data.data) = 'object' then public.app_data.data else '{{}}'::jsonb end)
                                         || jsonb_build_object('promises_live', {v}), updated_at = now()
  returning (data->>'promises_live') as live, (select count(*) from jsonb_object_keys(data)) as keys"""
COUNT = "select jsonb_array_length(case when jsonb_typeof(data) = 'array' then data else '[]'::jsonb end) as n from app_data where key = 'ops_items'"
JOBQ = f"select jobname, schedule, active from cron.job where jobname = '{JOB}'"

say("STEP 6 · PROMISE PRODUCER · TURN " + MODE.upper())
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"))
say()
ok, before_keys = sql("select (select count(*) from jsonb_object_keys(case when jsonb_typeof(data) = 'object' then data else '{}'::jsonb end)) as keys from app_data where key = 'ops_settings'")
nkeys = int(before_keys[0]["keys"]) if ok and before_keys else 0

if MODE == "off":
    ok, r = sql(SET("false"))
    if not ok: say("  ✗ could not turn the switch off: " + str(r)); done(4)
    say("  ✓ switch OFF (ops_settings.promises_live = false); every other setting untouched")
    ok, r = sql(f"select cron.unschedule('{JOB}') from cron.job where jobname = '{JOB}'")
    ok2, j = sql(JOBQ)
    say("  " + ("✓ hourly schedule removed" if ok2 and not j else "✗ the schedule is still there: " + json.dumps(j)))
    say("  Existing My Work items were left exactly as they are.")
    say(); say("RESULT: " + ("TURNED OFF" if ok2 and not j else "CHECK THE ✗ LINES")); done(0 if ok2 and not j else 5)

# ---- ON ----
s, eng = http("GET", ENGINE + "?v=" + dt.datetime.now().strftime("%H%M%S"))
if s != 200 or "workItems" not in eng: say("  ✗ STOP: the live hub does not serve the promise engine with work items. Nothing was changed."); done(2)
s, _ = http("OPTIONS", f"{FNB}/functions/v1/promise-run")
if s != 200: say("  ✗ STOP: promise-run is not deployed (run 235 first). Nothing was changed."); done(2)
say("  ✓ the live engine and the deployed producer are both in place")
k = keys(); anon, svc = k.get("anon", ""), k.get("service_role", "")
if not anon or not svc: say("  ✗ STOP: could not read the project keys. Nothing was changed."); done(3)
ok, b = sql(COUNT); before = b[0]["n"] if ok and b else None

ok, r = sql(SET("true"))
if not ok or not r or r[0].get("live") != "true": say("  ✗ could not turn the switch on: " + str(r)); done(4)
kept = int(r[0]["keys"]) - 1 if r else 0
say(f"  ✓ switch ON (ops_settings.promises_live = true); the other {kept} settings kept as they were")

cmd = ("select net.http_post(url := '" + FNB + "/functions/v1/promise-run', "
       "headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer " + anon + "'), body := '{}'::jsonb)")
ok, _ = sql(f"select cron.unschedule('{JOB}') from cron.job where jobname = '{JOB}'")
ok, r = sql(f"select cron.schedule('{JOB}', '{SCHEDULE}', $job$ {cmd} $job$)")
ok2, j = sql(JOBQ)
sched_ok = bool(ok2 and j and len(j) == 1 and j[0].get("active") in (True, "true", "t"))
say("  " + (f"✓ scheduled: exactly one job '{JOB}', every hour at :07, active" if sched_ok else "✗ schedule not confirmed: " + json.dumps(j)[:300]))

s, body = http("POST", f"{FNB}/functions/v1/promise-run", {}, {"Authorization": "Bearer " + svc, "apikey": svc}, 180)
svc = ""
try: out = json.loads(body)
except Exception: out = {"error": body[:300]}
live_ok = s == 200 and out.get("dry") is False
ok, b = sql(COUNT); after = b[0]["n"] if ok and b else None
created = out.get("created") if live_ok else None
matches = live_ok and before is not None and after is not None and after - before == created
say("  " + (f"✓ first live run: read {out.get('contracts_seen')} Start Contract(s) and {out.get('reviews_seen')} review(s); created {created}, closed {out.get('closed')}"
            if live_ok else "✗ the first live run did not complete: HTTP " + str(s) + " " + json.dumps(out)[:300]))
say("  " + (f"✓ My Work went from {before} to {after} items, exactly what the run reports" if matches else f"✗ My Work count {before} -> {after} does not match the run"))
for i in (out.get("create_preview") or []):
    say(f"    + {i.get('title')}  ·  for {i.get('owner')}  ·  due {str(i.get('due'))[:10]}")
say()
allok = sched_ok and live_ok and matches
say("RESULT: " + ("TURNED ON · it runs every hour; family updates owed and Journey decisions now arrive in My Work on their own"
                  if allok else "CHECK THE ✗ LINES (to undo, run 237 - Turn Off)"))
done(0 if allok else 6)
