-- =============================================================================
-- LEVEL OF CARE VERIFICATION (Samantha's approved design of 2026-10-08, design doc ed1f68c2 tab "Level of Care Verification";
-- decision 4 of the onboarding design 2026-10-21: approvers are the Approve to Work list). Hub project. Desktop step 1033.
--   caregiver_level_evidence   one row per piece of proof (a reference, an employment call, a credential lookup, a document),
--                              keyed by the offer, with who recorded it and when. Server only (the Hub reads and writes it
--                              through caregiver-journey's level actions). Never an SSN; a credential row holds its type,
--                              number, status and lookup date only. ref_request_id makes a reference answer land once.
--   level_patch                the server's door for the approved level on the candidate or roster record (only the
--                              care_level_* fields, only if nobody changed the record since it was read), like step2_patch.
-- Idempotent. Rollback: level-1033-rollback.sql.
-- =============================================================================
create table if not exists public.caregiver_level_evidence (
  id uuid primary key default gen_random_uuid(),
  offer_id text not null,
  level int not null check (level in (2, 3)),
  kind text not null check (kind in ('reference', 'employment', 'credential', 'document')),
  source text, who text, duties jsonb not null default '[]'::jsonb, date_from text, date_to text,
  credential jsonb, proof text, note text, ref_request_id text,
  by_email text, by_name text, at timestamptz not null default now()
);
create index if not exists caregiver_level_evidence_offer on public.caregiver_level_evidence (offer_id);
create unique index if not exists caregiver_level_evidence_ref on public.caregiver_level_evidence (ref_request_id, level) where ref_request_id is not null;
alter table public.caregiver_level_evidence enable row level security;
revoke all on public.caregiver_level_evidence from public, anon, authenticated;
grant all on public.caregiver_level_evidence to service_role;

create or replace function public.level_patch(p_key text, p_id text, p_base_rev bigint, p_patch jsonb)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
set lock_timeout = '5s'
as $fn$
declare cg jsonb; rec jsonb; n int; bad text[]; newarr jsonb; outd jsonb; v_rev bigint;
begin
  if p_key is null or p_key not in ('candidates', 'caregivers') then
    raise exception 'level_patch: only candidates and caregivers are saved this way' using errcode = '22023';
  end if;
  if p_id is null or p_id = '' or p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'level_patch: a record number and the fields are needed' using errcode = '22023';
  end if;
  select array_agg(k) into bad from jsonb_object_keys(p_patch) k
   where k not in ('care_level_approved', 'care_level_by', 'care_level_by_email', 'care_level_at', 'care_level_note', 'care_level_evidence', 'care_level_history');
  if bad is not null then
    raise exception 'level_patch: not a Level of Care field: %', array_to_string(bad, ', ') using errcode = '22023';
  end if;
  select data into cg from public.app_data where key = p_key for update;
  if cg is null or jsonb_typeof(cg) <> 'array' then return jsonb_build_object('ok', false, 'reason', 'gone'); end if;
  select count(*) into n from jsonb_array_elements(cg) x where x->>'id' = p_id;
  if n = 0 then return jsonb_build_object('ok', false, 'reason', 'gone'); end if;
  if n > 1 then return jsonb_build_object('ok', false, 'reason', 'duplicate_id'); end if;
  select x into rec from jsonb_array_elements(cg) x where x->>'id' = p_id limit 1;
  if public.app_data_rev(rec) <> coalesce(p_base_rev, -1) then
    return jsonb_build_object('ok', false, 'reason', 'changed', 'current_record', rec);
  end if;
  select coalesce(jsonb_agg(case when x->>'id' = p_id then ((x - '_rev') || p_patch) else x end), '[]'::jsonb) into newarr from jsonb_array_elements(cg) x;
  update public.app_data set data = newarr, updated_at = now() where key = p_key returning data into outd;
  select public.app_data_rev(x) into v_rev from jsonb_array_elements(outd) x where x->>'id' = p_id limit 1;
  return jsonb_build_object('ok', true, 'rev', v_rev);
end $fn$;
revoke all on function public.level_patch(text, text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.level_patch(text, text, bigint, jsonb) to service_role;

do $v$ begin
  if has_function_privilege('authenticated', 'public.level_patch(text, text, bigint, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.level_patch(text, text, bigint, jsonb)', 'execute') then
    raise exception '1033 self-check: only the server may call level_patch'; end if;
  if has_table_privilege('authenticated', 'public.caregiver_level_evidence', 'select') or has_table_privilege('anon', 'public.caregiver_level_evidence', 'select') then
    raise exception '1033 self-check: the evidence table is open to the browser'; end if;
end $v$;
