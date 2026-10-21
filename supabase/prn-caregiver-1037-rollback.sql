-- Rollback for prn-caregiver-1037.sql. The role and the posting are switched off, never deleted (applications may point at
-- them); the screen goes back to asking CNA of every PRN role (run prn1.sql's applicant_screen_prn and ok_messages_808.sql's
-- applicant_screening_gap again for the exact earlier text). Team columns and history stay (history is never edited).
update public.job_positions set active = false where key = 'prn_caregiver';
update public.job_postings set status = 'draft' where slug = 'prn-caregiver-springfield';
drop function if exists public.pay_team_change(uuid, text, text, numeric, date, text, text);
drop function if exists public.pay_track_start(uuid, text, numeric, date, text, text);
