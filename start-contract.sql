-- =============================================================================
-- start-contract.sql · the Start Contract and the family-update log
--
--   start_contract_version   append-only: what Caring Companions is committing to
--                            for one Journey episode. Target date + confidence,
--                            the exact words promised (to whom, how, when), the
--                            commitment owner. A change is a new version that
--                            supersedes the last; changing a COMMITTED promise
--                            needs a reason. One chain per episode.
--   start_contract_update    append-only: each update given to the family, and
--                            each scheduling of the next update owed. The latest
--                            row says what is owed next (a date, or why nothing is).
--   start_contract_door_audit  one row per Door call, refusals included.
--   start_contract_record / start_contract_update_record   the Doors
--                            (service_role only; the hub reaches them through the
--                            start-contract edge function as the signed-in person)
--   start_contract_current   read-only view: the current contract per episode,
--                            with next update owed and the last update given.
--
-- OWNERSHIP (ratified field map): the Start Contract owns promised wording, the
-- target/committed date with author, next update owed, last family update. It
-- does NOT copy payer, quoted price or the promised call-back: those stay on the
-- lead, which is still their only writable home, and the hub shows them by reference.
-- GUARD: refuses if either table already holds rows. Nothing else is touched.
-- =============================================================================
begin;

do $guard$
declare n bigint;
begin
  if to_regclass('public.start_contract_version') is not null then
    lock table public.start_contract_version in access exclusive mode;
    select count(*) into n from public.start_contract_version;
    if n > 0 then raise exception 'start_contract refused: start_contract_version contains % row(s). Nothing was changed.', n; end if;
  end if;
  if to_regclass('public.start_contract_update') is not null then
    lock table public.start_contract_update in access exclusive mode;
    select count(*) into n from public.start_contract_update;
    if n > 0 then raise exception 'start_contract refused: start_contract_update contains % row(s). Nothing was changed.', n; end if;
  end if;
end $guard$;

drop view if exists public.start_contract_current;
drop function if exists public.start_contract_record(uuid, text, date, text, text, text, date, text, date, text, text, text);
drop function if exists public.start_contract_update_record(uuid, timestamptz, text, text, text, date, text, text, text);
drop function if exists public.start_contract_audit(text, uuid, text, text, jsonb);
drop table if exists public.start_contract_door_audit, public.start_contract_update, public.start_contract_version;
drop function if exists public.start_contract_guard();

create table public.start_contract_version (
  version_id            uuid primary key default gen_random_uuid(),
  episode_id            uuid not null references public.journey_episode(episode_id) on delete restrict,
  confidence            text not null check (confidence in ('early','likely','expected','committed')),
  target_date           date,
  promised_wording      text,
  promised_to           text,
  promised_via          text check (promised_via in ('call','in_person','text','email','other')),
  promised_on           date,
  commitment_owner      text not null check (length(btrim(commitment_owner)) > 0),
  change_reason         text,
  recorded_by           text not null check (length(btrim(recorded_by)) > 0),
  recorded_seat         text not null check (recorded_seat in ('client_intake','owner_decision')),
  recorded_at           timestamptz not null default now(),
  supersedes_version_id uuid references public.start_contract_version(version_id) on delete restrict,
  constraint start_contract_target_needed check (confidence = 'early' or target_date is not null),
  constraint start_contract_promise_shape check (
       (promised_wording is null and promised_to is null and promised_via is null and promised_on is null)
    or (length(btrim(promised_wording)) > 0 and length(btrim(promised_to)) > 0
        and promised_via is not null and promised_on is not null)),
  constraint start_contract_committed_is_promised check (confidence <> 'committed' or promised_wording is not null)
);
comment on table public.start_contract_version is
  'start_contract v1 · append-only; the current contract of an episode is the version nothing supersedes';
create unique index start_contract_supersedes_once on public.start_contract_version (supersedes_version_id)
  where supersedes_version_id is not null;
create unique index start_contract_one_root on public.start_contract_version (episode_id)
  where supersedes_version_id is null;
create index start_contract_version_episode_ix on public.start_contract_version (episode_id);

