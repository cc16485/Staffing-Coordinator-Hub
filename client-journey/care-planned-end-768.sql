-- 768 · PLANNED END OF CARE (Samantha 2026-10-15: "both new reasons under the 21-day notice rule, plus planned future end
-- dates"). Two more kinds of permanent care change: end_planned (End care with a last day in the future; every check runs
-- when it is recorded) and end_cancelled (a planned end called off, with why). A planned end needs its reason, like an end.
-- Nothing else changes: the table stays permanent (only its checklist can be updated) and no row is touched.
begin;
alter table public.client_care_change drop constraint if exists client_care_change_kind_check;
alter table public.client_care_change add constraint client_care_change_kind_check
  check (kind in ('pause', 'extend', 'resume', 'end', 'return', 'end_date', 'end_planned', 'end_cancelled'));
alter table public.client_care_change drop constraint if exists ccc_end_needs_reason;
alter table public.client_care_change add constraint ccc_end_needs_reason
  check (kind not in ('pause', 'end', 'end_planned') or reason is not null);
do $verify$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_care_change_kind_check' and pg_get_constraintdef(oid) like '%end_planned%' and pg_get_constraintdef(oid) like '%end_cancelled%') then
    raise exception '768 self-check: the new kinds are not allowed'; end if;
  if not exists (select 1 from pg_constraint where conname = 'ccc_end_needs_reason' and pg_get_constraintdef(oid) like '%end_planned%') then
    raise exception '768 self-check: a planned end would not need a reason'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'client_care_change_keep' and not tgisinternal) then
    raise exception '768 self-check: the table is no longer permanent'; end if;
  raise notice '768: planned ends can be recorded';
end $verify$;
commit;
