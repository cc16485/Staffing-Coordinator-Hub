-- =====================================================================================================================
-- CLIENT JOURNEY (Stages 1–3, Samantha approved 2026-10-06): ONE canonical journey per person, from the first call to an
-- Active client. Four tables:
--   client_journey_step_def   the catalog: every step, as data an owner can edit later (name, instructions, payers, owner role,
--                      required, how it is proven, due timing, hard gate, what comes first). Not code.
--   journey            one per person (a lead, or an AxisCare client with no lead). Payer, assigned Care Coordinator,
--                      target start, status.
--   client_journey_step       each step's state for that person: answers, evidence (files, verification), waiting and its
--                      check-back date (required), blocked reason, owner exception, who completed it and when.
--   client_journey_event      the permanent history: every change, who, when, why. Append-only: nobody can edit or delete it.
-- Nobody signed in to the Hub reads or writes these tables directly. Everything goes through the `journey` function,
-- which checks the person's office role and runs the same rules file as the page (journey-rules.js), so a hard stop or
-- an owner-only exception can't be bypassed from a browser.
-- =====================================================================================================================
create table if not exists public.client_journey_step_def (
  key             text primary key check (key ~ '^[a-z0-9_.-]{3,60}$'),
  catalog_version int  not null default 1,
  def             jsonb not null check (jsonb_typeof(def) = 'object' and def ? 'title' and def ? 'stage'),
  active          boolean not null default true,
  updated_at      timestamptz not null default now(),
  updated_by      text not null default 'seed'
);

create table if not exists public.client_journey (
  journey_id         uuid primary key default gen_random_uuid(),
  lead_id            text unique,
  axiscare_client_id text unique check (axiscare_client_id is null or axiscare_client_id ~ '^\d+$'),
  person_id          uuid,
  client_name        text not null check (length(btrim(client_name)) > 0),
  payer              text check (payer in ('private', 'medicaid', 'va', 'ltc', 'other')),
  payer_other        text,
  assigned_cc        text,
  staffing_email     text,
  target_start       date,
  status             text not null default 'open' check (status in ('open', 'active', 'closed')),
  closed_reason      text,
  is_test            boolean not null default false,
  created_at         timestamptz not null default now(),
  created_by         text not null,
  updated_at         timestamptz not null default now(),
  constraint cj_has_a_person check (lead_id is not null or axiscare_client_id is not null)
);

create table if not exists public.client_journey_step (
  journey_id        uuid not null references public.client_journey(journey_id) on delete cascade,
  step_key          text not null,
  state             text not null default 'open' check (state in ('open', 'waiting', 'blocked', 'complete', 'not_needed', 'exception')),
  answer            jsonb,
  evidence          jsonb not null default '{}'::jsonb,
  waiting_on        text,
  check_back        date,
  blocked_reason    text,
  unblock           text,
  unblock_role      text,
  owner_email       text,
  exception         jsonb,
  ready_since       timestamptz,
  completed_by      text,
  completed_by_name text,
  completed_at      timestamptz,
  version           int not null default 1,
  updated_at        timestamptz not null default now(),
  primary key (journey_id, step_key),
  -- Samantha: "Waiting cannot become a place where leads disappear." No check-back date, no waiting.
  constraint cj_waiting_needs_check_back check (state <> 'waiting' or check_back is not null),
  constraint cj_blocked_needs_reason check (state <> 'blocked' or length(btrim(coalesce(blocked_reason, ''))) > 0),
  constraint cj_exception_needs_reason check (state <> 'exception' or (exception ? 'reason' and exception ? 'by' and length(btrim(exception->>'reason')) > 0))
);

create table if not exists public.client_journey_event (
  id          bigserial primary key,
  journey_id  uuid not null references public.client_journey(journey_id) on delete cascade,
  step_key    text,
  at          timestamptz not null default now(),
  actor_email text not null,
  actor_name  text,
  kind        text not null,
  detail      jsonb not null default '{}'::jsonb,
  reason      text,
  is_test     boolean not null default false
);
create index if not exists journey_event_by_journey on public.client_journey_event (journey_id, at desc);
create index if not exists client_journey_open on public.client_journey (status) where status = 'open';

-- The history is permanent: no update and no delete, for anyone (the function only ever inserts). The one exception is
-- a made-up TEST journey (is_test), so test clients can be removed after testing; real history never can.
create or replace function public.client_journey_event_keep() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and old.is_test then return old; end if;
  raise exception 'journey history is permanent: it cannot be changed or deleted';
end $$;
create or replace function public.client_journey_event_mark_test() returns trigger language plpgsql as $$
begin
  new.is_test := coalesce((select j.is_test from public.client_journey j where j.journey_id = new.journey_id), false);
  return new;
end $$;
drop trigger if exists client_journey_event_test_flag on public.client_journey_event;
create trigger client_journey_event_test_flag before insert on public.client_journey_event
  for each row execute function public.client_journey_event_mark_test();
drop trigger if exists client_journey_event_no_change on public.client_journey_event;
create trigger client_journey_event_no_change before update or delete on public.client_journey_event
  for each row execute function public.client_journey_event_keep();

-- Only the server (service role, used by the journey function) touches these tables.
revoke all on public.client_journey_step_def, public.client_journey, public.client_journey_step, public.client_journey_event from public, anon, authenticated;
revoke all on sequence public.client_journey_event_id_seq from public, anon, authenticated;
grant select, insert, update on public.client_journey_step_def, public.client_journey, public.client_journey_step to service_role;
grant select, insert on public.client_journey_event to service_role;
grant usage on sequence public.client_journey_event_id_seq to service_role;
alter table public.client_journey_step_def enable row level security;
alter table public.client_journey enable row level security;
alter table public.client_journey_step enable row level security;
alter table public.client_journey_event enable row level security;

-- Proof files live in a private bucket. The function hands out short-lived upload and view links; there is no public
-- access and no signed-in access to the bucket itself.
insert into storage.buckets (id, name, public) values ('client-journey-files', 'client-journey-files', false) on conflict (id) do nothing;
