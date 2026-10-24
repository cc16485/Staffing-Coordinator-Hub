-- 1098 · CAREGIVER PREVIEW (Samantha, 2026-10-24): one record per client for the friendly profile caregivers see on a shift
-- offer, replacing the About / What they enjoy / Share the care needs fields on the Family Circle (care_circles). Read and
-- written only by the caregiver-preview function and the shift page / Booking App readers (service role); no browser access.
-- Existing Family Circle entries are copied across (nothing lost); the old columns stay until the switch has been on a while.
create table if not exists public.client_caregiver_profile (
  id uuid primary key default gen_random_uuid(),
  client_key text not null unique,            -- 'ax:<AxisCare client id>' or 'lead:<lead id>' before they're in AxisCare
  axiscare_client_id text unique,
  lead_id text,
  client_name text,
  draft_about text, draft_enjoys jsonb, draft_share_care boolean not null default false, draft_hidden jsonb not null default '[]'::jsonb,
  intro_changed_at timestamptz, intro_changed_by text, care_changed_at timestamptz, care_changed_by text,
  approved_about text, approved_enjoys jsonb, intro_approved_at timestamptz, intro_approved_by text,
  approved_share_care boolean not null default false, approved_hidden jsonb not null default '[]'::jsonb,
  approved_care_items jsonb not null default '[]'::jsonb, approved_care_sig text, care_approved_at timestamptz, care_approved_by text,
  carried_at timestamptz,
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists client_caregiver_profile_lead on public.client_caregiver_profile (lead_id);
alter table public.client_caregiver_profile enable row level security;
revoke all on public.client_caregiver_profile from anon, authenticated;
grant all on public.client_caregiver_profile to service_role;

-- Carry over what is already on Family Circles (the About and What they enjoy were in use, so they come across approved;
-- Share the care needs comes across as a draft only, to be approved here with a second look).
insert into public.client_caregiver_profile (client_key, axiscare_client_id, client_name, draft_about, draft_enjoys, approved_about, approved_enjoys,
  intro_approved_at, intro_approved_by, draft_share_care, care_changed_at, care_changed_by, carried_at, history)
select 'ax:' || c.axiscare_client_id, c.axiscare_client_id, c.client_name,
  nullif(trim(c.caregiver_about), ''), to_jsonb(c.caregiver_enjoys), nullif(trim(c.caregiver_about), ''), to_jsonb(c.caregiver_enjoys),
  case when nullif(trim(c.caregiver_about), '') is not null or coalesce(cardinality(c.caregiver_enjoys), 0) > 0 then now() end,
  case when nullif(trim(c.caregiver_about), '') is not null or coalesce(cardinality(c.caregiver_enjoys), 0) > 0 then 'Carried over from the Family Circle' end,
  coalesce(c.caregiver_share_care, false), case when c.caregiver_share_care then now() end, case when c.caregiver_share_care then 'carried-over' end,
  now(), jsonb_build_array(jsonb_build_object('at', now(), 'by', 'Carried over', 'what', 'copied from the Family Circle', 'kind', 'carried'))
from public.care_circles c
where c.active is not false and coalesce(c.axiscare_client_id, '') ~ '^\d+$'
  and (nullif(trim(c.caregiver_about), '') is not null or coalesce(cardinality(c.caregiver_enjoys), 0) > 0 or c.caregiver_share_care is true)
on conflict (client_key) do nothing;
