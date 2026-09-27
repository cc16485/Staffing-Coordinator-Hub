-- =============================================================================
-- client-status.sql · Change 3: AxisCare's client status reaches the hub
-- The status check (client-status-observe) only records changes. This puts every
-- change for a client the hub knows in front of a person, and the person's
-- answer is what changes the hub. Nothing ends automatically, whatever AxisCare's
-- word is ("Deceased" included).
--
--   client_status_current         AxisCare's current status per client, as of the last check (display copy)
--   client_status_current_refresh rewrites it from the check's last-seen map (service_role)
--   client_status_review          one row per status change for a hub client; the answer is recorded once
--   client_status_review_open     opens a review for one recorded change (service_role; idempotent)
--   client_status_decide          the one door for an answer (service_role; the hub reaches it through
--                                 client-status-review as the signed-in seat holder):
--       care_ended   ends the active Journey on the given day and ends the client role (former)
--       on_hold      nothing ends; the note is kept
--       no_change    nothing ends; the note is kept
--       returning    Owner / Decision only: opens their new Journey and a new active client role
-- Additive. GUARD: refuses if client_status_review already holds rows.
-- =============================================================================
begin;

do $guard$
declare n bigint;
begin
  if to_regclass('public.client_status_review') is not null then
    lock table public.client_status_review in access exclusive mode;
    select count(*) into n from public.client_status_review;
    if n > 0 then raise exception 'client_status refused: client_status_review contains % row(s). Nothing was changed.', n; end if;
  end if;
end $guard$;

drop function if exists public.client_status_decide(uuid, text, date, text, text, text, text);
drop function if exists public.client_status_review_open(jsonb, text);
drop function if exists public.client_status_current_refresh(jsonb, timestamptz);
drop table if exists public.client_status_review;
drop table if exists public.client_status_current;
drop function if exists public.client_status_review_guard();

create table public.client_status_current (
  axiscare_client_id text primary key check (length(btrim(axiscare_client_id)) > 0),
  label              text not null,
  observed_at        timestamptz not null,
  updated_at         timestamptz not null default now()
);
comment on table public.client_status_current is
  'client_status v1 · AxisCare''s client status as of the last 6-hourly check; AxisCare owns it, this is a display copy';

create table public.client_status_review (
  review_id          uuid primary key default gen_random_uuid(),
  transition_ref     text not null unique check (length(btrim(transition_ref)) > 0),
  axiscare_client_id text not null,
  person_id          uuid not null references public.person_identity(id) on delete restrict,
  episode_id         uuid references public.journey_episode(episode_id) on delete restrict,
  old_label          text,
  new_label          text not null,
  observed_at        timestamptz not null,
  created_by         text not null,
  created_at         timestamptz not null default now(),
  status             text not null default 'open' check (status in ('open','decided')),
  decision           text check (decision in ('care_ended','on_hold','no_change','returning')),
  decided_on         date,
  reason             text,
  note               text,
  decided_by         text,
  decided_seat       text check (decided_seat in ('client_intake','owner_decision')),
  decided_at         timestamptz,
  result             jsonb,
  constraint client_status_review_decision_fields check (
    (status = 'open' and decision is null and decided_by is null and decided_at is null)
    or (status = 'decided' and decision is not null and decided_by is not null and decided_at is not null and decided_seat is not null))
);
create index client_status_review_open_idx on public.client_status_review (status, created_at);
create index client_status_review_person on public.client_status_review (person_id);
comment on table public.client_status_review is
  'client_status v1 · a person''s answer to each AxisCare status change for a hub client; answered once, never edited';

-- answered once, then frozen; never deleted
create function public.client_status_review_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.status = 'open' and new.status = 'decided'
     and new.review_id = old.review_id and new.transition_ref = old.transition_ref
     and new.axiscare_client_id = old.axiscare_client_id and new.person_id = old.person_id
     and new.episode_id is not distinct from old.episode_id and new.old_label is not distinct from old.old_label
     and new.new_label = old.new_label and new.observed_at = old.observed_at
     and new.created_by = old.created_by and new.created_at = old.created_at then
    return new;
  end if;
  raise exception '% is answer-once and append-only (% refused)', tg_table_name, tg_op;
end $$;
create trigger client_status_review_guard_t before update or delete on public.client_status_review
  for each row execute function public.client_status_review_guard();
create trigger client_status_review_no_truncate before truncate on public.client_status_review
  for each statement execute function public.client_status_review_guard();

