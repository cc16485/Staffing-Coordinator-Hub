-- 1117 · THE LAST 2 HOURS (Samantha 2026-10-24: "DO NOT STOP with 2 hours"). One column on cara_run: when Cara told the
-- office she keeps going in the last 2 hours (once per run), so she tells them once and carries on.
alter table public.cara_run add column if not exists urgent_at timestamptz;
