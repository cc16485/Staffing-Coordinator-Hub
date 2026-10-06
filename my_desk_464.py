#!/usr/bin/env python3
# 464 · MY DESK, STAGE 1 GOES ON FOR SAMANTHA AND KRYSTAL. Samantha approved Stage 1 on 2026-10-06 ("go to stage 1 but I
# want Samantha and Krystal's built"). The My Desk tab is in the live Hub (CC Hub PR) but shows only for people ticked in
# Settings > My Desk; this ticks Samantha and Krystal (only if nobody has set it yet) and starts the nightly tidy that
# keeps desks small (erased things gone after 30 days, pages after 13 months, the plan's decisions 3 and 4).
# Part 1 (read only): the live Hub has My Desk; the desk storage from 463 is there; the job scheduler is there.
# Part 2: ops_settings.desk_access = Samantha + Krystal (if not set); the nightly tidy at 3:20 AM Central.
# Part 3 (proof): the schedule is in; the tidy runs (inside a test that is undone) and only the server may run it; who
#   sees My Desk reads back as Samantha and Krystal. If anything isn't right, what this run added is taken back off.
# Nothing is texted or emailed. Nothing on anyone's desk is changed.
import json, os, re, subprocess, urllib.request, urllib.error, datetime as dt, sys

REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); REF = "zngsgedlsxinbygwmxwn"
HUB = os.environ.get("SB_HUB_BASE", "https://cc.mo-care.com/")
JOB = "desk-tidy-nightly"; SCHEDULE = "20 8 * * *"; COMMAND = "select public.desk_tidy()"   # 08:20 UTC = 3:20 AM CDT / 2:20 AM CST
PEOPLE = ["samantha@mo-care.com", "krystal@mo-care.com"]

lines = []; fails = []
def say(s=""):
    s = str(s)
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", s); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=200):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-464/1.0", "Cache-Control": "no-cache"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
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
lit = lambda v: "'" + str(v).replace("'", "''") + "'"
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)

