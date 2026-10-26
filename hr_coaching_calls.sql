-- =============================================================================
-- hr_coaching_calls.sql · COACHING BY RECORDED PHONE CALL, part C1 (Samantha 2026-10-18: "Start the coaching calls build")
-- Installed by Desktop step 969 (coaching_calls_969.py). Safe to run again. Design: doc "Care Coordinator Leads and Bonus",
-- tab "Coaching calls (proposal)"; her choices: the safer matching with the manager's pick list as the backup, and the
-- tab's recommended defaults (3 minutes; no recording = doesn't count, Zach may excuse a phone-system failure with a
-- reason; a private copy of the audio; overdue to Zach, then Samantha 3 business days later; notice before recording).
-- STAYS OFF until ops_settings.hr_coaching_calls_live is true, after her two gates (who can hear calls inside
-- GoHighLevel, and the employee notice checked by an attorney). Until then only Samantha and Zach can try it, in
-- practice, and coaching completes exactly as today.
--   hr_coaching_call  one row per Call now tap (and per call picked from the list): the tap, the call GoHighLevel logged
--                     (its message id is the call id, one coaching record per call), its facts, whether the recording
--                     came back, whether it qualifies and why not, the manager's confirmation, Zach's exception, and the
--                     private copy of the audio. Server only (the hr-coach-call function is the door). Never deleted.
--   bucket hr-audio   PRIVATE audio copies; never deleted, moved or renamed.
--   hr_coaching       + help_agreed, warning_given, call_id; hr_coaching_act's done needs a confirmed call and the full
--                     write-up once it is live; the My Work card shows "Coaching call due" and first name + last initial.
-- =============================================================================
create table if not exists public.hr_coaching_call (
  id uuid primary key default gen_random_uuid(),
  coaching_id uuid not null references public.hr_coaching(id),
  practice boolean not null default true,
  matched_by text not null check (matched_by in ('tap', 'pick')),
  tapped_by text not null,
  tap_at timestamptz,
  ghl_contact_id text,
  phone_digits text,
  ghl_user_id text,
  ghl_message_id text unique,
  call_at timestamptz,
  seconds int,
  call_status text,
  direction text,
  recording_ok boolean,
  recording_checked_at timestamptz,
  state text not null default 'waiting' check (state in ('waiting', 'no_call', 'attempt', 'qualifies', 'confirmed', 'exception', 'cancelled')),
  reason text,
  confirmed_by text,
  confirmed_at timestamptz,
  exception_by text,
  exception_reason text,
  audio_path text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists hr_coaching_call_coaching on public.hr_coaching_call (coaching_id, created_at);
create index if not exists hr_coaching_call_tap on public.hr_coaching_call (tap_at);
comment on table public.hr_coaching_call is '969 (2026-10-18): coaching calls (tap, the GoHighLevel call, qualifies or why not, confirmation). Server only. Never deleted.';
create or replace function public.hr_coaching_call_guard() returns trigger
language plpgsql set search_path = pg_catalog, public as $g$
begin
  if tg_op = 'DELETE' then raise exception 'Coaching call records are kept and cannot be deleted.' using errcode = '42501'; end if;
  if new.coaching_id is distinct from old.coaching_id or new.practice is distinct from old.practice then raise exception 'A coaching call cannot move to another record.' using errcode = '42501'; end if;
  if old.ghl_message_id is not null and new.ghl_message_id is distinct from old.ghl_message_id then raise exception 'A linked call cannot be changed.' using errcode = '42501'; end if;
  if old.state in ('confirmed', 'exception') and (new.state is distinct from old.state or new.audio_path is distinct from old.audio_path and old.audio_path is not null) then
    raise exception 'A confirmed coaching call cannot be changed.' using errcode = '42501'; end if;
  new.updated_at := now();
  return new;
end $g$;
drop trigger if exists hr_coaching_call_guard_u on public.hr_coaching_call;
create trigger hr_coaching_call_guard_u before update on public.hr_coaching_call for each row execute function public.hr_coaching_call_guard();
drop trigger if exists hr_coaching_call_guard_d on public.hr_coaching_call;
create trigger hr_coaching_call_guard_d before delete on public.hr_coaching_call for each row execute function public.hr_coaching_call_guard();
alter table public.hr_coaching_call enable row level security;
revoke all privileges on table public.hr_coaching_call from anon, authenticated;
grant all on public.hr_coaching_call to service_role;

alter table public.hr_coaching add column if not exists help_agreed text;
alter table public.hr_coaching add column if not exists warning_given boolean;
alter table public.hr_coaching add column if not exists call_id uuid references public.hr_coaching_call(id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hr-audio', 'hr-audio', false, 52428800, array['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/ogg', 'audio/webm', 'application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create or replace function public.hr_audio_keep() returns trigger
language plpgsql set search_path = pg_catalog, public as $k$
begin
  if coalesce(current_setting('cc.retention_purge', true), '') = 'on' then return case when tg_op = 'DELETE' then old else new end; end if;
  if old.bucket_id = 'hr-audio' then
    if tg_op = 'DELETE' then raise exception 'Coaching call recordings are kept and cannot be deleted (%).', old.name using errcode = '42501';
    elsif new.bucket_id is distinct from old.bucket_id or new.name is distinct from old.name then raise exception 'Coaching call recordings cannot be moved or renamed (%).', old.name using errcode = '42501'; end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $k$;
drop trigger if exists hr_audio_keep on storage.objects;
create trigger hr_audio_keep before delete or update on storage.objects for each row when (old.bucket_id = 'hr-audio') execute function public.hr_audio_keep();

create or replace function public.hr_coaching_card(c public.hr_coaching) returns void
language plpgsql security definer set search_path = pg_catalog, public as $f$
declare due timestamptz := (c.due_on::text || ' 17:00')::timestamp at time zone 'America/Chicago';
  /* COACHING CALLS (2026-10-18): once they are switched on, the office-visible card names first name + last initial only */
  calls_live boolean := coalesce((select (data->>'hr_coaching_calls_live') = 'true' from public.app_data where key = 'ops_settings'), false);
  short text := split_part(btrim(c.caregiver), ' ', 1) || coalesce(' ' || nullif(left(regexp_replace(btrim(c.caregiver), '^.*\s', ''), 1), split_part(btrim(c.caregiver), ' ', 1)) || '.', '');
begin
  perform public.upsert_app_data_item('ops_items', jsonb_build_object(
    'id', 'ops_coach_' || c.id, 'kind', 'coaching', 'source_id', c.id::text, 'sensitive', false,
    'title', case when calls_live and c.kind = 'coaching' then 'Coaching call due: ' || short
                  else (case when c.kind = 'recognition' then 'Pass on kind words to ' else 'Coaching talk with ' end) || c.caregiver end,
    'detail', case when calls_live and c.kind = 'coaching' then 'Open it on the Performance page.' else c.topic end, 'next_action', case when c.kind = 'recognition' then 'Tell them, then record it on the Performance page.' else 'Have the conversation, then record it on the Performance page.' end,
    'about', c.caregiver, 'owner', c.assigned_to, 'domain', 'caregiver_performance', 'urgency', case when c.priority = 'soon' then 'today' else 'normal' end,
    'status', case when c.status = 'open' then 'open' else 'done' end,
    'closed_at', case when c.status = 'open' then null else to_jsonb(now()) end,
    'closed_by', case when c.status = 'open' then null else to_jsonb('system'::text) end,
    'created_at', c.assigned_at, 'last_activity_at', now(), 'due', due, 'opened_by', 'system', 'link', '#hr/coaching'));
end $f$;
revoke all on function public.hr_coaching_card(public.hr_coaching) from public, anon, authenticated;

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
      if coalesce(p->>'warning_given','') <> 'true' then raise exception 'Tick that you told them further issues lead to official write-ups.'; end if;
      d := coalesce((cl.call_at at time zone 'America/Chicago')::date, today);
      chk := coalesce(nullif(p->>'check_on','')::date, d + 30);
      if chk < today + 7 or chk > today + 90 then raise exception 'Pick a follow-up date between 1 week and 90 days from today.'; end if;
      update public.hr_coaching set status = 'done', held_on = d, method = 'phone', discussed = btrim(p->>'discussed'), response = btrim(p->>'response'),
        expectation = btrim(p->>'expectation'), help_agreed = btrim(p->>'help_agreed'), followup = btrim(p->>'followup'), warning_given = true, call_id = cl.id,
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
