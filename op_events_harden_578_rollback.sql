-- 578 rollback: back to the 159 shape of access. Columns and indexes stay (harmless, empty defaults); the guards, the
-- door and the office read rule go; pages may insert directly again and any signed-in account may read, as before 578.
drop trigger if exists op_events_keep_row on public.op_events;
drop trigger if exists op_events_keep_table on public.op_events;
drop function if exists public.op_events_keep();
drop policy if exists op_events_select_office on public.op_events;
drop policy if exists op_events_insert_auth on public.op_events;
drop policy if exists op_events_select_auth on public.op_events;
create policy op_events_insert_auth on public.op_events for insert to authenticated with check (true);
create policy op_events_select_auth on public.op_events for select to authenticated using (true);
grant select, insert on public.op_events to authenticated;
grant all on public.op_events to service_role;
drop function if exists public.record_event(text, text, text, text, jsonb, text, text, text, text, jsonb);
drop function if exists public.hub_office_ok();
select count(*) as guards from pg_trigger where tgrelid = 'public.op_events'::regclass and tgname like 'op_events_keep_%';
