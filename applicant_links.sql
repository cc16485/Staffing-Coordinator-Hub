-- =============================================================================
-- 444 · PRIVATE APPLICANT LINKS (Samantha "yes to all", 2026-10-04: https://claude.ai/artifact/MQgrEVdZ8Kr65LBLsha1Aq)
-- A start form sent through a private start link records which job offer it came from and the link's code, so the
-- server can check it later (the start form check counts it as "we sent them a start link"). The public start page
-- (anon, insert only) may write these three columns; nothing reads them but the server. Safe to run again.
-- =============================================================================
alter table public.hire_intake add column if not exists start_offer_id text;
alter table public.hire_intake add column if not exists start_link_exp bigint;
alter table public.hire_intake add column if not exists start_link_sig text;
grant insert (start_offer_id, start_link_exp, start_link_sig) on public.hire_intake to anon;
do $v$ begin
  if not has_column_privilege('anon', 'public.hire_intake', 'start_offer_id', 'insert') then
    raise exception '444 self-check: the start page cannot record the link it came through';
  end if;
end $v$;
