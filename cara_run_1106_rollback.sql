-- 1106 rollback: only coverage-run reads these. Turn cara_run_live off and redeploy the previous coverage-run first.
drop table if exists public.cara_run_event;
drop table if exists public.cara_run;
