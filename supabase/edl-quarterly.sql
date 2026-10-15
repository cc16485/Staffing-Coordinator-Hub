-- EDL recheck: monthly to quarterly (Samantha, 2026-10-14). The Employee Disqualification List is rechecked every
-- quarter as agency policy, replacing her 2026-10-09 monthly rule (decision 3). Matches care-coordinator-hub PR #409
-- (eligibility-rules.js chkStatus(edl_date, 90, 14)). Changes ONE catalog row, cg.check.edl: expires_after_days 30 -> 90
-- and its how-to line. Nothing else. Safe to run twice. Undo: edl-quarterly-rollback.sql.
begin;
update public.client_journey_step_def
   set def = jsonb_set(jsonb_set(def, '{expires_after_days}', '90'::jsonb),
                       '{howto}', '["Search the DHSS EDL portal; record the result with its document. Quarterly as agency policy (2026-10-14)."]'::jsonb),
       updated_at = now(),
       updated_by = 'edl quarterly 2026-10-14'
 where key = 'cg.check.edl';
do $v$ declare d jsonb; begin
  select def into d from public.client_journey_step_def where key = 'cg.check.edl';
  if d is null then raise exception 'edl-quarterly: cg.check.edl not found'; end if;
  if (d->>'expires_after_days')::int <> 90 then raise exception 'edl-quarterly: expires_after_days is %, expected 90', d->>'expires_after_days'; end if;
end $v$;
commit;
select key, def->'expires_after_days' as expires_after_days, def->'howto' as howto, updated_by from public.client_journey_step_def where key = 'cg.check.edl';