create function public.client_status_current_refresh(p_map jsonb, p_observed_at timestamptz) returns jsonb
language plpgsql security invoker as $$
declare n int := 0;
begin
  if p_map is null or jsonb_typeof(p_map) <> 'object' or p_observed_at is null then
    return jsonb_build_object('outcome','invalid'); end if;
  insert into public.client_status_current (axiscare_client_id, label, observed_at, updated_at)
  select k, v #>> '{}', p_observed_at, now() from jsonb_each(p_map) as j(k, v)
   where length(btrim(k)) > 0 and jsonb_typeof(v) = 'string'
  on conflict (axiscare_client_id) do update
     set label = excluded.label, observed_at = excluded.observed_at, updated_at = now();
  get diagnostics n = row_count;
  return jsonb_build_object('outcome','refreshed','rows', n);
end $$;

-- p_transition: one client_status_log record {id, axiscare_client_id, old_status_label, new_status_label, observed_at}
create function public.client_status_review_open(p_transition jsonb, p_staff text) returns jsonb
language plpgsql security invoker as $$
declare
  ref text := nullif(btrim(p_transition->>'id'), '');
  ax text := nullif(btrim(p_transition->>'axiscare_client_id'), '');
  newl text := nullif(btrim(p_transition->>'new_status_label'), '');
  seen timestamptz; v_person uuid; v_ep uuid; v_id uuid; v_status text;
begin
  if nullif(btrim(p_staff), '') is null then return jsonb_build_object('outcome','staff_required'); end if;
  if ref is null or ax is null or newl is null then return jsonb_build_object('outcome','invalid'); end if;
  begin seen := (p_transition->>'observed_at')::timestamptz; exception when others then seen := null; end;
  if seen is null then return jsonb_build_object('outcome','invalid'); end if;
  perform pg_advisory_xact_lock(hashtext('client_status_review'), hashtext(ref));
  select review_id, status into v_id, v_status from public.client_status_review where transition_ref = ref;
  if v_id is not null then return jsonb_build_object('outcome', 'already_' || v_status, 'review_id', v_id); end if;
  select person_id into v_person from public.person_source_id
   where system = 'axiscare' and entity_type = 'client' and source_id = ax limit 1;
  if v_person is null then return jsonb_build_object('outcome','no_hub_person'); end if;
  select episode_id into v_ep from public.journey_episode
   where person_id = v_person and public.journey_state_is_active(state) limit 1;
  insert into public.client_status_review (transition_ref, axiscare_client_id, person_id, episode_id, old_label, new_label, observed_at, created_by)
  values (ref, ax, v_person, v_ep, nullif(btrim(p_transition->>'old_status_label'), ''), newl, seen, btrim(p_staff))
  returning review_id into v_id;
  return jsonb_build_object('outcome','opened','review_id', v_id, 'person_id', v_person, 'episode_id', v_ep);
end $$;

create function public.client_status_decide(
  p_review_id uuid, p_decision text, p_date date, p_reason text, p_note text, p_staff text, p_seat text
) returns jsonb
language plpgsql security invoker as $$
declare
  staff text := nullif(btrim(p_staff), '');
  v_note text := nullif(btrim(p_note), '');
  rv public.client_status_review%rowtype;
  today date := (now() at time zone 'America/Chicago')::date;
  v_ep uuid; r jsonb; v_ended_role boolean := false; v_role_id bigint; v_new_ep uuid; evid text; res jsonb;
