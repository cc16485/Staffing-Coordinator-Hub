#!/usr/bin/env python3
# Change 7a · measure our AxisCare visit reads and test "changed since". READ ONLY.
#  1. sha-checks the probe function (the reviewed source)
#  2. deploys axiscare-read-probe (owner script only; GET requests to AxisCare, nothing written)
#  3. runs it once, and reads (never writes) the hub's own records of recent timed-job runs
#  4. writes the report; nothing in AxisCare, the hub or GHL is changed and nothing is sent
import json, os, hashlib, subprocess, urllib.request, urllib.error, datetime as dt
FNROOT = os.environ["SB_FNROOT"]; FN_SHAS = json.loads(os.environ["SB_FN_SHAS"])
REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "")
SUPA = os.environ.get("SB_SUPA_CLI", ""); SKIP_FN = os.environ.get("SB_SKIP_FUNCTION") == "1"
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None, timeout=240):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-read-probe/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace"), dict(r.headers)
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace"), dict(e.headers)
    except Exception as e: return None, "%s: %s" % (type(e).__name__, e), {}
def sql(q):
    s, b, _ = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, {"Authorization": "Bearer " + TOKEN}, 300)
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:300]
def yn(x): return "yes" if x else "no"

say("CHANGE 7a · AXISCARE READ PROBE (read only)")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
for fn, want in FN_SHAS.items():
    got = hashlib.sha256(open(os.path.join(FNROOT, fn, "index.ts"), "rb").read()).hexdigest()
    say(f"  {fn} sha256 {got[:16]}…" + ("  ✓ reviewed source" if got == want else "  ✗ differs"))
    if got != want: say("  STOP. Nothing was run."); done(2)
if SKIP_FN: say("  (test target: function deploy skipped)")
else:
    p = subprocess.run([SUPA, "functions", "deploy", "axiscare-read-probe", "--project-ref", REF, "--use-api"], cwd=os.path.dirname(os.path.dirname(FNROOT)),
                       env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: say("  ✗ deploy failed: " + (p.stderr or p.stdout)[-400:]); done(3)
    say("  ✓ axiscare-read-probe deployed (read only)")

s, kb, _ = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers={"Authorization": "Bearer " + TOKEN})
svc = ""
try: svc = next((k.get("api_key", "") for k in json.loads(kb) if isinstance(k, dict) and k.get("name") == "service_role"), "")
except Exception: pass
if not svc: say("  ✗ could not read the project's service key (HTTP %s). Nothing else was run." % s); done(4)
s, body, _ = http("POST", f"{FNB}/functions/v1/axiscare-read-probe", {}, {"Authorization": "Bearer " + svc, "apikey": svc}, 300); svc = ""
try: d = json.loads(body)
except Exception: d = {"error": body[:300]}
if s != 200 or "windows" not in d: say("  ✗ the probe did not complete: HTTP " + str(s) + " " + json.dumps(d)[:300]); done(5)
say(f"  ✓ probe ran · {d['axiscare_calls']} AxisCare read(s)" + (" · ✗ AxisCare asked us to slow down, so the probe stopped early" if d.get("rate_limited") else ""))

say(); say("1. HOW BIG EACH TIMED READ IS (right now)")
for w in d["windows"]:
    say(f"  • {w['name']}: {w['visits']} visits, {w['pages']} page(s), {w['seconds']}s" + (f"  ({w['stopped']})" if w.get("stopped") else ""))
pg = {w["name"].split(" (")[0]: max(1, w["pages"]) for w in d["windows"]}
fast = 30 * pg.get("today", 1) + 12 * pg.get("next 72 hours", 1)
hourly = pg.get("next 14 days", 1) + pg.get("yesterday and today", 1) + pg.get("last 21 days", 1)
say(f"  → the two fastest checks make about {fast} visit reads an hour (30 × today + 12 × next 72 hours),")
say(f"    plus about {hourly} more each hour for the sweep, notes and history, before per-case and per-visit reads.")

say(); say("2. DOES AXISCARE'S \"CHANGED SINCE\" RETURN WHAT MATTERS?")
for w in d["changed_since"]:
    say(f"  • {w['name']}: {w['visits']} visits, {w['pages']} page(s)" + (f", visit dates {w['visit_dates']}" if w.get("visit_dates") else "")
        + f", ids s={w['id_kinds']['s']} v={w['id_kinds']['v']} other={w['id_kinds']['other']}" + (f"  ({w['stopped']})" if w.get("stopped") else ""))
T = d["tests"]
def test(label, t, must=True):
    if not t["checked"]: say(f"  ○ {label}: nothing to test in this period"); return None
    ok = t["missing"] == 0
    say(f"  {'✓' if ok else '✗'} {label}: {t['checked']} checked · returned {t['found_exact']} (+{t['found_same_slot']} as the same slot under another id) · missing {t['missing']}"
        + (f" · {t['changed_before_period']} last changed before this period (not a miss)" if t.get("changed_before_period") else "")
        + (" · " + ", ".join(t["missing_ids"][:10]) if t["missing"] else ""))
    return ok
