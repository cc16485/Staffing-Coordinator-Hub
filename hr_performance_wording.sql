-- Performance wording (Samantha 2026-10-26: "change the coaching cards and labels to say Performance page instead of HR page").
-- The HR page was renamed Performance on 2026-10-26 (Hub #645). Only the words on My Work cards change; nothing else.
-- Each function below is the LIVE definition read on 2026-10-26 with only those words swapped.

CREATE OR REPLACE FUNCTION public.hr_coaching_card(c hr_coaching)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare due timestamptz := (c.due_on::text || ' 17:00')::timestamp at time zone 'America/Chicago';
  /* COACHING CALLS (2026-10-18): once they are switched on, the office-visible card names first name + last initial only */
  calls_live boolean := coalesce((select (data->>'hr_coaching_calls_live') = 'true' from public.app_data where key = 'ops_settings'), false);
  short text := split_part(btrim(c.caregiver), ' ', 1) || coalesce(' ' || nullif(left(regexp_replace(btrim(c.caregiver), '^.*\s', ''), 1), split_part(btrim(c.caregiver), ' ', 1)) || '.', '');
begin
  perform public.upsert_app_data_item('ops_items', jsonb_build_object(
    'id', 'ops_coach_' || c.id, 'kind', 'coaching', 'source_id', c.id::text, 'sensitive', c.subject_type = 'office',
    'title', case when c.subject_type = 'office' then 'Office coaching due: ' || short
                  when calls_live and c.kind = 'coaching' then 'Coaching call due: ' || short
                  else (case when c.kind = 'recognition' then 'Pass on kind words to ' else 'Coaching talk with ' end) || c.caregiver end,
    'detail', case when c.subject_type = 'office' or (calls_live and c.kind = 'coaching') then 'Open it on the Performance page.' else c.topic end, 'next_action', case when c.kind = 'recognition' then 'Tell them, then record it on the Performance page.' else 'Have the conversation, then record it on the Performance page.' end,
    'about', c.caregiver, 'owner', c.assigned_to, 'domain', 'caregiver_performance', 'urgency', case when c.priority = 'soon' then 'today' else 'normal' end,
    'status', case when c.status = 'open' then 'open' else 'done' end,
    'closed_at', case when c.status = 'open' then null else to_jsonb(now()) end,
    'closed_by', case when c.status = 'open' then null else to_jsonb('system'::text) end,
    'created_at', c.assigned_at, 'last_activity_at', now(), 'due', due, 'opened_by', 'system', 'link', '#hr/coaching'));
  perform public.hr_coaching_side_cards(c);
end $function$

;

CREATE OR REPLACE FUNCTION public.hr_coach_side_card(card_id text, c hr_coaching, owner_email text, title text, detail text, link text, urgency text, open boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare ex jsonb := (select e from public.app_data, jsonb_array_elements(data) e where key = 'ops_items' and e->>'id' = card_id limit 1);
begin
  if not open then
    if ex is null or ex->>'status' = 'done' then return; end if;
    perform public.upsert_app_data_item('ops_items', ex || jsonb_build_object('status', 'done', 'closed_at', now(), 'closed_by', 'system', 'last_activity_at', now()));
    return;
  end if;
  if ex is not null and ex->>'status' = 'open' then return; end if;
  perform public.upsert_app_data_item('ops_items', jsonb_build_object('id', card_id, 'kind', 'coaching', 'source_id', c.id::text, 'sensitive', true,
    'title', title, 'detail', detail, 'next_action', 'Open it on the Performance page.', 'about', public.hr_short_name(c.caregiver), 'owner', owner_email,
    'domain', 'caregiver_performance', 'urgency', urgency, 'status', 'open', 'created_at', now(), 'last_activity_at', now(), 'due', now(), 'opened_by', 'system', 'link', link));
end $function$

;

CREATE OR REPLACE FUNCTION public.hr_coaching_followthrough()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare c public.hr_coaching; live boolean := public.hr_calls_live(); today date := (now() at time zone 'America/Chicago')::date;
  zach text := public.hr_lead_email(); sam text := public.hr_decider_email(); n_late int := 0; n_late2 int := 0; n_check int := 0; n_notyet int := 0; coach text; rv jsonb;
begin
  if live then rv := public.hr_coaching_from_reviews(); end if;
  for c in select * from public.hr_coaching where kind = 'coaching' and status = 'open' and due_on < today loop
    coach := coalesce((select pe.full_name from public.persons pe where lower(pe.primary_email) = lower(c.assigned_to) limit 1), c.assigned_to);
    if c.escalated_zach_at is null then
      n_late := n_late + 1;
      if live then
        perform public.hr_coach_side_card('ops_coach_late_' || c.id, c, zach, 'Coaching overdue: ' || public.hr_short_name(c.caregiver),
          'Assigned to ' || split_part(coach, ' ', 1) || ', due ' || to_char(c.due_on, 'Mon FMDD') || '. See HR, Coaching oversight.', '#hr/oversight', 'today', true);
        update public.hr_coaching set escalated_zach_at = now() where id = c.id;
      end if;
    end if;
    if c.escalated_sam_at is null and public.hr_business_days(c.due_on, today) >= 3 then
      n_late2 := n_late2 + 1;
      if live then
        perform public.hr_coach_side_card('ops_coach_late2_' || c.id, c, sam, 'Coaching still overdue: ' || public.hr_short_name(c.caregiver),
          '3 business days past due (' || to_char(c.due_on, 'Mon FMDD') || '). Assigned to ' || split_part(coach, ' ', 1) || '; Zach was told. See HR, Coaching oversight.', '#hr/oversight', 'today', true);
        update public.hr_coaching set escalated_sam_at = now() where id = c.id;
      end if;
    end if;
  end loop;
  for c in select * from public.hr_coaching where kind = 'coaching' and status = 'done' and improved is null and check_on is not null and check_on <= today and check_card_at is null loop
    n_check := n_check + 1;
    if live then
      perform public.hr_coach_side_card('ops_coach_check_' || c.id, c, c.assigned_to, 'Did it improve? ' || public.hr_short_name(c.caregiver),
        'The follow-up check for a coaching talk on ' || to_char(c.held_on, 'Mon FMDD') || '. Answer it on Performance, Coaching.', '#hr/coaching', 'normal', true);
      update public.hr_coaching set check_card_at = now() where id = c.id;
    end if;
  end loop;
  for c in select * from public.hr_coaching where kind = 'coaching' and improved = false and notyet_card_at is null loop
    n_notyet := n_notyet + 1;
    if live then
      perform public.hr_coach_side_card('ops_coach_notyet_' || c.id, c, zach, 'Coaching did not help yet: ' || public.hr_short_name(c.caregiver),
        'The coach says it is still happening after the follow-up check. Decide the next step on Performance.', '#hr/oversight', 'normal', true);
      update public.hr_coaching set notyet_card_at = now() where id = c.id;
    end if;
  end loop;
  return jsonb_build_object('live', live, 'overdue_to_zach', n_late, 'overdue_to_samantha', n_late2, 'checks', n_check, 'not_yet_to_zach', n_notyet, 'reviews', rv);
end $function$

;

CREATE OR REPLACE FUNCTION public.hr_sop_reminders()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
end $function$

;
