#!/usr/bin/env python3
# 512 · INTERVIEW HOURS, AND KRYSTAL FIRST. Samantha, 2026-10-08: "it should be Krystal M-F 8:30am-1:30pm and Samantha
# 10:00am-4:30pm" and "Krystal is the first option during her hours". (Replaces the unrun 511.)
#   · Krystal's interview hours Monday to Friday: 8:30am to 1:30pm (her assessment and orientation hours stay).
#   · Samantha interviews Monday to Friday 10:00am to 4:30pm (added as an interviewer, or switched back on).
#   · Booking order: Krystal 1, Samantha 2. interview_book now gives a time to the free interviewer first in that order
#     (interview_first_choice_512.sql); before, whoever had fewer that day took it.
# All in one transaction (all of it, or none of it). Shows the change and asks for yes first. NOTHING IS SENT; existing
# bookings are not moved. Rollback: interview_first_choice_512_rollback.sql (the rule); the hours are settings in the Hub.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); REF = "zngsgedlsxinbygwmxwn"
HUB = os.environ["SB_REPO"]; BASE = os.environ.get("SB_BASE", "")
SQLFILE, RBFILE = "interview_first_choice_512.sql", "interview_first_choice_512_rollback.sql"
lines = []; fails = []
def say(s=""):
    s = re.sub(r"(sbp_|eyJ|sb_secret_)[A-Za-z0-9._\-]+", "(hidden)", str(s)); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def sql(q):
    req = urllib.request.Request(f"{API}/v1/projects/{REF}/database/query", data=json.dumps({"query": q}).encode(), method="POST",
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-512/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return True, json.loads(r.read().decode() or "[]")
    except urllib.error.HTTPError as e: return False, f"HTTP {e.code}: {e.read().decode()[:300]}"
    except Exception as e: return False, type(e).__name__
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
def git(*a): return subprocess.run(["git", *a], cwd=HUB, capture_output=True)
BODY = re.compile(r"create\s+or\s+replace\s+function\s+(?:public\.)?interview_book\s*\([^)]*\)[\s\S]*?\bas\s+(\$\w*\$)([\s\S]*?)\1", re.I)
norm = lambda b: re.sub(r"\s+", " ", b).strip()
def body_of(path): m = BODY.search(open(path).read()); return norm(m.group(2)) if m else None
DAYS = {0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat"}
def hours():
    ok, rows = sql("""select c.name, coalesce(to_jsonb(c)->>'active','true') act, coalesce(to_jsonb(c)->>'booking_order','') ord, a.day_of_week d,
        to_char(a.start_time,'HH12:MI am') st, to_char(a.end_time,'HH12:MI am') en
      from public.coordinator_availability a join public.coordinators c on c.id = a.coordinator_id
     where a.activity = 'interview' and coalesce((to_jsonb(a)->>'active')::boolean, true) order by c.name, a.day_of_week, a.start_time""")
    if not ok: bad("couldn't read the hours: " + str(rows)); return []
    if not rows: say("    · nobody")
    for r in rows: say(f"    {r['name']}{'' if r['act'] == 'true' else ' (switched off)'}{' · order ' + r['ord'] if r['ord'] else ''} · {DAYS.get(r['d'], r['d'])} {r['st']} to {r['en']}")
    return rows
def slots(title):
    ok, s = sql("""select count(*)::int n, to_char(min(starts_at) at time zone 'America/Chicago','Dy Mon DD HH12:MI am') f,
        count(*) filter (where (starts_at at time zone 'America/Chicago')::time < '08:30' or (starts_at at time zone 'America/Chicago')::time >= '16:30')::int outside,
        count(*) filter (where hosts_free = 2)::int both from public.interview_open_slots()""")
    ok2, w = sql("select count(*)::int n from public.welcome_open_slots()")
    say(title + (f"{s[0]['n']} interview times (first {s[0]['f']}; {s[0]['both']} where both are free), {w[0]['n'] if ok2 and w else '?'} welcome-call times" if ok and s else "✗ " + str(s)))
    return s[0] if ok and s else None

say("512 · INTERVIEW HOURS, AND KRYSTAL FIRST"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
if not BASE or git("cat-file", "-e", BASE + "^{commit}").returncode != 0: bad("the reviewed starting point isn't in the history"); done(2)
changed = set(git("diff", "--name-only", BASE, "HEAD").stdout.decode().split())
for rel, want in ((SQLFILE, os.environ.get("SB_SQL_SHA", "")), (RBFILE, os.environ.get("SB_RB_SHA", ""))):
    if rel not in changed or sha(os.path.join(HUB, rel)) != want: bad(f"{rel} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
OLD, NEW = body_of(os.path.join(HUB, RBFILE)), body_of(os.path.join(HUB, SQLFILE))
if not OLD or not NEW: bad("couldn't read the booking rule from the files. Tell Claude."); done(2)
ok, live = sql("select p.prosrc src from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'interview_book'")
if not ok or len(live) != 1: bad("couldn't read the live booking rule (or there is more than one). Nothing was changed. Tell Claude."); done(3)
lb = norm(live[0]["src"])
if lb not in (OLD, NEW): bad("the live booking rule isn't the one this was built on (461). Nothing was changed. Tell Claude."); done(3)
say("  ✓ the live booking rule is " + ("already this build (an earlier run)" if lb == NEW else "the one this was built on (461)"))
ok, co = sql("select id::text id, name, coalesce(to_jsonb(c)->>'active','true') act from public.coordinators c order by name")
if not ok: bad("couldn't read the interviewers: " + str(co)); done(3)
kr = [c for c in co if c["name"].strip().lower().startswith("krystal")]
sa = [c for c in co if c["name"].strip().lower().startswith("samantha")]
if len(kr) != 1: bad(f"expected one Krystal among the interviewers, found {len(kr)}. Nothing was changed. Tell Claude."); done(3)
if len(sa) > 1: bad(f"found {len(sa)} interviewers called Samantha. Nothing was changed. Tell Claude."); done(3)
say("  Who interviews when now:"); hours()
slots("  Open times now: ")
say("  · the booking rule was proved on a real Postgres copy with made-up people when built (interview_first_choice_512_test.mjs, 11 checks)")
say(""); say("THE CHANGE")
say("  · Krystal: Monday to Friday 8:30am to 1:30pm (her assessment and orientation hours stay as they are)")
say("  · Samantha: Monday to Friday 10:00am to 4:30pm" + (" (added as an interviewer)" if not sa else (" (switched back on)" if sa[0]["act"] != "true" else "")))
say("  · Krystal first: a time goes to Krystal when she is free; to Samantha when Krystal already has it, or after 1:30pm")
try:
    with open("/dev/tty", "w") as tw: tw.write("\n  Make this change? Type yes and press Enter: "); tw.flush()
    with open("/dev/tty") as tr: a = tr.readline().strip().lower()
except Exception: a = os.environ.get("SB_YES", "")
if a != "yes": say("  · you didn't type yes, so nothing was changed."); done(0)

say(""); say("PART 2 · CHANGE (one step: all of it, or none of it)")
lit = lambda v: "'" + str(v).replace("'", "''") + "'"
DATA = f"""do $$
declare k uuid := {lit(kr[0]['id'])}::uuid; s uuid;
begin
  select id into s from public.coordinators where lower(trim(name)) like 'samantha%' limit 1;
  if s is null then insert into public.coordinators (name) values ('Samantha') returning id into s;
  else update public.coordinators set active = true where id = s; end if;
  update public.coordinators set booking_order = 1 where id = k;
  update public.coordinators set booking_order = 2 where id = s;
  delete from public.coordinator_availability where activity = 'interview' and coordinator_id in (k, s) and day_of_week between 1 and 5;
  insert into public.coordinator_availability (coordinator_id, activity, day_of_week, start_time, end_time)
    select k, 'interview', d, '08:30'::time, '13:30'::time from generate_series(1, 5) d
    union all select s, 'interview', d, '10:00'::time, '16:30'::time from generate_series(1, 5) d;
end $$;
"""
q = open(os.path.join(HUB, SQLFILE)).read()
if q.count("\ncommit;") != 1: bad("the rule file isn't one transaction. Nothing was changed. Tell Claude."); done(5)
q = q.replace("\ncommit;", "\n" + DATA + "\ncommit;", 1)
ok, r = sql(q)
if not ok: bad("the change didn't go in (nothing was changed): " + str(r)[:240]); done(5)
say("  ✓ saved: the hours, the booking order and the booking rule")

say(""); say("PART 3 · PROOF (read only, nothing is booked)")
ok, live = sql("select p.prosrc src from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'interview_book'")
(say if ok and live and norm(live[0]["src"]) == NEW else bad)(("  ✓ " if ok and live and norm(live[0]["src"]) == NEW else "") + "the booking rule is the new one (Krystal first when she is free)")
say("  Who interviews when now:"); h = hours()
okk = any(r["name"].lower().startswith("krystal") and r["ord"] == "1" for r in h) and any(r["name"].lower().startswith("samantha") and r["ord"] == "2" for r in h)
(say if okk else bad)(("  ✓ " if okk else "") + "booking order: Krystal 1, Samantha 2")
after = slots("  Open times now: ")
good = after and after["outside"] == 0 and after["n"] > 0 and after["both"] > 0
(say if good else bad)(("  ✓ " if good else "") + "every open time is between 8:30am and 4:30pm, and from 10:00am to 1:30pm either of you can take it")
say()
say("RESULT: " + ("DONE · the apply page and the welcome-call page use the new hours now, and Krystal is asked first." if not fails else "PARTLY DONE · the ✗ lines above need Claude."))
say("Nothing was texted or emailed. Existing booked interviews are not moved.")
say("Rollback: interview_first_choice_512_rollback.sql puts the booking rule back; the hours can be changed in the Hub's Interviews settings.")
done(0 if not fails else 8)
