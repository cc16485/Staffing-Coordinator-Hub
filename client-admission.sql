-- =============================================================================
-- client-admission.sql · identity layer · human-confirmed AxisCare client admission
--
-- AxisCare observation -> admission case -> suggested identity evidence ->
-- HUMAN confirmation -> person identity resolved -> baseline-open eligible.
--
--   * Nothing creates or merges a person automatically. Phone matches are shown
--     as suggestions; only a confirming person (Client Intake / Care Coordination,
--     or Owner / Decision) resolves identity.
--   * An AxisCare id already linked to someone, or a person who already has a
--     different AxisCare client id, escalates to Owner / Decision.
--   * One open case per AxisCare client id. Cases and their event log are
--     append-only except the single open -> resolved transition.
--   * Additive: touches no existing identity object except to INSERT a confirmed
--     link (person_source_id), a new person (person_identity) and a client role
--     (person_role), exactly as the identity backfill does for active clients.
-- RERUN: reinstalls while both new tables are empty; refuses if either holds rows.
-- =============================================================================
begin;

do $guard$
declare t text; n bigint;
begin
  foreach t in array array['client_admission_case','client_admission_event'] loop
    if to_regclass('public.' || t) is not null then
      execute format('lock table public.%I in access exclusive mode', t);
      execute format('select count(*) from public.%I', t) into n;
      if n > 0 then
        raise exception 'client_admission refused: public.% contains % row(s). Nothing was changed.', t, n;
      end if;
    end if;
  end loop;
end $guard$;

drop table if exists public.client_admission_event, public.client_admission_case;
do $drop$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('client_admission_open','client_admission_confirm',
                  'client_admission_dismiss','client_admission_guard','client_admission_event_guard','client_admission_log')
  loop execute 'drop function ' || r.sig; end loop;
end $drop$;

create table public.client_admission_case (
  case_id              uuid primary key default gen_random_uuid(),
  axiscare_client_id   text not null check (length(btrim(axiscare_client_id)) > 0),
  status               text not null default 'open'
                         check (status in ('open','confirmed_existing','confirmed_new','dismissed')),
  observed_label       text not null,
  observed_at          timestamptz not null,
  axiscare_name        text,
  axiscare_phones      text[] not null default '{}',
  suggestions          jsonb not null default '[]'::jsonb,
  needs_owner_decision boolean not null default false,
  escalation_reason    text,
  opened_at            timestamptz not null default now(),
  opened_by            text not null,
  resolved_person_id   uuid references public.person_identity(id) on delete restrict,
  resolved_by          text,
  resolved_seat        text,
  resolved_at          timestamptz,
  resolution_note      text,
  constraint client_admission_resolution check (
       (status = 'open' and resolved_person_id is null and resolved_by is null and resolved_at is null)
    or (status in ('confirmed_existing','confirmed_new') and resolved_person_id is not null
        and resolved_by is not null and resolved_at is not null
        and resolved_seat in ('client_intake','owner_decision'))
    or (status = 'dismissed' and resolved_person_id is null and resolved_by is not null and resolved_at is not null
        and resolution_note is not null))
);
comment on table public.client_admission_case is
  'client_admission v1 · human-confirmed AxisCare client admission; suggestions never resolve identity';
create unique index client_admission_one_open_uq on public.client_admission_case (axiscare_client_id) where status = 'open';

create table public.client_admission_event (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  case_id      uuid,
  axiscare_client_id text,
  op           text not null check (op in ('open','confirm','dismiss','escalate')),
  acting_staff text not null,
  acting_seat  text not null,
  outcome      text not null,
  detail       text
);

create function public.client_admission_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'client_admission_case rows are never deleted'; end if;
  if old.status <> 'open' then raise exception 'client_admission_case % is already %', old.case_id, old.status; end if;
  if (new.case_id, new.axiscare_client_id, new.observed_label, new.observed_at, new.axiscare_name,
      new.axiscare_phones, new.suggestions, new.opened_at, new.opened_by)
     is distinct from
     (old.case_id, old.axiscare_client_id, old.observed_label, old.observed_at, old.axiscare_name,
      old.axiscare_phones, old.suggestions, old.opened_at, old.opened_by) then
    raise exception 'client_admission_case: the observation and suggestions are immutable';
  end if;
  return new;
