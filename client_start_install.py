#!/usr/bin/env python3
# Change 8b · stalled starts become owned work. Install, preview, then ask.
#  1. sha-checks client-start-run, and checks the LIVE hub serves the reviewed client-start.js
#     (the server runs exactly the file the hub serves)
#  2. deploys client-start-run and schedules it hourly (it stays DRY until switched on)
#  3. runs one preview and lists every stuck start: who, which step, how long, whose list
#  4. asks; only a typed "yes" switches it on (ops_settings.client_start_live), records the
#     approval, and runs it once so today's stuck starts are on My Work now
#   SB_MODE=off switches it off (Desktop 260): the hourly run goes back to preview only.
import json, os, hashlib, subprocess, urllib.request, urllib.error, datetime as dt
FNROOT = os.environ.get("SB_FNROOT", ""); FN_SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))
ENGINE_SHA = os.environ.get("SB_ENGINE_SHA", ""); REPORT = os.environ["SB_REPORT"]; MODE = os.environ.get("SB_MODE", "install")
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "")
SUPA = os.environ.get("SB_SUPA_CLI", ""); SKIP_FN = os.environ.get("SB_SKIP_FUNCTION") == "1"
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
ENGINE_URL = os.environ.get("SB_ENGINE_URL", "https://cc.mo-care.com/client-start.js")
JOB, SCHEDULE = "client-start-run", "35 * * * *"
lines = []
def say(s=""): print(s, flush=True); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None, timeout=240):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-client-start/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read()
    except urllib.error.HTTPError as e: return e.code, e.read()
    except Exception as e: return None, ("%s: %s" % (type(e).__name__, e)).encode()
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, {"Authorization": "Bearer " + TOKEN}, 300)
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]!r}"
    try: return True, json.loads(b)
    except Exception: return False, b[:300]
def keys():
    s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers={"Authorization": "Bearer " + TOKEN})
    try: return {k.get("name"): k.get("api_key", "") for k in json.loads(kb) if isinstance(k, dict)}
    except Exception: return {}
def setlive(on, approval=None):
    extra = f", 'client_start_approved', '{json.dumps(approval).replace(chr(39), chr(39) * 2)}'::jsonb" if approval else ""
    ok, r = sql(f"""update public.app_data set data = data || jsonb_build_object('client_start_live', {'true' if on else 'false'}{extra}), updated_at = now()
      where key = 'ops_settings' and jsonb_typeof(data) = 'object' returning (data->>'client_start_live')::boolean as on""")
    return ok and r and r[0].get("on") in (on, str(on).lower())
def run(dry):
    svc = keys().get("service_role", "")
    if not svc: return None, "could not read the project's service key"
    s, b = http("POST", f"{FNB}/functions/v1/client-start-run" + ("?dry=1" if dry else ""), {}, {"Authorization": "Bearer " + svc, "apikey": svc}, 300)
    try: d = json.loads(b)
    except Exception: d = None
    return (d if s == 200 and isinstance(d, dict) and d.get("ok") else None), f"HTTP {s} {b[:200]!r}"
ROLE = {"family": "the family", "state": "DSDS", "day": "the office", "evening": "the office"}
def show(d, heading):
    say(heading)
    say(f"  starts on file: {d['leads_with_a_start']} · in scope (not archived or lost): {d['in_scope']} · stuck right now: {d['stuck_now'] + d['held_too_old']}")
    rows = (d.get("create_preview") or []) + (d.get("update_preview") or [])
    for x in rows:
        say(f"  • {x['about']} · waiting {x['waited_days']} days on \"{x['step']}\" ({ROLE.get(x['role'], x['role'] or 'the office')}, window {x['window']} days)")
        say(f"      goes to: {x['owner']} · {x['urgency']} · a supervisor is pulled in {x['escalate_on']} if it's still stuck")
    if not rows: say("  • nothing stuck to raise")
    for x in d.get("held_preview") or []: say(f"  ○ held, stuck {x['waited_days']} days on \"{x['step']}\": {x['about']}. Probably not starting; decide on the lead (mark it Lost or restart it)")
    for x in d.get("close_preview") or []: say(f"  ✓ closes: {x['about']} · {x['why']}")
    for x in d.get("unrouted_preview") or []: say(f"  ✗ no owner for step {x.get('pathway')}:{x.get('step')} \"{x.get('label')}\" ({x.get('who')}); tell Claude, it will not be guessed")
    if d.get("deferred"): say(f"  ○ {d['deferred']} more wait for the next hourly run (at most {d['max_per_run']} new items a run)")

