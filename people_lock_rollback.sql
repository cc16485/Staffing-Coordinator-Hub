-- Undo 442: take the three restrictive rules off app_data (everything else is untouched).
drop policy if exists app_data_people_lock_ins on public.app_data;
drop policy if exists app_data_people_lock_upd on public.app_data;
drop policy if exists app_data_people_lock_del on public.app_data;
