-- ============================================================================
-- 355 · ONE PAY TRACK AT A TIME: the ad and the pay acknowledgment. Samantha's correction 2026-09-29.
-- A caregiver is EITHER on the PRN CNA Team ($20/hr) OR an ongoing caregiver ($18/hr), never both. The live ad and
-- the pay statement on the application said a PRN CNA could take ongoing shifts at $18 and stay on the team for $20.
-- This replaces that wording: $20 for the PRN Team is the offer; $18 is only a short note at the bottom for anyone
-- who'd like to switch to taking an ongoing client (her wording, 2026-09-29). Applications already sent keep the wording and version they accepted.
-- ============================================================================
update public.job_positions set
  pay_ack = 'I understand that Caring Companions PRN CNA Team members are paid $20/hour.',
  pay_ack_version = 'PRN-PAY-2026-09B'
where key = 'prn_cna';

update public.job_postings set
  summary = '$20/hr · Start PRN. Stay flexible.',
  description =
       E'Start PRN. Stay flexible.\n\n'
    || E'Join Caring Companions'' elite PRN CNA Team and earn $20 an hour, with the flexibility to decide when you can help.\n\n'
    || E'You tell us when you''re generally available. When we have an opportunity that may fit, we''ll text you. Can help? Accept it. Can''t help? Decline it. No pressure to accept, and no guilt for declining. There may be times when you can help often and times when you can''t help at all. That''s the beauty of PRN. But once you accept and are confirmed, we must be able to depend on you.\n\n'
    || E'PRN opportunities may include covering open shifts, being a second set of hands, supporting caregivers in the field and, when specifically approved, helping train caregivers.\n\n'
    || E'Apply in under two minutes. We keep this team open all year.\n\n'
    || E'Note: if you''d like to switch to taking an ongoing client, our CNAs are paid $18 an hour.',
  internal_note = 'PRN CNA Team, always on (PRN1, 2026-09-29). ONE pay track at a time: PRN Team $20/hr OR ongoing caregiver $18/hr, never both (her rule, 2026-09-29).',
  updated_at = now()
where slug = 'prn-cna-springfield';
