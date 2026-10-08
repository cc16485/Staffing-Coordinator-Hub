-- 499 (Samantha 2026-10-08, "On or before"): an ended client role must have an end date (person_role_check). When AxisCare
-- has no end date for an imported past client, we store the date we first saw them inactive (at the latest, the import date)
-- and mark it 'on_or_before', so the Hub says "Care ended on or before <date> · exact date not recorded in AxisCare" and never
-- shows it as exact. Empty (null) = an exact date, as every end recorded in the Hub so far. Additive; nothing else changes.
begin;
alter table public.person_role add column if not exists ended_date_basis text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'person_role_ended_date_basis_check') then
    alter table public.person_role add constraint person_role_ended_date_basis_check check (ended_date_basis is null or ended_date_basis in ('exact', 'on_or_before'));
  end if;
end $$;
comment on column public.person_role.ended_date_basis is 'null/exact = ended_at is the real date; on_or_before = AxisCare had no end date, ended_at is when we first saw them inactive';
commit;
