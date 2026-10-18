-- Undo 911. Refuses if any journey has moved to the nine steps (turn the switch off and move them back on purpose first).
begin;
do $c$ begin if exists (select 1 from public.client_journey where catalog = 'nine') then
  raise exception '911 rollback: some journeys are on the nine steps; nothing was undone'; end if; end $c$;
delete from public.client_journey_step_def where def->>'catalog' = 'nine';
alter table public.client_journey drop constraint if exists client_journey_catalog_check;
alter table public.client_journey drop column if exists catalog;
commit;
