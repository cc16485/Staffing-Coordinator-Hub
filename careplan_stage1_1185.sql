-- 1185 · CARE PLAN STAGE 1 (Samantha approved Stage 1 of "From Visit to First Shift", 2026-10-29).
-- Start of Care step 4 (soc.setup, the nine steps) gets one more check, ticked by the Hub: "Care plan approved in the Hub",
-- right after "Care tasks in AxisCare". Adds only. A step already complete stays complete; nothing else in the step changes.
-- Run again: nothing happens (the check is added once).
begin;
update public.client_journey_step_def d
   set def = jsonb_set(d.def, '{checks}', (
         select jsonb_agg(x.e order by x.o)
           from (select t.e, t.i * 10 as o from jsonb_array_elements(d.def->'checks') with ordinality t(e, i)
                 union all
                 select '{"key": "plan_approved", "label": "Care plan approved in the Hub", "auto": "care_plan_approved"}'::jsonb,
                        coalesce((select t.i * 10 + 5 from jsonb_array_elements(d.def->'checks') with ordinality t(e, i) where t.e->>'key' = 'ax_tasks'), 100000)) x)),
       updated_at = now(), updated_by = '1185 care plan stage 1'
 where d.key = 'soc.setup'
   and jsonb_typeof(d.def->'checks') = 'array'
   and not exists (select 1 from jsonb_array_elements(d.def->'checks') c where c->>'key' = 'plan_approved');
do $verify$
declare n int; k text;
begin
  select count(*) into n from public.client_journey_step_def d, jsonb_array_elements(d.def->'checks') c where d.key = 'soc.setup' and c->>'key' = 'plan_approved';
  if n <> 1 then raise exception '1185 self-check: soc.setup has % "plan_approved" checks, expected 1', n; end if;
  select string_agg(c->>'key', ',' order by i) into k from public.client_journey_step_def d, jsonb_array_elements(d.def->'checks') with ordinality t(c, i) where d.key = 'soc.setup';
  if position('ax_tasks,plan_approved' in k) = 0 then raise exception '1185 self-check: plan_approved is not right after ax_tasks (%)', k; end if;
end $verify$;
commit;
