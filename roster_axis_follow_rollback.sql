-- 722 rollback: removes caregiver_active_patch. Changes it already made stay (each is listed on the Caregivers page).
drop function if exists public.caregiver_active_patch(text, bigint, boolean, jsonb);
