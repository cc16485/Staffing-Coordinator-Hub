-- =============================================================================
-- legacy-mirror-parity.sql · READ ONLY
-- For every legacy coverage case: is it mirrored, and does the canonical shadow
-- agree with legacy on status, asks, yes answers, "asked" and who covered it?
-- =============================================================================
with lc as (
  select e from public.app_data ad,
         lateral jsonb_array_elements(case when jsonb_typeof(ad.data) = 'array' then ad.data else '[]'::jsonb end) e
   where ad.key = 'coverage_cases' and jsonb_typeof(e) = 'object' and e->>'id' is not null
),
leg as (
  select e->>'id' as cid, coalesce(nullif(e->>'status', ''), 'open') as st,
         jsonb_array_length(coalesce(e->'asked', '[]'::jsonb)) as n_asks,
         (select count(*) from jsonb_array_elements(coalesce(e->'asked', '[]'::jsonb)) a
           where a->>'state' = 'yes' or a->>'was_yes' = 'true') as n_yes,
         (select count(*) from jsonb_array_elements(coalesce(e->'asked', '[]'::jsonb)) a where a->>'state' = 'waiting') as n_waiting,
         lower(nullif(btrim(e->>'covered_by'), '')) as covered
    from lc
),
can as (
  select n.origin_ref as cid, n.need_id, n.state, s.status, s.open_asks,
         (select count(*) from public.staffing_ask a where a.need_id = n.need_id) as n_asks,
         (select count(*) from public.staffing_ask_current a where a.need_id = n.need_id and a.current_reply = 'yes') as n_yes,
         (select lower(string_agg(x.caregiver_name, ',' order by x.caregiver_name)) from public.staffing_assignment x
           where x.need_id = n.need_id and x.state = 'active') as covered
    from public.staffing_need n join public.staffing_need_status s using (need_id)
   where n.origin_system = 'coverage_case'
)
select leg.cid as case_id,
       leg.st as legacy_status,
       coalesce(can.state || ' / ' || can.status, 'not mirrored') as canonical,
       case when can.need_id is null then null
            else ((leg.st = 'open' and can.state = 'open') or (leg.st in ('done','resolved','dismissed') and can.state = 'closed')) end as status_match,
       case when can.need_id is null then null else leg.n_asks = can.n_asks end as asks_match,
       case when can.need_id is null then null else leg.n_yes = can.n_yes end as yes_match,
       case when can.need_id is null or leg.st <> 'open' then null else (leg.n_waiting > 0) = (can.open_asks > 0) end as asked_match,
       case when can.need_id is null then null else leg.covered is not distinct from can.covered end as covered_match,
       leg.n_asks || '/' || coalesce(can.n_asks::text, '-') as asks_legacy_vs_canonical
  from leg left join can using (cid)
 order by (can.need_id is null), leg.cid
