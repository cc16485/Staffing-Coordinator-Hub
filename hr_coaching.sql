-- =============================================================================
-- hr_coaching.sql · THE COACHING TRACKER (HR Agent build step 5, Samantha 2026-10-18: "go on to step 5")
-- Installed by Desktop step 961 (hr_coaching_961.py). Safe to run again.
--   hr_coaching      one coaching conversation (or a compliment to pass on) assigned to a Care Coordinator
--   hr_coaching_log  every action on it: who, when, what (the audit trail)
--   hr_coaching_act  the ONLY way a page changes either: it checks who is asking and what they may do
-- Who may do what (decisions 2, 3 and 8):
--   · Samantha and Zach (owner_admin) assign coaching, reassign, reply to a help request, withdraw, and do anything a
--     coordinator can.
--   · A Care Coordinator reads every coaching record (they share all caregivers) and, on one assigned to them, records
--     the conversation, asks for help, postpones (with a reason), says the flag is wrong, says coaching isn't right
--     here, or asks to hand it to someone else. The owner of a task never changes unless an owner reassigns it.
--   · Nobody else reads anything here. No signed-in page can write a table directly.
-- Each change also keeps the person's My Work card current (app_data ops_items, kind 'coaching').
-- Nothing here texts, emails or calls anyone.
-- =============================================================================
create or replace function public.hr_is_coordinator() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $f$
  select public.desk_hub_ok() and exists (select 1 from public.staff_roles r where r.person_id = public.desk_me() and r.entity = 'cc_ihs' and r.role = 'care_coordinator')
$f$;
comment on function public.hr_is_coordinator() is '961 (2026-10-18): the caller holds the care_coordinator role.';

create table if not exists public.hr_coaching (
  id uuid primary key default gen_random_uuid(),
  case_id text unique references public.hr_cases(id),
  axiscare_caregiver_id text not null,
  caregiver text not null,
  kind text not null default 'coaching' check (kind in ('coaching','recognition')),
  topic text not null,
  facts jsonb not null default '[]'::jsonb,
  handbook text not null default '',
  talking_points text not null default '',
  priority text not null default 'normal' check (priority in ('normal','soon')),
  assigned_to text not null,
  assigned_by text not null,
  assigned_at timestamptz not null default now(),
  due_on date not null,
  status text not null default 'open' check (status in ('open','done','flag_wrong','not_needed','withdrawn')),
  postpone_count int not null default 0,
  help_note text, help_at timestamptz, help_reply text, help_reply_by text, help_reply_at timestamptz,
  handoff_note text, handoff_at timestamptz,
  held_on date, method text check (method in ('in_person','phone','video')),
  discussed text, response text, expectation text, followup text,
  closed_by text, closed_at timestamptz, close_note text,
  check_on date, improved boolean, improved_note text, improved_by text, improved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hr_coaching_cg on public.hr_coaching (axiscare_caregiver_id, created_at);
create table if not exists public.hr_coaching_log (
  id bigserial primary key,
  coaching_id uuid not null references public.hr_coaching(id),
  at timestamptz not null default now(),
  by_email text not null,
  action text not null,
  detail jsonb not null default '{}'::jsonb
);
alter table public.hr_coaching enable row level security;
alter table public.hr_coaching_log enable row level security;
revoke all on public.hr_coaching, public.hr_coaching_log from anon, authenticated;
grant select on public.hr_coaching, public.hr_coaching_log to authenticated;
grant all on public.hr_coaching, public.hr_coaching_log to service_role;
grant usage, select on sequence public.hr_coaching_log_id_seq to service_role;
drop policy if exists hr_coaching_read on public.hr_coaching;
drop policy if exists hr_coaching_log_read on public.hr_coaching_log;
create policy hr_coaching_read on public.hr_coaching for select to authenticated using (public.desk_is_owner() or public.hr_is_coordinator());
create policy hr_coaching_log_read on public.hr_coaching_log for select to authenticated using (public.desk_is_owner() or public.hr_is_coordinator());

/* the person's My Work card for one coaching record (open = a card due on the due day; anything else = closed) */
create or replace function public.hr_coaching_card(c public.hr_coaching) returns void
language plpgsql security definer set search_path = pg_catalog, public as $f$
declare due timestamptz := (c.due_on::text || ' 17:00')::timestamp at time zone 'America/Chicago';
begin
  perform public.upsert_app_data_item('ops_items', jsonb_build_object(
    'id', 'ops_coach_' || c.id, 'kind', 'coaching', 'source_id', c.id::text, 'sensitive', false,
    'title', (case when c.kind = 'recognition' then 'Pass on kind words to ' else 'Coaching talk with ' end) || c.caregiver,
    'detail', c.topic, 'next_action', case when c.kind = 'recognition' then 'Tell them, then record it on the Performance page.' else 'Have the conversation, then record it on the Performance page.' end,
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
    if p_action = 'done' then
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
comment on function public.hr_coaching_act(uuid, text, jsonb) is '961 (2026-10-18): the only way a page changes coaching records. Checks who is asking; logs every action; keeps the My Work card current.';
