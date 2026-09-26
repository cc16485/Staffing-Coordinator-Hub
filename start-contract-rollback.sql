-- =============================================================================
-- start-contract-rollback.sql · removes the Start Contract objects ONLY while empty
-- Refuses if any contract version or family update exists: recorded promises are
-- history and are never dropped by a rollback.
-- =============================================================================
begin;
do $guard$
declare n bigint;
begin
  if to_regclass('public.start_contract_version') is not null then
    lock table public.start_contract_version in access exclusive mode;
    select count(*) into n from public.start_contract_version;
    if n > 0 then raise exception 'rollback refused: % Start Contract version(s) exist. Nothing was changed.', n; end if;
  end if;
  if to_regclass('public.start_contract_update') is not null then
    lock table public.start_contract_update in access exclusive mode;
    select count(*) into n from public.start_contract_update;
    if n > 0 then raise exception 'rollback refused: % family update row(s) exist. Nothing was changed.', n; end if;
  end if;
end $guard$;
drop view if exists public.start_contract_current;
drop function if exists public.start_contract_record(uuid, text, date, text, text, text, date, text, date, text, text, text);
drop function if exists public.start_contract_update_record(uuid, timestamptz, text, text, text, date, text, text, text);
drop function if exists public.start_contract_audit(text, uuid, text, text, jsonb);
drop table if exists public.start_contract_door_audit, public.start_contract_update, public.start_contract_version;
drop function if exists public.start_contract_guard();
commit;
