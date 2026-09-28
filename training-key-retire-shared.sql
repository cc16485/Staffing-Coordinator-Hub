-- T3 (2026-09-28) · shared project · take the retired Training key (and the unused AxisCare-token slot) out of the
-- shared settings records: cc_hub_config (Care Coordinator Hub), settings (Staffing Hub and the caregiver engine) and
-- team_hub_settings (Team Hub, the hub_config item). The updated pages no longer read or write these fields.
-- One transaction; it checks itself (none of the three records still holds the key) and undoes everything if the
-- check fails. Other records holding the old value are counted by the run beforehand (compared inside the database).
-- No rollback: the key was replaced in the Training project first, so the removed value was already worthless.
begin;
create temp table _t3_old on commit drop as
  select v from (
    select nullif(btrim(data->>'training_hub_key'), '') as v from public.app_data where key = 'cc_hub_config' and jsonb_typeof(data) = 'object'
    union all
    select nullif(btrim(data->>'training_hub_key'), '') from public.app_data where key = 'settings' and jsonb_typeof(data) = 'object'
    union all
    select nullif(btrim(e->>'training_hub_key'), '') from public.app_data a, jsonb_array_elements(a.data) e
     where a.key = 'team_hub_settings' and jsonb_typeof(a.data) = 'array' and jsonb_typeof(e) = 'object'
  ) x where v is not null group by v;
update public.app_data set data = data - 'training_hub_key' - 'axiscare_token'
 where key = 'cc_hub_config' and jsonb_typeof(data) = 'object' and (data ? 'training_hub_key' or data ? 'axiscare_token');
update public.app_data set data = data - 'training_hub_key'
 where key = 'settings' and jsonb_typeof(data) = 'object' and data ? 'training_hub_key';
update public.app_data a set data = (
    select coalesce(jsonb_agg(case when jsonb_typeof(e) = 'object' then e - 'training_hub_key' else e end order by i), '[]'::jsonb)
      from jsonb_array_elements(a.data) with ordinality t(e, i))
 where a.key = 'team_hub_settings' and jsonb_typeof(a.data) = 'array'
   and exists (select 1 from jsonb_array_elements(a.data) e where jsonb_typeof(e) = 'object' and e ? 'training_hub_key');
do $verify$ begin
  if exists (select 1 from public.app_data where key = 'cc_hub_config' and jsonb_typeof(data) = 'object' and (data ? 'training_hub_key' or data ? 'axiscare_token'))
     or exists (select 1 from public.app_data where key = 'settings' and jsonb_typeof(data) = 'object' and data ? 'training_hub_key')
     or exists (select 1 from public.app_data a, jsonb_array_elements(a.data) e where a.key = 'team_hub_settings' and jsonb_typeof(a.data) = 'array'
                 and jsonb_typeof(e) = 'object' and e ? 'training_hub_key') then
    raise exception 'T3: a settings record still holds the key; nothing changed'; end if;
  raise notice 'T3 shared settings cleaned (% distinct old value(s) removed)', (select count(*) from _t3_old);
end $verify$;
commit;
