-- GATE 2b rollback. Step 1 alone puts every save back exactly as it was before
-- the install (the history table stays, readable, no longer growing).
-- Step 2 removes the history itself; run it only if you want the history gone.

-- step 1 · stop watching
drop trigger if exists lead_change_capture_t on public.app_data;
drop function if exists public.lead_change_capture();

-- step 2 · remove the history (only on purpose)
-- drop table if exists public.lead_change;
-- drop function if exists public.lead_change_guard();
-- drop function if exists public.lead_change_keep(text, jsonb);
-- drop function if exists public.lead_change_blank(jsonb);
