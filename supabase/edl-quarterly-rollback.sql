-- Undo edl-quarterly.sql: cg.check.edl back to 30 days and the monthly how-to line. Safe to run twice.
begin;
update public.client_journey_step_def
   set def = jsonb_set(jsonb_set(def, '{expires_after_days}', '30'::jsonb),
                       '{howto}', '["Search the DHSS EDL portal; record the result with its document. Monthly as agency policy (decision 3)."]'::jsonb),
       updated_at = now(),
       updated_by = 'edl quarterly rollback'
 where key = 'cg.check.edl';
commit;
