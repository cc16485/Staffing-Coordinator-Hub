-- =============================================================================
-- ON CALL FOR OUR CAREGIVERS (Samantha 2026-10-30, Krystal's idea: "Yes to all, we will only have caregivers who can do level 3
-- be on-call". Rules in supabase/functions/_shared/prn-oncall.ts, C1 to C7)
--   The on-call records knew people only from the hiring records (job_applicants). Most of our long-time caregivers are only in
--   AxisCare. Each on-call record now names EITHER a PRN member (applicant_id) OR an AxisCare caregiver (caregiver_ax), never
--   both, never neither. Nothing about the PRN records already there changes.
--   oncall_invites   each time the office invited a caregiver (texted their My on-call link, or copied it). Kept as written.
-- Written only by the prn-week and oncall-page functions (service role). Office staff can read. Adds only; safe to run again.
-- =============================================================================
set local lock_timeout = '5s';

do $$ declare t text; begin
  foreach t in array array['prn_oncall', 'prn_oncall_series', 'prn_oncall_marks', 'prn_oncall_terms'] loop
    execute format('alter table public.%I add column if not exists caregiver_ax text', t);
    execute format('alter table public.%I alter column applicant_id drop not null', t);
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_caregiver_ax_check');
    execute format('alter table public.%I add constraint %I check (caregiver_ax is null or caregiver_ax ~ ''^[0-9]{1,12}$'')', t, t || '_caregiver_ax_check');
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_one_person');
    execute format('alter table public.%I add constraint %I check ((applicant_id is null) <> (caregiver_ax is null))', t, t || '_one_person');
  end loop;
end $$;

/* the same "once" rules for caregivers that the PRN records already have */
create unique index if not exists prn_oncall_one_confirm_ax on public.prn_oncall (caregiver_ax, start_date, coalesce(shift, ''))
  where kind = 'confirmed' and cancelled_at is null and caregiver_ax is not null;
create unique index if not exists prn_oncall_one_ask_ax on public.prn_oncall (caregiver_ax, start_date, shift)
  where kind = 'asked' and cancelled_at is null and caregiver_ax is not null;
create unique index if not exists prn_oncall_series_one_live_ax on public.prn_oncall_series (caregiver_ax, weekday, slot)
  where status in ('asked', 'confirmed') and caregiver_ax is not null;
create unique index if not exists prn_oncall_terms_one_ax on public.prn_oncall_terms (caregiver_ax, version) where caregiver_ax is not null;
create index if not exists prn_oncall_member_ax_idx on public.prn_oncall (caregiver_ax, at desc) where caregiver_ax is not null;
create index if not exists prn_oncall_marks_member_ax_idx on public.prn_oncall_marks (caregiver_ax, at) where caregiver_ax is not null;

create table if not exists public.oncall_invites (
  id            bigserial primary key,
  caregiver_ax  text not null check (caregiver_ax ~ '^[0-9]{1,12}$'),
  name          text not null check (length(btrim(name)) between 1 and 120),
  via           text not null check (via in ('text', 'link')),
  message       text check (message is null or length(message) <= 1000),
  by_email      text not null,
  by_name       text,
  at            timestamptz not null default now()
);
create index if not exists oncall_invites_cg_idx on public.oncall_invites (caregiver_ax, at desc);
create or replace function public.oncall_invites_kept()
returns trigger language plpgsql as $$
begin raise exception 'HISTORY_IS_KEPT' using errcode = 'P0001', hint = 'On-call invites are kept as written.'; end $$;
drop trigger if exists oncall_invites_kept on public.oncall_invites;
create trigger oncall_invites_kept before update or delete on public.oncall_invites for each row execute function public.oncall_invites_kept();

alter table public.oncall_invites enable row level security;
drop policy if exists oncall_invites_read on public.oncall_invites;
create policy oncall_invites_read on public.oncall_invites for select to authenticated using (true);
revoke all on public.oncall_invites from anon, authenticated;
grant select on public.oncall_invites to authenticated;
grant all on public.oncall_invites to service_role;
grant usage, select on sequence public.oncall_invites_id_seq to service_role;
