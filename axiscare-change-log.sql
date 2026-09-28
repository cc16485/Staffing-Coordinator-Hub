-- =============================================================================
-- axiscare-change-log.sql · one record of every change the Hub makes in AxisCare (C2, approved 2026-09-28)
-- =============================================================================
-- Kept by our own server functions, never by a browser: one line right after AxisCare answers. Who (the staff member's
-- sign-in, or a named automation), when, which client or caregiver (AxisCare numbers), what kind of change, how it went,
-- and a short summary with NO health details (the note text itself stays in AxisCare). Append-only: nothing can be
-- changed or deleted. Written only through axiscare_change_record() (service_role). Client lines are read by whoever can
-- read leads; caregiver lines by whoever can read caregivers.
-- C2b starts with notes (axiscare-note); C2a wires the other functions that write to AxisCare into the same record.
-- =============================================================================
begin;

do $guard$ begin
  if to_regclass('public.axiscare_change_log') is not null then
    raise exception 'axiscare_change_log refused: already installed. Nothing was changed.'; end if;
  if to_regprocedure('public.can_access_data_key(text)') is null then
    raise exception 'axiscare_change_log refused: the data access rule is missing. Nothing was changed.'; end if;
end $guard$;

create table public.axiscare_change_log (
  id                   bigserial primary key,
  at                   timestamptz not null default now(),
  kind                 text not null check (kind in ('client_created','client_linked','client_updated','responsible_party','care_level',
                                                     'care_tasks','care_plan_note','client_note','caregiver_note','schedule',
                                                     'visit_caregiver','call_summary','scheduling_note')),
  subject              text not null check (subject in ('client','caregiver')),
  axiscare_client_id   text check (axiscare_client_id is null or axiscare_client_id ~ '^\d+$'),
  axiscare_caregiver_id text check (axiscare_caregiver_id is null or axiscare_caregiver_id ~ '^\d+$'),
  outcome              text not null check (outcome in ('sent_confirmed','sent','refused','practice')),
  summary              text not null check (length(btrim(summary)) between 1 and 200),
  detail               text check (detail is null or length(detail) <= 300),
  by_who               text not null check (length(btrim(by_who)) > 0),
  via                  text not null check (length(btrim(via)) > 0),
  constraint axiscare_change_subject_id check (
    (subject = 'client' and axiscare_client_id is not null) or (subject = 'caregiver' and axiscare_caregiver_id is not null))
);
comment on table public.axiscare_change_log is 'C2 · append-only record of every change the Hub makes in AxisCare (no health details)';
create index axiscare_change_client_ix on public.axiscare_change_log (axiscare_client_id, at desc) where axiscare_client_id is not null;
create index axiscare_change_caregiver_ix on public.axiscare_change_log (axiscare_caregiver_id, at desc) where axiscare_caregiver_id is not null;

create function public.axiscare_change_guard() returns trigger language plpgsql as $g$
begin raise exception '% is append-only (% refused)', tg_table_name, tg_op; end $g$;
create trigger axiscare_change_append_only before update or delete on public.axiscare_change_log for each row execute function public.axiscare_change_guard();
create trigger axiscare_change_no_truncate before truncate on public.axiscare_change_log for each statement execute function public.axiscare_change_guard();

create function public.axiscare_change_record(p_kind text, p_subject text, p_client text, p_caregiver text, p_outcome text,
                                              p_summary text, p_detail text, p_by text, p_via text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $d$
declare v_id bigint;
begin
  insert into public.axiscare_change_log (kind, subject, axiscare_client_id, axiscare_caregiver_id, outcome, summary, detail, by_who, via)
  values (p_kind, p_subject, nullif(btrim(coalesce(p_client,'')),''), nullif(btrim(coalesce(p_caregiver,'')),''), p_outcome,
          left(btrim(coalesce(p_summary,'')), 200), left(nullif(btrim(coalesce(p_detail,'')),''), 300), btrim(coalesce(p_by,'')), btrim(coalesce(p_via,'')))
  returning id into v_id;
  return jsonb_build_object('outcome','recorded','id',v_id);
exception when check_violation or not_null_violation then
  return jsonb_build_object('outcome','refused','reason',sqlerrm);
end $d$;

alter table public.axiscare_change_log enable row level security;
revoke all on public.axiscare_change_log from public, anon, authenticated, service_role;
revoke all on sequence public.axiscare_change_log_id_seq from public, anon, authenticated, service_role;
grant select on public.axiscare_change_log to authenticated, service_role;
create policy axiscare_change_read on public.axiscare_change_log for select to authenticated using (
  (subject = 'client' and public.can_access_data_key('leads')) or (subject = 'caregiver' and public.can_access_data_key('caregivers')));
revoke all on function public.axiscare_change_record(text,text,text,text,text,text,text,text,text) from public, anon, authenticated, service_role;
grant execute on function public.axiscare_change_record(text,text,text,text,text,text,text,text,text) to service_role;
revoke all on function public.axiscare_change_guard() from public, anon, authenticated, service_role;

do $verify$ begin
  if has_function_privilege('authenticated','public.axiscare_change_record(text,text,text,text,text,text,text,text,text)','execute')
     or has_function_privilege('anon','public.axiscare_change_record(text,text,text,text,text,text,text,text,text)','execute') then
    raise exception 'axiscare_change_log self-check: a browser can write the record'; end if;
  if has_table_privilege('authenticated','public.axiscare_change_log','insert') or has_table_privilege('service_role','public.axiscare_change_log','insert')
     or has_table_privilege('anon','public.axiscare_change_log','select') then
    raise exception 'axiscare_change_log self-check: someone other than the door could write, or a visitor could read'; end if;
  raise notice 'axiscare_change_log installed: one door, append-only';
end $verify$;
commit;
