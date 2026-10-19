-- =============================================================================
-- hr_coaching_office_script.sql · THE OFFICE COACHING SCRIPT (Samantha 2026-10-18: "The office coaching script is
-- approved. Make the changes that go with it." The script: plan doc f9223573, tab "Coaching call papers", part 2).
-- Installed by Desktop step 998 (office_script_998.py). Safe to run again.
--   · hr_office_script(review, coach first name, employee first name, check date): the approved script as talking
--     points, filled in from the team review (the follow-ups with their days and families), with the STOP and NOTE
--     markers the HR page already shows (STOP boxes; gray notes for the coach, not said out loud), the note for the
--     cause chosen in the review, and the review's plan as a note.
--   · office coaching records are made with it (hr_coaching_from_reviews, from part C3).
--   · completing office coaching never asks for the write-up warning tick (hr_coaching_act); caregiver coaching does,
--     as before. All of it still waits for ops_settings.hr_coaching_calls_live.
-- =============================================================================
create or replace function public.hr_office_script(r jsonb, coach text, person text, check_on date) returns text
language plpgsql stable set search_path = pg_catalog, public as $f$
declare stop text := '[STOP: let them answer. Write down what they say.]'; facts text; cause text := coalesce(r->>'cause', ''); plan text := btrim(coalesce(r->'coaching'->>'plan', ''));
begin
  select string_agg(
      case i->>'kind' when 'first_call' then 'the first call' when 'second_try' then 'the second try' when 'relationship_call' then 'a relationship call'
        when 'call_back' then 'a promised call back' when 'follow_up' then 'a follow-up' when 'check_back' then 'a check-back' else replace(coalesce(i->>'kind', 'a follow-up'), '_', ' ') end
      || coalesce(' for ' || nullif(i->>'client', ''), '') || coalesce(' (' || to_char(nullif(i->>'day', '')::date, 'Mon FMDD') || ')', ''), '; ')
    into facts from jsonb_array_elements(coalesce(r->'items', '[]'::jsonb)) i;
  return 'Hi ' || coalesce(nullif(person, ''), 'there') || ', it''s ' || coalesce(nullif(coach, ''), 'Zach') || '. This call is being recorded for our coaching records. Is now still a good time?'
    || E'\n\nThis is a coaching call, not discipline. A few follow-ups slipped this month, and I''d like us to figure out together what would help.'
    || E'\n\nHere is what I''m seeing: ' || coalesce(facts, 'the follow-ups in the review') || '.'
    || E'\n\nWhen a follow-up slips, a family waits for a call we promised them, and a family who was ready to start care can go somewhere else.'
    || E'\n\nWhat has been getting in the way? ' || stop
    || E'\n\nWhat would help most: a different way to plan your day, a refresher on the lead steps, or moving some of your work to someone else for a while? ' || stop
    || E'\n\nGoing forward, every follow-up is either done or moved to a new date with a note by the time it is due.'
    || E'\n\nI''ll check in with you on ' || to_char(check_on, 'FMMonth FMDD') || '. Thank you for talking this through with me.'
    || case cause when 'workload' then E'\n\n[NOTE: The review says workload. Agree what comes off their plate before the call ends, and who takes it.]'
                  when 'training' then E'\n\n[NOTE: The review says training. Book the refresher before the call ends, with a date.]'
                  when 'accountability' then E'\n\n[NOTE: The review says accountability. Keep it about the dates, never "always" or "never". Ask what they will do differently.]'
                  else '' end
    || case when plan <> '' then E'\n\n[NOTE: The plan from the review: ' || replace(plan, ']', ')') || ']' else '' end;
end $f$;
revoke all on function public.hr_office_script(jsonb, text, text, date) from public, anon, authenticated;

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
          public.hr_office_script(r, split_part(coalesce((select pe.full_name from public.persons pe where lower(pe.primary_email) = owner_e limit 1), 'Zach'), ' ', 1),
            split_part(coalesce(who_n, r->>'person', ''), ' ', 1), dl + 30), owner_e, coalesce(r->>'decided_by', 'team review'), dl)
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

