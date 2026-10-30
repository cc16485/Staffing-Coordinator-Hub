-- 1208 · AGREEMENT BEFORE AXISCARE (Samantha 2026-10-30: "we want it to go straight to the care agreement ... the potential
-- client does not need to be active in axiscare before the agreement, actually we need to have a signed agreement before we
-- would make them active in axiscare"; her answer "Wait for it").
--   1. client_agreements: a Client Care Agreement can belong to a LEAD (lead_id) before the client has an AxisCare number.
--      The AxisCare number may be empty while the lead has none; one of the two is always there. The number's own check is
--      kept. Existing rows are not changed.
--   2. Start of Care step 4 (soc.setup): its first how-to line says the agreement comes first. Nothing else in the step.
-- Run again: nothing changes.
begin;
alter table public.client_agreements add column if not exists lead_id text check (lead_id is null or lead_id ~ '^[A-Za-z0-9_.:-]{1,80}$');
alter table public.client_agreements alter column axiscare_client_id drop not null;
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'client_agreements_client_or_lead' and conrelid = 'public.client_agreements'::regclass) then
    alter table public.client_agreements add constraint client_agreements_client_or_lead check (axiscare_client_id is not null or lead_id is not null);
  end if;
end $c$;
create index if not exists client_agreements_lead on public.client_agreements (lead_id, created_at desc) where lead_id is not null;

update public.client_journey_step_def d
   set def = jsonb_set(d.def, '{howto,0}', to_jsonb('Once the Client Care Agreement is signed, create the client in AxisCare from the profile (More, Create in AxisCare). The Hub checks it read back.'::text)),
       updated_at = now(), updated_by = '1208 agreement before AxisCare'
 where d.key = 'soc.setup'
   and jsonb_typeof(d.def->'howto') = 'array'
   and d.def->'howto'->>0 not like 'Once the Client Care Agreement is signed%';
do $verify$
declare n int; h text;
begin
  select count(*) into n from information_schema.columns where table_schema = 'public' and table_name = 'client_agreements' and column_name = 'lead_id';
  if n <> 1 then raise exception '1208 self-check: client_agreements.lead_id is missing'; end if;
  select count(*) into n from information_schema.columns where table_schema = 'public' and table_name = 'client_agreements' and column_name = 'axiscare_client_id' and is_nullable = 'YES';
  if n <> 1 then raise exception '1208 self-check: client_agreements.axiscare_client_id still requires a number'; end if;
  select count(*) into n from pg_constraint where conname = 'client_agreements_client_or_lead';
  if n <> 1 then raise exception '1208 self-check: the client-or-lead check is missing'; end if;
  select d.def->'howto'->>0 into h from public.client_journey_step_def d where d.key = 'soc.setup';
  if h is not null and h not like 'Once the Client Care Agreement is signed%' then raise exception '1208 self-check: step 4 does not say the agreement comes first'; end if;
end $verify$;
commit;
