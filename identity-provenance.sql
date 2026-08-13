-- =============================================================================
-- PROVENANCE ON RECOVERED IDENTIFIERS — a permanent rule, not a guard
-- =============================================================================
-- On 13 August 2026, 52 caregiver phone numbers were copied from GoHighLevel on
-- the basis of an exact full-name match and nothing else, and the identity layer
-- was rebuilt on top of them. Restoring the roster alone would have left
-- phone_index rows still making those numbers look authoritative.
--
-- The durable fix is not a guard around bad data. It is that any identifier
-- imported from another system must carry where it came from and how much it is
-- trusted, so nothing downstream can mistake a probable match for a confirmed
-- one.
--
-- THE RULE: automated outbound communication must never treat a 'probable'
-- identity match as equivalent to an authoritative phone number.
-- =============================================================================

alter table phone_index
  add column if not exists source_system      text,
  add column if not exists source_record_id   text,
  add column if not exists confidence         text not null default 'confirmed',
  add column if not exists imported_at        timestamptz,
  add column if not exists verification_status text not null default 'unverified',
  add column if not exists verified_by        text,
  add column if not exists verified_at        timestamptz;

do $$
begin
  alter table phone_index add constraint phone_index_confidence_check
    check (confidence in ('confirmed','probable','suspect'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table phone_index add constraint phone_index_verification_check
    check (verification_status in ('unverified','verified','rejected'));
exception when duplicate_object then null;
end $$;

-- The single question every sender must ask before dialling or texting.
-- A number is safe for automation only when it is confirmed AND not rejected.
-- 'probable' is explicitly NOT safe, however plausible it looks.
create or replace view phone_safe_for_outreach as
  select ph.phone, ph.person_id, pi.display_name,
         ph.confidence, ph.verification_status, ph.source_system,
         (ph.confidence = 'confirmed' and ph.verification_status <> 'rejected')
           as safe_for_automation
  from phone_index ph
  join person_identity pi on pi.id = ph.person_id;

revoke all on phone_safe_for_outreach from anon;
grant select on phone_safe_for_outreach to authenticated;

-- Same provenance on the identity source map, so a link's evidence is visible.
alter table person_source_id
  add column if not exists evidence   text,
  add column if not exists imported_at timestamptz;

comment on column phone_index.confidence is
  'confirmed = an authoritative source or an independently corroborated match. '
  'probable = plausible but resting on one weak signal such as a name. '
  'NEVER let automated outbound treat probable as confirmed.';
comment on column phone_index.source_system is
  'Where this number came from: axiscare, ghl, hub, office_entry.';
comment on column phone_index.verification_status is
  'unverified until a human or an authoritative source has agreed it is right.';
