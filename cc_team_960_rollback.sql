-- Undo 960 (team numbers and reviews, the server): remove the four rules that keep the 'cc_reviews' and 'cc_overdue_log' slots server-only and stop the daily check.
-- The records themselves stay. The cc-team function stays deployed (switched off by ops_settings.team_live).
drop policy if exists app_data_cc_team_sel on public.app_data;
drop policy if exists app_data_cc_team_ins on public.app_data;
drop policy if exists app_data_cc_team_upd on public.app_data;
drop policy if exists app_data_cc_team_del on public.app_data;
do $$ begin perform cron.unschedule('cc-team-daily'); exception when others then null; end $$;
