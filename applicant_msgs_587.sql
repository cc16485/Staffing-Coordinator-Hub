-- applicant_msgs_587.sql (Desktop 587, 2026-10-11). WARMER APPLICANT MESSAGES, REPLIES AND THE CANCEL SCREEN.
-- Samantha: the new wording and timing ("make it more friendly"), "if they reply no they aren't coming to the interview
-- the next day, make sure that opens up the interview spot for someone else", and the cancel screen ("clarity on if
-- they want to book a different time, or they are canceling ... a place for them to say why").
--   · job_applicants: finish_nudge_1_at / finish_nudge_2_at (the "finish your application" texts), nudge_4_at (the
--     day-6 last note).
--   · interview_bookings: confirm_email_at (the confirmation email goes any hour; the text keeps confirmed_at),
--     reminded_2day_at, reply_kind / reply_text / reply_at (their YES / NO / other reply), cancel_kind (why they
--     cancelled, from the cancel screen, or 'replied_no').
--   · interview_cancel_with_reason(p_applicant, p_kind, p_note): the cancel screen. Same rules as interview_cancel (the
--     2-hour and change limits); also keeps why. Anyone with their link, like interview_cancel.
--   · interview_cancel_by_reply(p_booking, p_words): a clear NO to the reminder. Server only (interview-reply). Frees
--     the time at once, whatever the hour, and records their words. The cancellation text then goes from
--     interview-messages as for any cancellation (texts 8am to 6pm).
--   · interview_record_reply(p_booking, p_kind, p_words): a YES or anything else, kept on the booking. Server only.
--     Nothing else changes (YES confirming the interview comes later, after it is tested).
-- Rollback: applicant_msgs_587_rollback.sql (drops the three functions; columns stay, harmless).
begin;

alter table public.job_applicants add column if not exists finish_nudge_1_at timestamptz;
alter table public.job_applicants add column if not exists finish_nudge_2_at timestamptz;
alter table public.job_applicants add column if not exists nudge_4_at timestamptz;
alter table public.interview_bookings add column if not exists confirm_email_at timestamptz;
alter table public.interview_bookings add column if not exists reminded_2day_at timestamptz;
alter table public.interview_bookings add column if not exists reply_kind text;
alter table public.interview_bookings add column if not exists reply_text text;
alter table public.interview_bookings add column if not exists reply_at timestamptz;
alter table public.interview_bookings add column if not exists cancel_kind text;

create or replace function public.interview_cancel_with_reason(p_applicant uuid, p_kind text default null, p_note text default null)
 returns json language plpgsql security definer set search_path to 'public' as $f$
declare
  v_kind text := nullif(trim(coalesce(p_kind, '')), '');
  v_note text := left(nullif(trim(coalesce(p_note, '')), ''), 300);
  v_label text; v_res json;
begin
  if v_kind is not null and v_kind not in ('schedule','found_job','transport','not_interested','other') then
    raise exception 'unknown reason';
  end if;
  v_label := case v_kind when 'schedule' then 'My schedule changed' when 'found_job' then 'Found another job'
                         when 'transport' then 'Transportation' when 'not_interested' then 'Not interested anymore'
                         when 'other' then 'Something else' end;
  -- interview_cancel keeps its own rules (2 hours, change limit) and makes p_by 'applicant' for anyone not signed in.
  v_res := public.interview_cancel(p_applicant, nullif(concat_ws(': ', v_label, v_note), ''), 'applicant');
  if (v_res->>'cancelled')::boolean then
    update public.interview_bookings set cancel_kind = v_kind
     where applicant_id in (select public.applicant_person_ids(p_applicant))
       and status = 'cancelled' and cancelled_at = now();
  end if;
  return v_res;
end $f$;
revoke all on function public.interview_cancel_with_reason(uuid, text, text) from public;
grant execute on function public.interview_cancel_with_reason(uuid, text, text) to anon, authenticated;

create or replace function public.interview_cancel_by_reply(p_booking uuid, p_words text)
 returns json language plpgsql security definer set search_path to 'public' as $f$
declare b public.interview_bookings;
begin
  select * into b from public.interview_bookings where id = p_booking for update;
  if b.id is null or b.status <> 'booked' then return json_build_object('cancelled', false, 'reason', 'not booked'); end if;
  update public.interview_bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = 'applicant',
         cancel_reason = left('Replied NO to the reminder: ' || coalesce(p_words, ''), 300), cancel_kind = 'replied_no',
         reply_kind = 'no', reply_text = left(p_words, 500), reply_at = now()
   where id = p_booking;
  -- the time goes back on the calendar at once (website and the office's Book a time)
  -- (all of this person's interview holds, the same as interview_cancel: one live interview per person since 586)
  delete from public.coordinator_busy where source = 'interview' and source_id in (select x::text from public.applicant_person_ids(b.applicant_id) x);
  return json_build_object('cancelled', true, 'was', b.starts_at, 'applicant_id', b.applicant_id);
end $f$;
revoke all on function public.interview_cancel_by_reply(uuid, text) from public, anon, authenticated;

create or replace function public.interview_record_reply(p_booking uuid, p_kind text, p_words text)
 returns void language sql security definer set search_path to 'public' as $f$
  update public.interview_bookings set reply_kind = p_kind, reply_text = left(p_words, 500), reply_at = now()
   where id = p_booking and status = 'booked'
$f$;
revoke all on function public.interview_record_reply(uuid, text, text) from public, anon, authenticated;

commit;
notify pgrst, 'reload schema';
