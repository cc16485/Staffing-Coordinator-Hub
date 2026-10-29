-- ============================================================================
-- PRN STEP 2 · THE "THIS WEEK" LIST AND THE ON-CALL CALENDAR (Samantha 2026-10-28: "start building PRN step 2 with the
-- switches off"; the office-side sample she approved the same day). Safe to run again.
--   prn_touches  what the office did for a PRN member from the This week list: a thank-you texted, a handwritten card
--                mailed, a check-in call, or "not this one". One row per member, kind and reference (a shift, a
--                milestone, a week). Kept, never edited or deleted.
--   prn_oncall   the PRN CNA Team's on-call: what each member offered (every weekend, every other weekend, one weekend a
--                month, a weekday, not right now), and the dates the office confirmed with them. An offer alone never puts
--                anyone on call. A confirmed date can be taken back (cancelled_at), never deleted.
-- Written only by the office's prn-week function (service role). Office staff can read both. Nothing here touches pay:
-- the on-call stipend amount is not set yet (her call), so nothing stores or computes one.
-- ============================================================================
create table if not exists public.prn_touches (
  id            bigserial primary key,
  applicant_id  uuid not null references public.job_applicants(id) on delete restrict,
  kind          text not null check (kind in ('thanks_sent', 'card_mailed', 'called', 'not_this_one')),
  ref           text not null check (length(btrim(ref)) between 1 and 120),
  note          text check (note is null or length(note) <= 600),
  message       text check (message is null or length(message) <= 700),
  by_email      text not null,
  by_name       text,
  at            timestamptz not null default now(),
  unique (applicant_id, kind, ref)
);
create index if not exists prn_touches_member_idx on public.prn_touches (applicant_id, at desc);
alter table public.prn_touches enable row level security;
drop policy if exists prn_touches_read on public.prn_touches;
create policy prn_touches_read on public.prn_touches for select to authenticated using (true);
revoke all on public.prn_touches from anon, authenticated;
grant select on public.prn_touches to authenticated;
grant all on public.prn_touches to service_role;
grant usage, select on sequence public.prn_touches_id_seq to service_role;

create or replace function public.prn_touches_frozen()
returns trigger language plpgsql as $$
begin
  raise exception 'HISTORY_IS_KEPT' using errcode = 'P0001', hint = 'What the office did is never edited or deleted.';
end $$;
drop trigger if exists prn_touches_frozen on public.prn_touches;
create trigger prn_touches_frozen before update or delete on public.prn_touches
  for each row execute function public.prn_touches_frozen();

create table if not exists public.prn_oncall (
  id            bigserial primary key,
  applicant_id  uuid not null references public.job_applicants(id) on delete restrict,
  kind          text not null check (kind in ('offer', 'confirmed')),
  pattern       text check (pattern is null or pattern in ('every_weekend', 'every_other_weekend', 'one_weekend_month', 'weekday', 'not_now')),
  start_date    date,
  end_date      date,
  note          text check (note is null or length(note) <= 300),
  by_email      text not null,
  by_name       text,
  at            timestamptz not null default now(),
  cancelled_at  timestamptz,
  cancelled_by  text,
  constraint prn_oncall_offer_has_pattern check (kind <> 'offer' or pattern is not null),
  constraint prn_oncall_confirmed_has_dates check (kind <> 'confirmed' or (start_date is not null and end_date is not null and end_date >= start_date and end_date - start_date <= 6))
);
create index if not exists prn_oncall_member_idx on public.prn_oncall (applicant_id, at desc);
create index if not exists prn_oncall_dates_idx on public.prn_oncall (start_date) where kind = 'confirmed' and cancelled_at is null;
create unique index if not exists prn_oncall_one_confirm on public.prn_oncall (applicant_id, start_date) where kind = 'confirmed' and cancelled_at is null;
alter table public.prn_oncall enable row level security;
drop policy if exists prn_oncall_read on public.prn_oncall;
create policy prn_oncall_read on public.prn_oncall for select to authenticated using (true);
revoke all on public.prn_oncall from anon, authenticated;
grant select on public.prn_oncall to authenticated;
grant all on public.prn_oncall to service_role;
grant usage, select on sequence public.prn_oncall_id_seq to service_role;

/* A confirmed date can only be taken back (cancelled_at set once); nothing else about a row ever changes, and no row is
   deleted. */
create or replace function public.prn_oncall_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'HISTORY_IS_KEPT' using errcode = 'P0001'; end if;
  if old.cancelled_at is not null or new.cancelled_at is null
     or (to_jsonb(new) - 'cancelled_at' - 'cancelled_by') is distinct from (to_jsonb(old) - 'cancelled_at' - 'cancelled_by') then
    raise exception 'ONLY_CANCEL' using errcode = 'P0001', hint = 'An on-call row can only be taken back, once.';
  end if;
  return new;
end $$;
drop trigger if exists prn_oncall_guard on public.prn_oncall;
create trigger prn_oncall_guard before update or delete on public.prn_oncall
  for each row execute function public.prn_oncall_guard();
