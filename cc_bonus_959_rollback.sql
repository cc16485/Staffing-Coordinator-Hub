-- Undo 959 (bonuses, the server): remove the four rules that keep the 'cc_bonuses' slot server-only and stop the daily check.
-- The bonus records themselves stay. The cc-bonus function stays deployed (switched off by ops_settings.bonus_live).
drop policy if exists app_data_cc_bonus_sel on public.app_data;
drop policy if exists app_data_cc_bonus_ins on public.app_data;
drop policy if exists app_data_cc_bonus_upd on public.app_data;
drop policy if exists app_data_cc_bonus_del on public.app_data;
do $$ begin perform cron.unschedule('cc-bonus-daily'); exception when others then null; end $$;
