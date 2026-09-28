#!/usr/bin/env python3
# How leads arrive (read only, counts only; no names, phones or emails are read out).
# Each automatic path leaves its own mark on the lead:
#   website form (lead-intake)        source Website/Referral + a "web inquiry" first event
#   phone call transcript (call-followup) an AI suggestion marked call-followup; source Inbound Call
#   call outcome tap (call-disposition)   source Inbound Call / Referral, no AI suggestion
#   assessment booking (assessment-intake) source "Assessment booking"
#   consult booking page (cc-booking)      source "Consult booking"
#   HomeTogether order                     source "HomeTogether TV order"
#   typed in the Hub                       everything else (Phone, Website without a web event, Other…)
import json, os, urllib.request, urllib.error, datetime as dt
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn"); LOCAL = os.environ.get("SB_LOCAL_SOCK")
lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def sql(q):
    if LOCAL:
        from pg8000.native import Connection, DatabaseError
        c = Connection(user="postgres", database="postgres", unix_sock=LOCAL)
        try:
            rows = c.run(q); cols = [d["name"] for d in (c.columns or [])]; return True, [dict(zip(cols, r)) for r in (rows or [])]
        except DatabaseError as e:
            d = e.args[0] if e.args and isinstance(e.args[0], dict) else {}; return False, str(d.get("M", e))
        finally: c.close()
    req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{REF}/database/query", data=json.dumps({"query": q}).encode(), method="POST",
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-leads-arrival/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return True, json.loads(r.read().decode(errors="replace"))
    except urllib.error.HTTPError as e: return False, "HTTP %s: %s" % (e.code, e.read().decode(errors="replace")[:600])
    except Exception as e: return False, "%s: %s" % (type(e).__name__, e)

Q = """with l as (
  select e, nullif(e->>'created_at','')::timestamptz as made,
    case
      when exists (select 1 from jsonb_array_elements(case when jsonb_typeof(e->'ai_suggestions')='array' then e->'ai_suggestions' else '[]' end) s where s->>'source' = 'call-followup')
        or coalesce(e->>'draft_sms','') <> '' or coalesce(e->>'draft_email_body','') <> '' then 'Phone call transcript (AI, draft-first)'
      when e->>'source' in ('Website','Referral') and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(e->'contact_events')='array' then e->'contact_events' else '[]' end) v
             where v->>'channel' = 'web' and v->>'outcome' = 'inquiry') then 'Website form'
      when e->>'source' = 'Assessment booking' then 'Assessment booking (GHL calendar)'
      when e->>'source' = 'Consult booking' then 'Consult booking page'
      when e->>'source' like 'HomeTogether%' then 'HomeTogether order'
      when e->>'source' = 'Inbound Call' then 'Call outcome tapped after a call'
      else 'Typed in the Hub (' || coalesce(nullif(e->>'source',''), 'no source') || ')'
    end as path
  from public.app_data d, jsonb_array_elements(case when jsonb_typeof(d.data)='array' then d.data else '[]' end) e where d.key = 'leads')
select path, count(*) as all_time,
  count(*) filter (where made >= now() - interval '30 days') as last_30_days,
  count(*) filter (where made >= now() - interval '7 days') as last_7_days,
  to_char(max(made) at time zone 'America/Chicago', 'Mon DD, YYYY') as latest
from l group by path order by all_time desc"""

say("HOW LEADS ARRIVE (read only, counts only)")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
ok, rows = sql(Q)
if not ok: say("✗ could not read: " + str(rows)[:300]); done(3)
w = max([len(r["path"]) for r in rows] + [10])
say("  " + "How it arrived".ljust(w) + "   all   30d   7d   latest")
for r in rows:
    say("  " + r["path"].ljust(w) + f"  {r['all_time']:>4}  {r['last_30_days']:>4}  {r['last_7_days']:>3}   {r['latest'] or '—'}")
say("  " + "TOTAL".ljust(w) + f"  {sum(r['all_time'] for r in rows):>4}  {sum(r['last_30_days'] for r in rows):>4}  {sum(r['last_7_days'] for r in rows):>3}")
say()
ok, x = sql("""select
  (select count(*) from jsonb_array_elements(coalesce((select case when jsonb_typeof(data)='array' then data end from public.app_data where key='post_call_followups'),'[]')) f
     where nullif(f->>'created_at','')::timestamptz >= now() - interval '30 days') as drafts_30d,
  (select to_char(max(nullif(f->>'created_at','')::timestamptz) at time zone 'America/Chicago','Mon DD, YYYY')
     from jsonb_array_elements(coalesce((select case when jsonb_typeof(data)='array' then data end from public.app_data where key='post_call_followups'),'[]')) f) as drafts_latest""")
if ok and x:
    say(f"  Follow-up drafts written in the last 30 days: {x[0]['drafts_30d']} (latest: {x[0]['drafts_latest'] or 'never'})")
say()
say("Note: website-form leads from before the form started marking its first contact event show as \"Typed in the Hub (Website)\".")
say("A path with 0 in the last 30 days is either quiet or not switched on in GoHighLevel; the latest date says which.")
done(0)
