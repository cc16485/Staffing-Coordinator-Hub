-- SLICE 7 ROLLBACK · the five catalog rows go inactive (never deleted); the kind list narrows only when no row uses the new kinds.
update public.client_journey_step_def set active = false, updated_by = 'rollback 7' where key in ('cg.axiscare.in_training','cg.axiscare.attributes','cg.axiscare.availability','cg.axiscare.hire_date','cg.axiscare.level');
do $k$ declare cn text; n int; begin
  select count(*) into n from public.axiscare_change_log where kind in ('caregiver_hire_date', 'caregiver_level');
  if n > 0 then raise notice 'slice 7 rollback: % change log row(s) use the new kinds; the kind list is kept so they stay valid', n;
  else
    select conname into cn from pg_constraint where conrelid = 'public.axiscare_change_log'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%client_created%';
    if cn is not null then execute format('alter table public.axiscare_change_log drop constraint %I', cn); end if;
    alter table public.axiscare_change_log add constraint axiscare_change_log_kind_check check (kind in (
      'client_created','client_linked','client_updated','responsible_party','care_level','care_tasks','care_plan_note','client_note',
      'caregiver_note','schedule','visit_caregiver','call_summary','scheduling_note','caregiver_status','prn_team_classes'));
  end if;
end $k$;
