-- =============================================================================
-- hr_concerns.sql · TELL ZACH + NEW COACHING TALK (Samantha 2026-10-27: "build it: Tell Zach on the caregiver's
-- Performance tab for anyone in the office, and + New coaching talk for owners only. Coordinators ask, Zach decides.")
-- Installed by Desktop step 1151 (hr_concerns_1151.py). Safe to run again.
--   · hr_case_add({type:'concern', ...})   anyone in the office (owner, care or staffing coordinator) tells Zach about a
--     caregiver: an open hr_cases row (rule office_concern, kind recurring, or serious when they say so), never practice.
--     Only Samantha and Zach can read it (hr_cases row security, unchanged). Zach's alerts already count open recurring
--     and serious cases; a card goes on Zach's My Work.
--   · hr_case_add({type:'coaching', ...})  owners AND care coordinators (her change 2026-10-27: "care coordinators can
--     initiate a coaching call too!", e.g. a caregiver arranging days off with the family instead of the office): a
--     coaching case (rule owner_coaching) assigned in the same step. An owner's goes through hr_coaching_act('assign');
--     a coordinator's makes the same coaching record, log line and My Work card here (that door is owners only). Zach
--     sees every one on Coaching oversight.
--   · hr_case_decide(id, {decision})       owners only, on an office concern: coaching (assigned the same way), formal
--     (the Hub then opens the write-up draft), or nothing more (with why). Saved once; closes Zach's card.
-- =============================================================================
alter table public.hr_cases add column if not exists raised_by text;
alter table public.hr_cases add column if not exists raised_by_name text;
alter table public.hr_cases add column if not exists decision text;
alter table public.hr_cases add column if not exists decision_note text;
alter table public.hr_cases add column if not exists decided_by text;
alter table public.hr_cases add column if not exists decided_at timestamptz;

create or replace function public.hr_concern_card(k public.hr_cases) returns void
language plpgsql security definer set search_path = pg_catalog, public as $f$
declare done boolean := k.decided_at is not null or k.status <> 'open';
begin
  perform public.upsert_app_data_item('ops_items', jsonb_build_object(
    'id', 'ops_hrconcern_' || left(md5(k.id), 12), 'kind', 'hr_file', 'source_id', k.id, 'sensitive', true,
    'title', 'From the office: ' || public.hr_short_name(k.caregiver), 'about', public.hr_short_name(k.caregiver),
    'detail', 'Open it on Performance, Incidents and concerns.',
    'next_action', case when done then 'Decided: ' || coalesce(k.decision, 'closed') else 'Read what the office saw, then decide: a coaching talk, a formal case, or nothing more.' end,
    'owner', public.hr_lead_email(), 'domain', 'caregiver_performance', 'urgency', case when k.kind = 'serious' then 'urgent' else 'today' end,
    'status', case when done then 'done' else 'open' end,
    'closed_at', case when done then to_jsonb(now()) else null end, 'closed_by', case when done then to_jsonb(coalesce(k.decided_by, 'system')) else null end,
    'created_at', k.created_at, 'last_activity_at', now(), 'due', k.created_at + interval '2 days', 'opened_by', 'person', 'link', '#hr/incidents'));
end $f$;
revoke all on function public.hr_concern_card(public.hr_cases) from public, anon, authenticated;

create or replace function public.hr_case_add(p jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $f$
declare
  me text := lower(coalesce((select email from auth.users where id = auth.uid()), ''));
  my_name text;
  is_owner boolean := public.desk_is_owner();
  is_office boolean := public.desk_hub_ok() and exists (select 1 from public.staff_roles r where r.person_id = public.desk_me() and r.entity = 'cc_ihs'
                         and r.role in ('owner_admin','care_coordinator','staffing_coordinator'));
  typ text := coalesce(p->>'type', '');
  cg text := regexp_replace(btrim(coalesce(p->>'caregiver', '')), '\s+', ' ', 'g');
  what text := replace(btrim(coalesce(p->>'what', '')), '—', ',');
  topic text := replace(btrim(coalesce(p->>'topic', '')), '—', ',');
  d date;
  today date := (now() at time zone 'America/Chicago')::date;
  k public.hr_cases;
  r jsonb;
  c public.hr_coaching;
  to_e text;
  due date;
begin
  if me = '' or not is_office then raise exception 'Only the office can do this.'; end if;
  if typ not in ('concern','coaching') then raise exception 'Say whether this is a concern for Zach or a coaching talk.'; end if;
  if typ = 'coaching' and not (is_owner or public.hr_is_coordinator()) then raise exception 'Only Samantha, Zach or a Care Coordinator starts a coaching talk. Use Tell Zach instead.'; end if;
  if cg !~ '^\S+( \S+)+$' then raise exception 'Pick the caregiver (first and last name).'; end if;
  if length(cg) > 120 then raise exception 'That name is too long.'; end if;
  if length(what) < 15 then raise exception 'Say what happened (a sentence or more).'; end if;
  if length(what) > 2000 then raise exception 'Keep it under 2,000 characters.'; end if;
  begin d := nullif(p->>'happened_on', '')::date; exception when others then d := null; end;
  if d is null or d > today or d < today - 120 then raise exception 'Pick the day it happened (in the last 4 months).'; end if;
  select pe.full_name into my_name from public.persons pe where pe.person_id = public.desk_me();
  if typ = 'concern' then
    insert into public.hr_cases (id, axiscare_caregiver_id, caregiver, kind, rule, title, facts, practice, status, raised_by, raised_by_name)
      values ('office_' || gen_random_uuid(), left(btrim(coalesce(p->>'axiscare_id', '')), 40), cg, case when p->>'serious' = 'true' then 'serious' else 'recurring' end,
              'office_concern', left(regexp_replace(what, '\s+', ' ', 'g'), 90), jsonb_build_array(jsonb_build_object('date', d::text, 'what', what, 'by', coalesce(my_name, me))),
              false, 'open', me, coalesce(my_name, me))
      returning * into k;
    perform public.hr_concern_card(k);
    return jsonb_build_object('ok', true, 'id', k.id, 'kind', k.kind);
  end if;
  if length(topic) < 3 then raise exception 'Say what the talk is about.'; end if;
  insert into public.hr_cases (id, axiscare_caregiver_id, caregiver, kind, rule, title, facts, practice, status, raised_by, raised_by_name, decision, decided_by, decided_at)
    values ('owner_' || gen_random_uuid(), left(btrim(coalesce(p->>'axiscare_id', '')), 40), cg, 'coaching', 'owner_coaching', left(topic, 120),
            jsonb_build_array(jsonb_build_object('date', d::text, 'what', what, 'by', coalesce(my_name, me))), false, 'open', me, coalesce(my_name, me), 'coaching', me, now())
    returning * into k;
  if is_owner then
    r := public.hr_coaching_act(null, 'assign', jsonb_build_object('case_id', k.id, 'assigned_to', p->>'assigned_to', 'due_on', p->>'due_on',
           'priority', p->>'priority', 'talking_points', p->>'talking_points'));
    return jsonb_build_object('ok', true, 'id', k.id, 'assigned', r);
  end if;
  /* a Care Coordinator: the same checks and record as hr_coaching_act('assign') */
  to_e := lower(btrim(coalesce(p->>'assigned_to', '')));
  if not exists (select 1 from public.persons pe join public.staff_roles sr on sr.person_id = pe.person_id
                 where lower(pe.primary_email) = to_e and pe.active and sr.entity = 'cc_ihs' and sr.role in ('care_coordinator','owner_admin')) then
    raise exception 'Coaching goes to a Care Coordinator (or an owner).'; end if;
  begin due := nullif(p->>'due_on', '')::date; exception when others then due := null; end;
  if due is null or due < today or due > today + 30 then raise exception 'Pick a due date between today and 30 days from now.'; end if;
  insert into public.hr_coaching (case_id, axiscare_caregiver_id, caregiver, kind, topic, facts, handbook, talking_points, priority, assigned_to, assigned_by, due_on)
    values (k.id, k.axiscare_caregiver_id, k.caregiver, 'coaching', k.title, k.facts, '', coalesce(p->>'talking_points', ''),
            case when p->>'priority' = 'soon' then 'soon' else 'normal' end, to_e, me, due)
    returning * into c;
  update public.hr_cases set status = 'reviewed', updated_at = now() where id = k.id;
  insert into public.hr_coaching_log (coaching_id, by_email, action, detail) values (c.id, me, 'assign', (p - 'talking_points') || jsonb_build_object('started_by', 'coordinator'));
  perform public.hr_coaching_card(c);
  return jsonb_build_object('ok', true, 'id', k.id, 'assigned', to_jsonb(c));
end $f$;
revoke all on function public.hr_case_add(jsonb) from public, anon;
grant execute on function public.hr_case_add(jsonb) to authenticated;

create or replace function public.hr_case_decide(p_id text, p jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $f$
declare
  me text := lower(coalesce((select email from auth.users where id = auth.uid()), ''));
  dec text := coalesce(p->>'decision', '');
  note text := replace(btrim(coalesce(p->>'note', '')), '—', ',');
  k public.hr_cases;
  r jsonb;
begin
  if me = '' or not public.desk_is_owner() then raise exception 'Only Samantha or Zach decides this.'; end if;
  select * into k from public.hr_cases where id = p_id for update;
  if k.id is null or k.rule <> 'office_concern' then raise exception 'That concern is not on file.'; end if;
  if k.decided_at is not null then raise exception 'Already decided by %.', k.decided_by; end if;
  if dec not in ('coaching','formal','nothing') then raise exception 'Pick a coaching talk, a formal case, or nothing more.'; end if;
  if dec = 'nothing' and length(note) < 5 then raise exception 'Say why nothing more is needed.'; end if;
  update public.hr_cases set decision = dec, decision_note = nullif(note, ''), decided_by = me, decided_at = now(), updated_at = now(),
    kind = case when dec = 'coaching' then 'coaching' else kind end,
    status = case when dec = 'nothing' then 'dismissed' when dec = 'formal' then 'reviewed' else status end
    where id = k.id returning * into k;
  if dec = 'coaching' then
    r := public.hr_coaching_act(null, 'assign', jsonb_build_object('case_id', k.id, 'assigned_to', p->>'assigned_to', 'due_on', p->>'due_on',
           'priority', p->>'priority', 'talking_points', p->>'talking_points'));
  end if;
  select * into k from public.hr_cases where id = p_id;
  perform public.hr_concern_card(k);
  return jsonb_build_object('ok', true, 'decision', dec, 'assigned', r);
end $f$;
revoke all on function public.hr_case_decide(text, jsonb) from public, anon;
grant execute on function public.hr_case_decide(text, jsonb) to authenticated;

do $v$ begin
  if has_function_privilege('anon', 'public.hr_case_add(jsonb)', 'execute') or has_function_privilege('anon', 'public.hr_case_decide(text, jsonb)', 'execute') then
    raise exception 'hr_concerns self-check: the public key could call these'; end if;
  if has_table_privilege('authenticated', 'public.hr_cases', 'insert') then raise exception 'hr_concerns self-check: a signed-in page could add cases directly'; end if;
end $v$;