create table public.start_contract_update (
  update_id            uuid primary key default gen_random_uuid(),
  seq                  bigint generated always as identity,
  episode_id           uuid not null references public.journey_episode(episode_id) on delete restrict,
  kind                 text not null check (kind in ('update_given','next_scheduled')),
  given_at             timestamptz,
  given_to             text,
  given_via            text check (given_via in ('call','in_person','text','email','other')),
  summary              text,
  next_update_owed_on  date,
  owed_by              text,
  none_owed_reason     text,
  recorded_by          text not null check (length(btrim(recorded_by)) > 0),
  recorded_seat        text not null check (recorded_seat in ('client_intake','owner_decision')),
  recorded_at          timestamptz not null default now(),
  constraint start_contract_update_shape check (
       (kind = 'update_given' and given_at is not null and length(btrim(given_to)) > 0
        and given_via is not null and length(btrim(summary)) > 0)
    or (kind = 'next_scheduled' and given_at is null and given_to is null and given_via is null and summary is null)),
  constraint start_contract_update_next check (
       (next_update_owed_on is not null and length(btrim(owed_by)) > 0 and none_owed_reason is null)
    or (next_update_owed_on is null and length(btrim(none_owed_reason)) > 0))
);
comment on table public.start_contract_update is
  'start_contract v1 · append-only; the latest row of an episode says what update is owed next';
create index start_contract_update_episode_ix on public.start_contract_update (episode_id, seq);

create table public.start_contract_door_audit (
  id            bigserial primary key,
  at            timestamptz not null default now(),
  door          text not null,
  episode_id    uuid,
  acting_staff  text,
  acting_seat   text,
  outcome       text not null,
  detail        jsonb not null default '{}'::jsonb
);

create function public.start_contract_guard() returns trigger language plpgsql as $$
begin raise exception '% is append-only (% refused)', tg_table_name, tg_op; end $$;
create trigger start_contract_version_append_only_t before update or delete on public.start_contract_version
  for each row execute function public.start_contract_guard();
create trigger start_contract_version_no_truncate before truncate on public.start_contract_version
  for each statement execute function public.start_contract_guard();
create trigger start_contract_update_append_only_t before update or delete on public.start_contract_update
  for each row execute function public.start_contract_guard();
create trigger start_contract_update_no_truncate before truncate on public.start_contract_update
  for each statement execute function public.start_contract_guard();
create trigger start_contract_audit_append_only_t before update or delete on public.start_contract_door_audit
  for each row execute function public.start_contract_guard();
create trigger start_contract_audit_no_truncate before truncate on public.start_contract_door_audit
  for each statement execute function public.start_contract_guard();

create view public.start_contract_current with (security_invoker = true) as
select v.version_id, v.episode_id, v.confidence, v.target_date, v.promised_wording, v.promised_to, v.promised_via,
       v.promised_on, v.commitment_owner, v.change_reason, v.recorded_by, v.recorded_seat, v.recorded_at,
       (select count(*) from public.start_contract_version x where x.episode_id = v.episode_id) as versions,
       nx.next_update_owed_on, nx.owed_by, nx.none_owed_reason,
       lg.given_at as last_update_at, lg.given_to as last_update_to, lg.given_via as last_update_via,
       lg.summary as last_update_summary
  from public.start_contract_version v
  left join lateral (select u.* from public.start_contract_update u where u.episode_id = v.episode_id
                      order by u.seq desc limit 1) nx on true
  left join lateral (select u.* from public.start_contract_update u where u.episode_id = v.episode_id
                        and u.kind = 'update_given' order by u.seq desc limit 1) lg on true
 where not exists (select 1 from public.start_contract_version s where s.supersedes_version_id = v.version_id);

create function public.start_contract_audit(p_door text, p_episode_id uuid, p_staff text, p_seat text, p_out jsonb)
returns jsonb language plpgsql security invoker as $$
begin
  insert into public.start_contract_door_audit (door, episode_id, acting_staff, acting_seat, outcome, detail)
  values (p_door, p_episode_id, p_staff, p_seat, coalesce(p_out->>'outcome','unknown'), p_out);
  return p_out;
end $$;

