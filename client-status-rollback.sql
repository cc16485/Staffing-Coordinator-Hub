-- client-status-rollback.sql · removes Change 3's tables and doors while unused.
-- Refuses once any review exists (a person's answers are not thrown away).
begin;
do $guard$
declare n bigint;
begin
  if to_regclass('public.client_status_review') is not null then
    lock table public.client_status_review in access exclusive mode;
    select count(*) into n from public.client_status_review;
    if n > 0 then raise exception 'client_status rollback refused: % review(s) recorded. Nothing was changed.', n; end if;
  end if;
end $guard$;
drop function if exists public.client_status_decide(uuid, text, date, text, text, text, text);
drop function if exists public.client_status_review_open(jsonb, text);
drop function if exists public.client_status_current_refresh(jsonb, timestamptz);
drop table if exists public.client_status_review;
drop table if exists public.client_status_current;
drop function if exists public.client_status_review_guard();
commit;
