-- =============================================================================
-- phone_index.confidence must default to PROBABLE, not confirmed
-- =============================================================================
-- The provenance columns were added with `default 'confirmed'`. That means any
-- code writing a phone_index row without stating where the number came from
-- gets a number the outreach gate will send to.
--
-- The default must be the SAFE value. Trust should have to be asserted, never
-- inherited by omission — that is the whole rule this layer exists to hold.
--
-- Existing rows are left alone: the 53 AxisCare-backed caregivers are genuinely
-- confirmed, and re-grading them here would undo a migration that was proven.
-- Only the default changes.
alter table phone_index alter column confidence set default 'probable';

comment on column phone_index.confidence is
  'confirmed = an authoritative source, or independently corroborated. '
  'probable = plausible but resting on one weak signal. DEFAULTS TO PROBABLE: '
  'a caller who does not state their evidence does not get trusted.';