create or replace function public.hr_coaching_act(p_id uuid, p_action text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $f$
declare
  me text := lower(coalesce((select email from auth.users where id = auth.uid()), ''));
  is_owner boolean := public.desk_is_owner();
  is_cc boolean := public.hr_is_coordinator();
  c public.hr_coaching;
  k public.hr_cases;
  txt text;
  d date;
  today date := (now() at time zone 'America/Chicago')::date;
  t text := nullif(btrim(coalesce(p->>'reason', p->>'note', '')), '');
  calls_live boolean := coalesce((select (data->>'hr_coaching_calls_live') = 'true' from public.app_data where key = 'ops_settings'), false);
  cl public.hr_coaching_call;
  chk date;
begin
  if me = '' or not (is_owner or is_cc) then raise exception 'Only Samantha, Zach and the Care Coordinators can do this.'; end if;

  if p_action = 'assign' then
    if not is_owner then raise exception 'Only Samantha or Zach assigns coaching.'; end if;
    select * into k from public.hr_cases where id = p->>'case_id';
    if k.id is null then raise exception 'That case is not on file.'; end if;
    if k.kind not in ('coaching','recognition') then raise exception 'Only a coaching or recognition case is assigned to a coordinator. A recurring or serious case stays with Zach.'; end if;
    if exists (select 1 from public.hr_coaching where case_id = k.id) then raise exception 'This case is already assigned.'; end if;
    txt := lower(btrim(coalesce(p->>'assigned_to', '')));
    if not exists (select 1 from public.persons pe join public.staff_roles r on r.person_id = pe.person_id
                   where lower(pe.primary_email) = txt and pe.active and r.entity = 'cc_ihs' and r.role in ('care_coordinator','owner_admin')) then
      raise exception 'Coaching goes to a Care Coordinator (or an owner).'; end if;
    d := nullif(p->>'due_on', '')::date;
    if d is null or d < today or d > today + 30 then raise exception 'Pick a due date between today and 30 days from now.'; end if;
    insert into public.hr_coaching (case_id, axiscare_caregiver_id, caregiver, kind, topic, facts, handbook, talking_points, priority, assigned_to, assigned_by, due_on)
      values (k.id, k.axiscare_caregiver_id, k.caregiver, k.kind, k.title, k.facts, k.handbook, coalesce(p->>'talking_points', ''),
              case when p->>'priority' = 'soon' then 'soon' else 'normal' end, txt, me, d)
      returning * into c;
    update public.hr_cases set status = 'reviewed', updated_at = now() where id = k.id and status = 'open';
  else
    select * into c from public.hr_coaching where id = p_id for update;
    if c.id is null then raise exception 'That coaching record is not on file.'; end if;
    if p_action in ('done','help','postpone','flag_wrong','not_needed','handoff') then
      if c.status <> 'open' then raise exception 'This one is already closed.'; end if;
      if not is_owner and lower(c.assigned_to) <> me then raise exception 'This one is assigned to someone else.'; end if;
    end if;
    if p_action = 'done' and calls_live and c.kind = 'coaching' then
      /* COACHING CALLS (2026-10-18): complete only with a qualifying recorded call the manager confirmed (or Zach's exception
         for a phone-system failure) and the full write-up; the call date, length and method come from the call itself */
      select * into cl from public.hr_coaching_call where coaching_id = c.id and not practice and state in ('confirmed','exception') order by confirmed_at desc nulls last limit 1;
      if cl.id is null then raise exception 'This needs a recorded coaching call first: press Call now, then confirm the call once it is found.'; end if;
      if nullif(btrim(coalesce(p->>'discussed','')), '') is null or nullif(btrim(coalesce(p->>'expectation','')), '') is null
         or nullif(btrim(coalesce(p->>'help_agreed','')), '') is null or nullif(btrim(coalesce(p->>'followup','')), '') is null
         or nullif(btrim(coalesce(p->>'response','')), '') is null then
        raise exception 'Fill in the summary, their response, the expectations, the help agreed and the follow-up actions.'; end if;
      /* the warning is for caregiver coaching only; a team review (office coaching) is never discipline (her approval 2026-10-18) */
      if c.subject_type <> 'office' and coalesce(p->>'warning_given','') <> 'true' then raise exception 'Tick that you told them further issues lead to official write-ups.'; end if;
      d := coalesce((cl.call_at at time zone 'America/Chicago')::date, today);
      chk := coalesce(nullif(p->>'check_on','')::date, d + 30);
      if chk < today + 7 or chk > today + 90 then raise exception 'Pick a follow-up date between 1 week and 90 days from today.'; end if;
      update public.hr_coaching set status = 'done', held_on = d, method = 'phone', discussed = btrim(p->>'discussed'), response = btrim(p->>'response'),
        expectation = btrim(p->>'expectation'), help_agreed = btrim(p->>'help_agreed'), followup = btrim(p->>'followup'), warning_given = (c.subject_type <> 'office'), call_id = cl.id,
        closed_by = me, closed_at = now(), check_on = chk, updated_at = now() where id = c.id returning * into c;
    elsif p_action = 'done' then
      if nullif(btrim(coalesce(p->>'discussed','')), '') is null or nullif(btrim(coalesce(p->>'response','')), '') is null
         or nullif(btrim(coalesce(p->>'expectation','')), '') is null or nullif(p->>'held_on', '') is null or coalesce(p->>'method','') not in ('in_person','phone','video') then
        raise exception 'Fill in the date, how you talked, what you discussed, their response and what is expected.'; end if;
      d := (p->>'held_on')::date;
      if d > today or d < today - 30 then raise exception 'The conversation date has to be in the last 30 days.'; end if;
      update public.hr_coaching set status = 'done', held_on = d, method = p->>'method', discussed = btrim(p->>'discussed'), response = btrim(p->>'response'),
        expectation = btrim(p->>'expectation'), followup = nullif(btrim(coalesce(p->>'followup','')), ''), closed_by = me, closed_at = now(),
        check_on = case when c.kind = 'coaching' then d + 30 else null end, updated_at = now() where id = c.id returning * into c;
    elsif p_action = 'help' then
      if t is null then raise exception 'Say what you would like help with.'; end if;
      update public.hr_coaching set help_note = t, help_at = now(), help_reply = null, help_reply_by = null, help_reply_at = null, updated_at = now() where id = c.id returning * into c;
    elsif p_action = 'help_reply' then
      if not is_owner then raise exception 'Zach (or Samantha) answers a help request.'; end if;
      if t is null then raise exception 'Write your reply first.'; end if;
      update public.hr_coaching set help_reply = t, help_reply_by = me, help_reply_at = now(), updated_at = now() where id = c.id returning * into c;
    elsif p_action = 'postpone' then
      d := nullif(p->>'due_on', '')::date;
      if t is null then raise exception 'Say why it has to wait.'; end if;
      if d is null or d <= c.due_on or d > c.due_on + 14 then raise exception 'Pick a new date after the current one and within 2 weeks of it.'; end if;
      update public.hr_coaching set due_on = d, postpone_count = postpone_count + 1, updated_at = now() where id = c.id returning * into c;
    elsif p_action in ('flag_wrong','not_needed') then
      if t is null then raise exception 'Say why, so Zach can see it.'; end if;
      update public.hr_coaching set status = p_action, close_note = t, closed_by = me, closed_at = now(), updated_at = now() where id = c.id returning * into c;
    elsif p_action = 'handoff' then
      if t is null then raise exception 'Say why it should go to someone else.'; end if;
      update public.hr_coaching set handoff_note = t, handoff_at = now(), updated_at = now() where id = c.id returning * into c;
    elsif p_action = 'reassign' then
      if not is_owner then raise exception 'Only Samantha or Zach reassigns coaching.'; end if;
      txt := lower(btrim(coalesce(p->>'assigned_to', '')));
      if not exists (select 1 from public.persons pe join public.staff_roles r on r.person_id = pe.person_id
                     where lower(pe.primary_email) = txt and pe.active and r.entity = 'cc_ihs' and r.role in ('care_coordinator','owner_admin')) then
        raise exception 'Coaching goes to a Care Coordinator (or an owner).'; end if;
      update public.hr_coaching set assigned_to = txt, handoff_note = null, handoff_at = null, updated_at = now() where id = c.id returning * into c;
    elsif p_action = 'withdraw' then
      if not is_owner then raise exception 'Only Samantha or Zach withdraws coaching.'; end if;
      update public.hr_coaching set status = 'withdrawn', close_note = t, closed_by = me, closed_at = now(), updated_at = now() where id = c.id returning * into c;
    elsif p_action = 'improved' then
      if c.status <> 'done' or c.kind <> 'coaching' then raise exception 'Only a finished coaching talk gets a follow-up.'; end if;
      if p->>'improved' not in ('true','false') then raise exception 'Say whether it got better.'; end if;
      update public.hr_coaching set improved = (p->>'improved')::boolean, improved_note = t, improved_by = me, improved_at = now(), updated_at = now() where id = c.id returning * into c;
    else
      raise exception 'Unknown action.';
    end if;
  end if;
  insert into public.hr_coaching_log (coaching_id, by_email, action, detail) values (c.id, me, p_action, coalesce(p, '{}'::jsonb) - 'talking_points');
  perform public.hr_coaching_card(c);
  return to_jsonb(c);
end $f$;
revoke all on function public.hr_coaching_act(uuid, text, jsonb) from public, anon;
grant execute on function public.hr_coaching_act(uuid, text, jsonb) to authenticated;
