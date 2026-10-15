-- ============================================================================================================================
-- 744 · A LEAD MADE FROM A CALL HAS ALREADY BEEN TALKED TO (Samantha 2026-10-15: "Leads that are put in from the first lead
-- call that they called us are being treated like its a lead we haven't spoken to"). SHARED HUB PROJECT. Safe to run again.
--
-- From 2026-10-15 the Hub records the answered call a lead is made or filled from as its first real conversation (call-lead.js).
-- This puts the same record on the leads made before that: a lead whose answered call is on it (from_calls, Make this a lead /
-- Fill from the call) or that the old AI made from a call transcript (ai_suggestions source call-followup), and that has NO
-- human contact recorded yet. For each one, exactly what a logged connected call writes (ldPush): first_human_contact_at,
-- first_human_attempt_at (if missing), one contact event, one call line in the log, last_contacted_at, and New -> Contacted
-- with its status history line. Leads already talked to, Lost or archived leads, and every other lead are left exactly as they are.
-- ============================================================================================================================
with fix as (
  select t.o,
    coalesce(
      (select min(c->>'at') from jsonb_array_elements(case when jsonb_typeof(t.x->'from_calls') = 'array' then t.x->'from_calls' else '[]'::jsonb end) c where coalesce(c->>'at', '') <> ''),
      case when exists (select 1 from jsonb_array_elements(case when jsonb_typeof(t.x->'ai_suggestions') = 'array' then t.x->'ai_suggestions' else '[]'::jsonb end) s where s->>'source' = 'call-followup')
        then coalesce(nullif(t.x->>'last_call_at', ''), (select min(s->>'at') from jsonb_array_elements(t.x->'ai_suggestions') s where s->>'source' = 'call-followup')) end
    ) as at,
    (select c->>'message_id' from jsonb_array_elements(case when jsonb_typeof(t.x->'from_calls') = 'array' then t.x->'from_calls' else '[]'::jsonb end) c order by c->>'at' limit 1) as msg
  from public.app_data a, jsonb_array_elements(a.data) with ordinality t(x, o)
  where a.key = 'leads' and jsonb_typeof(a.data) = 'array'
    and coalesce(t.x->>'first_human_contact_at', '') = ''
    and coalesce(t.x->>'archived', 'false') <> 'true' and coalesce(t.x->>'status', 'New') <> 'Lost'
)
update public.app_data a set data = (
  select jsonb_agg(case when f.at is null then t.x else t.x || jsonb_build_object(
      'first_human_contact_at', f.at,
      'first_human_attempt_at', coalesce(nullif(t.x->>'first_human_attempt_at', ''), f.at),
      'last_contacted_at', greatest(coalesce(t.x->>'last_contacted_at', ''), left(f.at, 10)),
      'contact_events', (case when jsonb_typeof(t.x->'contact_events') = 'array' then t.x->'contact_events' else '[]'::jsonb end)
        || jsonb_build_array(jsonb_build_object('at', f.at, 'channel', 'call', 'direction', 'in', 'outcome', 'connected', 'actor', 'human', 'by', 'The Hub (744)',
             'ref', 'ghl:' || coalesce(f.msg, 'call'), 'note', 'Answered call this lead was made from (recorded by 744)')),
      'comm_log', (case when jsonb_typeof(t.x->'comm_log') = 'array' then t.x->'comm_log' else '[]'::jsonb end)
        || jsonb_build_array(jsonb_build_object('body', '☎ call: connected (the call this lead was made from)', 'at', f.at, 'by', 'The Hub (744)')),
      'status', case when coalesce(t.x->>'status', 'New') = 'New' then 'Contacted' else t.x->>'status' end,
      'status_history', case when coalesce(t.x->>'status', 'New') = 'New'
        then (case when jsonb_typeof(t.x->'status_history') = 'array' then t.x->'status_history' else '[]'::jsonb end)
          || jsonb_build_array(jsonb_build_object('at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'from', 'New', 'to', 'Contacted', 'by', 'The Hub (744)', 'why', 'first real conversation (the call this lead was made from)'))
        else t.x->'status_history' end
    ) end order by t.o)
  from jsonb_array_elements(a.data) with ordinality t(x, o) left join fix f on f.o = t.o
)
where a.key = 'leads' and jsonb_typeof(a.data) = 'array' and jsonb_array_length(a.data) > 0 and exists (select 1 from fix where fix.at is not null);
