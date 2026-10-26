-- =============================================================================
-- hr_coaching_c3.sql · COACHING CALLS, part C3 (Samantha 2026-10-18: "Start coaching calls part 3: overdue escalation,
-- the follow-up check and office coaching"). Installed by Desktop step 970 (coaching_calls_970.py). Safe to run again.
-- Design: doc "Care Coordinator Leads and Bonus", tab "Coaching calls (proposal)", decisions 5 and 7 (defaults).
--   OVERDUE: past its due day, Zach gets a My Work card; 3 business days later, Samantha does. Both close themselves
--            when the coaching closes.
--   FOLLOW-UP CHECK: on the check date the card comes back to the coach ("did it improve?"); "not yet" puts a card on
--            Zach's My Work. Closes itself when answered.
--   OFFICE COACHING (one system, decision 7): a team review (Stage 5, app_data cc_reviews) decided as Coaching becomes a
--            coaching record of type office, coached by an owner (the review's coaching owner, else Zach), seen by
--            Samantha and Zach only (coordinators never see office rows). Finishing it here closes the review (only if
--            it is still in coaching); finishing it on the Team page closes the record here. Agreed with the Stage 5
--            session (2026-10-18): the review shape, the history entry form and its 30 cap, 'done' as the only status.
-- Every card here is sensitive (owners and the card's owner only). It all waits for ops_settings.hr_coaching_calls_live:
-- until then the daily run only counts what it would do, and no office record is made.
-- =============================================================================
alter table public.hr_coaching alter column axiscare_caregiver_id drop not null;
alter table public.hr_coaching add column if not exists subject_type text not null default 'caregiver';
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'hr_coaching_subject_type_check') then
    alter table public.hr_coaching add constraint hr_coaching_subject_type_check check (subject_type in ('caregiver', 'office')); end if;
end $c$;
alter table public.hr_coaching add column if not exists subject_email text;
alter table public.hr_coaching add column if not exists review_id text;
create unique index if not exists hr_coaching_review on public.hr_coaching (review_id) where review_id is not null;
alter table public.hr_coaching add column if not exists escalated_zach_at timestamptz;
alter table public.hr_coaching add column if not exists escalated_sam_at timestamptz;
alter table public.hr_coaching add column if not exists check_card_at timestamptz;
alter table public.hr_coaching add column if not exists notyet_card_at timestamptz;

/* office rows are for Samantha and Zach only */
drop policy if exists hr_coaching_read on public.hr_coaching;
create policy hr_coaching_read on public.hr_coaching for select to authenticated
  using (public.desk_is_owner() or (public.hr_is_coordinator() and subject_type = 'caregiver'));
drop policy if exists hr_coaching_log_read on public.hr_coaching_log;
create policy hr_coaching_log_read on public.hr_coaching_log for select to authenticated
  using (public.desk_is_owner() or (public.hr_is_coordinator() and exists (select 1 from public.hr_coaching c where c.id = coaching_id and c.subject_type = 'caregiver')));

create or replace function public.hr_calls_live() returns boolean language sql stable security definer set search_path = pg_catalog, public as $f$
  select coalesce((select (data->>'hr_coaching_calls_live') = 'true' from public.app_data where key = 'ops_settings'), false) $f$;
create or replace function public.hr_lead_email() returns text language sql stable security definer set search_path = pg_catalog, public as $f$
  select coalesce(nullif(lower(btrim((select data->'team'->>'hr_lead' from public.app_data where key = 'ops_settings'))), ''), 'zach@mo-care.com') $f$;
create or replace function public.hr_decider_email() returns text language sql stable security definer set search_path = pg_catalog, public as $f$
  select coalesce(nullif(lower(btrim((select data->'bonus'->>'decider' from public.app_data where key = 'ops_settings'))), ''), 'samantha@mo-care.com') $f$;
create or replace function public.hr_short_name(n text) returns text language sql immutable set search_path = pg_catalog as $f$
  select split_part(btrim(coalesce(n, '')), ' ', 1) || coalesce(' ' || nullif(left(regexp_replace(btrim(coalesce(n, '')), '^.*\s', ''), 1), split_part(btrim(coalesce(n, '')), ' ', 1)) || '.', '') $f$;
create or replace function public.hr_business_days(a date, b date) returns int language sql immutable set search_path = pg_catalog as $f$
  select count(*)::int from generate_series(a + 1, b, interval '1 day') d where extract(isodow from d) < 6 $f$;

/* one My Work card for the follow-through: made open, or closed if it exists. Sensitive: owners and its owner only. */
create or replace function public.hr_coach_side_card(card_id text, c public.hr_coaching, owner_email text, title text, detail text, link text, urgency text, open boolean) returns void
language plpgsql security definer set search_path = pg_catalog, public as $f$
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
end $f$;
revoke all on function public.hr_coach_side_card(text, public.hr_coaching, text, text, text, text, text, boolean) from public, anon, authenticated;

/* the follow-through cards that no longer apply close themselves (called from hr_coaching_card after every change) */
create or replace function public.hr_coaching_side_cards(c public.hr_coaching) returns void
language plpgsql security definer set search_path = pg_catalog, public as $f$
begin
  if c.status <> 'open' then
    perform public.hr_coach_side_card('ops_coach_late_' || c.id, c, null, null, null, null, null, false);
    perform public.hr_coach_side_card('ops_coach_late2_' || c.id, c, null, null, null, null, null, false);
  end if;
  if c.improved is not null or c.status <> 'done' then perform public.hr_coach_side_card('ops_coach_check_' || c.id, c, null, null, null, null, null, false); end if;
end $f$;
revoke all on function public.hr_coaching_side_cards(public.hr_coaching) from public, anon, authenticated;

create or replace function public.hr_coaching_card(c public.hr_coaching) returns void
language plpgsql security definer set search_path = pg_catalog, public as $f$
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
end $f$;
revoke all on function public.hr_coaching_card(public.hr_coaching) from public, anon, authenticated;

/* ── OFFICE COACHING from a team review (both directions) ── */
create or replace function public.hr_coaching_from_reviews() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $f$
declare r jsonb; c public.hr_coaching; made int := 0; closed int := 0; owner_e text; who_e text; who_n text; staff jsonb; dl date;
begin
  if not public.hr_calls_live() then return jsonb_build_object('live', false); end if;
  staff := coalesce((select data from public.app_data where key = 'coordinator_staff'), '[]'::jsonb);
  for r in select x from public.app_data, jsonb_array_elements(case when jsonb_typeof(data) = 'array' then data else '[]'::jsonb end) x where key = 'cc_reviews' loop
    select * into c from public.hr_coaching where review_id = r->>'id';
    if r->>'status' = 'coaching' and c.id is null then
      /* the person: a Care Coordinator's first name on the review, matched to the staff list by first name (team-rules same()) */
      select lower(s->>'email'), s->>'name' into who_e, who_n from jsonb_array_elements(staff) s
        where lower(split_part(btrim(coalesce(s->>'name', '')), ' ', 1)) = lower(split_part(btrim(coalesce(r->>'person', '')), ' ', 1)) limit 1;
      owner_e := lower(btrim(coalesce(r->'coaching'->>'owner', '')));
      if not exists (select 1 from public.persons pe join public.staff_roles sr on sr.person_id = pe.person_id
                     where lower(pe.primary_email) = owner_e and pe.active and sr.entity = 'cc_ihs' and sr.role = 'owner_admin') then owner_e := public.hr_lead_email(); end if;
      dl := coalesce(nullif(r->'coaching'->>'deadline', '')::date, (now() at time zone 'America/Chicago')::date + 7);
      insert into public.hr_coaching (subject_type, subject_email, review_id, caregiver, kind, topic, facts, talking_points, assigned_to, assigned_by, due_on)
        values ('office', who_e, r->>'id', coalesce(who_n, r->>'person', 'A Care Coordinator'), 'coaching', 'Follow-ups went overdue',
          coalesce((select jsonb_agg(jsonb_build_object('date', i->>'day', 'what', coalesce(i->>'kind', '') || coalesce(': ' || nullif(i->>'client', ''), ''))) from jsonb_array_elements(coalesce(r->'items', '[]'::jsonb)) i), '[]'::jsonb),
          coalesce(r->'coaching'->>'plan', ''), owner_e, coalesce(r->>'decided_by', 'team review'), dl)
        returning * into c;
      insert into public.hr_coaching_log (coaching_id, by_email, action, detail) values (c.id, 'system', 'from_review', jsonb_build_object('review_id', r->>'id'));
      perform public.hr_coaching_card(c);
      made := made + 1;
    elsif r->>'status' <> 'coaching' and c.id is not null and c.status = 'open' then
      /* finished on the Team page (or no longer coaching): this record closes too, never left as an overdue HR item */
      update public.hr_coaching set status = case when r->>'status' = 'done' then 'done' else 'withdrawn' end,
        discussed = case when r->>'status' = 'done' then coalesce(nullif(r->'coaching'->>'done_note', ''), 'Finished on the Team page.') else discussed end,
        held_on = case when r->>'status' = 'done' then coalesce(nullif(left(r->'coaching'->>'done_at', 10), '')::date, (now() at time zone 'America/Chicago')::date) else held_on end,
        close_note = 'Finished on the Team page.', closed_by = coalesce(r->'coaching'->>'done_by', 'team review'), closed_at = now(), updated_at = now()
        where id = c.id and status = 'open' returning * into c;
      insert into public.hr_coaching_log (coaching_id, by_email, action, detail) values (c.id, 'system', 'closed_from_review', jsonb_build_object('review_status', r->>'status'));
      perform public.hr_coaching_card(c);
      closed := closed + 1;
    end if;
  end loop;
  return jsonb_build_object('live', true, 'made', made, 'closed', closed);
end $f$;
revoke all on function public.hr_coaching_from_reviews() from public, anon, authenticated;

create or replace function public.hr_reviews_to_coaching() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $f$
begin perform public.hr_coaching_from_reviews(); return new; end $f$;
revoke all on function public.hr_reviews_to_coaching() from public, anon, authenticated;
drop trigger if exists hr_reviews_to_coaching on public.app_data;
create trigger hr_reviews_to_coaching after insert or update of data on public.app_data
  for each row when (new.key = 'cc_reviews') execute function public.hr_reviews_to_coaching();

/* finished here: the review closes too, only if it is still in coaching (never over a decision made since) */
create or replace function public.hr_coaching_to_review() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $f$
declare r jsonb; who text;
begin
  if new.subject_type <> 'office' or new.review_id is null or new.status <> 'done' or old.status = 'done' then return new; end if;
  select x into r from public.app_data, jsonb_array_elements(case when jsonb_typeof(data) = 'array' then data else '[]'::jsonb end) x where key = 'cc_reviews' and x->>'id' = new.review_id;
  if r is null or r->>'status' <> 'coaching' then return new; end if;
  who := coalesce((select pe.full_name from public.persons pe where lower(pe.primary_email) = lower(new.closed_by) limit 1), '');
  r := r || jsonb_build_object('status', 'done',
    'coaching', coalesce(r->'coaching', '{}'::jsonb) || jsonb_build_object('done_at', to_jsonb(now()), 'done_by', lower(coalesce(new.closed_by, '')), 'done_note', left(coalesce(new.discussed, ''), 400)),
    'history', (select coalesce(jsonb_agg(h order by n), '[]'::jsonb) from (
       select h, n from jsonb_array_elements(coalesce(r->'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', to_jsonb(now()), 'by', lower(coalesce(new.closed_by, '')), 'by_name', who,
         'action', 'coaching_done', 'from', 'coaching', 'to', 'done', 'why', left(coalesce(new.discussed, ''), 400)))) with ordinality t(h, n)
       order by n desc limit 30) z));
  perform public.upsert_app_data_item('cc_reviews', r);
  return new;
end $f$;
revoke all on function public.hr_coaching_to_review() from public, anon, authenticated;
drop trigger if exists hr_coaching_to_review on public.hr_coaching;
create trigger hr_coaching_to_review after update of status on public.hr_coaching for each row execute function public.hr_coaching_to_review();

/* ── THE DAILY FOLLOW-THROUGH (8:05 Central): overdue to Zach, then Samantha; the 30-day check; "not yet" to Zach ── */
create or replace function public.hr_coaching_followthrough() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $f$
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
end $f$;
revoke all on function public.hr_coaching_followthrough() from public, anon, authenticated;
