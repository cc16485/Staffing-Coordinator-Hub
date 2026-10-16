-- =============================================================================
-- Family app sign-in by email on file (Samantha 2026-10-16: "yes, build it"). Rules: supabase/functions/_shared/family-signin.ts.
--  * family_signin_attempts: each sign-in check (email, address, outcome), so asking can be limited (5 per email per
--    15 minutes, 30 per address per hour). Server only: no grants to anon or signed-in logins.
--  * ops_settings family_app_test_clients: AxisCare test clients the app treats as active (Test Client 5, #290), only
--    where not already set.
-- Changes nothing else. Idempotent.
-- =============================================================================
begin;
create table if not exists public.family_signin_attempts (
  id bigserial primary key,
  email text not null,
  ip text not null default 'unknown',
  outcome text,
  at timestamptz not null default now()
);
create index if not exists family_signin_attempts_email_at on public.family_signin_attempts (email, at);
create index if not exists family_signin_attempts_ip_at on public.family_signin_attempts (ip, at);
alter table public.family_signin_attempts enable row level security;
revoke all on public.family_signin_attempts from anon, authenticated;
grant all on public.family_signin_attempts to service_role;
grant usage, select on sequence public.family_signin_attempts_id_seq to service_role;

update public.app_data
   set data = jsonb_build_object('family_app_test_clients', jsonb_build_array('290')) || coalesce(data, '{}'::jsonb)
 where key = 'ops_settings';
commit;
