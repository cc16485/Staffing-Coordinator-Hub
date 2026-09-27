#!/usr/bin/env python3
# Change 3 · turn client status reviews ON (switch + a run 5 minutes after each status check + one live run) or OFF.
# ON opens reviews and My Work items and runs "Who is this?"; nothing ends until a person answers. OFF leaves everything as it is.
import json, os, urllib.request, urllib.error, datetime as dt

MODE = os.environ["SB_MODE"]            # on | off
REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
JOB = "client-status-review"
SCHEDULE = "22 */6 * * *"       # 5 minutes after the 6-hourly status check (17 */6)

lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None, timeout=240):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-client-status-switch/1.0"}, **(headers or {})))
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

SET = lambda v: f"""insert into public.app_data (key, data, updated_at) values ('ops_settings', jsonb_build_object('client_status_live', {v}), now())
  on conflict (key) do update set data = (case when jsonb_typeof(public.app_data.data) = 'object' then public.app_data.data else '{{}}'::jsonb end)
                                         || jsonb_build_object('client_status_live', {v}), updated_at = now()
  returning (data->>'client_status_live') as live, (select count(*) from jsonb_object_keys(data)) as keys"""
COUNT = "select count(*)::int as n from public.client_status_review"
JOBQ = f"select jobname, schedule, active from cron.job where jobname = '{JOB}'"

say("CHANGE 3 · AXISCARE STATUS REACHES THE HUB · TURN " + MODE.upper())
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"))
say()

if MODE == "off":
    ok, r = sql(SET("false"))
    if not ok: say("  ✗ could not turn the switch off: " + str(r)); done(4)
    say("  ✓ switch OFF (ops_settings.client_status_live = false); every other setting untouched")
    sql(f"select cron.unschedule('{JOB}') from cron.job where jobname = '{JOB}'")
    ok2, j = sql(JOBQ)
    say("  " + ("✓ the schedule is removed" if ok2 and not j else "✗ the schedule is still there: " + json.dumps(j)))
    say("  Open reviews and answers already given were left exactly as they are.")
    say(); say("RESULT: " + ("TURNED OFF" if ok2 and not j else "CHECK THE ✗ LINES")); done(0 if ok2 and not j else 5)

# ---- ON ----
s, _ = http("OPTIONS", f"{FNB}/functions/v1/client-status-review")
ok, t = sql("select to_regclass('public.client_status_review') is not null as ok")
if s != 200 or not ok or not t or t[0].get("ok") not in (True, "true"):
    say("  ✗ STOP: client status reviews are not installed (run 244 first). Nothing was changed."); done(2)
say("  ✓ the installed records and the deployed reader are in place")
k = keys(); anon, svc = k.get("anon", ""), k.get("service_role", "")
if not anon or not svc: say("  ✗ STOP: could not read the project keys. Nothing was changed."); done(3)
ok, b = sql(COUNT); before = b[0]["n"] if ok and b else None

ok, r = sql(SET("true"))
if not ok or not r or r[0].get("live") != "true": say("  ✗ could not turn the switch on: " + str(r)); done(4)
say(f"  ✓ switch ON (ops_settings.client_status_live = true); the other {int(r[0]['keys']) - 1} settings kept as they were")

cmd = ("select net.http_post(url := '" + FNB + "/functions/v1/client-status-review', "
       "headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer " + anon + "'), body := '{\"action\":\"run\"}'::jsonb)")
sql(f"select cron.unschedule('{JOB}') from cron.job where jobname = '{JOB}'")
sql(f"select cron.schedule('{JOB}', '{SCHEDULE}', $job$ {cmd} $job$)")
ok2, j = sql(JOBQ)
sched_ok = bool(ok2 and j and len(j) == 1 and j[0].get("active") in (True, "true", "t"))
say("  " + (f"✓ scheduled: exactly one job '{JOB}', 5 minutes after each status check, active" if sched_ok else "✗ schedule not confirmed: " + json.dumps(j)[:300]))

s, body = http("POST", f"{FNB}/functions/v1/client-status-review", {"action": "run"}, {"Authorization": "Bearer " + svc, "apikey": svc}, 300)
svc = ""
try: out = json.loads(body)
except Exception: out = {"error": body[:300]}
live_ok = s == 200 and out.get("dry") is False
ok, b = sql(COUNT); after = b[0]["n"] if ok and b else None
rec = out.get("opened") if live_ok else None
matches = live_ok and before is not None and after is not None and after - before == rec
sc = out.get("admission_scan") or {}
say("  " + (f"✓ first live run: AxisCare status copied for {out.get('current_refreshed')} client(s); {rec} review(s) opened; "
            f"{out.get('items_created')} My Work item(s); \"Who is this?\" checked {sc.get('unlinked', '?')} client(s), opened {sc.get('opened', '?')}"
            if live_ok else "✗ the first live run did not complete: HTTP " + str(s) + " " + json.dumps(out)[:300]))
say("  " + (f"✓ reviews went from {before} to {after}, exactly what the run reports" if matches else f"✗ review count {before} -> {after} does not match the run"))
for e in out.get("error_list") or []: say(f"    ✗ {json.dumps(e)[:300]}")
say()
allok = sched_ok and live_ok and matches
say("RESULT: " + ("TURNED ON · after every status check, AxisCare status changes reach My Work and \"Who is this?\" opens on its own"
                  if allok else "CHECK THE ✗ LINES (to undo, run 246 - Turn Off)"))
done(0 if allok else 6)
