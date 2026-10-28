-- ============================================================================
-- 1164 · SHARED HUB PROJECT (zngsgedlsxinbygwmxwn) · CAREGIVER PROFILES TO FAMILIES BEFORE A NEW CAREGIVER (Samantha 2026-10-28)
-- "Approved as written, including the 5 decisions as you suggested. Build it with the switch off and start the practice week."
--   1. caregiver_intro_log learns who and whom by AxisCare id, the visit, and whether it went by itself
--   2. caregiver_client_history: a year of which caregiver has visited which client (AxisCare's completed visits)
--   3. profile_intro_pairs: one row per caregiver per client, the once-only record
--   4. profile_intro_runs: one row per day, what would go (practice) or went, and the cards. Kept 30 days.
--   5. Start of Care step 7: "Family told the date, time and caregiver" ticks itself when the first-visit profile went
--   6. her approval on record, the switch added OFF (only when missing, so running this again never changes either)
-- The server alone reads and writes the new tables. Run inside one transaction by the step.
-- ============================================================================
alter table public.caregiver_intro_log add column if not exists client_axiscare_id text;
alter table public.caregiver_intro_log add column if not exists caregiver_axiscare_id text;
alter table public.caregiver_intro_log add column if not exists visit_id text;
alter table public.caregiver_intro_log add column if not exists auto boolean not null default false;
create index if not exists caregiver_intro_log_pair_idx on public.caregiver_intro_log (client_axiscare_id, caregiver_axiscare_id, sent_at);

create table if not exists public.caregiver_client_history (
  client_axiscare_id    text not null,
  caregiver_axiscare_id text not null,
  last_day              date not null,
  primary key (client_axiscare_id, caregiver_axiscare_id)
);

create table if not exists public.profile_intro_pairs (
  id                    text primary key,            -- <client axiscare id>_<caregiver axiscare id>
  client_axiscare_id    text not null,
  caregiver_axiscare_id text not null,
  client_name           text,
  caregiver_name        text,
  visit_id              text,
  visit_start           text,
  reason                text,                         -- first_visit | new_caregiver
  status                text not null,                -- practice | sent | retry | blocked | no_time | not_wanted | opted_out | gave_up
  tries                 integer not null default 0,
  last_try              timestamptz,
  sent_at               timestamptz,
  sent_to               jsonb,
  card                  text,
  card_at               timestamptz,
  why                   text,
  updated_at            timestamptz not null default now()
);

create table if not exists public.profile_intro_runs (
  run_day  date primary key,
  ran_at   timestamptz not null default now(),
  live     boolean not null default false,
  ok       boolean not null default false,
  problems jsonb not null default '[]'::jsonb,
  would    jsonb not null default '[]'::jsonb,
  cards    jsonb not null default '[]'::jsonb,
  sent     integer not null default 0
);

alter table public.caregiver_client_history enable row level security;
alter table public.profile_intro_pairs enable row level security;
alter table public.profile_intro_runs enable row level security;
revoke all on public.caregiver_client_history, public.profile_intro_pairs, public.profile_intro_runs from anon, authenticated;
grant all on public.caregiver_client_history, public.profile_intro_pairs, public.profile_intro_runs to service_role;

-- Start of Care step 7: the family-told check is ticked by the Hub when the first-visit profile went (a person can still tick it)
update public.client_journey_step_def
   set def = jsonb_set(def, '{checks}', (select jsonb_agg(case when c->>'key' = 'family_told' then c || '{"auto": "profile_sent_first"}'::jsonb else c end order by n)
                                           from jsonb_array_elements(def->'checks') with ordinality as x(c, n))),
       updated_at = now(), updated_by = '1164 caregiver profiles'
 where key = 'soc.start' and not exists (select 1 from jsonb_array_elements(def->'checks') c where c->>'key' = 'family_told' and c ? 'auto');

-- Her approval, in her words, and the switch OFF. Only added when missing.
update public.app_data set data = jsonb_build_object('profile_intro_approved', jsonb_build_object('by', 'Samantha Troutman', 'at', '2026-10-28',
    'words', 'Approved as written, including the 5 decisions as you suggested. Build it with the switch off and start the practice week.',
    'plan', 'https://claude.ai/artifact/6UCG72cozFDT31cZozVeLM')) || data
  where key = 'ops_settings' and jsonb_typeof(data) = 'object' and not (data ? 'profile_intro_approved');
update public.app_data set data = jsonb_build_object('profile_intro_live', false) || data
  where key = 'ops_settings' and jsonb_typeof(data) = 'object' and not (data ? 'profile_intro_live');

do $verify$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'caregiver_intro_log' and column_name = 'caregiver_axiscare_id')
    then raise exception '1164 self-check: caregiver_intro_log has no caregiver_axiscare_id'; end if;
  if (select data->>'profile_intro_live' from public.app_data where key = 'ops_settings') is null
    then raise exception '1164 self-check: the switch is missing'; end if;
  raise notice '1164: the tables are in place and the switch is %', (select data->>'profile_intro_live' from public.app_data where key = 'ops_settings');
end $verify$;