-- Record or change the Start Contract. Blank text counts as absent. Identical to the
-- current version = no new version (a double-click is harmless).
create function public.start_contract_record(
  p_episode_id uuid, p_confidence text, p_target_date date, p_promised_wording text, p_promised_to text,
  p_promised_via text, p_promised_on date, p_commitment_owner text, p_next_update_owed_on date,
  p_change_reason text, p_acting_staff text, p_acting_seat text
) returns jsonb
language plpgsql security invoker as $$
declare
  cur public.start_contract_current%rowtype;
  v_today date := (now() at time zone 'America/Chicago')::date;
  w text := nullif(btrim(p_promised_wording), '');
  t text := nullif(btrim(p_promised_to), '');
  o text := nullif(btrim(p_commitment_owner), '');
  r text := nullif(btrim(p_change_reason), '');
  staff text := nullif(btrim(p_acting_staff), '');
  same boolean;
  v uuid;
  D constant text := 'start_contract_record';
begin
  if p_acting_seat is null or p_acting_seat not in ('client_intake','owner_decision') then
    return public.start_contract_audit(D, p_episode_id, staff, p_acting_seat, jsonb_build_object('outcome','invalid_seat')); end if;
  if staff is null then
    return public.start_contract_audit(D, p_episode_id, staff, p_acting_seat, jsonb_build_object('outcome','staff_required')); end if;
  perform pg_advisory_xact_lock(hashtext('start_contract'), hashtext(coalesce(p_episode_id::text, '')));
  if not exists (select 1 from public.journey_episode e where e.episode_id = p_episode_id and public.journey_state_is_active(e.state)) then
    return public.start_contract_audit(D, p_episode_id, staff, p_acting_seat, jsonb_build_object('outcome','episode_not_active')); end if;
  if p_confidence is null or p_confidence not in ('early','likely','expected','committed') then
    return public.start_contract_audit(D, p_episode_id, staff, p_acting_seat, jsonb_build_object('outcome','invalid_confidence')); end if;
  if p_confidence <> 'early' and p_target_date is null then
    return public.start_contract_audit(D, p_episode_id, staff, p_acting_seat, jsonb_build_object('outcome','target_date_required')); end if;
  if o is null then
    return public.start_contract_audit(D, p_episode_id, staff, p_acting_seat, jsonb_build_object('outcome','owner_required')); end if;
  if not ((w is null and t is null and p_promised_via is null and p_promised_on is null)
          or (w is not null and t is not null and p_promised_via is not null and p_promised_on is not null)) then
    return public.start_contract_audit(D, p_episode_id, staff, p_acting_seat, jsonb_build_object('outcome','promise_incomplete',
      'detail','a promise needs the exact words, who they were said to, how, and when')); end if;
  if p_promised_via is not null and p_promised_via not in ('call','in_person','text','email','other') then
    return public.start_contract_audit(D, p_episode_id, staff, p_acting_seat, jsonb_build_object('outcome','invalid_via')); end if;
  if p_promised_on is not null and p_promised_on > v_today then
    return public.start_contract_audit(D, p_episode_id, staff, p_acting_seat, jsonb_build_object('outcome','promised_in_future')); end if;
  if p_confidence = 'committed' and w is null then
    return public.start_contract_audit(D, p_episode_id, staff, p_acting_seat, jsonb_build_object('outcome','committed_needs_wording',
      'detail','a commitment is something we told the family; record the words')); end if;
  if p_next_update_owed_on is not null and p_next_update_owed_on < v_today then
    return public.start_contract_audit(D, p_episode_id, staff, p_acting_seat, jsonb_build_object('outcome','next_update_in_past')); end if;

  select c.* into cur from public.start_contract_current c where c.episode_id = p_episode_id;
  if not found then
    if p_next_update_owed_on is null then
      return public.start_contract_audit(D, p_episode_id, staff, p_acting_seat, jsonb_build_object('outcome','next_update_required',
        'detail','every Start Contract starts with the next update we owe the family')); end if;
  else
    same := cur.confidence = p_confidence and cur.target_date is not distinct from p_target_date
        and cur.promised_wording is not distinct from w and cur.promised_to is not distinct from t
        and cur.promised_via is not distinct from p_promised_via and cur.promised_on is not distinct from p_promised_on
        and cur.commitment_owner = o;
    if same then
      if p_next_update_owed_on is null or p_next_update_owed_on is not distinct from cur.next_update_owed_on then
        return public.start_contract_audit(D, p_episode_id, staff, p_acting_seat,
          jsonb_build_object('outcome','unchanged','version_id', cur.version_id)); end if;
      insert into public.start_contract_update (episode_id, kind, next_update_owed_on, owed_by, recorded_by, recorded_seat)
      values (p_episode_id, 'next_scheduled', p_next_update_owed_on, o, staff, p_acting_seat);
      return public.start_contract_audit(D, p_episode_id, staff, p_acting_seat,
        jsonb_build_object('outcome','next_update_set','version_id', cur.version_id));
    end if;
    if cur.confidence = 'committed' and r is null then
      return public.start_contract_audit(D, p_episode_id, staff, p_acting_seat, jsonb_build_object('outcome','reason_required',
        'detail','this changes a commitment already made to the family; say why')); end if;
  end if;

  insert into public.start_contract_version (episode_id, confidence, target_date, promised_wording, promised_to, promised_via,
                                             promised_on, commitment_owner, change_reason, recorded_by, recorded_seat,
                                             supersedes_version_id)
  values (p_episode_id, p_confidence, p_target_date, w, t, p_promised_via, p_promised_on, o, r, staff, p_acting_seat,
          cur.version_id)
  returning version_id into v;
  if p_next_update_owed_on is not null and p_next_update_owed_on is distinct from cur.next_update_owed_on then
    insert into public.start_contract_update (episode_id, kind, next_update_owed_on, owed_by, recorded_by, recorded_seat)
    values (p_episode_id, 'next_scheduled', p_next_update_owed_on, o, staff, p_acting_seat);
  end if;
  return public.start_contract_audit(D, p_episode_id, staff, p_acting_seat,
    jsonb_build_object('outcome', case when cur.version_id is null then 'recorded' else 'changed' end, 'version_id', v));
