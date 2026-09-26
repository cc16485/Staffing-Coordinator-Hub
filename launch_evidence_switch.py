#!/usr/bin/env python3
# Change 1 · turn launch evidence ON (switch + every-30-minutes schedule + one live run) or OFF (switch + unschedule).
# ON records AxisCare evidence and ticks only EMPTY New Clients boxes. OFF leaves everything recorded exactly as it is.
import json, os, urllib.request, urllib.error, datetime as dt

MODE = os.environ["SB_MODE"]            # on | off
REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
ENGINE = os.environ.get("SB_ENGINE_URL", "https://cc.mo-care.com/launch-evidence.js")
JOB = "launch-evidence"
SCHEDULE = "*/30 * * * *"       # every 30 minutes, day and night (care happens overnight too)

lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None, timeout=240):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-launch-evidence-switch/1.0"}, **(headers or {})))
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

SET = lambda v: f"""insert into public.app_data (key, data, updated_at) values ('ops_settings', jsonb_build_object('launch_evidence_live', {v}), now())
  on conflict (key) do update set data = (case when jsonb_typeof(public.app_data.data) = 'object' then public.app_data.data else '{{}}'::jsonb end)
                                         || jsonb_build_object('launch_evidence_live', {v}), updated_at = now()
  returning (data->>'launch_evidence_live') as live, (select count(*) from jsonb_object_keys(data)) as keys"""
COUNT = "select count(*)::int as n from public.launch_evidence"
JOBQ = f"select jobname, schedule, active from cron.job where jobname = '{JOB}'"

say("CHANGE 1 · NEW CLIENTS READS AXISCARE · TURN " + MODE.upper())
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"))
say()

if MODE == "off":
    ok, r = sql(SET("false"))
    if not ok: say("  ✗ could not turn the switch off: " + str(r)); done(4)
    say("  ✓ switch OFF (ops_settings.launch_evidence_live = false); every other setting untouched")
    sql(f"select cron.unschedule('{JOB}') from cron.job where jobname = '{JOB}'")
    ok2, j = sql(JOBQ)
    say("  " + ("✓ the every-30-minutes schedule is removed" if ok2 and not j else "✗ the schedule is still there: " + json.dumps(j)))
    say("  Evidence already recorded, and boxes already ticked, were left exactly as they are.")
    say("  New Clients goes back to the checkboxes, with AxisCare's view shown beside them.")
    say(); say("RESULT: " + ("TURNED OFF" if ok2 and not j else "CHECK THE ✗ LINES")); done(0 if ok2 and not j else 5)

# ---- ON ----
s, eng = http("GET", ENGINE + "?v=" + dt.datetime.now().strftime("%H%M%S"))
if s != 200 or "CCLaunchEvidence" not in eng: say("  ✗ STOP: the live hub does not serve the launch evidence rules. Nothing was changed."); done(2)
s, _ = http("OPTIONS", f"{FNB}/functions/v1/launch-evidence")
ok, t = sql("select to_regclass('public.launch_evidence') is not null as ok")
if s != 200 or not ok or not t or t[0].get("ok") not in (True, "true"):
    say("  ✗ STOP: launch evidence is not installed (run 239 first). Nothing was changed."); done(2)
say("  ✓ the live rules, the installed record and the deployed reader are all in place")
k = keys(); anon, svc = k.get("anon", ""), k.get("service_role", "")
if not anon or not svc: say("  ✗ STOP: could not read the project keys. Nothing was changed."); done(3)
ok, b = sql(COUNT); before = b[0]["n"] if ok and b else None

ok, r = sql(SET("true"))
if not ok or not r or r[0].get("live") != "true": say("  ✗ could not turn the switch on: " + str(r)); done(4)
say(f"  ✓ switch ON (ops_settings.launch_evidence_live = true); the other {int(r[0]['keys']) - 1} settings kept as they were")

cmd = ("select net.http_post(url := '" + FNB + "/functions/v1/launch-evidence', "
       "headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer " + anon + "'), body := '{\"action\":\"run\"}'::jsonb)")
sql(f"select cron.unschedule('{JOB}') from cron.job where jobname = '{JOB}'")
sql(f"select cron.schedule('{JOB}', '{SCHEDULE}', $job$ {cmd} $job$)")
ok2, j = sql(JOBQ)
sched_ok = bool(ok2 and j and len(j) == 1 and j[0].get("active") in (True, "true", "t"))
say("  " + (f"✓ scheduled: exactly one job '{JOB}', every 30 minutes, active" if sched_ok else "✗ schedule not confirmed: " + json.dumps(j)[:300]))

s, body = http("POST", f"{FNB}/functions/v1/launch-evidence", {"action": "run"}, {"Authorization": "Bearer " + svc, "apikey": svc}, 300)
svc = ""
try: out = json.loads(body)
except Exception: out = {"error": body[:300]}
live_ok = s == 200 and out.get("dry") is False
ok, b = sql(COUNT); after = b[0]["n"] if ok and b else None
rec = out.get("recorded") if live_ok else None
matches = live_ok and before is not None and after is not None and after - before == rec
say("  " + (f"✓ first live run: read {out.get('read')} launch(es); recorded {rec} fact(s), ticked {out.get('ticked')} empty box(es); {out.get('flagged')} question(s) for a person"
            if live_ok else "✗ the first live run did not complete: HTTP " + str(s) + " " + json.dumps(out)[:300]))
say("  " + (f"✓ evidence went from {before} to {after} rows, exactly what the run reports" if matches else f"✗ evidence count {before} -> {after} does not match the run"))
for p_ in out.get("preview") or []:
    say(f"    • {p_.get('client')}: first shift {p_.get('first_shift')}" + (f", care began {p_.get('actual_soc')}" if p_.get("actual_soc") else "")
        + (" · recorded: " + ", ".join(p_.get("would_record")) if p_.get("would_record") else ""))
    for q in p_.get("questions") or []: say(f"        ? {q}")
say()
allok = sched_ok and live_ok and matches
say("RESULT: " + ("TURNED ON · New Clients now fills caregiver, schedule and first shift from AxisCare every 30 minutes and when a card opens"
                  if allok else "CHECK THE ✗ LINES (to undo, run 241 - Turn Off)"))
done(0 if allok else 6)
