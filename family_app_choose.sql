-- =============================================================================
-- family_app_choose.sql · "Let me choose" for the family app (her yes 2026-10-16: "Start both: Let me choose with your 5
-- recommended answers, and brand steps 1 and 2. Fix the Approved Driver gap first.")
--  * family_bookings.method: 'auto' (Find someone for me, first yes wins, as today) or 'choose' (caregivers say they're
--    interested, the family picks). choose_by = the family's deadline (24 hours before the visit); family_told_at = when
--    the ONE "caregivers are interested" text went to the person who booked.
--  * family_offers.state gains interested (said yes, not placed), withdrawn (took it back, or no longer free), chosen,
--    not_chosen.
--  * ops_settings, only where not set: Let me choose OFF (family_choose_live false), at most 3 interested, deadline 24 hours,
--    shown only for visits at least 30 hours away, and her approval of the one family text recorded (her named exception
--    to the no-automatic-family-contact rule, this message only).
-- Changes nothing else. Idempotent.
-- =============================================================================
begin;

do $guard$
begin
  if to_regclass('public.family_offers') is null then
    raise exception 'refused: family_offers not found (825 first). Nothing was changed.'; end if;
end $guard$;

alter table public.family_bookings add column if not exists method text not null default 'auto';
alter table public.family_bookings add column if not exists choose_by timestamptz;
alter table public.family_bookings add column if not exists family_told_at timestamptz;
alter table public.family_bookings drop constraint if exists family_bookings_method_ck;
alter table public.family_bookings add constraint family_bookings_method_ck check (method in ('auto', 'choose'));

alter table public.family_offers drop constraint if exists family_offers_state_check;
alter table public.family_offers drop constraint if exists family_offers_state_ck;
alter table public.family_offers add constraint family_offers_state_ck check (state in ('sent', 'yes', 'no', 'taken', 'closed', 'failed', 'interested', 'withdrawn', 'chosen', 'not_chosen'));
create index if not exists family_offers_interested on public.family_offers (booking_id) where state = 'interested';

update public.app_data
   set data = jsonb_build_object(
                'family_choose_live', false,
                'family_choose_max_interested', 3,
                'family_choose_deadline_hours', 24,
                'family_choose_min_lead_hours', 30,
                'family_choose_text_approved', jsonb_build_object('by', 'Samantha', 'on', '2026-10-16',
                  'words', 'Start both: Let me choose with your 5 recommended answers, and brand steps 1 and 2. Fix the Approved Driver gap first.',
                  'scope', 'ONE text to the person who booked, when caregivers are interested in a Let me choose visit, 8 AM to 8 PM, Texts OK only')
              ) || coalesce(data, '{}'::jsonb)
 where key = 'ops_settings';

commit;
