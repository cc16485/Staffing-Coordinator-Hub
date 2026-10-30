-- 1208 rollback · only if no agreement was started on a lead yet (those rows have no AxisCare number and would break the
-- old rule). Stops and changes nothing otherwise. The step 4 how-to line goes back to the old words.
begin;
do $r$ begin
  if exists (select 1 from public.client_agreements where axiscare_client_id is null) then
    raise exception '1208 rollback refused: some agreements were started on a lead and have no AxisCare number yet';
  end if;
end $r$;
alter table public.client_agreements drop constraint if exists client_agreements_client_or_lead;
alter table public.client_agreements alter column axiscare_client_id set not null;
drop index if exists public.client_agreements_lead;
alter table public.client_agreements drop column if exists lead_id;
update public.client_journey_step_def d
   set def = jsonb_set(d.def, '{howto,0}', to_jsonb('Create the client in AxisCare from the profile (More, Create in AxisCare). The Hub checks it read back.'::text)),
       updated_at = now(), updated_by = '1208 rollback'
 where d.key = 'soc.setup' and d.def->'howto'->>0 like 'Once the Client Care Agreement is signed%';
commit;
