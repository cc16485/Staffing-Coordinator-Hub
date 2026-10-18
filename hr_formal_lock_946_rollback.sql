-- Undo 946 (write-ups owner-only in the database). Removes the four restrictive rules, so write-ups go back to being
-- readable by every Care Coordinator, Staffing and Team Hub sign-in, as before 946. The list itself was never changed;
-- the copy in discipline_actions_946_previous is left in place (no browser can read it).
drop policy if exists app_data_hr_formal_sel on public.app_data;
drop policy if exists app_data_hr_formal_ins on public.app_data;
drop policy if exists app_data_hr_formal_upd on public.app_data;
drop policy if exists app_data_hr_formal_del on public.app_data;
