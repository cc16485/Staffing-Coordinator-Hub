-- 1097 rollback: removes the What they enjoy and Share the care needs columns.
alter table public.care_circles drop column if exists caregiver_enjoys;
alter table public.care_circles drop column if exists caregiver_enjoys_by;
alter table public.care_circles drop column if exists caregiver_enjoys_at;
alter table public.care_circles drop column if exists caregiver_share_care;
alter table public.care_circles drop column if exists caregiver_share_care_by;
alter table public.care_circles drop column if exists caregiver_share_care_at;
