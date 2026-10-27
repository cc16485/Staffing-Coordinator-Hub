-- ============================================================================
-- 1143 · SHARED HUB PROJECT (zngsgedlsxinbygwmxwn) · FRIENDS & FAMILY INVITATIONS (Samantha 2026-10-27)
-- "I approve step 4 as recommended: the wording as written, owners-only tab, family credit on the connected client's invoice,
-- printed card requests emailed to me. Leave office staff out of caregiver invitations. Build it."
-- One row per person: their invitation (when, by text or email, whether it went through) or an owner's Skip with the reason.
-- No phone numbers or emails are kept here. The server alone reads and writes it; owners see it through the Hub's
-- Friends & Family tab (ff-invite-check checks that they are an owner). Card requests: one row per request, so a code
-- can't ask more than once a day. Safe to run again.
-- ============================================================================
create table if not exists public.ff_invites (
  person_key    text primary key,
  kind          text not null check (kind in ('caregiver', 'family')),
  name          text not null default '',
  client_name   text,
  client_ax     text,
  org_id        text,
  code          text,
  status        text not null check (status in ('sent', 'partial', 'failed', 'skipped')),
  channels      jsonb not null default '[]'::jsonb,
  first_sent_at timestamptz,
  last_sent_at  timestamptz,
  sends         integer not null default 0,
  sent_by       text,
  skipped_at    timestamptz,
  skipped_by    text,
  skip_why      text,
  updated_at    timestamptz not null default now()
);
alter table public.ff_invites enable row level security;
revoke all on public.ff_invites from anon, authenticated;
grant all on public.ff_invites to service_role;

create table if not exists public.ff_card_requests (
  id          bigint generated always as identity primary key,
  code        text not null,
  org_id      text,
  how_many    integer not null default 10,
  emailed     boolean not null default false,
  why         text,
  created_at  timestamptz not null default now()
);
create index if not exists ff_card_requests_code_idx on public.ff_card_requests (code, created_at);
alter table public.ff_card_requests enable row level security;
revoke all on public.ff_card_requests from anon, authenticated;
grant all on public.ff_card_requests to service_role;

-- The program's pause switch starts OFF (not paused). Only added when missing. ff_invites_live is not touched here:
-- invitations stay off until Samantha turns them on in the Friends & Family tab after the preview.
update public.app_data set data = jsonb_build_object('ff_program_paused', false) || data
  where key = 'ops_settings' and jsonb_typeof(data) = 'object' and not (data ? 'ff_program_paused');
