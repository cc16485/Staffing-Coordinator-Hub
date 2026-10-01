-- ============================================================================
-- SEND A REFERENCE THE FORM BY EMAIL OR TEXT, FROM THE OFFICE (Desktop 377). Samantha approved 2026-10-01 ("yes to all").
-- SHARED HUB PROJECT. Safe to run again.
-- A reference who can't take a call can be emailed the form on the spot, or texted it once they've said OK on the phone.
-- That verbal OK is recorded here (who took it, when, how). Texts are refused by the server without it.
-- Written only by the reference-send function (server key); staff read via the existing authenticated policy.
-- ============================================================================
alter table public.reference_requests
  add column if not exists office_attempts    jsonb default '[]'::jsonb,
  add column if not exists sms_ok_at          timestamptz,
  add column if not exists sms_ok_by          text,
  add column if not exists sms_ok_how         text,
  add column if not exists office_emailed_at  timestamptz,
  add column if not exists office_emailed_by  text,
  add column if not exists office_texted_at   timestamptz,
  add column if not exists office_texted_by   text;
