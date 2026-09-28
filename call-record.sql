-- =============================================================================
-- call-record.sql · one record of every call the Hub hears about (K1, approved 2026-09-28)
-- =============================================================================
-- Every call the Hub hears about becomes one line: an outcome tapped after the call (call-disposition), GoHighLevel's
-- summary of it (call-disposition's attach path), or our AI's reading of it (call-followup). Kept by our own server
-- functions, never by a browser, through call_record_add() (service_role only). Append-only: nothing can be changed
-- or deleted. Read by whoever can read leads.
--
-- WHO THE CALL WAS WITH is decided HERE, by her rule: software never decides who is who. The door looks the caller's
-- number up itself: exactly one person in the identity layer's phone index → that person; exactly one lead (not
-- archived) with that number → that lead; more than one of either → 'several'; nothing → 'none'. Never by name, never
-- a guess. 'several' and 'none' are for a person to place (K3).
-- Summaries are kept (her decision 1), capped at 4,000 characters. No transcript is ever stored here.
-- =============================================================================
begin;

do $guard$ begin
  if to_regclass('public.call_record') is not null then
    raise exception 'call_record refused: already installed. Nothing was changed.'; end if;
  if to_regprocedure('public.can_access_data_key(text)') is null then
    raise exception 'call_record refused: the data access rule is missing. Nothing was changed.'; end if;
  if to_regclass('public.phone_index') is null then
    raise exception 'call_record refused: the identity layer''s phone index is missing. Nothing was changed.'; end if;
end $guard$;

create table public.call_record (
  id             bigserial primary key,
  recorded_at    timestamptz not null default now(),
  kind           text not null check (kind in ('outcome','summary','ai_reading')),
  direction      text not null default 'unknown' check (direction in ('inbound','outbound','unknown')),
  caller_phone   text check (caller_phone is null or caller_phone ~ '^\d{10}$'),
  ghl_contact_id text check (ghl_contact_id is null or length(ghl_contact_id) <= 64),
  match          text not null check (match in ('one','several','none')),
  person_id      uuid,
  lead_id        text check (lead_id is null or length(lead_id) <= 100),
  outcome        text check (outcome is null or length(outcome) between 1 and 200),
  summary        text check (summary is null or length(summary) between 1 and 4000),
  summary_source text check (summary_source is null or summary_source in ('ghl','our_ai')),
  axiscare       text check (axiscare is null or axiscare in ('posted','practice','skipped','error')),
  axiscare_detail text check (axiscare_detail is null or length(axiscare_detail) <= 300),
  written_to     text check (written_to is null or length(written_to) <= 100),
  via            text not null check (via in ('call-disposition','call-followup')),
  constraint call_record_kind_fields check (
    (kind = 'outcome' and outcome is not null and summary is null)
    or (kind in ('summary','ai_reading') and summary is not null and summary_source is not null)),
  constraint call_record_match_fields check (
    (match = 'one' and (person_id is not null or lead_id is not null))
    or (match in ('several','none') and person_id is null and lead_id is null))
);
comment on table public.call_record is 'K1 · append-only record of every call the Hub hears about; who it was with is decided by the door (one person or none)';
create index call_record_lead_ix on public.call_record (lead_id, recorded_at desc) where lead_id is not null;
create index call_record_person_ix on public.call_record (person_id, recorded_at desc) where person_id is not null;
create index call_record_unmatched_ix on public.call_record (recorded_at desc) where match <> 'one';

create function public.call_record_guard() returns trigger language plpgsql as $g$
begin raise exception '% is append-only (% refused)', tg_table_name, tg_op; end $g$;
create trigger call_record_append_only before update or delete on public.call_record for each row execute function public.call_record_guard();
create trigger call_record_no_truncate before truncate on public.call_record for each statement execute function public.call_record_guard();

