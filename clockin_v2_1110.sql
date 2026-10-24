-- 1110 · CARA PHASE 3, MISSED CLOCK-IN VERSION 2 (Samantha, 2026-10-24). One column: a running-late notice whose
-- caregiver said "can't make it" records the call-off case Cara opened for it (or, while the switch is off, which case
-- she WOULD have opened), so it is opened once.
alter table public.late_notices add column if not exists cant_case_would text;
-- the late hand-off: who asked the caregiver on shift to stay, when, and the words (once per notice)
alter table public.late_notices add column if not exists handoff_asked jsonb;
