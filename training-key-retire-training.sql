-- T3 (2026-09-28) · Training project · replace the shared hub read key with a long random value nobody ever sees.
-- Nothing a browser can reach accepts the key any more (T1, T2). The only reader left is hub-training-data, on the
-- server, which reads whatever value is here and hands it to the three database functions (which answer the server
-- only). So every copy of the old key, in any browser or settings record, becomes worthless.
-- No rollback: the old value is dead by design, and nothing needs it.
begin;
do $pre$ begin
  if not exists (select 1 from public.app_settings where key = 'hub_read_key') then
    raise exception 'T3: there is no hub read key here; nothing changed';
  end if;
end $pre$;
create temp table _t3_before on commit drop as
  select md5(coalesce(value->>'key', '')) as fp from public.app_settings where key = 'hub_read_key';
update public.app_settings
   set value = jsonb_build_object('key', 'retired_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
                                  'note', 'Replaced 2026-09-28 (T3). Only hub-training-data reads this, on the server. Never copy it anywhere.')
 where key = 'hub_read_key';
do $verify$ begin
  if (select md5(value->>'key') from public.app_settings where key = 'hub_read_key') = (select fp from _t3_before) then
    raise exception 'T3: the key did not change; nothing changed'; end if;
  if (select length(value->>'key') from public.app_settings where key = 'hub_read_key') < 70 then
    raise exception 'T3: the new value is too short; nothing changed'; end if;
  raise notice 'T3 Training key replaced';
end $verify$;
commit;