end $$;
create trigger client_admission_guard_t before update or delete on public.client_admission_case
  for each row execute function public.client_admission_guard();

create function public.client_admission_event_guard() returns trigger language plpgsql as $$
begin raise exception '% is append-only (% refused)', tg_table_name, tg_op; end $$;
create trigger client_admission_event_append_only_t before update or delete on public.client_admission_event
  for each row execute function public.client_admission_event_guard();
create trigger client_admission_case_no_truncate before truncate on public.client_admission_case
  for each statement execute function public.client_admission_event_guard();
create trigger client_admission_event_no_truncate before truncate on public.client_admission_event
  for each statement execute function public.client_admission_event_guard();

create function public.client_admission_log(p_case uuid, p_ax text, p_op text, p_staff text, p_seat text,
                                            p_outcome text, p_detail text) returns void
language sql security invoker as $$
  insert into public.client_admission_event (case_id, axiscare_client_id, op, acting_staff, acting_seat, outcome, detail)
  values (p_case, p_ax, p_op, coalesce(p_staff, 'unspecified'), coalesce(p_seat, 'system'), p_outcome, p_detail)
$$;

-- open (idempotent) · suggestions from phone matches, never a resolution
create function public.client_admission_open(
  p_axiscare_client_id text, p_observed_label text, p_observed_at timestamptz,
  p_axiscare_name text default null, p_axiscare_phones text[] default '{}',
  p_opened_by text default 'client-admission-scan'
) returns jsonb
language plpgsql security invoker as $$
declare v uuid; v_sug jsonb; v_phones text[];
begin
  perform pg_advisory_xact_lock(hashtext('axiscare_client'), hashtext(p_axiscare_client_id));
  if exists (select 1 from public.person_source_id
              where system = 'axiscare' and entity_type = 'client' and source_id = p_axiscare_client_id) then
    perform public.client_admission_log(null, p_axiscare_client_id, 'open', p_opened_by, 'system', 'already_linked', null);
    return jsonb_build_object('outcome','already_linked');
  end if;
  select case_id into v from public.client_admission_case
   where axiscare_client_id = p_axiscare_client_id and status = 'open';
  if v is not null then return jsonb_build_object('outcome','already_open','case_id', v); end if;

  -- E.164 normalisation: 10 digits -> +1…, 11 starting with 1 -> +…
  select coalesce(array_agg(distinct n), '{}') into v_phones
    from (select case when length(d) = 10 then '+1' || d when length(d) = 11 and left(d, 1) = '1' then '+' || d end n
            from (select regexp_replace(coalesce(x, ''), '\D', '', 'g') d from unnest(coalesce(p_axiscare_phones, '{}')) x) q) z
   where n is not null;
  select coalesce(jsonb_agg(s order by s->>'strength', s->>'person_id'), '[]'::jsonb) into v_sug
    from (select distinct jsonb_build_object(
                   'person_id', pi.person_id,
                   'display_name', p.display_name,
                   'via', 'phone',
                   'phone_last4', right(pi.phone, 4),
                   'confidence', coalesce(to_jsonb(pi)->>'confidence', 'unknown'),
                   'verification', coalesce(to_jsonb(pi)->>'verification_status', 'unknown'),
                   'strength', case when coalesce(to_jsonb(pi)->>'confidence', '') = 'confirmed'
                                     and coalesce(to_jsonb(pi)->>'verification_status', '') = 'verified'
                                    then 'strong' else 'weak' end) s
            from public.phone_index pi join public.person_identity p on p.id = pi.person_id
           where pi.phone = any(v_phones)) x;

  insert into public.client_admission_case (axiscare_client_id, observed_label, observed_at, axiscare_name,
                                            axiscare_phones, suggestions, opened_by)
  values (p_axiscare_client_id, p_observed_label, p_observed_at, p_axiscare_name, v_phones, v_sug, p_opened_by)
  returning case_id into v;
  perform public.client_admission_log(v, p_axiscare_client_id, 'open', p_opened_by, 'system', 'opened',
                                      jsonb_array_length(v_sug) || ' suggestion(s)');
  return jsonb_build_object('outcome','opened','case_id', v, 'suggestions', jsonb_array_length(v_sug));