end $$;

-- Log an update given to the family. Every update either sets the next one owed
-- or says why nothing more is owed. Repeating the same update is harmless.
create function public.start_contract_update_record(
  p_episode_id uuid, p_given_at timestamptz, p_given_to text, p_given_via text, p_summary text,
  p_next_update_owed_on date, p_none_owed_reason text, p_acting_staff text, p_acting_seat text
) returns jsonb
language plpgsql security invoker as $$
declare
  cur public.start_contract_current%rowtype;
  v_today date := (now() at time zone 'America/Chicago')::date;
  t text := nullif(btrim(p_given_to), '');
  s text := nullif(btrim(p_summary), '');
  nr text := nullif(btrim(p_none_owed_reason), '');
  staff text := nullif(btrim(p_acting_staff), '');
  v uuid;
  D constant text := 'start_contract_update_record';
begin
  if p_acting_seat is null or p_acting_seat not in ('client_intake','owner_decision') then
    return public.start_contract_audit(D, p_episode_id, staff, p_acting_seat, jsonb_build_object('outcome','invalid_seat')); end if;
  if staff is null then
    return public.start_contract_audit(D, p_episode_id, staff, p_acting_seat, jsonb_build_object('outcome','staff_required')); end if;
  perform pg_advisory_xact_lock(hashtext('start_contract'), hashtext(coalesce(p_episode_id::text, '')));
  select c.* into cur from public.start_contract_current c where c.episode_id = p_episode_id;
  if not found then
    return public.start_contract_audit(D, p_episode_id, staff, p_acting_seat, jsonb_build_object('outcome','no_contract')); end if;
  if exists (select 1 from public.journey_episode e where e.episode_id = p_episode_id and e.state = 'voided') then
    return public.start_contract_audit(D, p_episode_id, staff, p_acting_seat, jsonb_build_object('outcome','episode_voided')); end if;
  if p_given_at is null or t is null or s is null or p_given_via is null then
    return public.start_contract_audit(D, p_episode_id, staff, p_acting_seat, jsonb_build_object('outcome','update_incomplete',
      'detail','say when, to whom, how, and what we told them')); end if;
  if p_given_via not in ('call','in_person','text','email','other') then
    return public.start_contract_audit(D, p_episode_id, staff, p_acting_seat, jsonb_build_object('outcome','invalid_via')); end if;
  if p_given_at > now() + interval '5 minutes' then
    return public.start_contract_audit(D, p_episode_id, staff, p_acting_seat, jsonb_build_object('outcome','given_in_future')); end if;
  if (p_next_update_owed_on is null) = (nr is null) then
    return public.start_contract_audit(D, p_episode_id, staff, p_acting_seat, jsonb_build_object('outcome','next_update_required',
      'detail','set the next update owed, or say why nothing more is owed')); end if;
  if p_next_update_owed_on is not null and p_next_update_owed_on < v_today then
    return public.start_contract_audit(D, p_episode_id, staff, p_acting_seat, jsonb_build_object('outcome','next_update_in_past')); end if;
  if cur.last_update_at = p_given_at and cur.last_update_to = t and cur.last_update_summary = s then
    return public.start_contract_audit(D, p_episode_id, staff, p_acting_seat, jsonb_build_object('outcome','unchanged')); end if;
  insert into public.start_contract_update (episode_id, kind, given_at, given_to, given_via, summary,
                                            next_update_owed_on, owed_by, none_owed_reason, recorded_by, recorded_seat)
  values (p_episode_id, 'update_given', p_given_at, t, p_given_via, s, p_next_update_owed_on,
          case when p_next_update_owed_on is null then null else cur.commitment_owner end, nr, staff, p_acting_seat)
  returning update_id into v;
  return public.start_contract_audit(D, p_episode_id, staff, p_acting_seat,
    jsonb_build_object('outcome','update_logged','update_id', v));
