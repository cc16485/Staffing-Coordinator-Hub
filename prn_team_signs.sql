-- =============================================================================
-- PRN · OUR TEAMS SIGNS (2026-10-29). Fix found while building them: the 60-day check-in table only allowed answers 'still_right'
-- and 'updated', so an answer from the PRN Team page (how 'prn_page', step 5a) was refused and the check-in stayed unanswered.
-- Allows 'prn_page' too; every earlier answer stays allowed. Adds only; safe to run again.
-- =============================================================================
set local lock_timeout = '5s';
do $c$ declare n text; begin
  for n in select conname from pg_constraint where conrelid = 'public.prn_checkins'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%how%' loop
    execute format('alter table public.prn_checkins drop constraint %I', n);
  end loop;
end $c$;
alter table public.prn_checkins add constraint prn_checkins_how_check check (how is null or how in ('still_right', 'updated', 'prn_page'));