if MODE == "off":
    say("CHANGE 8b · STALLED STARTS · SWITCH OFF"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
    say("  ✓ switched off: the hourly check previews only; items already on My Work stay until someone closes them" if setlive(False) else "  ✗ could not switch it off"); done(0)

say("CHANGE 8b · STALLED STARTS BECOME OWNED WORK · INSTALL")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
for fn, want in FN_SHAS.items():
    got = hashlib.sha256(open(os.path.join(FNROOT, fn, "index.ts"), "rb").read()).hexdigest()
    say(f"  {fn} sha256 {got[:16]}…" + ("  ✓ reviewed source" if got == want else "  ✗ differs"))
    if got != want: say("  STOP. Nothing was run."); done(2)
s, body = http("GET", ENGINE_URL + "?v=" + dt.datetime.now().strftime("%H%M%S"))
live_sha = hashlib.sha256(body).hexdigest() if s == 200 else ""
if live_sha != ENGINE_SHA:
    say(f"  ✗ STOP: the live hub's client-start.js is not the reviewed version yet (HTTP {s}). Merge the hub pull request and wait a few minutes. Nothing was run."); done(3)
say("  ✓ the live hub serves the reviewed client-start.js (the server runs these exact rules)")
ok, st = sql("select coalesce((data->>'client_start_live')::boolean, false) as on from app_data where key = 'ops_settings'")
if not ok or not st: say("  ✗ STOP: could not read the settings: " + str(st)[:200]); done(4)
if st[0]["on"] and not setlive(False): say("  ✗ STOP: it was already on and could not be paused for the preview"); done(4)
if SKIP_FN: say("  (test target: function deploy skipped)")
else:
    p = subprocess.run([SUPA, "functions", "deploy", "client-start-run", "--project-ref", REF, "--use-api"], cwd=os.path.dirname(os.path.dirname(FNROOT)),
                       env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: say("  ✗ deploy failed: " + (p.stderr or p.stdout)[-400:]); done(5)
    say("  ✓ client-start-run deployed (off: it only previews)")
anon = keys().get("anon", "")
if not anon: say("  ✗ STOP: could not read the project's public key for the schedule"); done(6)
cmd = ("select net.http_post(url := '" + FNB + "/functions/v1/client-start-run', "
       "headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer " + anon + "'), body := '{}'::jsonb)")
sql(f"select cron.unschedule('{JOB}') from cron.job where jobname = '{JOB}'")
ok, r = sql(f"select cron.schedule('{JOB}', '{SCHEDULE}', $job$ {cmd} $job$)")
if not ok: say("  ✗ could not schedule the hourly check: " + str(r)[:200]); done(6)
say("  ✓ scheduled hourly (at :35); while off it previews and logs, nothing more")
d, why = run(dry=True)
if not d: say("  ✗ the preview did not complete: " + why); done(7)
say(); show(d, "WHAT IT WOULD PUT ON MY WORK RIGHT NOW (preview: nothing written)")
say()
say("  Switching on means: each stuck start above becomes one item on that person's My Work, updated")
say("  every hour, and closed by itself when the start moves again. Type yes to switch on.")
try: ans = input("  Switch it on now? ").strip().lower()
except EOFError: ans = ""
say(f"  answer: {ans or '(nothing)'}")
if ans != "yes": say(); say("RESULT: INSTALLED, LEFT OFF · the hourly check previews only; run 259 again to switch on"); done(0)
approval = {"by": "Samantha", "decided_on": dt.date.today().isoformat(), "words": "yes, start 8b / 14 days", "confirmed_at_install": "yes", "recorded_by": "Desktop 259"}
if not setlive(True, approval): say("  ✗ could not switch it on; it stays off"); done(8)
say("  ✓ switched on, with your approval recorded")
d2, why = run(dry=False)
say()
if d2: say(f"FIRST LIVE RUN: {d2.get('created', 0)} added to My Work · {d2.get('updated', 0)} updated · {d2.get('closed', 0)} closed · {len(d2.get('write_errors') or [])} errors")
else: say("  ○ the first live run didn't answer (" + why + "); the hourly run will do it")
say(); say("RESULT: INSTALLED AND ON · a stalled start becomes one owned My Work item and closes itself when the start moves")
done(0)