end $$;

alter table public.start_contract_version    enable row level security;
alter table public.start_contract_update     enable row level security;
alter table public.start_contract_door_audit enable row level security;
revoke all on public.start_contract_version, public.start_contract_update, public.start_contract_door_audit
  from public, anon, authenticated, service_role;
revoke all on public.start_contract_current from public, anon, authenticated, service_role;
revoke all on sequence public.start_contract_door_audit_id_seq from public, anon, authenticated, service_role;
grant select on public.start_contract_version, public.start_contract_update to authenticated;
grant select, insert on public.start_contract_version, public.start_contract_update, public.start_contract_door_audit to service_role;
grant usage on sequence public.start_contract_door_audit_id_seq to service_role;
grant select on public.start_contract_current to authenticated, service_role;
create policy start_contract_version_read on public.start_contract_version for select to authenticated using (true);
create policy start_contract_update_read  on public.start_contract_update  for select to authenticated using (true);
revoke all on function public.start_contract_record(uuid, text, date, text, text, text, date, text, date, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.start_contract_update_record(uuid, timestamptz, text, text, text, date, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.start_contract_audit(text, uuid, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.start_contract_guard() from public, anon, authenticated, service_role;
grant execute on function public.start_contract_record(uuid, text, date, text, text, text, date, text, date, text, text, text) to service_role;
grant execute on function public.start_contract_update_record(uuid, timestamptz, text, text, text, date, text, text, text) to service_role;
grant execute on function public.start_contract_audit(text, uuid, text, text, jsonb) to service_role;

do $verify$
declare f text;
begin
  foreach f in array array['public.start_contract_record(uuid,text,date,text,text,text,date,text,date,text,text,text)',
                           'public.start_contract_update_record(uuid,timestamptz,text,text,text,date,text,text,text)',
                           'public.start_contract_audit(text,uuid,text,text,jsonb)'] loop
    if (select prosecdef from pg_proc where oid = f::regprocedure) then
      raise exception 'start_contract self-check failed: % is security definer', f; end if;
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then
      raise exception 'start_contract self-check failed: % is callable from the browser', f; end if;
  end loop;
  if has_table_privilege('authenticated', 'public.start_contract_version', 'insert')
     or has_table_privilege('authenticated', 'public.start_contract_update', 'insert')
     or has_table_privilege('authenticated', 'public.start_contract_door_audit', 'select')
     or has_table_privilege('service_role', 'public.start_contract_version', 'update')
     or has_table_privilege('service_role', 'public.start_contract_version', 'delete')
     or has_table_privilege('service_role', 'public.start_contract_update', 'update')
     or has_table_privilege('anon', 'public.start_contract_version', 'select')
     or has_table_privilege('anon', 'public.start_contract_current', 'select') then
    raise exception 'start_contract self-check failed: privileges'; end if;
end $verify$;

commit;
