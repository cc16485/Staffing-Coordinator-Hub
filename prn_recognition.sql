-- =============================================================================
-- PRN STEP 7 · RECOGNITION EXTRAS AND GROWTH (Samantha 2026-10-29: "Yes, build step 7 with its switches off")
-- The PRN Team page's record may now keep 'feedback' (their answers to the twice-yearly questions) and 'oncall_offer' (an
-- on-call offer from their page; the offer itself goes in prn_oncall like one from the welcome call). The PRN records may keep
-- 'feedback_invite_sent' (one invite text per member per round). Every earlier kind stays allowed. Adds only; safe to run again.
-- =============================================================================
set local lock_timeout = '5s';
alter table public.prn_page_log drop constraint if exists prn_page_log_kind_check;
alter table public.prn_page_log add constraint prn_page_log_kind_check check (kind in ('viewed', 'office_preview', 'looking_on', 'looking_off',
  'hours_saved', 'short_notice', 'break_set', 'course_request', 'idea', 'interested', 'feedback', 'oncall_offer'));
alter table public.prn_touches drop constraint if exists prn_touches_kind_check;
alter table public.prn_touches add constraint prn_touches_kind_check check (kind in ('thanks_sent', 'card_mailed', 'called', 'not_this_one',
  'goback_asked', 'goback_yes', 'goback_no', 'goback_unclear', 'welcome_sent', 'welcome_call', 'handled', 'page_ready_sent', 'monthly_sent',
  'feedback_invite_sent'));
