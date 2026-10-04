-- bg_review_446.sql (Desktop 446, 2026-10-04). Samantha approved the revised plan "Telling an applicant something came up
-- on a background check" ("yes to all", https://claude.ai/artifact/92p3yq6QqJxHq2dFLiBbY4).
-- bg_reviews: one row per background review (a candidate + one of our direct checks: FCSR, EDL, OIG, fingerprints).
-- Only the bg-review function writes it (the server key), so every step is a trustworthy record with who and when,
-- kept for the 5-year record MMAC asks for. Signed-in office staff can read it (the Hub shows it on the candidate).
-- At most one open review per candidate and check. Run as one transaction. Adds only; changes no existing row.

create table if not exists public.bg_reviews (
  id                uuid primary key default gen_random_uuid(),
  candidate_id      text not null,
  check_key         text not null check (check_key in ('fcsr', 'edl', 'oig', 'fp')),
  who               text,
  status            text not null default 'open' check (status in ('open', 'waiting_waiver', 'cleared', 'not_hired')),
  result            text not null default 'review' check (result in ('review', 'waiver_needed', 'no_waiver', 'cannot_employ')),
  opened_at         timestamptz not null default now(),
  opened_by         text,
  step1_at          timestamptz,
  step1_told_at     timestamptz,
  step1_by          text,
  step1_how         text,
  step1_note        text,
  step1_held_at     timestamptz,
  step1_claim_at    timestamptz,
  due_date          date,
  due_card_at       timestamptz,
  spoke_at          timestamptz,
  spoke_by          text,
  result_at         timestamptz,
  result_by         text,
  decision_reason   text,
  waiver_wait_at    timestamptz,
  waiver_decided_at timestamptz,
  waiver_outcome    text check (waiver_outcome in ('approved', 'denied')),
  waiver_proof      text,
  cleared_at        timestamptz,
  cleared_by        text,
  cleared_why       text check (cleared_why in ('not_them', 'error_fixed', 'no_waiver', 'waiver_approved')),
  final_at          timestamptz,
  final_by          text,
  final_variant     text check (final_variant in ('waiver', 'decision', 'edl', 'oig')),
  final_how         text,
  final_held_at     timestamptz,
  final_claim_at    timestamptz,
  note              text,
  history           jsonb not null default '[]'::jsonb,
  updated_at        timestamptz not null default now()
);
create unique index if not exists bg_reviews_one_open on public.bg_reviews (candidate_id, check_key) where status in ('open', 'waiting_waiver');
create index if not exists bg_reviews_candidate on public.bg_reviews (candidate_id);

alter table public.bg_reviews enable row level security;
revoke all on public.bg_reviews from public, anon, authenticated;
grant select on public.bg_reviews to authenticated;
grant all on public.bg_reviews to service_role;
drop policy if exists bg_reviews_read on public.bg_reviews;
create policy bg_reviews_read on public.bg_reviews for select to authenticated using (true);
