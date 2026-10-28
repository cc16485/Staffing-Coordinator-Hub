-- family_send.sql · SEND TO FAMILY (Samantha 2026-10-28: "Yes, build it with your picks: Billing owner enters payment forms,
-- no 3-digit code unless AxisCare needs it, start with the four pieces"). Installed by Desktop step 1163. Safe to run again.
-- The office sends ONE person in a client's Family Circle a link to one piece: the payment authorization, a Family Circle
-- check, or the GUIDE program (the whole agreement keeps its own links, client_agreement_links). Like the agreement link:
-- only hashes of the link's secret, the 6-digit code and the session are stored; 7 days; at most one live link per piece
-- per client.
-- family_payments holds what the family typed on the payment form. The card or bank numbers are SEALED in the function
-- (AES-256-GCM, key FAMILY_PAY_KEK, a function secret never stored in the database) and erased for good when the office
-- marks "Entered in AxisCare", or 7 days after signing by the hourly job. What stays: card or bank, the last 4, who signed,
-- when, the authorization words. No 3-digit card code is ever asked for or kept.
-- Both tables are server only: RLS on, no policies, no browser privileges. The switch ops_settings.family_send_live is
-- added OFF (until it is on, only owners can send, to try it).
begin;

create table if not exists public.family_sends (
  id                  uuid primary key default gen_random_uuid(),
  client_ax           text not null check (client_ax ~ '^[0-9]{1,12}$'),
  client_name         text not null default '',
  piece               text not null check (piece in ('payment', 'circle', 'guide')),
  contact_id          uuid not null,
  token_hash          text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  to_name             text not null check (length(to_name) between 2 and 80),
  to_phone            text check (to_phone is null or to_phone ~ '^[0-9]{10}$'),
  to_email            text check (to_email is null or length(to_email) <= 120),
  channels            text[] not null check (cardinality(channels) between 1 and 2 and channels <@ array['sms', 'email']),
  sent                jsonb not null default '{}'::jsonb check (jsonb_typeof(sent) = 'object'),
  sent_by             text not null,
  sent_by_name        text not null default '',
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  revoked_at          timestamptz,
  revoked_by          text,
  opened_at           timestamptz,
  code_hash           text check (code_hash is null or code_hash ~ '^[0-9a-f]{64}$'),
  code_channel        text check (code_channel is null or code_channel in ('sms', 'email')),
  code_sent_at        timestamptz,
  code_expires_at     timestamptz,
  code_sends          integer not null default 0 check (code_sends between 0 and 50),
  code_tries          integer not null default 0 check (code_tries between 0 and 50),
  verified_at         timestamptz,
  verified_via        text check (verified_via is null or verified_via in ('sms', 'email')),
  session_hash        text check (session_hash is null or session_hash ~ '^[0-9a-f]{64}$'),
  session_expires_at  timestamptz,
  done_at             timestamptz,
  result              jsonb,
  check ((to_phone is not null) or (to_email is not null))
);
create index if not exists family_sends_client on public.family_sends (client_ax, created_at desc);
create unique index if not exists family_sends_one_live on public.family_sends (client_ax, piece) where revoked_at is null and done_at is null;

create table if not exists public.family_payments (
  id            uuid primary key default gen_random_uuid(),
  send_id       uuid not null unique references public.family_sends(id),
  client_ax     text not null,
  client_name   text not null default '',
  method        text not null check (method in ('card', 'bank')),
  holder_name   text not null,
  brand         text,
  exp           text check (exp is null or exp ~ '^(0[1-9]|1[0-2])/[0-9]{2}$'),
  zip           text check (zip is null or zip ~ '^[0-9]{5}$'),
  bank_type     text check (bank_type is null or bank_type in ('checking', 'savings')),
  phone         text check (phone is null or phone ~ '^[0-9]{10}$'),
  invoice_email text,
  all_future    boolean not null,
  last4         text not null check (last4 ~ '^[0-9]{4}$'),
  sealed        text,
  signer_name   text not null,
  signed_at     timestamptz not null default now(),
  words         text not null,
  ip            text,
  agent         text,
  reveals       integer not null default 0,
  entered_at    timestamptz,
  entered_by    text,
  erased_at     timestamptz,
  erased_why    text check (erased_why is null or erased_why in ('entered', 'seven_days', 'replaced')),
  check ((sealed is null) = (erased_at is not null))
);
create index if not exists family_payments_client on public.family_payments (client_ax, signed_at desc);

-- every "Show to enter in AxisCare": who and when (never the number). Append only.
create table if not exists public.family_payment_reveals (
  id          bigint generated always as identity primary key,
  payment_id  uuid not null references public.family_payments(id),
  at          timestamptz not null default now(),
  by_email    text not null,
  by_name     text not null default ''
);
create or replace function public.family_payment_reveals_append_only() returns trigger language plpgsql as $f$
begin raise exception 'family_payment_reveals is append-only'; end $f$;
drop trigger if exists family_payment_reveals_keep on public.family_payment_reveals;
create trigger family_payment_reveals_keep before update or delete on public.family_payment_reveals
  for each row execute function public.family_payment_reveals_append_only();

alter table public.family_sends enable row level security;
alter table public.family_payments enable row level security;
alter table public.family_payment_reveals enable row level security;
revoke all on public.family_sends, public.family_payments, public.family_payment_reveals from anon, authenticated;

-- the switch, added OFF (never flipped here)
update public.app_data set data = data || '{"family_send_live": false}'::jsonb
  where key = 'ops_settings' and not (data ? 'family_send_live');

commit;