end $$;

-- confirm · a human decides: an existing person, or a new person
create function public.client_admission_confirm(
  p_case_id uuid, p_decision text, p_acting_staff text, p_acting_seat text,
  p_person_id uuid default null, p_display_name text default null, p_note text default null
) returns jsonb
language plpgsql security invoker as $$
declare c public.client_admission_case%rowtype; v_person uuid; v_other text;
begin
  if p_acting_seat not in ('client_intake','owner_decision') then return jsonb_build_object('outcome','invalid_seat'); end if;
  if p_acting_staff is null or length(btrim(p_acting_staff)) = 0 then return jsonb_build_object('outcome','staff_required'); end if;
  if p_decision not in ('existing','new') then return jsonb_build_object('outcome','invalid_decision'); end if;
  select * into c from public.client_admission_case where case_id = p_case_id;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  perform pg_advisory_xact_lock(hashtext('axiscare_client'), hashtext(c.axiscare_client_id));
  select * into c from public.client_admission_case where case_id = p_case_id for update;
  if c.status <> 'open' then return jsonb_build_object('outcome','already_closed','status', c.status); end if;
  if c.needs_owner_decision and p_acting_seat <> 'owner_decision' then
    return jsonb_build_object('outcome','seat_required','seat','owner_decision','reason', c.escalation_reason);
  end if;

  if exists (select 1 from public.person_source_id
              where system = 'axiscare' and entity_type = 'client' and source_id = c.axiscare_client_id) then
    update public.client_admission_case
       set needs_owner_decision = true, escalation_reason = 'this AxisCare id is already linked to a person'
     where case_id = p_case_id;
    perform public.client_admission_log(p_case_id, c.axiscare_client_id, 'escalate', p_acting_staff, p_acting_seat,
                                        'already_linked', null);
    return jsonb_build_object('outcome','escalated','reason','this AxisCare id is already linked to a person');
  end if;

  if p_decision = 'existing' then
    if p_person_id is null or not exists (select 1 from public.person_identity where id = p_person_id) then
      return jsonb_build_object('outcome','invalid_person');
    end if;
    select string_agg(source_id, ',') into v_other from public.person_source_id
     where person_id = p_person_id and system = 'axiscare' and entity_type = 'client';
    if v_other is not null and p_acting_seat <> 'owner_decision' then
      update public.client_admission_case
         set needs_owner_decision = true,
             escalation_reason = 'that person already has AxisCare client id(s) ' || v_other
       where case_id = p_case_id;
      perform public.client_admission_log(p_case_id, c.axiscare_client_id, 'escalate', p_acting_staff, p_acting_seat,
                                          'person_has_other_axiscare_id', v_other);
      return jsonb_build_object('outcome','escalated','reason','that person already has another AxisCare client id');
    end if;
    v_person := p_person_id;
  else
    if p_display_name is null or length(btrim(p_display_name)) = 0 then
      return jsonb_build_object('outcome','name_required');
    end if;
    insert into public.person_identity (display_name) values (btrim(p_display_name)) returning id into v_person;
  end if;

  insert into public.person_source_id (person_id, system, entity_type, source_id, confidence, needs_review, evidence, imported_at)
  values (v_person, 'axiscare', 'client', c.axiscare_client_id, 'confirmed', false,
          'human-confirmed admission case ' || p_case_id || ' by ' || p_acting_staff || ' (' || p_acting_seat || ')', now());
  insert into public.person_role (person_id, role, status)
  select v_person, 'client', 'active'
   where not exists (select 1 from public.person_role where person_id = v_person and role = 'client' and status = 'active');

  update public.client_admission_case
     set status = case when p_decision = 'existing' then 'confirmed_existing' else 'confirmed_new' end,
         resolved_person_id = v_person, resolved_by = p_acting_staff, resolved_seat = p_acting_seat,
         resolved_at = now(), resolution_note = p_note
   where case_id = p_case_id;
  perform public.client_admission_log(p_case_id, c.axiscare_client_id, 'confirm', p_acting_staff, p_acting_seat,
                                      p_decision, v_person::text);
  return jsonb_build_object('outcome','confirmed','decision', p_decision, 'person_id', v_person);