say("464 · MY DESK GOES ON FOR SAMANTHA AND KRYSTAL"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
stamp = dt.datetime.now().strftime("%H%M%S")
s1, b1 = http("GET", HUB + "desk.js?464=" + stamp); s2, b2 = http("GET", HUB + "index.html?464=" + stamp)
if s1 != 200 or "MY DESK, STAGE 1" not in b1 or s2 != 200 or 'id="tab-mydesk"' not in b2 or 'data-set="my-desk"' not in b2:
    bad("the live Hub doesn't have the My Desk tab yet (Claude merges the Hub change first; GitHub can take a few minutes)"); say("  STOP. Nothing was changed."); done(3)
say("  ✓ the live Hub has the My Desk tab and its setting")
ok, st = sql("""select
  (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in
     ('desk_lines','desk_stickies','desk_pages','desk_settings','desk_visits','kind_words','kind_word_drops'))::int as tables,
  to_regprocedure('public.desk_tidy()') is not null as tidy,
  to_regnamespace('cron') is not null as cron,
  (select jsonb_typeof(data) from public.app_data where key = 'ops_settings') as ops_shape,
  (select data->'desk_access' from public.app_data where key = 'ops_settings' and jsonb_typeof(data) = 'object') as access_now""")
if not ok or not st: bad("couldn't read the database's set-up: " + str(st)[:200] + ". Nothing was changed."); done(3)
s0 = st[0]
if s0["tables"] != 7 or not s0["tidy"]: bad("My Desk's storage (463) isn't all there. Nothing was changed. Tell Claude."); done(3)
if not s0["cron"]: bad("the database's job scheduler isn't there. Nothing was changed. Tell Claude."); done(3)
if s0["ops_shape"] != "object": bad("the Hub settings aren't in the expected shape. Nothing was changed. Tell Claude."); done(3)
say("  ✓ My Desk's storage (463) and the job scheduler are there")
had = s0["access_now"]
if isinstance(had, str):
    try: had = json.loads(had)
    except Exception: pass
if had: say("  · who sees My Desk is already set (" + str((had or {}).get("mode")) + ", " + str(len((had or {}).get("people") or [])) + " ticked); it is left exactly as it is")
ok, jb = sql(f"select count(*)::int as n from cron.job where jobname = {lit(JOB)}")
job_was = bool(ok and jb and jb[0]["n"])

say(); say("PART 2 · CHANGE")
added_access = False
if not had:
    val = json.dumps({"mode": "some", "people": PEOPLE, "set_by": "Samantha (Desktop 464)", "set_at": dt.datetime.now(dt.timezone.utc).isoformat()})
    ok, r = sql(f"update public.app_data set data = data || jsonb_build_object('desk_access', {lit(val)}::jsonb) where key = 'ops_settings' and jsonb_typeof(data) = 'object' and not (data ? 'desk_access') returning key")
    if not ok: bad("couldn't tick Samantha and Krystal for My Desk: " + str(r)[:200]); say("  STOP. Nothing else was changed."); done(6)
    added_access = bool(r)
    chk(added_access, "My Desk is switched on for Samantha and Krystal (Settings > My Desk shows them ticked)")
sql(f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
ok, r = sql(f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(COMMAND)}) as id")
chk(ok, "the nightly tidy is scheduled for 3:20 AM Central" + ("" if ok else ": " + str(r)[:200]))

say(); say("PART 3 · PROOF")
ok, jb = sql(f"select schedule, command from cron.job where jobname = {lit(JOB)}")
chk(ok and jb and jb[0]["schedule"] == SCHEDULE and jb[0]["command"] == COMMAND, "the tidy's schedule reads back exactly")
res, err = probe("""do $p$ declare r jsonb; a boolean; begin
  r := public.desk_tidy();
  a := has_function_privilege('authenticated', 'public.desk_tidy()', 'execute') or has_function_privilege('anon', 'public.desk_tidy()', 'execute');
  raise exception 'PROBE_RESULT: %', jsonb_build_object('tidy', r, 'browser_can_tidy', a,
    'access', (select data->'desk_access' from public.app_data where key = 'ops_settings'));
end $p$;""")
if res is None: bad("the proof didn't answer: " + str(err))
else:
    t = res.get("tidy") or {}
    chk(isinstance(t, dict) and all(k in t for k in ("erased_lines", "erased_stickies", "old_lines", "old_visits")), "the tidy runs (tried inside a test that was undone; it found " + str(sum(int(v or 0) for v in t.values()) if isinstance(t, dict) else "?") + " old things)")
    chk(res.get("browser_can_tidy") is False, "only the server can run the tidy, never a page")
    a = res.get("access") or {}
    if added_access: chk(a.get("mode") == "some" and sorted(a.get("people") or []) == sorted(PEOPLE), "who sees My Desk reads back as Samantha and Krystal")
    else: say("  · who sees My Desk: " + str(a.get("mode")) + ", " + str(len(a.get("people") or [])) + " ticked (left as it was)")
if fails:
    if added_access:
        ok, r = sql("update public.app_data set data = data - 'desk_access' where key = 'ops_settings' and data->'desk_access'->>'set_by' = 'Samantha (Desktop 464)'")
        (say if ok else bad)(("  ✓ " if ok else "") + "because something wasn't right, My Desk was switched back off" + ("" if ok else ": " + str(r)[:160]))
    if not job_was:
        ok, r = sql(f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
        (say if ok else bad)(("  ✓ " if ok else "") + "...and the nightly tidy was taken back off the schedule")
say()
say("RESULT: " + ("DONE · My Desk is on for Samantha and Krystal (Today > My Desk), and old desk pages tidy themselves each night." if not fails else "NOT DONE · the ✗ lines above need Claude."))
say("Nothing was texted or emailed, and nothing on anyone's desk was changed. Who sees My Desk: Settings > My Desk.")
done(0 if not fails else 8)
