-- agreement_links_874.sql · Client Care Agreement, Stage 3: signing from home (Samantha 2026-10-17: "start stage 3"; her
-- answers "Office picks each time", "6-digit code", "7 days", code "Any time").
-- One row per link the office sends: who it went to and how, when it expires, whether it was opened, the code check, the
-- signature, or who cancelled it. The link's secret, the code and the signing session are stored ONLY as SHA-256 hashes.
-- At most one live link per agreement. Only the client-agreement and agreement-sign functions (service role) read or
-- write it: RLS on, no policies, no browser privileges. Nothing existing changes.
begin;

create table if not exists public.client_agreement_links (
  id                  uuid primary key default gen_random_uuid(),
  agreement_id        uuid not null references public.client_agreements(id),
  token_hash          text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  to_name             text not null check (length(to_name) between 2 and 80),
  to_phone            text check (to_phone is null or to_phone ~ '^[0-9]{10}$'),
  to_email            text check (to_email is null or length(to_email) <= 120),
  channels            text[] not null check (cardinality(channels) between 1 and 2 and channels <@ array['sms', 'email']),
  sent                jsonb not null default '{}'::jsonb check (jsonb_typeof(sent) = 'object'),
  sent_by             text not null,
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
  verified_to         text,
  session_hash        text check (session_hash is null or session_hash ~ '^[0-9a-f]{64}$'),
  session_expires_at  timestamptz,
  signed_at           timestamptz,
  check ((to_phone is not null) or (to_email is not null))
);
create index if not exists client_agreement_links_agreement on public.client_agreement_links (agreement_id, created_at desc);
create unique index if not exists client_agreement_links_one_live on public.client_agreement_links (agreement_id) where revoked_at is null and signed_at is null;

alter table public.client_agreement_links enable row level security;
revoke all on public.client_agreement_links from anon, authenticated;

commit;