end $$;

create function public.client_admission_dismiss(
  p_case_id uuid, p_reason text, p_acting_staff text, p_acting_seat text
) returns jsonb
language plpgsql security invoker as $$
declare c public.client_admission_case%rowtype;
begin
  if p_acting_seat not in ('client_intake','owner_decision') then return jsonb_build_object('outcome','invalid_seat'); end if;
  if p_reason is null or length(btrim(p_reason)) = 0 or p_acting_staff is null then
    return jsonb_build_object('outcome','reason_required');
  end if;
  select * into c from public.client_admission_case where case_id = p_case_id for update;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  if c.status <> 'open' then return jsonb_build_object('outcome','already_closed'); end if;
  if c.needs_owner_decision and p_acting_seat <> 'owner_decision' then
    return jsonb_build_object('outcome','seat_required','seat','owner_decision');
  end if;
  update public.client_admission_case
     set status = 'dismissed', resolved_by = p_acting_staff, resolved_seat = p_acting_seat,
         resolved_at = now(), resolution_note = p_reason
   where case_id = p_case_id;
  perform public.client_admission_log(p_case_id, c.axiscare_client_id, 'dismiss', p_acting_staff, p_acting_seat,
                                      'dismissed', p_reason);
  return jsonb_build_object('outcome','dismissed');
end $$;

alter table public.client_admission_case  enable row level security;
alter table public.client_admission_event enable row level security;
revoke all on public.client_admission_case, public.client_admission_event from public, anon, authenticated, service_role;
revoke all on sequence public.client_admission_event_id_seq from public, anon, authenticated, service_role;
grant select on public.client_admission_case to authenticated;
grant select, insert, update on public.client_admission_case to service_role;
grant select, insert on public.client_admission_event to service_role;
grant usage, select on sequence public.client_admission_event_id_seq to service_role;
create policy client_admission_case_read on public.client_admission_case for select to authenticated using (true);

do $grants$
declare r record;
begin
  for r in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'client\_admission\_%' escape '\' loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    if r.proname in ('client_admission_open','client_admission_confirm','client_admission_dismiss','client_admission_log') then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
end $grants$;

do $verify$
declare bad text := ''; r record;
begin
  if has_table_privilege('anon','public.client_admission_case','select') then bad := bad || ' anon_select'; end if;
  if has_table_privilege('authenticated','public.client_admission_case','insert')
     or has_table_privilege('authenticated','public.client_admission_case','update') then bad := bad || ' auth_write'; end if;
  if has_table_privilege('service_role','public.client_admission_case','delete')
     or has_table_privilege('service_role','public.client_admission_event','update')
     or has_table_privilege('service_role','public.client_admission_event','delete') then bad := bad || ' svc_mutate'; end if;
  for r in select p.oid::regprocedure as sig, p.proname, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'client\_admission\_%' escape '\' loop
    if r.prosecdef then bad := bad || ' definer:' || r.proname; end if;
    if has_function_privilege('authenticated', r.sig, 'execute') or has_function_privilege('anon', r.sig, 'execute') then
      bad := bad || ' exec:' || r.proname; end if;
  end loop;
  if not (select relrowsecurity from pg_class where oid = 'public.client_admission_case'::regclass) then bad := bad || ' rls'; end if;
  if bad <> '' then raise exception 'client_admission self-check failed:%', bad; end if;
end $verify$;

commit;
