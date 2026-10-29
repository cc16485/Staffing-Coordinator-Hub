-- ============================================================================
-- PRN STEP 4 · TEAM WELCOME (Samantha 2026-10-29). Safe to run again.
--  1. prn_touches gains the welcome:
--       welcome_sent   the automatic welcome text went out (ref 'welcome', the message as sent), by prn-welcome
--       welcome_call   the coordinator's welcome call, with a short note of what they said (ref 'welcome'), by prn-week
--     Still kept, never edited or deleted.
--  2. Her identity line goes at the top of both PRN postings ("Start PRN. Stay flexible." stays): only where the posting
--     still opens with "Start PRN. Stay flexible." and doesn't have the line yet, so an edit made in the Hub is never
--     overwritten. The site rebuilds the job pages from these within the hour.
-- ============================================================================
alter table public.prn_touches drop constraint if exists prn_touches_kind_check;
alter table public.prn_touches add constraint prn_touches_kind_check check (kind in ('thanks_sent', 'card_mailed', 'called', 'not_this_one',
  'goback_asked', 'goback_yes', 'goback_no', 'goback_unclear', 'welcome_sent', 'welcome_call'));

update public.job_postings
   set description = E'Join our PRN Team. We stand in the gap so families never go without care.\n\n' || description
 where slug in ('prn-cna-springfield', 'prn-caregiver-springfield')
   and description like 'Start PRN. Stay flexible.%'
   and description not ilike '%stand in the gap%';
