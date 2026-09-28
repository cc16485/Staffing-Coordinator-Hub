#!/usr/bin/env python3
# I0 · recognising family when they call · what's there today (READ ONLY; counts only).
#  1. Family links the identity layer already holds (person_relationship; 'contact' source ids). Expected: none.
#  2. Active Family Circle members (circle active, not removed by AxisCare, not stopped): how many, how many have a
#     usable phone, how many circles are linked to an AxisCare client.
#  3. Their phone numbers against the identity layer: already a client's / a caregiver's / someone else's; shared with
#     another member; free to link.
#  4. Last month's "caller not recognised" calls (axiscare_call_note_log keeps the last 100): how many came from a
#     Family Circle member's number.
# Changes nothing, calls nothing. No name, number or relationship is printed.
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
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-i0/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return True, json.loads(r.read().decode(errors="replace"))
    except urllib.error.HTTPError as e: return False, "HTTP %s" % e.code
    except Exception as e: return False, type(e).__name__

MEMBERS = """with m as (
  select c.id, right(regexp_replace(coalesce(to_jsonb(c)->>'phone',''), '\\D', '', 'g'), 10) as d, k.axiscare_client_id as ax
    from public.circle_contacts c join public.care_circles k on k.id::text = c.circle_id::text
   where coalesce(k.active, true) and (to_jsonb(c)->>'axiscare_removed_at') is null and (to_jsonb(c)->>'stopped_at') is null)"""

say("I0 · RECOGNISING FAMILY WHEN THEY CALL · WHAT'S THERE TODAY (read only; counts only)")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC") + ("   (DISPOSABLE TEST TARGET)" if LOCAL else "")); say()
say("1 · FAMILY LINKS IN THE IDENTITY LAYER TODAY")
ok, r = sql("""select (select count(*) from public.person_relationship) as rel, (select count(*) from public.person_relationship where coalesce(active,true)) as rel_active,
  (select count(*) from public.person_source_id where entity_type = 'contact') as contact_ids""")
if ok and r: r = r[0]; say(f"  client–family links: {r['rel']} (active {r['rel_active']}) · family source records: {r['contact_ids']}")
else: say("  ✗ could not read: " + str(r)[:200])

say(); say("2 · ACTIVE FAMILY CIRCLE MEMBERS")
ok, r = sql(MEMBERS + """ select count(*) as members, count(*) filter (where length(d) = 10) as with_phone,
  count(*) filter (where ax is not null) as in_linked_circle, count(*) filter (where length(d) = 10 and ax is not null) as ready
  from m""")
if ok and r:
    r = r[0]
    say(f"  members: {r['members']} · with a usable phone: {r['with_phone']} · in a circle linked to an AxisCare client: {r['in_linked_circle']}")
    say(f"  both (a usable phone AND a linked circle, so they could be recognised): {r['ready']}")
else: say("  ✗ could not read: " + str(r)[:200])

say(); say("3 · THEIR NUMBERS AGAINST WHO THE HUB ALREADY KNOWS")
ok, r = sql(MEMBERS + """, owners as (
  select right(regexp_replace(pi.phone, '\\D', '', 'g'), 10) as d,
         bool_or(s.entity_type = 'client') as client, bool_or(s.entity_type = 'caregiver') as caregiver, count(distinct pi.person_id) as people
    from public.phone_index pi left join public.person_source_id s on s.person_id = pi.person_id
   group by 1),
  dup as (select d from m where length(d) = 10 group by d having count(*) > 1)
  select count(*) filter (where o.client) as on_client, count(*) filter (where o.caregiver and not coalesce(o.client,false)) as on_caregiver,
         count(*) filter (where o.d is not null and not coalesce(o.client,false) and not coalesce(o.caregiver,false)) as on_other,
         count(*) filter (where o.d is null and m.d in (select d from dup)) as shared_between_members,
         count(*) filter (where o.d is null and m.d not in (select d from dup)) as free
    from m left join owners o on o.d = m.d where length(m.d) = 10""")
if ok and r:
    r = r[0]
    say(f"  already a client's number (a shared home line): {r['on_client']} · a caregiver's: {r['on_caregiver']} · someone else's: {r['on_other']}")
    say(f"  shared between two family members: {r['shared_between_members']} · free to link: {r['free']}")
else: say("  ✗ could not read: " + str(r)[:200])

say(); say("4 · LAST MONTH'S UNRECOGNISED CALLS THAT CAME FROM A FAMILY CIRCLE NUMBER")
ok, r = sql(MEMBERS + """, un as (
  select e->>'phone_digits' as d from jsonb_array_elements(coalesce((select case when jsonb_typeof(data)='array' then data else '[]'::jsonb end
     from public.app_data where key='axiscare_call_note_log'),'[]'::jsonb)) e
   where e->>'outcome' = 'skipped' and e->>'detail' ilike 'caller not recognised%' and (e->>'at')::timestamptz >= now() - interval '30 days')
  select count(*) as unrecognised, count(*) filter (where un.d in (select d from m where length(d)=10)) as family from un""")
if ok and r: r = r[0]; say(f"  unrecognised calls: {r['unrecognised']} · from a Family Circle member's number: {r['family']}")
else: say("  ✗ could not read: " + str(r)[:200])
say()
say("Nothing was changed or called. No name, number or relationship was printed.")
done(0)
