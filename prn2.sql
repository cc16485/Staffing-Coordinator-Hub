-- ============================================================================
-- PRN2 · FROM HIRE TO THE PRN TEAM (Desktop 356). Samantha approved 2026-09-29 ("yes to all", with her correction).
-- SHARED HUB PROJECT. Safe to run again.
--
-- ONE PAY TRACK AT A TIME: a CNA is EITHER on the PRN CNA Team ($20/hr) OR an ongoing caregiver ($18/hr), never
-- both. Moving between them is a deliberate, recorded step; nothing here changes a track on its own, nothing switches
-- rates per shift, and nothing asks AxisCare or payroll to tell PRN hours from ongoing hours.
--
--   pay_tracks         each person's CURRENT track and rate. One row per person (the primary key), so two tracks at
--                      once cannot be stored.
--   pay_track_history  every change, append-only: never updated, never deleted.
-- Only the office's prn-team function writes them (through pay_track_change, one transaction). Staff can read them.
-- ============================================================================
create table if not exists public.pay_tracks (
  applicant_id          uuid primary key references public.job_applicants(id) on delete restrict,
  track                 text not null check (track in ('prn_team', 'ongoing')),
  rate                  numeric(6,2) not null check (rate > 0 and rate < 200),
  since                 date not null,
  axiscare_caregiver_id text unique,             -- their caregiver number, once staff link them
  linked_at             timestamptz,
  linked_by             text,
  axiscare_marked_at    timestamptz,             -- when the PRN Team / CNA classes were confirmed in AxisCare
  axiscare_marked_by    text,
  updated_at            timestamptz not null default now()
);

create table if not exists public.pay_track_history (
  id                    bigserial primary key,
  applicant_id          uuid not null references public.job_applicants(id) on delete restrict,
  axiscare_caregiver_id text,
  from_track            text,                     -- null when they first join
  from_rate             numeric(6,2),
  to_track              text not null check (to_track in ('prn_team', 'ongoing')),
  to_rate               numeric(6,2) not null,
  effective_date        date not null,
  changed_by            text not null,
  reason                text not null,
  recorded_at           timestamptz not null default now()
);
create index if not exists pay_track_history_applicant_idx on public.pay_track_history (applicant_id, recorded_at);

alter table public.pay_tracks enable row level security;
alter table public.pay_track_history enable row level security;
drop policy if exists pay_tracks_read on public.pay_tracks;
create policy pay_tracks_read on public.pay_tracks for select to authenticated using (true);
drop policy if exists pay_track_history_read on public.pay_track_history;
create policy pay_track_history_read on public.pay_track_history for select to authenticated using (true);
revoke all on public.pay_tracks, public.pay_track_history from anon, authenticated;
grant select on public.pay_tracks, public.pay_track_history to authenticated;
grant all on public.pay_tracks, public.pay_track_history to service_role;
grant usage, select on sequence public.pay_track_history_id_seq to service_role;

-- History is kept as it happened. Not even the server key can edit or remove a line.
create or replace function public.pay_track_history_frozen()
returns trigger language plpgsql as $$
begin
  raise exception 'HISTORY_IS_KEPT' using errcode = 'P0001', hint = 'Pay-track history is never edited or deleted.';
end $$;
drop trigger if exists pay_track_history_frozen on public.pay_track_history;
create trigger pay_track_history_frozen before update or delete on public.pay_track_history
  for each row execute function public.pay_track_history_frozen();

-- ---------------------------------------------------------------------------
-- pay_track_change: the one way a track starts or changes. The current row and its history line are written
-- together or not at all. p_from_expected guards against two people moving the same person at once.
--   start: no current row yet, to 'prn_team'           move: current track = p_from_expected, to the other track
-- ---------------------------------------------------------------------------
create or replace function public.pay_track_change(p_applicant uuid, p_from_expected text, p_to text, p_rate numeric,
                                                   p_effective date, p_by text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare cur public.pay_tracks;
begin
  if p_to not in ('prn_team', 'ongoing') then raise exception 'BAD_TRACK' using errcode = 'P0001'; end if;
  if p_rate is null or p_rate <= 0 or p_rate >= 200 then raise exception 'BAD_RATE' using errcode = 'P0001'; end if;
  if coalesce(trim(p_by), '') = '' or coalesce(trim(p_reason), '') = '' or p_effective is null then
    raise exception 'WHO_WHY_WHEN_REQUIRED' using errcode = 'P0001';
  end if;
  select * into cur from public.pay_tracks where applicant_id = p_applicant for update;
  if not found then
    if p_from_expected is not null or p_to <> 'prn_team' then raise exception 'NO_TRACK_YET' using errcode = 'P0001'; end if;
    insert into public.pay_tracks (applicant_id, track, rate, since) values (p_applicant, p_to, p_rate, p_effective);
  else
    if p_from_expected is null then return jsonb_build_object('outcome', 'already', 'track', cur.track, 'rate', cur.rate); end if;
    if cur.track is distinct from p_from_expected then raise exception 'TRACK_CHANGED' using errcode = 'P0001'; end if;
    if cur.track = p_to then raise exception 'SAME_TRACK' using errcode = 'P0001'; end if;
    update public.pay_tracks set track = p_to, rate = p_rate, since = p_effective, updated_at = now() where applicant_id = p_applicant;
  end if;
  insert into public.pay_track_history (applicant_id, axiscare_caregiver_id, from_track, from_rate, to_track, to_rate, effective_date, changed_by, reason)
  values (p_applicant, cur.axiscare_caregiver_id, cur.track, cur.rate, p_to, p_rate, p_effective, trim(p_by), trim(p_reason));
  return jsonb_build_object('outcome', 'changed', 'from', cur.track, 'from_rate', cur.rate, 'to', p_to, 'rate', p_rate);
end $$;
revoke all on function public.pay_track_change(uuid, text, text, numeric, date, text, text) from public, anon, authenticated;
grant execute on function public.pay_track_change(uuid, text, text, numeric, date, text, text) to service_role;
