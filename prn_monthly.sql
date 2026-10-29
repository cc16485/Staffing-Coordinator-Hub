-- =============================================================================
-- PRN STEP 6 · THE MONTHLY PRN TEAM UPDATE (Samantha 2026-10-28 decision 7; built 2026-10-29)
-- One row per month: the facts the Hub drafted, the office's own paragraph (and an optional kind word and tip), who saved it,
-- and once it went out, who sent it and when (sent_at is set once and never changes). Each member's text is kept in
-- prn_touches as 'monthly_sent' with ref 'monthly:YYYY-MM' (one per member per month, so a second tap never texts anyone
-- twice). Office staff read it in the Hub; only the server writes. Adds only; safe to run again.
-- =============================================================================
set local lock_timeout = '5s';
create table if not exists public.prn_monthly (
  month       text primary key check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  body        jsonb not null default '{}'::jsonb,
  saved_by    text,
  saved_at    timestamptz,
  sent_by     text,
  sent_at     timestamptz,
  sent_count  integer not null default 0
);
comment on table public.prn_monthly is 'PRN step 6: the monthly PRN Team update (facts, the office paragraph, kind word, tip), one row per month.';
alter table public.prn_monthly enable row level security;
drop policy if exists prn_monthly_read on public.prn_monthly;
create policy prn_monthly_read on public.prn_monthly for select to authenticated using (true);
revoke all on public.prn_monthly from anon, authenticated;
grant select on public.prn_monthly to authenticated;
grant all on public.prn_monthly to service_role;

/* once sent, the month's update stays as it went out */
create or replace function public.prn_monthly_sent_stays() returns trigger language plpgsql set search_path = pg_catalog, public as $f$
begin
  if old.sent_at is not null and (new.sent_at is distinct from old.sent_at or new.body is distinct from old.body or new.sent_by is distinct from old.sent_by) then
    raise exception 'This month''s PRN Team update was already sent and stays as it went out.';
  end if;
  return new;
end $f$;
drop trigger if exists prn_monthly_sent_stays on public.prn_monthly;
create trigger prn_monthly_sent_stays before update on public.prn_monthly for each row execute function public.prn_monthly_sent_stays();
drop trigger if exists prn_monthly_no_delete on public.prn_monthly;
create or replace function public.prn_monthly_no_delete() returns trigger language plpgsql set search_path = pg_catalog, public as $f$
begin raise exception 'PRN Team updates are kept.'; end $f$;
create trigger prn_monthly_no_delete before delete on public.prn_monthly for each row execute function public.prn_monthly_no_delete();

alter table public.prn_touches drop constraint if exists prn_touches_kind_check;
alter table public.prn_touches add constraint prn_touches_kind_check check (kind in ('thanks_sent', 'card_mailed', 'called', 'not_this_one',
  'goback_asked', 'goback_yes', 'goback_no', 'goback_unclear', 'welcome_sent', 'welcome_call', 'handled', 'page_ready_sent', 'monthly_sent'));