a = test("A. clock-ins in the last 24 hours", T["clock_ins_last_24h"])
b = test("A. clock-outs in the last 24 hours", T["clock_outs_last_24h"])
c1 = test("B. call-offs Cara opened this week, still open", T["calloff_cases_last_7d_still_open"])
c2 = test("B. call-offs Cara opened this week, since closed", T["calloff_cases_last_7d_closed"])
t = T["ongoing_sweep_cases_last_7d"]
say(f"  ○ B. open recurring shifts found by the hourly sweep this week: {t['checked']} checked, {t['found_exact'] + t['found_same_slot']} returned, {t['changed_before_period']} last changed earlier")
c3 = test("C. unassigned right now in the next 72 hours, with a call-off reason", T["unassigned_next_72h_with_reason"])
t = T["unassigned_next_72h_no_reason"]
say(f"  ○ C. unassigned right now in the next 72 hours, no reason: {t['checked']} checked, {t['found_exact'] + t['found_same_slot']} returned, {t['changed_before_period']} last changed earlier")
d4 = test("D. every visit AxisCare itself marks as changed in the last 24 hours", T["modified_last_24h"])
say(f"  ○ recurring-schedule visits (s=…) among the last 24 hours' changes: {T['recurring_schedule_visits_in_changed_24h']}")
cf = T["combined_filter"]
cf_ok = cf["extra"] == 0 and cf["missing"] == 0
say(f"  {'✓' if cf_ok else '✗'} \"changed since\" + a date range together: {cf['visits']} visits, expected {cf['expected_from_the_two_separate_reads']} (extra {cf['extra']}, missing {cf['missing']})")
say(f"  ○ \"last modified\" style fields on a visit: {', '.join(d['modified_date_fields']) or 'none'}")
say(f"  ○ clock-in record fields: {', '.join(d['clock_in_fields']) or 'none seen'}")
say(f"  ○ all visit fields: {', '.join(d['visit_fields'])}")

say(); say("3. HAS AXISCARE TOLD OUR TIMED CHECKS TO SLOW DOWN? (the hub's own run records)")
ok1, jobs = sql("""select jobname, schedule, active from cron.job
  where jobname ~ '(coverage|timekeeper|launch|carematch|status|census|identity)' order by jobname""")
if ok1:
    for j in jobs: say(f"  • {j['jobname']}: {j['schedule']}" + ("" if j["active"] else " (switched off)"))
else: say("  could not read the schedule: " + str(jobs)[:200])
ok2, net = sql("""select count(*)::int as responses, min(created)::text as since,
   count(*) filter (where content ~ '(responded|answered|window) 429')::int as slow_down,
   count(*) filter (where content ~ 'AxisCare (responded|answered) [45][0-9][0-9]' and content !~ '(responded|answered) 429')::int as other_axiscare_errors
   from net._http_response""")
if ok2 and net:
    n = net[0]
    say(f"  • timed-job answers kept by the database: {n['responses']} (since {str(n['since'] or 'n/a')[:16]} UTC)")
    say(f"  {'✓' if n['slow_down'] == 0 else '✗'} AxisCare \"slow down\" (429) passed on by a timed job: {n['slow_down']}")
    say(f"  {'✓' if n['other_axiscare_errors'] == 0 else '○'} other AxisCare errors passed on: {n['other_axiscare_errors']}")
else: say("  could not read the recent answers: " + str(net)[:200])
ok3, fails = sql("""select j.jobname, count(*) filter (where d.status = 'failed')::int as failed, count(*)::int as runs
   from cron.job_run_details d join cron.job j on j.jobid = d.jobid
   where d.start_time > now() - interval '24 hours' and j.jobname ~ '(coverage|timekeeper|launch|carematch|status|census)'
   group by j.jobname order by j.jobname""")
if ok3:
    for f in fails: say(f"  {'✓' if f['failed'] == 0 else '✗'} {f['jobname']}: {f['runs']} runs in 24 hours, {f['failed']} failed to start")
else: say("  could not read the run history: " + str(fails)[:200])

say(); say("WHAT IT MEANS")
tested = [x for x in (a, b, c1, c2, c3, d4) if x is not None]
complete = bool(tested) and all(tested) and cf_ok and not d.get("rate_limited")
if d.get("rate_limited"): say("  AxisCare asked us to slow down during the probe itself, so the answers above are partial.")
elif not tested: say("  There were no clock-ins or call-offs to test against. Run it again after a normal working day.")
elif complete:
    say("  \"Changed since\" returned every clock-in and call-off it could be tested against. Step 7b can be designed on it.")
    if c1 is None and c2 is None and c3 is None: say("  (No call-offs this week, so only clock-ins were tested. Worth a second run after the next call-off.)")
else: say("  \"Changed since\" missed something above (the ✗ lines). It can't be trusted for call-offs or clock-ins; the timed reads stay as they are.")
say("  Nothing was changed in AxisCare, the hub or GHL, and nothing was sent.")
say(); say("RESULT: PROBE COMPLETE · read only")
done(0)
