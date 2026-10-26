-- =============================================================================
-- hr_sop_reminders.sql · CORRECTIVE ACTION SOP REMINDERS (HR Agent build step 9, Samantha 2026-10-18: "Build HR step 9,
-- the SOP deadline reminders"). Installed by Desktop step 990 (hr_sop_990.py). Safe to run again.
-- The Corrective Action SOP (approved 2026-07-16): the facts checked within 2 business days of the write-up starting, a
-- decision within 3, the meeting (signed or refused) within 5 business days of the decision, and a follow-up 30 days
-- after it is issued. Each write-up has ONE reminder at a time: its next step, on the day it is due and every day after
-- until it is done. It is a private My Work card for the HR lead (Zach), and his generic alert ("You have an HR item to
-- review", hr-alerts, step 7) picks it up. The card closes itself when the step is done or the write-up moves on.
-- PRACTICE until ops_settings.hr_sop_reminders_live is true (build step 10): the run only counts what is due.
-- Runs every morning at 7:55 Central (before the 8am alerts) and right after every write-up save.
-- =============================================================================
create or replace function public.hr_add_business_days(d date, n int) returns date language plpgsql immutable set search_path = pg_catalog as $f$
declare x date := d; left_ int := n;
begin
  while left_ > 0 loop x := x + 1; if extract(isodow from x) < 6 then left_ := left_ - 1; end if; end loop;
  return x;
end $f$;

/* the next step a write-up is waiting on, and its due day (null when nothing is open) */
create or replace function public.hr_sop_next(w jsonb, out step text, out due date) language plpgsql immutable set search_path = pg_catalog as $f$
declare created date := nullif(left(w->>'created_at', 10), '')::date;
begin
  step := null; due := null;
  if w->>'status' = 'issued' then
    if nullif(w->>'followup_at', '') is null and nullif(w->>'issued_at', '') is not null then step := 'follow_up'; due := left(w->>'issued_at', 10)::date + 30; end if;
  elsif w->>'status' = 'approved' then
    if nullif(w->>'approved_at', '') is not null then step := 'meet'; due := public.hr_add_business_days(left(w->>'approved_at', 10)::date, 5); end if;
  elsif w->>'status' in ('draft', 'pending_approval') and created is not null then
    if nullif(w->>'facts_checked_at', '') is null then step := 'facts'; due := public.hr_add_business_days(created, 2);
    else step := 'decide'; due := public.hr_add_business_days(created, 3); end if;
  end if;
end $f$;

create or replace function public.hr_sop_reminders() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $f$
declare live boolean := coalesce((select (data->>'hr_sop_reminders_live') = 'true' from public.app_data where key = 'ops_settings'), false);
  today date := (now() at time zone 'America/Chicago')::date; zach text := public.hr_lead_email(); w jsonb; nx record; ex jsonb; cid text; title text; detail text;
  words jsonb := '{"facts": "check the facts", "decide": "decide it", "meet": "meet with them and get it signed or refused", "follow_up": "30-day follow-up"}'::jsonb;
  n_today int := 0; n_late int := 0; n_closed int := 0;
begin
  for w in select x from public.app_data, jsonb_array_elements(case when jsonb_typeof(data) = 'array' then data else '[]'::jsonb end) x where key = 'discipline_actions' and x->>'id' is not null loop
    select * into nx from public.hr_sop_next(w);
    cid := 'ops_wu_step_' || (w->>'id');
    ex := (select e from public.app_data, jsonb_array_elements(data) e where key = 'ops_items' and e->>'id' = cid limit 1);
    if nx.step is null or nx.due > today then
      if live and ex is not null and ex->>'status' = 'open' then
        perform public.upsert_app_data_item('ops_items', ex || jsonb_build_object('status', 'done', 'closed_at', now(), 'closed_by', 'system', 'last_activity_at', now()));
        n_closed := n_closed + 1;
      end if;
      continue;
    end if;
    if nx.due = today then n_today := n_today + 1; else n_late := n_late + 1; end if;
    if not live then continue; end if;
    title := 'Write-up, ' || (words->>nx.step) || ': ' || public.hr_short_name(w->>'caregiver');
    detail := coalesce(w->>'level', 'Write-up') || '. ' || case when nx.due = today then 'Due today' else 'Was due ' || to_char(nx.due, 'Mon FMDD') end
      || ' (Corrective Action SOP). Open it on Performance, Formal cases.';
    if ex is not null and ex->>'status' = 'open' and ex->>'title' = title and ex->>'detail' = detail then continue; end if;
    perform public.upsert_app_data_item('ops_items', jsonb_build_object('id', cid, 'kind', 'hr_file', 'source_id', w->>'id', 'sensitive', true,
      'title', title, 'detail', detail, 'next_action', 'Do this step on Performance, Formal cases.', 'about', public.hr_short_name(w->>'caregiver'), 'owner', zach,
      'domain', 'caregiver_performance', 'urgency', case when nx.due < today then 'today' else 'normal' end, 'status', 'open',
      'created_at', coalesce(ex->>'created_at', now()::text), 'last_activity_at', now(), 'due', ((nx.due::text || ' 17:00')::timestamp at time zone 'America/Chicago'),
      'opened_by', 'system', 'link', '#hr/formal'));
  end loop;
  return jsonb_build_object('live', live, 'due_today', n_today, 'overdue', n_late, 'closed', n_closed);
end $f$;
revoke all on function public.hr_sop_reminders() from public, anon, authenticated;

/* right after every write-up save, so a done step's reminder closes at once */
create or replace function public.hr_sop_after_save() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $f$
begin perform public.hr_sop_reminders(); return new; end $f$;
revoke all on function public.hr_sop_after_save() from public, anon, authenticated;
drop trigger if exists hr_sop_after_save on public.app_data;
create trigger hr_sop_after_save after insert or update of data on public.app_data
  for each row when (new.key = 'discipline_actions') execute function public.hr_sop_after_save();
