#!/usr/bin/env python3
# Change 3 · READ ONLY. What has the 6-hourly AxisCare status check actually seen, and how does the
# hub's client list compare? Changes nothing. The status wording must be observed, not guessed,
# before anything acts on it (client-status-observe's own rule).
import json, os, urllib.request, urllib.error, datetime as dt

REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
lines = []
def say(s=""): print(s); lines.append(s)
def sql(q):
    req = urllib.request.Request(f"{API}/v1/projects/{REF}/database/query", data=json.dumps({"query": q}).encode(), method="POST",
                                 headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-status-report/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return True, json.loads(r.read().decode())
    except urllib.error.HTTPError as e: return False, "HTTP %s: %s" % (e.code, e.read().decode(errors="replace")[:300])
    except Exception as e: return False, str(e)

LOG = """(select e from public.app_data ad, lateral jsonb_array_elements(case when jsonb_typeof(ad.data) = 'array' then ad.data else '[]'::jsonb end) e
          where ad.key = 'client_status_log')"""
say("CHANGE 3 · WHAT AXISCARE'S STATUS CHECK HAS SEEN · READ ONLY")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"))
say()

say("== 1. THE STATUS CHECK ITSELF =========================================")
ok, r = sql("select jobname, schedule, active from cron.job where jobname ilike any (array['%status%','%admission%','%census%']) order by jobname")
for j in (r if ok else []): say(f"  schedule: {j['jobname']} · {j['schedule']} · {'active' if j['active'] in (True,'true','t') else 'PAUSED'}")
if not ok: say("  could not read schedules: " + str(r))
ok, r = sql("select updated_at from public.app_data where key = 'client_status_log'")
say("  last saved: " + (str(r[0]["updated_at"])[:16] + " UTC" if ok and r else "never"))
say()

say("== 2. STATUS WORDING AXISCARE USES TODAY (current census) =============")
ok, r = sql(f"""select v #>> '{{}}' as label, count(*)::int as n from {LOG} x(e), lateral jsonb_each(e->'map') j(k, v)
                where e->>'id' = 'latest' group by 1 order by 2 desc""")
if ok and r:
    for x in r: say(f"  {x['label']:<28} {x['n']} client(s)")
else: say("  nothing recorded yet" if ok else "  could not read: " + str(r))
say()

say("== 3. EVERY STATUS CHANGE SEEN SO FAR ==================================")
ok, r = sql(f"""select e->>'axiscare_client_id' as ax, e->>'old_status_label' as old, e->>'new_status_label' as new,
                       e->>'observed_at' as at, e->'raw_status' as raw,
                       (select pi.display_name from public.person_source_id s join public.person_identity pi on pi.id = s.person_id
                         where s.system = 'axiscare' and s.entity_type = 'client' and s.source_id = e->>'axiscare_client_id' limit 1) as name
                from {LOG} x(e) where e->>'id' like 'tr\\_%' order by e->>'observed_at'""")
if ok:
    if not r: say("  none: no client has changed status since the check started")
    kinds = {}
    for x in r:
        say(f"  {str(x['at'])[:16]}  #{x['ax']} {x['name'] or '(no hub person)'}: {x['old']} -> {x['new']}   raw {json.dumps(x['raw'])}")
        kinds[(x['old'], x['new'])] = kinds.get((x['old'], x['new']), 0) + 1
    if kinds:
        say("  kinds of change:")
        for (a, b), n in sorted(kinds.items(), key=lambda z: -z[1]): say(f"    {a} -> {b}: {n}")
else: say("  could not read: " + str(r))
say()

say("== 4. AXISCARE vs THE HUB'S CLIENT LIST ================================")
ok, r = sql(f"""with census as (select k as ax, v #>> '{{}}' as label from {LOG} x(e), lateral jsonb_each(e->'map') j(k, v) where e->>'id' = 'latest'),
  hub as (select s.source_id as ax, pi.display_name as name, pr.status as role_status, pr.person_id
            from public.person_role pr join public.person_identity pi on pi.id = pr.person_id
            left join public.person_source_id s on s.person_id = pr.person_id and s.system = 'axiscare' and s.entity_type = 'client'
           where pr.role = 'client'),
  eps as (select person_id, string_agg(state, ', ' order by state) as states from public.journey_episode group by person_id)
  select coalesce(c.ax, h.ax) as ax, h.name, c.label, h.role_status, e.states
    from census c full join hub h on h.ax = c.ax left join eps e on e.person_id = h.person_id
   order by (c.label = 'Active') desc nulls last, h.name nulls last""")
if ok:
    act_ax = [x for x in r if x['label'] == 'Active']
    hub_active = [x for x in r if x['role_status'] == 'active']
    say(f"  Active in AxisCare: {len(act_ax)} · client role active in the hub: {len(hub_active)}")
    groups = [
        ("Active in AxisCare, no hub person yet (\"Who is this?\")", [x for x in r if x['label'] == 'Active' and not x['name']]),
        ("Hub says active client, AxisCare says NOT Active", [x for x in r if x['role_status'] == 'active' and x['label'] not in (None, 'Active')]),
        ("Hub says active client, AxisCare doesn't list them at all", [x for x in r if x['role_status'] == 'active' and x['label'] is None]),
        ("Active in AxisCare, hub client role not active", [x for x in r if x['label'] == 'Active' and x['name'] and x['role_status'] != 'active']),
    ]
    for title, rows in groups:
        say(f"  {title}: {len(rows)}")
        for x in rows: say(f"    #{x['ax'] or '-'} {x['name'] or '(no hub person)'} · AxisCare: {x['label'] or 'not listed'} · hub role: {x['role_status'] or '-'} · Journey: {x['states'] or 'none'}")
    others = [x for x in r if x['label'] not in (None, 'Active')]
    say(f"  Not Active in AxisCare (all): {len(others)}")
    for x in others: say(f"    #{x['ax']} {x['name'] or '(no hub person)'} · {x['label']} · hub role: {x['role_status'] or '-'} · Journey: {x['states'] or 'none'}")
else: say("  could not read: " + str(r))
say()

say("== 5. OPEN \"WHO IS THIS?\" CASES =======================================")
ok, r = sql("select axiscare_client_id, axiscare_name, observed_at, needs_owner_decision from public.client_admission_case where status = 'open' order by observed_at")
if ok:
    if not r: say("  none")
    for x in r: say(f"  #{x['axiscare_client_id']} {x['axiscare_name']} · seen {str(x['observed_at'])[:10]}" + (" · escalated" if x['needs_owner_decision'] in (True, 't') else ""))
else: say("  could not read: " + str(r))
say()
say("Nothing was changed.")
open(REPORT, "w").write("\n".join(lines) + "\n")
