-- Rights explained at the Orientation Video Call: rollback (2026-10-13). Removes the guard. The four columns go only when
-- no explanation has been recorded yet (her rule: a record is never deleted on rollback); otherwise they stay, with a notice.
-- The readiness row's title is left as it is (step1-viventium-forms-rollback.sql puts the Viventium wording back).
-- Safe to run twice.
begin;
drop trigger if exists welcome_rights_guard_t on public.welcome_calls;
drop function if exists public.welcome_rights_guard();
commit;
do $r$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'welcome_calls' and column_name = 'rights_explained_at') then
    if exists (select 1 from public.welcome_calls where rights_explained_at is not null) then
      raise notice 'explanations are recorded on welcome_calls: the four columns stay (nothing is deleted)';
    else
      alter table public.welcome_calls drop column if exists rights_explained_at, drop column if exists rights_explained_by,
        drop column if exists rights_explained_by_email, drop column if exists rights_ack_confirmed;
    end if;
  end if;
end $r$;
