#!/usr/bin/env python3
# J3 (Desktop 343) · READ ONLY: after 341 (J1) and 342 (J2), did every job's real schedule still get in?
# Nothing is changed, run, sent or deleted. Printed: job and schedule names, times, counts and status codes only.
# Three kinds of evidence, since the database keeps no per-job answer:
#   1 · the database's own call log (net._http_response, kept only a few hours): any "not allowed" answer there is a
#       schedule being turned away (only the database's schedules make these calls). It must be zero.
#   2 · each schedule still carries the vault secret, and pg_cron started it since the change (cron.job_run_details).
#   3 · the job's own record of a run that got in, after the change, where it keeps one (a heartbeat, a run-log line,
#       the morning brief's sent marker, the census state).
import json, os, re, urllib.request, urllib.error, datetime as dt, sys
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn"); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
DESK = os.environ.get("SB_DESKTOP", os.path.expanduser("~/Desktop"))
J1 = ["lead-nurture", "lead-followup", "ghe-reminders", "carematch-watch", "interview-messages", "coverage-run", "timekeeper-watch",
      "lead-digest", "automation-watchdog", "purge-recordings", "lead-docs-retention"]
J2 = ["coverage-watch", "client-status-observe", "client-status-review", "launch-evidence", "client-start-run", "promise-run", "caregiver-census-observe"]
HEART = {"coverage-run": "hb_coverage-run", "coverage-watch": "hb_coverage-watch", "automation-watchdog": "hb_automation-watchdog",
         "ghe-reminders": "hb_ghe-reminders", "interview-messages": "hb_interview-messages"}
RUNLOG = {"carematch-watch": "carematch-watch", "timekeeper-watch": "timekeeper-watch", "client-status-review": "client_status",
          "launch-evidence": "launch_evidence", "client-start-run": "client_start", "promise-run": "promises"}
lines = []; fails = []
def say(s=""):
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", str(s)); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def sql(q):
    req = urllib.request.Request(f"{API}/v1/projects/{REF}/database/query", data=json.dumps({"query": q}).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + TOKEN, "User-Agent": "cc-j3/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return True, json.loads(r.read().decode())
    except Exception as e: return False, str(e)[:200]
def lit(v): return "'" + str(v).replace("'", "''") + "'"
def when(report):
    p = os.path.join(DESK, report)
    if not os.path.exists(p): return None, False
    t = open(p).read(); m = re.search(r"Report (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) UTC", t)
    return (dt.datetime.strptime(m.group(1), "%Y-%m-%d %H:%M").replace(tzinfo=dt.timezone.utc) if m else None), ("RESULT: DONE" in t)
def ct(ts):   # a UTC time as Central, for reading
    if not ts: return "none"
    if isinstance(ts, str): ts = dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))
    off = -5 if 3 <= ts.month <= 10 or (ts.month == 11 and ts.day < 2) else -6
    return (ts + dt.timedelta(hours=off)).strftime("%a %b %d %I:%M%p").replace(" 0", " ") + " Central"
def ts(x):
    try: return dt.datetime.fromisoformat(str(x).replace("Z", "+00:00"))
    except Exception: return None

say("J3 · DID EVERY SCHEDULE STILL GET IN? (read only)"); now = dt.datetime.now(dt.timezone.utc); say("Report " + now.strftime("%Y-%m-%d %H:%M UTC") + " · " + ct(now)); say()
t1, ok1 = when("Job locks J1 report.txt"); t2, ok2 = when("Job locks J2 report.txt"); t1b, ok1b = when("Job locks J1b report.txt")
j1txt = open(os.path.join(DESK, "Job locks J1 report.txt")).read() if t1 else ""
only_ghe = t1 and not ok1 and ok1b and "Left exactly as they were: ghe-reminders." in j1txt and \
    all(l.strip().startswith("✗ ghe-reminders: the live copy is NOT") for l in j1txt.splitlines() if l.strip().startswith("✗"))
if not (t1 and (ok1 or only_ghe)): bad("341's report isn't here or didn't say DONE (nor 341 + 341b), so there is nothing to check yet."); done(3)
if not (t2 and ok2): say("  · 342's report isn't here or didn't say DONE: checking the J1 jobs only"); t2 = None
say(f"  · the J1 change ran {ct(t1)}" + (f"; ghe-reminders followed in 341b {ct(t1b)}" if only_ghe else "") + (f"; the J2 change ran {ct(t2)}" if t2 else ""))
since = {fn: t1 for fn in J1}; since.update({fn: t2 for fn in J2} if t2 else {})
if only_ghe: since["ghe-reminders"] = t1b
FNS = [fn for fn in J1 + J2 if since.get(fn)]

say(); say("1 · THE DATABASE'S CALL LOG (any \"not allowed\" is a schedule being turned away)")
ok, r = sql("""select current_setting('pg_net.ttl', true) as ttl, min(created) as first, max(created) as last, count(*)::int as n,
               count(*) filter (where status_code between 200 and 299)::int as ok2xx,
               count(*) filter (where status_code = 401 and content like '%not allowed%')::int as refused,
               count(*) filter (where status_code is null or timed_out)::int as no_answer,
               count(*) filter (where status_code not between 200 and 299 and not (status_code = 401 and content like '%not allowed%'))::int as other
               from net._http_response""")
