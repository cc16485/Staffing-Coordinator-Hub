-- Z2 (2026-09-28) · take the stored Zapier addresses out of the shared settings records. The Zapier account is deleted
-- and the updated pages no longer read or send to these. 'settings' (Staffing Hub and the caregiver engine): six webhook
-- fields. 'team_hub_settings' (its hub_config item): the Team Access Automation address. Everything else is kept.
-- One transaction; it checks itself and undoes everything if the check fails. No rollback needed: the account is gone.
begin;
update public.app_data
   set data = data - 'ac_orient_webhook' - 'zapier_orient_webhook' - 'zapier_attend_webhook' - 'zapier_cand_webhook'
                   - 'zapier_not_hired_webhook' - 'ac_new_client_webhook'
 where key = 'settings' and jsonb_typeof(data) = 'object'
   and (data ?| array['ac_orient_webhook','zapier_orient_webhook','zapier_attend_webhook','zapier_cand_webhook','zapier_not_hired_webhook','ac_new_client_webhook']);
update public.app_data a set data = (
    select coalesce(jsonb_agg(case when jsonb_typeof(e) = 'object' then e - 'access_webhook_url' else e end order by i), '[]'::jsonb)
      from jsonb_array_elements(a.data) with ordinality t(e, i))
 where a.key = 'team_hub_settings' and jsonb_typeof(a.data) = 'array'
   and exists (select 1 from jsonb_array_elements(a.data) e where jsonb_typeof(e) = 'object' and e ? 'access_webhook_url');
do $verify$ begin
  if exists (select 1 from public.app_data where key = 'settings' and jsonb_typeof(data) = 'object'
             and data ?| array['ac_orient_webhook','zapier_orient_webhook','zapier_attend_webhook','zapier_cand_webhook','zapier_not_hired_webhook','ac_new_client_webhook'])
     or exists (select 1 from public.app_data a, jsonb_array_elements(a.data) e where a.key = 'team_hub_settings' and jsonb_typeof(a.data) = 'array'
                and jsonb_typeof(e) = 'object' and e ? 'access_webhook_url')
     or exists (select 1 from public.app_data where key in ('settings','team_hub_settings') and data::text ilike '%hooks.zapier.com%') then
    raise exception 'Z2: a settings record still holds a Zapier address; nothing changed'; end if;
  raise notice 'Z2 Zapier addresses cleared';
end $verify$;
commit;
