-- 576 rollback: remove the four owner-key rules. app_data goes back to exactly the rules it had before 576.
drop policy if exists app_data_owner_keys_sel on public.app_data;
drop policy if exists app_data_owner_keys_ins on public.app_data;
drop policy if exists app_data_owner_keys_upd on public.app_data;
drop policy if exists app_data_owner_keys_del on public.app_data;
select count(*) as remaining from pg_policies where schemaname = 'public' and tablename = 'app_data' and policyname like 'app_data_owner_keys_%';