if not ok or not r: bad("could not read the call log: " + str(r)[:120]); done(4)
L = r[0]; first = ts(L["first"])
say(f"  · it keeps calls for {L['ttl'] or 'the default 6 hours'}: {L['n']} calls from {ct(first)} to {ct(ts(L['last']))}")
say(f"  · answered OK {L['ok2xx']} · turned away (\"not allowed\") {L['refused']} · no answer {L['no_answer']} · other answers {L['other']}")
if L["refused"]: bad(f"{L['refused']} scheduled call(s) were turned away by a lock. Tell Claude: a schedule is not getting in.")
else: say("  ✓ no schedule was turned away in that window")

say(); say("2 · EACH JOB: ITS SCHEDULE, WHEN IT LAST STARTED, AND ITS OWN RECORD OF GETTING IN")
ok, jobs = sql("select jobid, jobname, schedule, active, command from cron.job")
ok2, hb = sql("""select x->>'id' as id, x->>'at' as at from app_data a, jsonb_array_elements(case when jsonb_typeof(a.data) = 'array' then a.data else '[]'::jsonb end) x
                 where a.key = 'automation_heartbeats' and x->>'id' like 'hb_%'""")
ok3, lg = sql("""select x->>'automation' as a, max(x->>'at') as at from app_data a, jsonb_array_elements(case when jsonb_typeof(a.data) = 'array' then a.data else '[]'::jsonb end) x
                 where a.key = 'automation_log' group by 1""")
ok4, mb = sql("""select max(x->>'at') as at from app_data a, jsonb_array_elements(case when jsonb_typeof(a.data) = 'array' then a.data else '[]'::jsonb end) x
                 where a.key = 'morning_brief_state' and x->>'id' like 'sent_%'""")
ok5, cs = sql("""select (select x->>'last_run' from jsonb_array_elements(case when jsonb_typeof(data) = 'array' then data else '[]'::jsonb end) x where x->>'id' = 'state' limit 1) as at
                 from app_data where key = 'caregiver_census_state'""")
if not (ok and ok2 and ok3 and ok4 and ok5): bad("could not read the schedules or the jobs' own records."); done(4)
HB = {x["id"]: ts(x["at"]) for x in hb}; LG = {x["a"]: ts(x["at"]) for x in lg}
own = {fn: HB.get(h) for fn, h in HEART.items()}
for fn, a in RUNLOG.items(): own[fn] = max([t for t in (own.get(fn), LG.get(a)) if t], default=None)
own["lead-digest"] = ts(mb[0]["at"]) if mb else None; own["caregiver-census-observe"] = ts(cs[0]["at"]) if cs else None
for fn in FNS:
    mine = [j for j in jobs if re.search(r"/functions/v1/" + re.escape(fn) + r"(?![A-Za-z0-9_-])", j.get("command") or "")]
    if not mine: bad(f"{fn}: no schedule calls it any more"); continue
    nos = [j["jobname"] for j in mine if "x-cron-secret" not in (j["command"] or "")]
    if nos: bad(f"{fn}: schedule(s) without the secret: {', '.join(nos)} (they'd be turned away)")
    ok, rd = sql(f"""select max(start_time) as last, count(*)::int as n, count(*) filter (where status <> 'succeeded')::int as failed
                     from cron.job_run_details where jobid in ({', '.join(str(int(j['jobid'])) for j in mine)}) and start_time > {lit(since[fn].isoformat())}""")
    last = ts(rd[0]["last"]) if ok and rd else None; n = rd[0]["n"] if ok and rd else 0
    o = own.get(fn); got_in = bool(o and o > since[fn])
    inwin = bool(last and first and last >= first)
    if n == 0:
        say(f"  · {fn}: not started by its schedule since the change yet ({', '.join(j['schedule'] for j in mine)}); check again after its next time")
        continue
    if rd[0]["failed"]: bad(f"{fn}: {rd[0]['failed']} of {n} scheduled start(s) failed in the database since the change")
    how = []
    if got_in: how.append(f"its own record shows a run that got in at {ct(o)}")
    if inwin and not L["refused"]: how.append("its latest start is inside the call log, where nothing was turned away")
    if how: say(f"  ✓ {fn}: started {n} time(s) since the change, last {ct(last)}; " + " and ".join(how))
    elif fn in own or fn in RUNLOG:
        if fn == "lead-digest": say(f"  · {fn}: last started {ct(last)}; its brief only sends at 8am Central on weekdays (no sent marker since the change yet, and that start is older than the call log)")
        else: bad(f"{fn}: started {n} time(s) since the change (last {ct(last)}) but has no record of getting in since, and that start is older than the call log. Tell Claude.")
    else: say(f"  · {fn}: started {n} time(s) since the change, last {ct(last)}; it keeps no record of its own and that start is older than the call log, so this can't be proven here (341/342 proved its schedule's exact call is accepted)")

say()
say("RESULT: " + ("DONE · every schedule that has run since the change got in; none was turned away." if not fails else "CHECK THE ✗ LINES."))
say("Nothing was changed, run or sent. No key, secret, name, number or email was printed.")
done(0 if not fails else 8)
