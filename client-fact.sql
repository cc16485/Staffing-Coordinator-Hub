-- =============================================================================
-- GATE 2a · THE FACT RECORD (approved 2026-09-28)
-- =============================================================================
-- One append-only row per fact we learn about a person: what (a kind from a fixed
-- catalog), its value, which layer (intake, assessment, plan, current), how sure
-- (reported, confirmed, verified, doesn't apply), who said it, how and when, their
-- own words, what kind of change it is (first, update = life changed, correction =
-- the record was wrong, withdrawn), why (required for corrections and withdrawals),
-- which fact it replaces, and who recorded it. "Unknown" is simply no fact.
--
-- Facts attach to the person's Journey (journey_episode), which every lead has from
-- its first minute, so they follow the person from lead to client with nothing copied.
--
-- Built the way the Journey and the Start Contract already are:
--   * append-only: nothing can edit, delete or empty a fact (guard triggers)
--   * each fact is replaced at most once (a chain per episode + kind + layer)
--   * the ONLY way in is client_fact_record(), reachable only by the server
--     (the client-fact function checks the caller is active office staff)
--   * every door call, accepted or refused, is kept in client_fact_door_audit
--     (codes only, never the value)
-- A save made on top of a fact that someone else replaced since is REFUSED
-- ("stale"), so the last save never silently wins.
--
-- One rule for "has care begun" (care_began_for_episode), used by the door: after care
-- began, an intake fact may only be corrected or withdrawn, with a reason.
--
-- The catalog of kinds starts EMPTY. Gate 3 adds the first kinds. Nothing reads any
-- of this until then. Read access: exactly who can read leads.
-- =============================================================================
begin;

-- ---------------------------------------------------------------- the catalog
create table public.fact_kind (
  kind          text primary key check (kind ~ '^[a-z][a-z0-9_]{1,60}$'),
  label         text not null check (length(btrim(label)) > 0),
  fact_group    text not null check (length(btrim(fact_group)) > 0),
  value_shape   text not null check (value_shape in ('text','date','choice','choices','number','bool','object')),
  choices       jsonb check (choices is null or jsonb_typeof(choices) = 'array'),
  layers        text[] not null default '{intake}'
                  check (layers <@ array['intake','assessment','plan','current']::text[] and cardinality(layers) > 0),
  must_verify   boolean not null default false,   -- "needs verification" until verified (payer, authorization, start, safety)
  review_level  text not null default 'always' check (review_level in ('always')),   -- every kind "always review" for now
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    text not null default 'install',
  constraint fact_kind_choices_needed check (value_shape not in ('choice','choices') or jsonb_array_length(coalesce(choices,'[]')) > 0)
);
comment on table public.fact_kind is 'Gate 2a · the fixed list of kinds of fact. Starts empty; kinds are added by reviewed installs.';

-- ---------------------------------------------------------------- the facts
create table public.client_fact (
  fact_id               uuid primary key default gen_random_uuid(),
  episode_id            uuid not null references public.journey_episode(episode_id) on delete restrict,
  kind                  text not null references public.fact_kind(kind) on delete restrict,
  layer                 text not null check (layer in ('intake','assessment','plan','current')),
  value                 jsonb,
  certainty             text check (certainty in ('reported','confirmed','verified','doesnt_apply')),
  change_kind           text not null check (change_kind in ('first','update','correction','withdrawn')),
  reason                text,
  said_by               text,
  said_by_relationship  text,
  said_how              text check (said_how in ('call','text','email','in_person','form','document','state','axiscare','staff_observation','other')),
  said_at               timestamptz,
  words                 text check (words is null or length(words) <= 2000),
  source_ref            text,
  supersedes_fact_id    uuid references public.client_fact(fact_id) on delete restrict,
  recorded_by           text not null check (length(btrim(recorded_by)) > 0),
  recorded_at           timestamptz not null default now(),
  constraint client_fact_shape check (case change_kind
    when 'first'      then supersedes_fact_id is null and certainty is not null
    when 'update'     then supersedes_fact_id is not null and certainty is not null
    when 'correction' then supersedes_fact_id is not null and certainty is not null and length(btrim(coalesce(reason,''))) > 0
    when 'withdrawn'  then supersedes_fact_id is not null and certainty is null and value is null and length(btrim(coalesce(reason,''))) > 0
  end),
  constraint client_fact_value_matches_certainty check (
    change_kind = 'withdrawn' or (certainty = 'doesnt_apply') = (value is null))
);
comment on table public.client_fact is 'Gate 2a · append-only facts; the current fact of an episode+kind+layer is the one nothing replaces';
create unique index client_fact_supersedes_once on public.client_fact (supersedes_fact_id) where supersedes_fact_id is not null;
create unique index client_fact_one_root on public.client_fact (episode_id, kind, layer) where supersedes_fact_id is null;
create index client_fact_episode_ix on public.client_fact (episode_id, kind, layer);

create table public.client_fact_door_audit (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  outcome      text not null,
  episode_id   uuid,
  kind         text,
  layer        text,
  change_kind  text,
  acting_staff text,
  fact_id      uuid
);
comment on table public.client_fact_door_audit is 'Gate 2a · every call to the fact door, accepted or refused (codes only, never a value)';

-- append-only everywhere; the catalog is changed only by reviewed installs (the database owner)
create function public.client_fact_guard() returns trigger language plpgsql as $g$
begin raise exception '% is append-only (% refused)', tg_table_name, tg_op; end $g$;
create trigger client_fact_append_only_t before update or delete on public.client_fact for each row execute function public.client_fact_guard();
create trigger client_fact_no_truncate before truncate on public.client_fact for each statement execute function public.client_fact_guard();
create trigger client_fact_audit_append_only_t before update or delete on public.client_fact_door_audit for each row execute function public.client_fact_guard();
create trigger client_fact_audit_no_truncate before truncate on public.client_fact_door_audit for each statement execute function public.client_fact_guard();

-- ---------------------------------------------------------------- the current facts
create view public.client_fact_current with (security_invoker = true) as
select f.*, k.label, k.fact_group, k.must_verify,
       (k.must_verify and f.certainty in ('reported','confirmed')) as needs_verification
  from public.client_fact f
  join public.fact_kind k on k.kind = f.kind
 where f.change_kind <> 'withdrawn'
   and not exists (select 1 from public.client_fact s where s.supersedes_fact_id = f.fact_id);

-- ---------------------------------------------------------------- has care begun? (the one rule)
-- 1 · an actual start on a First shift checklist for the AxisCare client this Journey's person is
--     confirmed as, opened on or after the inquiry began: a date a person recorded (with a reason),
--     else AxisCare's first clock-in, else the "first shift completed" tick and its time;
-- 2 · otherwise the Journey's own recorded beginning (documented, a window, or on-or-before).
-- A scheduled date passing, the Start Contract's target, AxisCare's profile start date or status never count.
create function public.care_began_for_episode(p_episode_id uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $f$
declare
  v_person uuid; v_since date; v_best date; v_basis text; r record; v_hand date; v_ax date; e record;
begin
  select person_id into v_person from public.journey_episode where episode_id = p_episode_id;
  if not found then return jsonb_build_object('began', false, 'reason', 'no_such_episode'); end if;
  -- when this inquiry began: its origin lead's date, else the episode's record date
  select public.lead_inquiry_date(x) into v_since
    from public.episode_source s
    join public.app_data a on a.key = 'leads'
    cross join lateral jsonb_array_elements(a.data) x
   where s.episode_id = p_episode_id and s.system = 'lead' and s.role = 'origin' and x->>'id' = s.source_ref
   limit 1;
  if v_since is null then select (created_at at time zone 'America/Chicago')::date into v_since from public.journey_episode where episode_id = p_episode_id; end if;
  if v_person is not null then
    for r in
      select q.id, q.first_shift_done, q.first_shift_done_at
        from public.client_queue q
        join public.person_source_id ps on ps.system = 'axiscare' and ps.entity_type = 'client' and ps.source_id = q.axiscare_client_id
       where ps.person_id = v_person and (q.added_at is null or (q.added_at at time zone 'America/Chicago')::date >= v_since)
    loop
      select (evidence->>'date')::date into v_hand from public.launch_evidence
       where launch_id = r.id and fact = 'first_shift' and source = 'person' and coalesce(evidence->>'date','') ~ '^\d{4}-\d{2}-\d{2}$'
       order by 1 limit 1;
      select coalesce(nullif(evidence->>'clock_in_date','')::date, ((nullif(coalesce(evidence->>'clock_in_at', evidence->>'at'),''))::timestamptz at time zone 'America/Chicago')::date)
        into v_ax from public.launch_evidence
       where launch_id = r.id and fact = 'first_shift' and source = 'axiscare' limit 1;
      if v_hand is not null then
        if v_best is null or v_hand < v_best then v_best := v_hand; v_basis := 'recorded by hand'; end if;
      elsif v_ax is not null then
        if v_best is null or v_ax < v_best then v_best := v_ax; v_basis := 'AxisCare''s first clock-in'; end if;
      elsif r.first_shift_done and r.first_shift_done_at is not null then
        if v_best is null or (r.first_shift_done_at at time zone 'America/Chicago')::date < v_best then
          v_best := (r.first_shift_done_at at time zone 'America/Chicago')::date; v_basis := '"first shift completed" on the checklist'; end if;
      end if;
      v_hand := null; v_ax := null;
    end loop;
  end if;
  if v_best is not null then return jsonb_build_object('began', true, 'on', v_best, 'basis', v_basis); end if;
  select began_basis, began_lo, began_hi into e from public.episode_range where episode_id = p_episode_id;
  if e.began_basis in ('documented','observed_window','before_observation') then
    return jsonb_build_object('began', true, 'on', coalesce(e.began_lo, e.began_hi), 'basis', 'the Journey (' || e.began_basis || ')');
  end if;
  return jsonb_build_object('began', false);
exception when others then
  return jsonb_build_object('began', null, 'reason', 'could_not_check');
end $f$;

-- ---------------------------------------------------------------- the door
create function public.client_fact_record(
  p_episode_id uuid, p_kind text, p_layer text, p_value jsonb, p_certainty text, p_change_kind text,
  p_supersedes_fact_id uuid, p_reason text, p_said_by text, p_said_by_relationship text, p_said_how text,
  p_said_at timestamptz, p_words text, p_source_ref text, p_recorded_by text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $d$
declare
  k public.fact_kind; v_state text; v_head uuid; v_id uuid; v_began jsonb; v_code text; v_msg text; x jsonb;
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
  v_by text := nullif(btrim(coalesce(p_recorded_by,'')),'');
begin
  -- one save at a time per episode + kind + layer
  perform pg_advisory_xact_lock(hashtextextended(coalesce(p_episode_id::text,'') || '|' || coalesce(p_kind,'') || '|' || coalesce(p_layer,''), 0));
  <<check>> begin
    if v_by is null then v_code := 'staff_required'; v_msg := 'who is recording this is missing'; exit check; end if;
    select state into v_state from public.journey_episode where episode_id = p_episode_id;
    if not found then v_code := 'no_such_journey'; v_msg := 'that Journey does not exist'; exit check; end if;
    if v_state = 'voided' then v_code := 'journey_voided'; v_msg := 'that Journey was voided'; exit check; end if;
    select * into k from public.fact_kind where kind = p_kind;
    if not found or not k.active then v_code := 'unknown_kind'; v_msg := 'that kind of fact is not in the catalog'; exit check; end if;
    if p_layer is null or not (p_layer = any(k.layers)) then v_code := 'layer_not_allowed'; v_msg := 'that kind of fact is not kept on that layer'; exit check; end if;
    if p_change_kind is null or p_change_kind not in ('first','update','correction','withdrawn') then v_code := 'invalid_change_kind'; v_msg := 'change must be first, update, correction or withdrawn'; exit check; end if;
    if p_change_kind in ('correction','withdrawn') and v_reason is null then v_code := 'reason_required'; v_msg := 'a correction or withdrawal needs a reason'; exit check; end if;
    if p_change_kind = 'withdrawn' then
      if p_value is not null or p_certainty is not null then v_code := 'withdrawn_has_no_value'; v_msg := 'a withdrawal carries no value'; exit check; end if;
    else
      if p_certainty is null or p_certainty not in ('reported','confirmed','verified','doesnt_apply') then v_code := 'invalid_certainty'; v_msg := 'how sure must be reported, confirmed, verified or doesn''t apply'; exit check; end if;
      if p_certainty = 'doesnt_apply' then
        if p_value is not null then v_code := 'doesnt_apply_has_no_value'; v_msg := '"doesn''t apply" carries no value'; exit check; end if;
      else
        if p_value is null or p_value = 'null'::jsonb then v_code := 'value_required'; v_msg := 'a value is required'; exit check; end if;
        if not (case k.value_shape
            when 'text'    then jsonb_typeof(p_value) = 'string' and length(btrim(p_value #>> '{}')) between 1 and 2000
            when 'date'    then jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$'
            when 'choice'  then jsonb_typeof(p_value) = 'string' and k.choices ? (p_value #>> '{}')
            when 'choices' then jsonb_typeof(p_value) = 'array' and jsonb_array_length(p_value) > 0
                                and not exists (select 1 from jsonb_array_elements(p_value) e where jsonb_typeof(e) <> 'string' or not (k.choices ? (e #>> '{}')))
            when 'number'  then jsonb_typeof(p_value) = 'number'
            when 'bool'    then jsonb_typeof(p_value) = 'boolean'
            when 'object'  then jsonb_typeof(p_value) = 'object' and pg_column_size(p_value) <= 8000
            else false end) then v_code := 'value_wrong_shape'; v_msg := 'the value is not the right kind for this fact'; exit check; end if;
        if k.value_shape = 'date' then
          begin perform (p_value #>> '{}')::date; exception when others then v_code := 'value_wrong_shape'; v_msg := 'that is not a real date'; exit check; end;
        end if;
      end if;
    end if;
    if p_said_how is not null and p_said_how not in ('call','text','email','in_person','form','document','state','axiscare','staff_observation','other') then
      v_code := 'invalid_said_how'; v_msg := 'how we learned it is not one of the allowed ways'; exit check; end if;
    if p_said_how in ('call','text','email','in_person','form') and nullif(btrim(coalesce(p_said_by,'')),'') is null then
      v_code := 'said_by_required'; v_msg := 'say who told us'; exit check; end if;
    -- the chain for this episode + kind + layer
    select f.fact_id into v_head from public.client_fact f
     where f.episode_id = p_episode_id and f.kind = p_kind and f.layer = p_layer
       and not exists (select 1 from public.client_fact s where s.supersedes_fact_id = f.fact_id);
    if p_change_kind = 'first' then
      if p_supersedes_fact_id is not null then v_code := 'first_replaces_nothing'; v_msg := 'a first fact replaces nothing'; exit check; end if;
      if v_head is not null then v_code := 'already_recorded'; v_msg := 'this is already recorded; change it instead'; exit check; end if;
    else
      if p_supersedes_fact_id is null then v_code := 'supersedes_required'; v_msg := 'say which fact this replaces'; exit check; end if;
      if v_head is null or p_supersedes_fact_id <> v_head then
        if exists (select 1 from public.client_fact where fact_id = p_supersedes_fact_id and episode_id = p_episode_id and kind = p_kind and layer = p_layer) then
          v_code := 'stale'; v_msg := 'someone changed this after you opened it; look at their change first';
        else v_code := 'wrong_fact'; v_msg := 'that is not a fact of this kind on this Journey'; end if;
        exit check;
      end if;
    end if;
    -- after care began, the intake layer is history: corrections and withdrawals only
    if p_layer = 'intake' and p_change_kind in ('first','update') then
      v_began := public.care_began_for_episode(p_episode_id);
      if (v_began->>'began') is null then v_code := 'could_not_check_care'; v_msg := 'could not check whether care has begun, so nothing was saved'; exit check; end if;
      if (v_began->>'began')::boolean then v_code := 'care_began_use_correction'; v_msg := 'care has begun, so the intake record can only be corrected, with a reason'; exit check; end if;
    end if;
  end check;
  if v_code is not null then
    insert into public.client_fact_door_audit (outcome, episode_id, kind, layer, change_kind, acting_staff)
    values ('refused:' || v_code, p_episode_id, left(p_kind, 80), left(p_layer, 20), left(p_change_kind, 20), v_by);
    return jsonb_build_object('outcome', 'refused', 'reason', v_code, 'message', v_msg);
  end if;
  insert into public.client_fact (episode_id, kind, layer, value, certainty, change_kind, reason, said_by, said_by_relationship,
                                  said_how, said_at, words, source_ref, supersedes_fact_id, recorded_by)
  values (p_episode_id, p_kind, p_layer, p_value, p_certainty, p_change_kind, v_reason, nullif(btrim(coalesce(p_said_by,'')),''),
          nullif(btrim(coalesce(p_said_by_relationship,'')),''), p_said_how, p_said_at, nullif(btrim(coalesce(p_words,'')),''),
          nullif(btrim(coalesce(p_source_ref,'')),''), p_supersedes_fact_id, v_by)
  returning fact_id into v_id;
  insert into public.client_fact_door_audit (outcome, episode_id, kind, layer, change_kind, acting_staff, fact_id)
  values ('recorded', p_episode_id, p_kind, p_layer, p_change_kind, v_by, v_id);
  return jsonb_build_object('outcome', 'recorded', 'fact_id', v_id);
exception when unique_violation then
  insert into public.client_fact_door_audit (outcome, episode_id, kind, layer, change_kind, acting_staff)
  values ('refused:stale', p_episode_id, left(p_kind, 80), left(p_layer, 20), left(p_change_kind, 20), v_by);
  return jsonb_build_object('outcome', 'refused', 'reason', 'stale', 'message', 'someone changed this after you opened it; look at their change first');
end $d$;

-- ---------------------------------------------------------------- who can do what
alter table public.fact_kind enable row level security;
alter table public.client_fact enable row level security;
alter table public.client_fact_door_audit enable row level security;
revoke all on public.fact_kind, public.client_fact, public.client_fact_door_audit from public, anon, authenticated, service_role;
revoke all on public.client_fact_current from public, anon, authenticated, service_role;
revoke all on sequence public.client_fact_door_audit_id_seq from public, anon, authenticated, service_role;
grant select on public.fact_kind, public.client_fact, public.client_fact_door_audit, public.client_fact_current to authenticated, service_role;
create policy fact_kind_read on public.fact_kind for select to authenticated using (public.can_access_data_key('leads'));
create policy client_fact_read on public.client_fact for select to authenticated using (public.can_access_data_key('leads'));
create policy client_fact_audit_read on public.client_fact_door_audit for select to authenticated using (public.can_access_data_key('leads'));
revoke all on function public.client_fact_record(uuid,text,text,jsonb,text,text,uuid,text,text,text,text,timestamptz,text,text,text) from public, anon, authenticated, service_role;
grant execute on function public.client_fact_record(uuid,text,text,jsonb,text,text,uuid,text,text,text,text,timestamptz,text,text,text) to service_role;
revoke all on function public.care_began_for_episode(uuid) from public, anon, authenticated, service_role;
grant execute on function public.care_began_for_episode(uuid) to service_role;
revoke all on function public.client_fact_guard() from public, anon, authenticated, service_role;

do $verify$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='client_fact_record' and p.prosecdef) then
    raise exception 'client_fact self-check: the door must run as its owner'; end if;
  if has_function_privilege('authenticated', 'public.client_fact_record(uuid,text,text,jsonb,text,text,uuid,text,text,text,text,timestamptz,text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.client_fact_record(uuid,text,text,jsonb,text,text,uuid,text,text,text,text,timestamptz,text,text,text)', 'execute') then
    raise exception 'client_fact self-check: the door is reachable from a browser'; end if;
  if has_table_privilege('authenticated','public.client_fact','insert') or has_table_privilege('authenticated','public.fact_kind','insert')
     or has_table_privilege('service_role','public.client_fact','insert') or has_table_privilege('anon','public.client_fact','select') then
    raise exception 'client_fact self-check: someone other than the door could write, or a visitor could read'; end if;
  if exists (select 1 from public.fact_kind) then raise exception 'client_fact self-check: the catalog must start empty'; end if;
  raise notice 'client_fact installed: empty catalog, one door, read by whoever can read leads';
end $verify$;

commit;
