-- PRN STEP 5a · the texts that carry the PRN Team page link (Samantha 2026-10-29). Lets the PRN records keep the one-time
-- "your PRN Team page is ready" text (kind page_ready_sent, ref page_ready), kept like the welcome text. Safe to run again.
alter table public.prn_touches drop constraint if exists prn_touches_kind_check;
alter table public.prn_touches add constraint prn_touches_kind_check check (kind in ('thanks_sent', 'card_mailed', 'called', 'not_this_one',
  'goback_asked', 'goback_yes', 'goback_no', 'goback_unclear', 'welcome_sent', 'welcome_call', 'handled', 'page_ready_sent'));
