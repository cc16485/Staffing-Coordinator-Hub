-- step1-countersign rollback: Approve to Work stops waiting for the company signature; the row goes inactive. The columns,
-- any company signatures and their PDFs stay (nothing signed is ever removed). The guard keeps protecting them.
begin;
update public.client_journey_step_def set def = jsonb_set(def, '{after}', (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(def->'after') x where x <> '"cg.company.countersign"'::jsonb))
 where key = 'cg.approve.work';
update public.client_journey_step_def set active = false, updated_by = 'step1 countersign rollback' where key = 'cg.company.countersign';
commit;
