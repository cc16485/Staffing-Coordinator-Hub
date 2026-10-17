-- =============================================================================
-- Family app Release 2: stays accurate (Samantha 2026-10-17: "Start Release 2.").
--  * family_bookings: when AxisCare was last read for a confirmed app visit (ax_checked_at), what it showed (sync_state:
--    ok | no_caregiver | removed, sync_note = the caregiver who came off), who removed it (cancel_source 'office'), and
--    the one change message owed to the family (family_change_*: pending, kind caregiver | time | both, what it changed
--    from, when and how it went).
--  * ops_settings: her approval of the two change messages recorded:
--      family_cgchange_text_approved   (Oct 17 review, decision 5: "Approve, include not-filled and caregiver-changed messages")
--      family_timechange_text_approved (Oct 17: "Send families a text when AxisCare moves a confirmed app visit to a
--                                       different time?" = "Yes (Recommended)", 8 AM to 8 PM)
-- Changes nothing else. Idempotent. All or nothing.
-- =============================================================================
begin;
do $guard$ begin
  if to_regclass('public.family_bookings') is null then raise exception 'family_bookings is missing (run the family app steps first). Nothing was changed.'; end if;
end $guard$;
alter table public.family_bookings add column if not exists ax_checked_at timestamptz;
alter table public.family_bookings add column if not exists sync_state text;
alter table public.family_bookings add column if not exists sync_note text;
alter table public.family_bookings add column if not exists cancel_source text;
alter table public.family_bookings add column if not exists family_change_pending boolean not null default false;
alter table public.family_bookings add column if not exists family_change_at timestamptz;
alter table public.family_bookings add column if not exists family_change_from jsonb;
alter table public.family_bookings add column if not exists family_change_kind text;
alter table public.family_bookings add column if not exists family_change_how text;
create index if not exists family_bookings_change_due on public.family_bookings (family_change_pending) where family_change_pending;
update public.app_data
   set data = jsonb_build_object(
                'family_cgchange_text_approved', jsonb_build_object('by', 'Samantha', 'on', '2026-10-17',
                  'words', 'Family notifications: Approve, include not-filled and caregiver-changed messages',
                  'scope', 'ONE message to the person who booked when AxisCare shows another caregiver on their confirmed app visit and Coverage Help is not already telling them. The text with Texts OK, else the email; 8 AM to 8 PM Central'),
                'family_timechange_text_approved', jsonb_build_object('by', 'Samantha', 'on', '2026-10-17',
                  'words', 'Send families a text when AxisCare moves a confirmed app visit to a different time? Yes (Recommended)',
                  'scope', 'ONE message to the person who booked when AxisCare moves their confirmed app visit to another time or day. The text with Texts OK, else the email; 8 AM to 8 PM Central')
              ) || coalesce(data, '{}'::jsonb)
 where key = 'ops_settings';
commit;
