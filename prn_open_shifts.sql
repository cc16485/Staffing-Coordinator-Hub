-- =============================================================================
-- PRN STEP 5b · OPEN SHIFTS ON THE PRN TEAM PAGE (Samantha 2026-10-29: "Yes, build part 5b with its switch off")
-- The page's own record may now keep "interested" (an I'm Interested tap; the Yes itself goes on the shift's case, as a Yes
-- from the shift page does). Every earlier kind stays allowed. Adds only; safe to run again.
-- =============================================================================
set local lock_timeout = '5s';
alter table public.prn_page_log drop constraint if exists prn_page_log_kind_check;
alter table public.prn_page_log add constraint prn_page_log_kind_check check (kind in ('viewed', 'office_preview', 'looking_on', 'looking_off',
  'hours_saved', 'short_notice', 'break_set', 'course_request', 'idea', 'interested'));
