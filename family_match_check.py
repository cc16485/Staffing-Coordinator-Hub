#!/usr/bin/env python3
# Change 6 · READ ONLY. Could Cara's "your caregiver has changed" family text reach the wrong family?
# coverage-run picks the Family Circle whose client has the same FIRST name (first match wins).
# This counts shared first names among active circles, who could be texted, whether sending is on,
# and re-checks every past family text: which circle the rule picked vs the client's full name. Changes nothing.
import json, os, urllib.request, urllib.error, datetime as dt
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip(); REF = os.environ.get("SB_REF", "")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
lines = []
def say(s=""): print(s); lines.append(s)
def sql(q):
    req = urllib.request.Request(f"{API}/v1/projects/{REF}/database/query", data=json.dumps({"query": q}).encode(), method="POST",
                                 headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-family-check/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return True, json.loads(r.read().decode())
    except urllib.error.HTTPError as e: return False, "HTTP %s: %s" % (e.code, e.read().decode(errors="replace")[:300])
    except Exception as e: return False, str(e)
first = lambda s: (str(s or "").strip().lower().split() or [""])[0]
say("CHANGE 6 · COULD A FAMILY TEXT REACH THE WRONG FAMILY? · READ ONLY")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
ok, st = sql("select coalesce(data->>'coverage_send_live','(not set)') as live from app_data where key = 'ops_settings'")
say("  Cara sending switch (coverage_send_live): " + (str(st[0]["live"]) if ok and st else "could not read"))
ok, circ = sql("""select c.id, c.client_name,
     (select count(*) from circle_contacts m where m.circle_id = c.id)::int as members,
     (select count(*) from circle_contacts m where m.circle_id = c.id and m.sms_consent is true and coalesce(m.wants_changes, true)
        and length(regexp_replace(coalesce(m.phone,''), '\\D', '', 'g')) >= 10)::int as textable
   from care_circles c where c.active is true order by c.client_name""")
if not ok: say("  could not read Family Circles: " + str(circ)); circ = []
say(f"  active Family Circles: {len(circ)} · with at least one family member who would be texted: {sum(1 for c in circ if c['textable'])}")
groups = {}
for c in circ: groups.setdefault(first(c["client_name"]), []).append(c)
shared = {k: v for k, v in groups.items() if len(v) > 1}
say(); say("== CIRCLES THAT SHARE A FIRST NAME (the rule can pick the wrong one) ==")
if not shared: say("  none today")
for k, v in shared.items():
    say(f"  \"{k}\": " + " | ".join(f"{c['client_name']} ({c['members']} member(s), {c['textable']} textable)" for c in v)
        + "  → the rule takes whichever the database returns first; it could be any of these")
ok, clients = sql("""select pi.display_name from person_role pr join person_identity pi on pi.id = pr.person_id where pr.role = 'client' and pr.status = 'active'""")
cf = {}
for c in (clients if ok else []): cf.setdefault(first(c["display_name"]), []).append(c["display_name"])
dup = {k: v for k, v in cf.items() if len(v) > 1}
say(); say("== ACTIVE CLIENTS WHO SHARE A FIRST NAME ==")
say("  none" if not dup else "\n".join(f"  \"{k}\": " + ", ".join(v) for k, v in dup.items()))
ok, cases = sql("""select e->>'id' as id, e->>'client' as client, e->>'family_notified' as at, (e->>'family_notified_count')::int as n
   from app_data ad, lateral jsonb_array_elements(case when jsonb_typeof(ad.data)='array' then ad.data else '[]'::jsonb end) e
   where ad.key = 'coverage_cases' and coalesce((e->>'family_notified_count')::int, 0) > 0 order by e->>'family_notified'""")
say(); say("== EVERY PAST FAMILY TEXT: WAS IT THE RIGHT FAMILY? ==")
if not ok: say("  could not read coverage cases: " + str(cases)); cases = []
if ok and not cases: say("  no family texts have ever been sent")
for c in cases:
    cands = [x for x in circ if first(x["client_name"]) == first(c["client"])]
    exact = [x for x in cands if x["client_name"].strip().lower() == str(c["client"]).strip().lower()]
    if len(cands) == 1 and exact: verdict = "✓ only one circle has that first name, and it is this client's"
    elif not cands: verdict = "? no circle with that first name today (it may have been renamed or closed); check who was texted"
    elif not exact: verdict = "✗ POSSIBLY THE WRONG FAMILY: no circle has this client's full name; check who was texted"
    else: verdict = "✗ COULD HAVE BEEN EITHER FAMILY: " + ", ".join(x["client_name"] for x in cands) + " share the first name; check who was texted"
    say(f"  {str(c['at'])[:16]} · shift for {c['client']} · {c['n']} text(s) · {verdict}")
say(); say("Nothing was changed.")
open(REPORT, "w").write("\n".join(lines) + "\n")
