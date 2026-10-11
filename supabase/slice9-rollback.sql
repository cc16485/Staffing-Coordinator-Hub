-- =============================================================================
-- SLICE 9 ROLLBACK. Takes the watchers, the GHE lock and the bg_reviews guard off, and puts back every storage rule
-- slice 9 removed, exactly as it was (the split read/add copies of an ALL rule are removed again). Deletes nothing:
-- the evidence history, the journey row versions and the list of removed rules all stay (restored_at is stamped).
-- =============================================================================
begin;
drop trigger if exists evidence_app_data_t on public.app_data;
drop trigger if exists evidence_app_data_del_t on public.app_data;
drop trigger if exists evidence_evv_t on public.evv_submissions;
drop trigger if exists evidence_care_change_t on public.client_care_change;
drop trigger if exists journey_row_version_t on public.client_journey;
drop trigger if exists journey_row_version_t on public.client_journey_step;
drop trigger if exists ghe_forms_lock_t on public.app_data;
drop trigger if exists bg_reviews_history_keep_t on public.bg_reviews;
do $st$
declare p record; rs text; nm text;
begin
  if to_regclass('public.evidence_storage_rule_removed') is null or to_regclass('storage.objects') is null then return; end if;
  for p in select * from public.evidence_storage_rule_removed where restored_at is null order by id loop
    if p.replaced_by is not null then
      foreach nm in array p.replaced_by loop execute format('drop policy if exists %I on storage.objects', nm); end loop;
    end if;
    rs := (select string_agg(quote_ident(r), ', ') from unnest(p.roles) r);
    execute format('drop policy if exists %I on storage.objects', p.policyname);
    execute format('create policy %I on storage.objects as %s for %s to %s', p.policyname, p.permissive, lower(p.cmd), rs)
      || case when p.qual is not null then format(' using (%s)', p.qual) else '' end
      || case when p.with_check is not null then format(' with check (%s)', p.with_check) else '' end;
    update public.evidence_storage_rule_removed set restored_at = now() where id = p.id;
    raise notice 'slice 9 rollback: put back the storage rule "%" (%)', p.policyname, p.cmd;
  end loop;
end $st$;
do $v$ begin
  if exists (select 1 from pg_trigger where not tgisinternal and tgname in ('evidence_app_data_t', 'evidence_app_data_del_t', 'evidence_evv_t',
      'evidence_care_change_t', 'journey_row_version_t', 'ghe_forms_lock_t', 'bg_reviews_history_keep_t')) then
    raise exception 'slice 9 rollback self-check: a watcher or guard is still attached';
  end if;
  raise notice 'slice 9 rolled back: watchers and guards off, storage rules restored, every history line kept';
end $v$;
commit;
