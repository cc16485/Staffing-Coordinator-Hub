-- 910 · START OF CARE STAGE A (Samantha approved 2026-10-17). One transaction:
--   1. a client journey's payer may be 'guide' (Medicare GUIDE), its own payer instead of "Other"
--   2. the payer question offers Medicare GUIDE and no longer offers Medicaid IHS / HCBS for new families
--   3. the Medicaid-only steps stop applying to journeys opened from 2026-10-17 on (opened_before). Journeys opened
--      before keep every Medicaid step and record exactly as they are (the IHS transition records are kept).
-- Undo: soc_stage_a_910_rollback.sql
begin;
alter table public.client_journey drop constraint if exists client_journey_payer_check;
alter table public.client_journey add constraint client_journey_payer_check
  check (payer in ('private', 'medicaid', 'va', 'ltc', 'guide', 'other'));

update public.client_journey_step_def
   set def = jsonb_set(jsonb_set(def, '{answer,fields,0,options}',
         '[{"v":"private","l":"Private Pay"},{"v":"va","l":"VA Community Care"},{"v":"ltc","l":"Long-Term Care Insurance"},{"v":"guide","l":"Medicare GUIDE"},{"v":"other","l":"Other"}]'::jsonb),
         '{howto}',
         '["Ask who will pay for care: the family, the VA, a long-term care policy, Medicare GUIDE, or something else.","We no longer take agency Medicaid (IHS, Aged & Disabled Waiver). CDS (self-directed) is a different program: send those families to Caring Companions CDS, (417) 218-2888.","Pick the payer. For Other, write the payer or source; an owner reviews it next."]'::jsonb),
       updated_at = now(), updated_by = '910 stage A'
 where key = 'intake.payer';

update public.client_journey_step_def
   set def = def || '{"opened_before":"2026-10-17"}'::jsonb, updated_at = now(), updated_by = '910 stage A'
 where key in ('med.emomed', 'med.fusion', 'med.notices', 'med.careplan', 'med.decision', 'ready.state');

do $verify$
declare n int;
begin
  if not exists (select 1 from pg_constraint where conname = 'client_journey_payer_check' and pg_get_constraintdef(oid) like '%guide%') then
    raise exception '910 self-check: the payer rule does not allow guide'; end if;
  select count(*) into n from public.client_journey_step_def where key = 'intake.payer'
     and def->'answer'->'fields'->0->'options' @> '[{"v":"guide"}]'::jsonb and not (def->'answer'->'fields'->0->'options' @> '[{"v":"medicaid"}]'::jsonb);
  if n <> 1 then raise exception '910 self-check: the payer question was not updated'; end if;
  select count(*) into n from public.client_journey_step_def where def->>'opened_before' = '2026-10-17'
     and key in ('med.emomed', 'med.fusion', 'med.notices', 'med.careplan', 'med.decision', 'ready.state');
  if n <> 6 then raise exception '910 self-check: % of 6 Medicaid steps marked', n; end if;
  raise notice '910: GUIDE payer allowed, payer question updated, 6 Medicaid steps retired for new journeys';
end $verify$;
commit;
