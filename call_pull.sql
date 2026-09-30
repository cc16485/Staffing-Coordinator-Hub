-- ============================================================================
-- CALLS REACH THE HUB BY THEMSELVES (Desktop 372). Samantha approved 2026-09-30 ("yes to all"). SHARED HUB PROJECT.
-- Safe to run again.
--
-- The GoHighLevel "call transcript" workflow never delivered (370), but 371 proved GoHighLevel transcribes every
-- answered call. So the Hub fetches them: call-pull runs every 10 minutes, takes answered calls since go-live, gets
-- GoHighLevel's transcript and hands it to call-followup (the call reader). One row per call, so each is done once.
--   stage  practice       read and judged; nothing created (ops_settings.call_pull_live off)
--          done           handed to the call reader for real (lead + draft for approval + GHL "lead" tag, as before)
--          no_transcript  still no transcript 2 hours after the call; left alone
--          error          the call reader failed; retried on the next run, up to 3 times
-- Written only by the server. Staff read it (Settings → Calls from GoHighLevel).
-- ============================================================================
create table if not exists public.call_pull_seen (
  message_id    text primary key,          -- GoHighLevel's call message id
  call_at       timestamptz not null,
  direction     text,                      -- in | out
  seconds       int,
  caller        text,                      -- first name + last initial, from GoHighLevel's contact
  stage         text not null check (stage in ('practice', 'done', 'no_transcript', 'error')),
  outcome       text,                      -- e.g. "would create lead", "not a client lead: caregiver applicant"
  branch        text,
  tries         int not null default 1,
  handled_at    timestamptz not null default now()
);
create index if not exists call_pull_seen_call_at_idx on public.call_pull_seen (call_at desc);
alter table public.call_pull_seen enable row level security;
drop policy if exists call_pull_seen_read on public.call_pull_seen;
create policy call_pull_seen_read on public.call_pull_seen for select to authenticated using (true);
revoke all on public.call_pull_seen from anon, authenticated;
grant select on public.call_pull_seen to authenticated;
grant all on public.call_pull_seen to service_role;

-- Go-live starts from now: no earlier call is ever picked up. Practice until she flips call_pull_live in Settings.
update public.app_data
   set data = data || jsonb_build_object('call_pull_since', coalesce(data->>'call_pull_since', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
 where key = 'ops_settings' and jsonb_typeof(data) = 'object';