begin
  if p_seat is null or p_seat not in ('client_intake','owner_decision') then return jsonb_build_object('outcome','invalid_seat'); end if;
  if staff is null then return jsonb_build_object('outcome','staff_required'); end if;
  if p_decision is null or p_decision not in ('care_ended','on_hold','no_change','returning') then
    return jsonb_build_object('outcome','invalid_decision'); end if;
  select * into rv from public.client_status_review where review_id = p_review_id;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  perform pg_advisory_xact_lock(hashtext('client_status_person'), hashtext(rv.person_id::text));
  select * into rv from public.client_status_review where review_id = p_review_id for update;
  if rv.status <> 'open' then return jsonb_build_object('outcome','already_decided','decision', rv.decision); end if;

  if p_decision in ('care_ended','returning') then
    if p_date is null or p_date > today or p_date < date '2020-01-01' then
      return jsonb_build_object('outcome','date_required','detail',
        case when p_decision = 'care_ended' then 'the day care ended (not in the future)' else 'the day care resumed (not in the future)' end);
    end if;
  end if;
  if p_decision = 'care_ended' then
    if p_reason is null or p_reason not in ('discharged','facility','moved','deceased','other') then
      return jsonb_build_object('outcome','reason_required'); end if;
    if p_reason = 'other' and v_note is null then return jsonb_build_object('outcome','note_required'); end if;
  end if;
  if p_decision = 'no_change' and v_note is null then return jsonb_build_object('outcome','note_required'); end if;
  if p_decision = 'returning' and p_seat <> 'owner_decision' then
    return jsonb_build_object('outcome','seat_required','seat','owner_decision',
      'detail','opening a returning client''s new Journey is an Owner / Decision matter'); end if;

  evid := 'AxisCare status ' || coalesce(rv.old_label, '?') || ' -> ' || rv.new_label || ' (seen '
          || to_char(rv.observed_at at time zone 'America/Chicago', 'YYYY-MM-DD') || '); confirmed by ' || staff
          || coalesce(': ' || p_reason, '') || coalesce(' · ' || v_note, '');
  begin
    if p_decision = 'care_ended' then
      select episode_id into v_ep from public.journey_episode
       where person_id = rv.person_id and public.journey_state_is_active(state) limit 1;
      if v_ep is not null then
        r := public.episode_set_state(v_ep, 'ended', 'documented', p_date, null, null, evid, 'client_status', staff, p_seat);
        if r->>'outcome' <> 'state_set' then raise exception 'client_status:%', r::text; end if;
      end if;
      update public.person_role set status = 'former', ended_at = p_date,
             end_reason = case p_reason when 'facility' then 'moved to a facility' when 'moved' then 'moved away' else p_reason end,
             updated_at = now()
       where person_id = rv.person_id and role = 'client' and status = 'active';
      v_ended_role := found;
      res := jsonb_build_object('journey_ended', v_ep, 'client_role_ended', v_ended_role);
    elsif p_decision = 'returning' then
      r := public.episode_open_for_person(rv.person_id, 'established', 'documented', evid, p_date, null, null,
                                           'unobserved', 'returning client confirmed from an AxisCare status change', null,
                                           'client_status', staff, p_seat);
      if r->>'outcome' <> 'opened' then raise exception 'client_status:%', r::text; end if;
      v_new_ep := (r->>'episode_id')::uuid;
      if not exists (select 1 from public.person_role where person_id = rv.person_id and role = 'client' and status = 'active') then
        insert into public.person_role (person_id, role, status, started_at) values (rv.person_id, 'client', 'active', p_date)
        returning id into v_role_id;
      end if;
      res := jsonb_build_object('journey_opened', v_new_ep, 'client_role_started', v_role_id is not null);
    else
      res := '{}'::jsonb;
    end if;
    update public.client_status_review
       set status = 'decided', decision = p_decision, decided_on = case when p_decision in ('care_ended','returning') then p_date end,
           reason = case when p_decision = 'care_ended' then p_reason end, note = v_note, decided_by = staff, decided_seat = p_seat,
           decided_at = now(), result = res
     where review_id = p_review_id;
  exception when raise_exception then
    if sqlerrm like 'client_status:%' then
      return jsonb_build_object('outcome','refused','detail', substr(sqlerrm, 15)::jsonb, 'note','nothing was saved');
    end if;
    raise;
  end;
  return jsonb_build_object('outcome','decided','decision', p_decision) || res;
end $$;

alter table public.client_status_current enable row level security;
alter table public.client_status_review enable row level security;
revoke all on public.client_status_current, public.client_status_review from public, anon, authenticated, service_role;
grant select on public.client_status_current, public.client_status_review to authenticated;
grant select, insert, update on public.client_status_current to service_role;
grant select, insert, update on public.client_status_review to service_role;
create policy client_status_current_read on public.client_status_current for select to authenticated using (true);
create policy client_status_review_read on public.client_status_review for select to authenticated using (true);
revoke all on function public.client_status_current_refresh(jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.client_status_review_open(jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.client_status_decide(uuid, text, date, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.client_status_current_refresh(jsonb, timestamptz) to service_role;
grant execute on function public.client_status_review_open(jsonb, text) to service_role;
grant execute on function public.client_status_decide(uuid, text, date, text, text, text, text) to service_role;
revoke all on function public.client_status_review_guard() from public, anon, authenticated, service_role;

do $verify$
begin
  if (select bool_or(prosecdef) from pg_proc where proname in ('client_status_current_refresh','client_status_review_open','client_status_decide')) then
    raise exception 'client_status self-check failed: definer'; end if;
  if has_function_privilege('authenticated', 'public.client_status_decide(uuid,text,date,text,text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.client_status_decide(uuid,text,date,text,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.client_status_review_open(jsonb,text)', 'execute')
     or has_table_privilege('authenticated', 'public.client_status_review', 'insert')
     or has_table_privilege('authenticated', 'public.client_status_review', 'update')
     or has_table_privilege('authenticated', 'public.client_status_current', 'insert')
     or has_table_privilege('service_role', 'public.client_status_review', 'delete')
     or has_table_privilege('anon', 'public.client_status_review', 'select')
     or has_table_privilege('anon', 'public.client_status_current', 'select') then
    raise exception 'client_status self-check failed: privileges'; end if;
end $verify$;

commit;
