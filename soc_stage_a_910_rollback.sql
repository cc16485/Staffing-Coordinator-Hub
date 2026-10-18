-- Undo 910. Refuses if any journey already has the GUIDE payer (set those to 'other' first, on purpose).
begin;
do $c$ begin if exists (select 1 from public.client_journey where payer = 'guide') then
  raise exception '910 rollback: some journeys have the GUIDE payer; nothing was undone'; end if; end $c$;
alter table public.client_journey drop constraint if exists client_journey_payer_check;
alter table public.client_journey add constraint client_journey_payer_check check (payer in ('private', 'medicaid', 'va', 'ltc', 'other'));
update public.client_journey_step_def
   set def = jsonb_set(def, '{answer,fields,0,options}',
         '[{"v":"private","l":"Private Pay"},{"v":"medicaid","l":"Medicaid IHS / HCBS"},{"v":"va","l":"VA Community Care"},{"v":"ltc","l":"Long-Term Care Insurance"},{"v":"other","l":"Other"}]'::jsonb),
       updated_at = now(), updated_by = '910 rollback'
 where key = 'intake.payer';
update public.client_journey_step_def set def = def - 'opened_before', updated_at = now(), updated_by = '910 rollback'
 where key in ('med.emomed', 'med.fusion', 'med.notices', 'med.careplan', 'med.decision', 'ready.state');
commit;
