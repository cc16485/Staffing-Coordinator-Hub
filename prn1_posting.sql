-- ============================================================================
-- PRN1 · the always-on PRN CNA posting (Desktop 352 publishes it only after the live proof passes).
-- SHARED HUB PROJECT. Inserted once; running this again never overwrites an edit made in the Hub.
-- ============================================================================
-- No expiry date: this team is recruited all year. Everything else is the approved advert, word for word.
insert into public.job_postings (slug, status, title, description, employment_type, pay_min, pay_max, pay_unit,
                                 summary, qualifications, openings, position, indeed_feed, valid_through, internal_note)
select 'prn-cna-springfield', 'published', 'PRN CNA',
       E'Start PRN. Stay flexible.\n\n'
       || E'Join Caring Companions'' elite PRN CNA Team and earn $20 an hour, with the flexibility to decide when you can help.\n\n'
       || E'You tell us when you''re generally available. When we have an opportunity that may fit, we''ll text you. Can help? Accept it. Can''t help? Decline it. No pressure to accept, and no guilt for declining. There may be times when you can help often and times when you can''t help at all. That''s the beauty of PRN. But once you accept and are confirmed, we must be able to depend on you.\n\n'
       || E'PRN opportunities may include covering open shifts, being a second set of hands, supporting caregivers in the field and, when specifically approved, helping train caregivers.\n\n'
       || E'Apply in under two minutes. We keep this team open all year.\n\n'
       || E'Note: if you''d like to switch to taking an ongoing client, our CNAs are paid $18 an hour.',
       'PER_DIEM', 20, null, 'HOUR',
       '$20/hr · Start PRN. Stay flexible.',
       E'A current CNA certification\nA driver''s license and reliable transportation\nAt least a year of caregiving experience\nAble to pass a background check and references',
       1, 'prn_cna', true, null,
       'PRN CNA Team, always on (PRN1, 2026-09-29). ONE pay track at a time: PRN Team $20/hr OR ongoing caregiver $18/hr, never both (her rule, 2026-09-29).'
where not exists (select 1 from public.job_postings where slug = 'prn-cna-springfield');
