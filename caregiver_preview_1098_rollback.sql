-- 1098 rollback: the Family Circle fields were never changed, so dropping the new record puts things back as they were.
drop table if exists public.client_caregiver_profile;
