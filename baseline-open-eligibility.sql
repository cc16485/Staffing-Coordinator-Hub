-- =============================================================================
-- baseline-open-eligibility.sql · READ ONLY
-- Who may receive a baseline (current-state) Journey episode, and why not.
-- ELIGIBLE  = confirmed, unreviewed AxisCare client link; Active in the AxisCare
--             census the watcher last observed; no Journey episode at all.
-- SKIP      = already has an active episode (idempotent: nothing to do).
-- EXCLUDED  = anything else, with the reason.
-- ADMISSION = Active in AxisCare with no Hub person: human-confirmed admission first.
-- Nothing historical is inferred. began_not_after is the date the confirmed link
-- was created from the ACTIVE-only census load (the person was in care that day).
-- =============================================================================
with
census as (
  select e->'map' as m
    from app_data a, lateral jsonb_array_elements(case when jsonb_typeof(a.data) = 'array' then a.data else '[]'::jsonb end) e
   where a.key = 'client_status_log' and jsonb_typeof(e) = 'object' and e->>'id' = 'latest'
),
census_written as (
  select coalesce(to_jsonb(a)->>'updated_at', 'unknown') as w from app_data a where a.key = 'client_status_log'
),
links as (
  select p.id as link_id, p.person_id, p.source_id as ax, p.confidence, p.needs_review, p.created_at,
         (select c.m->>p.source_id from census c) as label
    from person_source_id p
   where p.system = 'axiscare' and p.entity_type = 'client'
),
per_person as (
  select l.person_id,
         bool_and(l.confidence = 'confirmed' and not l.needs_review) as all_confirmed,
         bool_or(l.label = 'Active') as any_active,
         string_agg(l.ax || '=' || coalesce(l.label, '(not in census)'), ', ' order by l.ax) as labels,
         min(l.created_at)::date as first_linked_on,
         min(l.link_id) as first_link_id
    from links l group by l.person_id
),
eps as (
  select person_id,
         bool_or(public.journey_state_is_active(state)) as has_active,
         count(*) filter (where state <> 'voided') as n_eps
    from journey_episode where person_id is not null group by person_id
)
select 'person'::text as row_kind,
       pp.person_id::text as ref,
       pp.labels,
       case when not pp.all_confirmed then 'EXCLUDED'
            when not pp.any_active then 'EXCLUDED'
            when coalesce(e.has_active, false) then 'SKIP'
            when coalesce(e.n_eps, 0) > 0 then 'EXCLUDED'
            else 'ELIGIBLE' end as decision,
       case when not pp.all_confirmed then 'AxisCare link not confirmed, or flagged for review'
            when not pp.any_active then 'not Active in the AxisCare census'
            when coalesce(e.has_active, false) then 'already has an active episode'
            when coalesce(e.n_eps, 0) > 0 then 'has an earlier episode: that would be a return, not a baseline'
            else 'confirmed current client with no episode yet' end as reason,
       pp.first_linked_on::text as began_not_after,
       'person_source_id:' || pp.first_link_id as evidence_ref,
       'Active in the AxisCare census (client_status_log, last written ' || (select w from census_written)
         || '); confirmed AxisCare client link since ' || pp.first_linked_on as evidence
  from per_person pp left join eps e using (person_id)
union all
select 'unlinked_active', x.k, x.k || '=Active', 'ADMISSION',
       'Active in AxisCare with no Hub person: needs the human-confirmed admission path',
       null, null, null
  from census c, jsonb_each_text(c.m) x(k, v)
 where x.v = 'Active' and not exists (select 1 from links l where l.ax = x.k)
order by 1, 4, 2
