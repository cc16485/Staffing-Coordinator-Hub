-- 1108 rollback: only coverage-watch writes these. Redeploy the previous coverage-watch first.
drop table if exists public.visit_last;
drop table if exists public.visit_history;
