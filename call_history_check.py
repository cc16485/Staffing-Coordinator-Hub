#!/usr/bin/env python3
# K0 · every call on the family's profile · what arrives today (READ ONLY; counts, outcomes and dates only).
#  1. The switches: is the AxisCare call-log push live; is the call-off flag live.
#  2. Outcomes tapped after calls (call_disposition_log, keeps the last 50): how many, routed where, last date.
#  3. GoHighLevel summaries and the AxisCare call log (axiscare_call_note_log, keeps the last 100): posted, practice,
#     skipped (and why: not recognised / shared line / duplicate / other), errors, last date.
#  4. Summaries kept in the Hub today: on leads' conversation logs; AxisCare call summaries recorded since C2a.
#  5. Leads sharing a phone number (numbers shared by more than one lead).
# Changes nothing, calls nothing. No name, number or summary text is printed.
import json, os, sys, urllib.request, urllib.error, datetime as dt
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn"); LOCAL = os.environ.get("SB_LOCAL_SOCK"); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  This check changes nothing.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def sql(q):
    if LOCAL:
        from pg8000.native import Connection, DatabaseError
        c = Connection(user="postgres", database="postgres", unix_sock=LOCAL)
        try: rows = c.run(q); cols = [d["name"] for d in (c.columns or [])]; return True, [dict(zip(cols, r)) for r in (rows or [])]
        except DatabaseError as e: return False, str(e)[:200]
        finally: c.close()
    req = urllib.request.Request(API + f"/v1/projects/{REF}/database/query", data=json.dumps({"query": q}).encode(), method="POST",
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-k0/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return True, json.loads(r.read().decode(errors="replace"))
    except urllib.error.HTTPError as e: return False, "HTTP %s" % e.code
    except Exception as e: return False, type(e).__name__
ARR = lambda key: f"jsonb_array_elements(coalesce((select case when jsonb_typeof(data)='array' then data else '[]'::jsonb end from public.app_data where key='{key}'),'[]'::jsonb))"
D30 = "(now() - interval '30 days')"; D90 = "(now() - interval '90 days')"
day = lambda v: (str(v or "never"))[:10]
yn = lambda b: "yes" if b else "no"

say("K0 · EVERY CALL ON THE PROFILE · WHAT ARRIVES TODAY (read only; counts, outcomes and dates only)")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC") + ("   (DISPOSABLE TEST TARGET)" if LOCAL else "")); say()
say("1 · THE SWITCHES")
ok, r = sql("""select coalesce((data->>'axiscare_call_notes_live')::boolean, false) as ax, coalesce((data->>'coverage_flag_live')::boolean, false) as flag
  from public.app_data where key='ops_settings'""")
if ok and r: say(f"  AxisCare call-log push is live: {yn(r[0]['ax'])} · call-off flag from summaries is live: {yn(r[0]['flag'])}")
else: say("  ✗ could not read the switches" + ("" if ok else ": " + str(r)[:160]))

say(); say("2 · OUTCOMES TAPPED AFTER CALLS (its log keeps the last 50)")
ok, r = sql(f"""select count(*) as n, count(*) filter (where (e->>'at')::timestamptz >= {D30}) as d30, count(*) filter (where (e->>'at')::timestamptz >= {D90}) as d90,
  max(e->>'at') as last from {ARR('call_disposition_log')} e""")
if ok and r: r = r[0]; say(f"  in the log: {r['n']} · last 30 days: {r['d30']} · last 90 days: {r['d90']} · last: {day(r['last'])}")
else: say("  ✗ could not read: " + str(r)[:160])
ok, r = sql(f"""select coalesce(e->>'routed','(not recorded)') as routed, count(*) as n from {ARR('call_disposition_log')} e group by 1 order by 2 desc limit 12""")
if ok and r: say("  routed to: " + " · ".join(f"{x['routed']}: {x['n']}" for x in r))

say(); say("3 · GOHIGHLEVEL SUMMARIES AND THE AXISCARE CALL LOG (its log keeps the last 100)")
ok, r = sql(f"""select count(*) as n, count(*) filter (where (e->>'at')::timestamptz >= {D30}) as d30, count(*) filter (where (e->>'at')::timestamptz >= {D90}) as d90,
  max(e->>'at') as last,
  count(*) filter (where e->>'outcome'='posted') as posted, count(*) filter (where e->>'outcome'='dry_run') as practice,
  count(*) filter (where e->>'outcome'='error') as errors,
  count(*) filter (where e->>'outcome'='skipped' and e->>'detail' ilike 'caller not recognised%') as unknown,
  count(*) filter (where e->>'outcome'='skipped' and e->>'detail' ilike 'shared line%') as shared,
  count(*) filter (where e->>'outcome'='skipped' and e->>'detail' ilike 'duplicate%') as dup,
  count(*) filter (where e->>'outcome'='skipped' and not (e->>'detail' ilike 'caller not recognised%' or e->>'detail' ilike 'shared line%' or e->>'detail' ilike 'duplicate%')) as other_skip
  from {ARR('axiscare_call_note_log')} e""")
if ok and r:
    r = r[0]
    say(f"  summaries seen: {r['n']} · last 30 days: {r['d30']} · last 90 days: {r['d90']} · last: {day(r['last'])}")
    say(f"  into AxisCare's call log: {r['posted']} · practice runs: {r['practice']} · errors: {r['errors']}")
    say(f"  skipped: caller not recognised {r['unknown']} · shared line {r['shared']} · duplicate {r['dup']} · other {r['other_skip']}")
else: say("  ✗ could not read: " + str(r)[:160])

say(); say("4 · SUMMARIES KEPT IN THE HUB TODAY")
ok, r = sql(f"""select count(*) as entries, count(distinct l->>'id') as leads, max(c->>'at') as last
  from {ARR('leads')} l, jsonb_array_elements(case when jsonb_typeof(l->'comm_log')='array' then l->'comm_log' else '[]'::jsonb end) c
  where c->>'by' = 'call summary'""")
if ok and r: r = r[0]; say(f"  on leads' conversation logs: {r['entries']} summaries across {r['leads']} leads · last: {day(r['last'])}")
else: say("  ✗ could not read the leads: " + str(r)[:160])
ok, r = sql("select to_regclass('public.axiscare_change_log') is not null as present")
if ok and r and r[0]["present"]:
    ok2, r2 = sql("select count(*) as n, max(at) as last from public.axiscare_change_log where kind='call_summary'")
    if ok2 and r2: say(f"  AxisCare call summaries on the change record (since 2026-09-28): {r2[0]['n']} · last: {day(r2[0]['last'])}")
    else: say("  ✗ could not read the change record: " + str(r2)[:160])

say(); say("5 · LEADS SHARING A PHONE NUMBER")
ok, r = sql(f"""with p as (select distinct l->>'id' as id, right(regexp_replace(coalesce(v,''),'\\D','','g'),10) as d
    from {ARR('leads')} l, unnest(array[l->>'phone', l->>'client_phone']) v
    where not coalesce((l->>'archived')::boolean, false))
  select count(*) as numbers from (select d from p where length(d)=10 group by d having count(distinct id) > 1) x""")
if ok and r: say(f"  phone numbers on more than one open lead: {r[0]['numbers']}")
else: say("  ✗ could not check: " + str(r)[:160])
say()
say("Nothing was changed or called. No name, number or summary text was printed.")
done(0)
