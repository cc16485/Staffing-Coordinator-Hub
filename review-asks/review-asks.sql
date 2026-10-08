-- =====================================================================================================================
-- GOOGLE REVIEW ASKS (Samantha 2026-10-07/08). "I do want review opportunities built into the journey, but not as a generic
-- automatic blast… The Care Coordinator should see a suggested review task/card. I do not want the system automatically
-- sending a Google review request." Her direct review link was verified signed in on 2026-10-08.
--
-- review_ask: one row per suggestion. A happy moment (her five: a family very happy with their caregiver or care; a
-- successful or positive check-in; an especially positive compliment; a hard problem solved and the family grateful; a
-- long-term client clearly satisfied), or a person choosing to ask. The Care Coordinator asks (text, call, in person) or
-- says Not now; a week after asking, one follow-up records whether they left a review. Nothing here sends anything.
-- Only the server (review-moments) reads or writes it; a row that was acted on is never deleted (TEST rows can be).
-- =====================================================================================================================
begin;

create table if not exists public.review_ask (
  ask_id             uuid primary key default gen_random_uuid(),
  axiscare_client_id text not null check (length(btrim(axiscare_client_id)) > 0),
  person_id          uuid,
  client_name        text not null,
  moment             text not null check (moment in ('kind_words', 'care_match', 'checkin', 'solved', 'long_term', 'manual')),
  moment_ref         text,
  moment_on          date,
  who                text,
  about              text,
  quote              text check (quote is null or char_length(quote) <= 1200),
  after_problem      text,
  owner_email        text,
  status             text not null default 'suggested' check (status in ('suggested', 'asked', 'not_now')),
  card_id            text,
  asked_how          text check (asked_how is null or asked_how in ('text', 'call', 'in_person', 'email')),
  asked_who          text,
  asked_by           text,
  asked_by_name      text,
  asked_at           timestamptz,
  followup_card_id   text,
  outcome            text check (outcome is null or outcome in ('left', 'said_would', 'didnt')),
  outcome_by         text,
  outcome_at         timestamptz,
  note               text,
  is_test            boolean not null default false,
  created_by         text not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint review_ask_asked_fields check (status <> 'asked' or (asked_how is not null and asked_by is not null and asked_at is not null))
);
-- one open suggestion per client at a time; the same happy moment never suggests twice
create unique index if not exists review_ask_one_open on public.review_ask (axiscare_client_id) where status = 'suggested';
create unique index if not exists review_ask_one_per_moment on public.review_ask (moment, moment_ref) where moment_ref is not null;
create index if not exists review_ask_by_client on public.review_ask (axiscare_client_id, created_at desc);

-- kept: only a TEST row can be deleted
create or replace function public.review_ask_keep() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and not old.is_test then raise exception 'review asks are kept (only TEST rows can be removed)'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists review_ask_keep on public.review_ask;
create trigger review_ask_keep before delete on public.review_ask for each row execute function public.review_ask_keep();

-- server only: the Hub reads and writes through review-moments (signed-in staff), never the table
alter table public.review_ask enable row level security;
revoke all on public.review_ask from public, anon, authenticated;
grant select, insert, update, delete on public.review_ask to service_role;

commit;
