-- Gate 3 rollback: switch the sixteen kinds off. Kinds are never deleted, so any fact already recorded stays as history.
begin;
update public.fact_kind set active = false where created_by = 'gate3';
commit;
