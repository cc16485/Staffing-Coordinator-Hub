-- ============================================================================
-- PRN1 · the always-on PRN CNA posting (Desktop 352 publishes it only after the live proof passes).
-- SHARED HUB PROJECT. Inserted once; running this again never overwrites an edit made in the Hub.
-- ============================================================================
-- No expiry date: this team is recruited all year. Everything else is the approved advert, word for word.
insert into public.job_postings (slug, status, title, description, employment_type, pay_min, pay_max, pay_unit,
                                 summary, qualifications, openings, position, indeed_feed, valid_through, internal_note)
select 'prn-cna-springfield', 'published', 'PRN CNA',
       E'Caring Companions'' PRN CNA Team is for CNAs who want flexible, as-needed work in Springfield and southwest Missouri. PRN Team shifts pay $20 an hour.\n\n'
       || E'You tell us the days and times you''re generally available and how much notice you need. When a qualifying open shift comes up, we contact you first, and you choose whether to take it. There''s no minimum.\n\n'
       || E'If you''d also like an ongoing, regularly scheduled client, you can take one too. Ongoing scheduled shifts are paid at $18 an hour, and you stay on the PRN Team for pickups at $20.\n\n'
       || E'Apply in under two minutes. We keep this team open all year.',
       'PER_DIEM', 20, null, 'HOUR',
       '$20/hr · Pick up shifts that fit your schedule',
       E'A current CNA certification\nA driver''s license and reliable transportation\nAt least a year of caregiving experience\nAble to pass a background check and references',
       1, 'prn_cna', true, null,
       'PRN CNA Team, always on (PRN1, 2026-09-29). PRN and open coverage $20/hr; ongoing assignments $18/hr.'
where not exists (select 1 from public.job_postings where slug = 'prn-cna-springfield');
