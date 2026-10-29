-- ============================================================================
-- PRN STEP 3 · FAMILIAR CLIENTS (Samantha 2026-10-28). prn_touches gains the go-back question and its answers:
--   goback_asked    the "Would you be glad to go back?" text went out (ref 'client:<name key>', message kept)
--   goback_yes/no   their answer: read by coverage-reply when it is a clear YES or NO, or marked by the office
--   goback_unclear  an answer the Hub couldn't read (kept in note), waiting on the office to mark
-- (A client with no PRN backup belongs to no member, so "Plan an intro visit" and "Not this one" on that line are kept in
-- app_data prn_client_marks instead.) Still kept, never edited or deleted. Safe to run again.
-- ============================================================================
alter table public.prn_touches drop constraint if exists prn_touches_kind_check;
alter table public.prn_touches add constraint prn_touches_kind_check check (kind in ('thanks_sent', 'card_mailed', 'called', 'not_this_one',
  'goback_asked', 'goback_yes', 'goback_no', 'goback_unclear'));
insert into public.app_data (key, data) values ('prn_client_marks', '[]'::jsonb) on conflict (key) do nothing;
