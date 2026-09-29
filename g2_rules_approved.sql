-- G2 (2026-09-29) · the list of rules-file versions the server may run (see _shared/approved-rules.ts).
-- Only the server role can read or write it; the Hub (signed-in staff) and the public key have no access at all.
-- Rows are added only by a reviewed Desktop step (g2 install, then "approve the new rules" steps), which keeps the
-- newest two per file so undoing a Hub change never stops the server.
-- Rollback: redeploy the five jobs from the commit before G2 (they ignore this table); the table can stay.
begin;
create table if not exists public.rules_approved (
  file        text        not null check (file ~ '^[a-z0-9-]+\.js$'),
  sha256      text        not null check (sha256 ~ '^[0-9a-f]{64}$'),
  approved_at timestamptz not null default now(),
  note        text,
  primary key (file, sha256)
);
alter table public.rules_approved enable row level security;
revoke all on public.rules_approved from public, anon, authenticated;
grant all on public.rules_approved to service_role;
commit;
