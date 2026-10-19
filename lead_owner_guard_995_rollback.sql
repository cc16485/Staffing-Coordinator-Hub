-- undo 995: the guard goes; nothing else changed
drop trigger if exists lead_owner_guard on public.app_data;
drop function if exists public.lead_owner_guard();
