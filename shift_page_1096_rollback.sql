-- 1096 rollback: removes the code table (no client data in it, only hashes) and the What they enjoy columns.
drop table if exists public.shift_offer_codes;
alter table public.care_circles drop column if exists caregiver_enjoys;
alter table public.care_circles drop column if exists caregiver_enjoys_by;
alter table public.care_circles drop column if exists caregiver_enjoys_at;
