-- =============================================================================
-- call-place.sql · a person says who an unmatched call was with (K3, approved 2026-09-28)
-- =============================================================================
-- The call record's door leaves a call 'none' (nobody on the number) or 'several' (more than one person or lead) and
-- never guesses. K3 lets office staff place such a call: on an inquiry (lead), on a client, or "not one of ours". Each
-- placement is one append-only line saying who placed it and when (the staff member's email from their sign-in,
-- checked by the call-place function; never taken from the page). A call line can be placed once.
-- Written only through call_record_place() (service_role). Read by whoever can read leads.
-- =============================================================================
begin;

do $guard$ begin
  if to_regclass('public.call_placement') is not null then
    raise exception 'call_placement refused: already installed. Nothing was changed.'; end if;
  if to_regclass('public.call_record') is null then
    raise exception 'call_placement refused: the call record (K1) is not installed. Nothing was changed.'; end if;
end $guard$;

create table public.call_placement (
  id                 bigserial primary key,
  placed_at          timestamptz not null default now(),
  call_record_id     bigint not null unique references public.call_record(id),
  decision           text not null check (decision in ('lead','client','not_ours')),
  lead_id            text check (lead_id is null or length(lead_id) <= 100),
  person_id          uuid,
  axiscare_client_id text check (axiscare_client_id is null or axiscare_client_id ~ '^\d+$'),
  placed_by          text not null check (length(btrim(placed_by)) > 0),
  note               text check (note is null or length(note) <= 300),
  constraint call_placement_target check (
    (decision = 'lead' and lead_id is not null and person_id is null)
    or (decision = 'client' and person_id is not null and axiscare_client_id is not null and lead_id is null)
    or (decision = 'not_ours' and lead_id is null and person_id is null and axiscare_client_id is null))
);
comment on table public.call_placement is 'K3 · who a person said an unmatched call was with (append-only; one per call line)';
create index call_placement_lead_ix on public.call_placement (lead_id) where lead_id is not null;
create index call_placement_person_ix on public.call_placement (person_id) where person_id is not null;

create function public.call_placement_guard() returns trigger language plpgsql as $g$
begin raise exception '% is append-only (% refused)', tg_table_name, tg_op; end $g$;
create trigger call_placement_append_only before update or delete on public.call_placement for each row execute function public.call_placement_guard();
create trigger call_placement_no_truncate before truncate on public.call_placement for each statement execute function public.call_placement_guard();

create function public.call_record_place(p_ids bigint[], p_decision text, p_lead text, p_person uuid, p_axiscare_client text,
                                         p_by text, p_note text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $d$
declare v_id bigint; v_n int := 0; v_lead text; v_person uuid; v_ax text;
begin
  if coalesce(array_length(p_ids, 1), 0) = 0 or array_length(p_ids, 1) > 20 then
    return jsonb_build_object('outcome','refused','reason','between 1 and 20 call lines at a time'); end if;
  if nullif(btrim(coalesce(p_by,'')),'') is null then return jsonb_build_object('outcome','refused','reason','who placed it is required'); end if;
  if p_decision = 'lead' then
    v_lead := nullif(btrim(coalesce(p_lead,'')),'');
    if v_lead is null or not exists (
      select 1 from public.app_data a, jsonb_array_elements(case when jsonb_typeof(a.data)='array' then a.data else '[]'::jsonb end) l
       where a.key = 'leads' and l->>'id' = v_lead and not coalesce((l->>'archived')::boolean, false)) then
      return jsonb_build_object('outcome','refused','reason','that inquiry is not on file (or is archived)'); end if;
  elsif p_decision = 'client' then
    v_person := p_person; v_ax := nullif(btrim(coalesce(p_axiscare_client,'')),'');
    if v_person is null or v_ax is null or not exists (
      select 1 from public.person_source_id s where s.person_id = v_person and s.system = 'axiscare' and s.entity_type = 'client' and s.source_id = v_ax) then
      return jsonb_build_object('outcome','refused','reason','that client is not linked to that AxisCare number'); end if;
  elsif p_decision <> 'not_ours' or p_decision is null then
    return jsonb_build_object('outcome','refused','reason','decision must be lead, client or not_ours');
  end if;
  foreach v_id in array p_ids loop
    if not exists (select 1 from public.call_record where id = v_id and match <> 'one') then
      raise exception 'call line % is not an unmatched call', v_id using errcode = 'P0001'; end if;
    if exists (select 1 from public.call_placement where call_record_id = v_id) then
      raise exception 'call line % is already placed', v_id using errcode = 'P0001'; end if;
    insert into public.call_placement (call_record_id, decision, lead_id, person_id, axiscare_client_id, placed_by, note)
    values (v_id, p_decision, v_lead, v_person, v_ax, btrim(p_by), left(nullif(btrim(coalesce(p_note,'')),''), 300));
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('outcome','placed','lines',v_n);
exception
  when raise_exception then return jsonb_build_object('outcome','refused','reason',sqlerrm);
  when check_violation or not_null_violation or unique_violation or foreign_key_violation then
    return jsonb_build_object('outcome','refused','reason',sqlerrm);
end $d$;

alter table public.call_placement enable row level security;
revoke all on public.call_placement from public, anon, authenticated, service_role;
revoke all on sequence public.call_placement_id_seq from public, anon, authenticated, service_role;
grant select on public.call_placement to authenticated, service_role;
create policy call_placement_read on public.call_placement for select to authenticated using (public.can_access_data_key('leads'));
revoke all on function public.call_record_place(bigint[],text,text,uuid,text,text,text) from public, anon, authenticated, service_role;
grant execute on function public.call_record_place(bigint[],text,text,uuid,text,text,text) to service_role;
revoke all on function public.call_placement_guard() from public, anon, authenticated, service_role;

do $verify$ begin
  if has_function_privilege('authenticated','public.call_record_place(bigint[],text,text,uuid,text,text,text)','execute')
     or has_function_privilege('anon','public.call_record_place(bigint[],text,text,uuid,text,text,text)','execute') then
    raise exception 'call_placement self-check: a browser can place a call directly'; end if;
  if has_table_privilege('authenticated','public.call_placement','insert') or has_table_privilege('service_role','public.call_placement','insert')
     or has_table_privilege('anon','public.call_placement','select') then
    raise exception 'call_placement self-check: someone other than the door could write, or a visitor could read'; end if;
  raise notice 'call_placement installed: one door, append-only, one placement per call line';
end $verify$;
commit;
