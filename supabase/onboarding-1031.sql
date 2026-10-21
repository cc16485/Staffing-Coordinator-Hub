-- =============================================================================
-- ONBOARDING RULE FIXES (Samantha approved the onboarding design 2026-10-21: "I approve the onboarding design with your
-- recommended answers to decisions 2 to 6. Go ahead and build it."). Hub project. Run by Desktop step 1031.
--   1. No fingerprints (her rule 2026-10-21, "I don't need finger print anymore since we are stopping Medicaid IHS"): the
--      readiness row cg.check.fingerprints is switched off for everyone. Recorded results stay; nothing is deleted.
--   2. Orientation only (her rule 2026-10-15): the dementia course is optional, so cg.training.dementia is no longer required
--      and Approve to Work no longer waits for it. The row stays on the card as optional (Medicaid proof stays on the
--      Training tab's "Worked with Medicaid clients" list).
--   3. The OIG search on arrival keeps its results in app_data key oig_auto_search; the Care Coordinator Hub may read it.
--   4. The background review takes Case.net (check_key 'casenet').
-- Idempotent: every change checks first. Rollback: onboarding-1031-rollback.sql.
-- =============================================================================
update public.client_journey_step_def
   set active = false, def = jsonb_set(def, '{active}', 'false'::jsonb), updated_at = now(), updated_by = 'onboarding 1031 (no fingerprints)'
 where key = 'cg.check.fingerprints' and (active is distinct from false or (def->>'active') is distinct from 'false');

update public.client_journey_step_def
   set def = jsonb_set(def, '{required}', 'false'::jsonb), updated_at = now(), updated_by = 'onboarding 1031 (orientation only)'
 where key = 'cg.training.dementia' and (def->>'required') is distinct from 'false';

update public.client_journey_step_def
   set def = jsonb_set(def, '{after}', (def->'after') - 'cg.training.dementia' - 'cg.check.fingerprints'), updated_at = now(), updated_by = 'onboarding 1031 (orientation only, no fingerprints)'
 where key in ('cg.approve.work', 'cg.approve.advance') and ((def->'after') @> '["cg.training.dementia"]'::jsonb or (def->'after') @> '["cg.check.fingerprints"]'::jsonb);

-- 4. A Case.net "Issues Found" gets the background review (the table allowed fcsr, edl, oig and fp only).
do $$
declare cn text;
begin
  for cn in select conname from pg_constraint where conrelid = 'public.bg_reviews'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%check_key%' loop
    execute format('alter table public.bg_reviews drop constraint %I', cn);
  end loop;
  alter table public.bg_reviews add constraint bg_reviews_check_key_check check (check_key in ('fcsr', 'edl', 'oig', 'casenet', 'fp'));
end $$;

insert into public.app_data_key_hub_map (data_key, hub_slug)
values ('oig_auto_search', 'care_coordinator')
on conflict (data_key, hub_slug) do nothing;

do $$
begin
  if exists (select 1 from public.client_journey_step_def where key = 'cg.check.fingerprints' and active is distinct from false) then raise exception 'self-check: the fingerprint row is still on'; end if;
  if exists (select 1 from public.client_journey_step_def where key = 'cg.training.dementia' and (def->>'required') is distinct from 'false') then raise exception 'self-check: dementia is still required'; end if;
  if exists (select 1 from public.client_journey_step_def where key in ('cg.approve.work', 'cg.approve.advance') and ((def->'after') @> '["cg.training.dementia"]'::jsonb or (def->'after') @> '["cg.check.fingerprints"]'::jsonb)) then raise exception 'self-check: an approval still waits for dementia or fingerprints'; end if;
  if not exists (select 1 from public.client_journey_step_def where key in ('cg.approve.advance') and (def->'after') @> '["cg.check.casenet"]'::jsonb) then raise exception 'self-check: Approve to Advance does not wait for Case.net'; end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.bg_reviews'::regclass and pg_get_constraintdef(oid) ilike '%casenet%') then raise exception 'self-check: the review table does not take Case.net'; end if;
  if not exists (select 1 from public.app_data_key_hub_map where data_key = 'oig_auto_search' and hub_slug = 'care_coordinator') then raise exception 'self-check: oig_auto_search is not open to the Hub'; end if;
end $$;