create function public.call_record_add(p_kind text, p_direction text, p_phone text, p_ghl_contact text, p_outcome text,
                                       p_summary text, p_source text, p_axiscare text, p_axiscare_detail text,
                                       p_written_to text, p_via text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $d$
declare v_id bigint; v_digits text; v_people uuid[]; v_leads text[]; v_match text := 'none'; v_person uuid; v_lead text;
begin
  v_digits := right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 10);
  if length(v_digits) <> 10 then v_digits := null; end if;
  if v_digits is not null then
    select array_agg(distinct person_id) into v_people from public.phone_index where phone = '+1' || v_digits;
    select array_agg(distinct l->>'id') into v_leads
      from public.app_data a, jsonb_array_elements(case when jsonb_typeof(a.data) = 'array' then a.data else '[]'::jsonb end) l
     where a.key = 'leads' and jsonb_typeof(l) = 'object' and not coalesce((l->>'archived')::boolean, false)
       and (right(regexp_replace(coalesce(l->>'phone',''), '\D', '', 'g'), 10) = v_digits
            or right(regexp_replace(coalesce(l->>'client_phone',''), '\D', '', 'g'), 10) = v_digits);
    if coalesce(array_length(v_people, 1), 0) > 1 or coalesce(array_length(v_leads, 1), 0) > 1 then v_match := 'several';
    elsif coalesce(array_length(v_people, 1), 0) = 1 or coalesce(array_length(v_leads, 1), 0) = 1 then
      v_match := 'one'; v_person := v_people[1]; v_lead := v_leads[1];
    end if;
  end if;
  insert into public.call_record (kind, direction, caller_phone, ghl_contact_id, match, person_id, lead_id, outcome, summary,
                                  summary_source, axiscare, axiscare_detail, written_to, via)
  values (p_kind, coalesce(nullif(p_direction,''), 'unknown'), v_digits, left(nullif(btrim(coalesce(p_ghl_contact,'')),''), 64),
          v_match, v_person, v_lead, left(nullif(btrim(coalesce(p_outcome,'')),''), 200), left(nullif(btrim(coalesce(p_summary,'')),''), 4000),
          nullif(p_source,''), nullif(p_axiscare,''), left(nullif(btrim(coalesce(p_axiscare_detail,'')),''), 300),
          left(nullif(btrim(coalesce(p_written_to,'')),''), 100), p_via)
  returning id into v_id;
  return jsonb_build_object('outcome','recorded','id',v_id,'match',v_match);
exception when check_violation or not_null_violation then
  return jsonb_build_object('outcome','refused','reason',sqlerrm);
end $d$;

alter table public.call_record enable row level security;
revoke all on public.call_record from public, anon, authenticated, service_role;
revoke all on sequence public.call_record_id_seq from public, anon, authenticated, service_role;
grant select on public.call_record to authenticated, service_role;
create policy call_record_read on public.call_record for select to authenticated using (public.can_access_data_key('leads'));
revoke all on function public.call_record_add(text,text,text,text,text,text,text,text,text,text,text) from public, anon, authenticated, service_role;
grant execute on function public.call_record_add(text,text,text,text,text,text,text,text,text,text,text) to service_role;
revoke all on function public.call_record_guard() from public, anon, authenticated, service_role;

do $verify$ begin
  if has_function_privilege('authenticated','public.call_record_add(text,text,text,text,text,text,text,text,text,text,text)','execute')
     or has_function_privilege('anon','public.call_record_add(text,text,text,text,text,text,text,text,text,text,text)','execute') then
    raise exception 'call_record self-check: a browser can write the record'; end if;
  if has_table_privilege('authenticated','public.call_record','insert') or has_table_privilege('service_role','public.call_record','insert')
     or has_table_privilege('anon','public.call_record','select') then
    raise exception 'call_record self-check: someone other than the door could write, or a visitor could read'; end if;
  raise notice 'call_record installed: one door, append-only, one person or none';
end $verify$;
commit;
