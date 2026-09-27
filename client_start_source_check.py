#!/usr/bin/env python3
# Change 8b follow-up · READ ONLY. Where are the Start of Care records? The first run of client-start-run
# saw 0 leads with a start; this counts them straight from the database and shows the check's own run log.
import json, os, urllib.request, urllib.error, datetime as dt
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
lines = []
def say(s=""): print(s); lines.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def sql(q):
    req = urllib.request.Request(f"{API}/v1/projects/{REF}/database/query", data=json.dumps({"query": q}).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "User-Agent": "cc-start-check/1.0", "Authorization": "Bearer " + TOKEN})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return True, json.loads(r.read().decode())
    except urllib.error.HTTPError as e: return False, f"HTTP {e.code}: {e.read().decode(errors='replace')[:300]}"
    except Exception as e: return False, str(e)[:300]
say("WHERE ARE THE START OF CARE RECORDS? (read only)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
ok, r = sql("""select jsonb_typeof(data) as shape, case when jsonb_typeof(data)='array' then jsonb_array_length(data) end as n,
   pg_column_size(data) as bytes, updated_at::text as updated from app_data where key = 'leads'""")
if not ok: say("  ✗ could not read the leads record: " + str(r)); done(2)
if not r: say("  ✗ there is no 'leads' record in the shared store"); done(3)
say(f"  leads record: stored as {r[0]['shape']}, {r[0]['n']} lead(s), last saved {str(r[0]['updated'])[:16]}")
ok, r = sql("""with l as (select e from app_data a, jsonb_array_elements(case when jsonb_typeof(a.data)='array' then a.data else '[]'::jsonb end) e where a.key='leads')
   select count(*)::int as leads, count(*) filter (where e ? 'soc')::int as has_soc_key,
     count(*) filter (where jsonb_typeof(e->'soc')='object')::int as soc_object,
     count(*) filter (where jsonb_typeof(e->'soc')='object' and coalesce((e->'soc'->>'abandoned')::boolean,false))::int as abandoned,
     count(*) filter (where jsonb_typeof(e->'soc')='object' and coalesce((e->>'archived')::boolean,false))::int as archived,
     count(*) filter (where jsonb_typeof(e->'soc')='object' and e->>'status'='Lost')::int as lost,
     count(*) filter (where jsonb_typeof(e->'soc')='string')::int as soc_text from l""")
if ok and r:
    x = r[0]
    say(f"  leads with a Start of Care: {x['soc_object']} (key present on {x['has_soc_key']}; stored as text on {x['soc_text']})")
    say(f"    of those: abandoned {x['abandoned']} · archived {x['archived']} · marked Lost {x['lost']}")
else: say("  ✗ could not count: " + str(r))
ok, r = sql("""with l as (select e from app_data a, jsonb_array_elements(case when jsonb_typeof(a.data)='array' then a.data else '[]'::jsonb end) e where a.key='leads')
   select coalesce(e->>'status','(none)') as status, count(*)::int as n from l group by 1 order by 2 desc""")
if ok: say("  leads by status: " + ", ".join(f"{x['status']} {x['n']}" for x in r))
ok, r = sql("""select e->>'at' as at, e->>'dry' as dry, e->>'rows_seen' as seen, e->>'created' as created, e->>'error' as error
   from app_data a, jsonb_array_elements(case when jsonb_typeof(a.data)='array' then a.data else '[]'::jsonb end) e
   where a.key='automation_log' and e->>'automation'='client_start' order by e->>'at' desc limit 5""")
say(); say("THE CHECK'S LAST RUNS")
if ok and r:
    for x in r: say(f"  • {str(x['at'])[:16]} · {'preview' if x['dry']=='true' else 'live'} · starts seen {x['seen']} · added {x['created']}" + (f" · error: {x['error']}" if x['error'] else ""))
else: say("  none recorded" if ok else "  could not read: " + str(r))
say(); say("Nothing was changed.")
done(0)
