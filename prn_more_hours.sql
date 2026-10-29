-- =============================================================================
-- PRN · "WOULD YOU LIKE MORE HOURS?" ON THE PRN TEAM PAGE (2026-10-29, plan section 3: the 60-day check-in plus "Would you like
-- more hours?"; the check-in text already opens their page at My hours). The page's record may now keep 'more_hours' (their
-- answer, yes or no). Every earlier kind stays allowed, including the on-call calendar's. Adds only; safe to run again.
-- =============================================================================
set local lock_timeout = '5s';
alter table public.prn_page_log drop constraint if exists prn_page_log_kind_check;
alter table public.prn_page_log add constraint prn_page_log_kind_check check (kind in ('viewed', 'office_preview', 'looking_on', 'looking_off',
  'hours_saved', 'short_notice', 'break_set', 'course_request', 'idea', 'interested', 'feedback', 'oncall_offer', 'oncall_signed', 'oncall_ask', 'more_hours'));
