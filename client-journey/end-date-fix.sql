-- 502 (Samantha 2026-10-08, "yes add the end date fix"): a past or deceased client's end date can be corrected from their
-- profile, with how we know. The correction is one more permanent care change (kind 'end_date'); nothing else changes.
begin;
alter table public.client_care_change drop constraint if exists client_care_change_kind_check;
alter table public.client_care_change add constraint client_care_change_kind_check
  check (kind in ('pause', 'extend', 'resume', 'end', 'return', 'end_date'));
commit;
