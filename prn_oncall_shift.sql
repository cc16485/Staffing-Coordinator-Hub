-- =============================================================================
-- PRN ON-CALL SHIFTS (Samantha 2026-10-29: "add a shift choice (daytime, overnight or whole day) when the office confirms on
-- call, with its switch off"). Each confirmed on-call date now says which shift: 'day' (7am to 5pm), 'overnight' (5pm to 7am)
-- or 'whole' (both, 24 hours), so payroll knows what to pay ($25 a shift, $50 a whole day, in her plan). Dates confirmed
-- before this keep no shift ("shift not recorded"). Only confirmed rows carry one. Adds only; safe to run again.
-- =============================================================================
set local lock_timeout = '5s';
alter table public.prn_oncall add column if not exists shift text;
alter table public.prn_oncall drop constraint if exists prn_oncall_shift_check;
alter table public.prn_oncall add constraint prn_oncall_shift_check check (shift is null or (kind = 'confirmed' and shift in ('day', 'overnight', 'whole')));
comment on column public.prn_oncall.shift is 'On-call shift for a confirmed date: day (7am to 5pm), overnight (5pm to 7am), whole (24 hours). Null = recorded before shifts.';
