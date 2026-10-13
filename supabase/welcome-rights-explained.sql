-- ============================================================================
-- RIGHTS EXPLAINED AT THE ORIENTATION VIDEO CALL (Samantha's ruling, 2026-10-13). Hub project.
-- 19 CSR 15-7.021(24)(B)5: "a signed statement documenting that the employee received and reviewed a copy of the
-- participant's rights, the code of ethics, and the service provider's policy regarding confidentiality ..., and that all
-- were explained prior to service delivery". Her rule: the Step 1 Client Rights signature confirms receipt and review
-- only; the office explains all three at the Orientation Video Call (table welcome_calls) and records it there:
--   rights_explained_at        when the office recorded the explanation (the "Orientation Video Call done" press)
--   rights_explained_by        who conducted it (name from their own Hub sign-in)
--   rights_explained_by_email  their sign-in email
--   rights_ack_confirmed       the employee confirmed on the call that they understood (recorded by the office)
-- The readiness row cg.step2.participant_rights completes only when BOTH the Step 1 signature and this record exist
-- (caregiver-journey.ts), and Approve to Work needs every required row, so it is always before the first shift.
-- Only the server (welcome-call, service role) writes these four columns: the Hub page's own table access (ticks and
-- notes) cannot set or change them, and once recorded the explanation never changes. Nothing else changes.
-- Safe to run twice. Rollback: welcome-rights-explained-rollback.sql.
-- ============================================================================
begin;
alter table public.welcome_calls add column if not exists rights_explained_at timestamptz;
alter table public.welcome_calls add column if not exists rights_explained_by text;
alter table public.welcome_calls add column if not exists rights_explained_by_email text;
alter table public.welcome_calls add column if not exists rights_ack_confirmed boolean not null default false;
comment on column public.welcome_calls.rights_explained_at is '2026-10-13: when the office recorded explaining Client Rights, the Code of Ethics and the HIPAA policy on this call (19 CSR 15-7.021(24)(B)5); server only';
comment on column public.welcome_calls.rights_explained_by is '2026-10-13: who conducted the explanation (name from their Hub sign-in); server only';
comment on column public.welcome_calls.rights_explained_by_email is '2026-10-13: the sign-in email of who conducted the explanation; server only';
comment on column public.welcome_calls.rights_ack_confirmed is '2026-10-13: the employee confirmed on the call that they understood (recorded by the office); server only';

create or replace function public.welcome_rights_guard() returns trigger
language plpgsql set search_path = pg_catalog, public as $g$
begin
  if tg_op = 'INSERT' then
    if current_user in ('anon', 'authenticated') and (new.rights_explained_at is not null or new.rights_explained_by is not null
       or new.rights_explained_by_email is not null or coalesce(new.rights_ack_confirmed, false)) then
      raise exception 'The explanation of rights is recorded only by the Orientation Video Call done press.' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.rights_explained_at is distinct from old.rights_explained_at or new.rights_explained_by is distinct from old.rights_explained_by
     or new.rights_explained_by_email is distinct from old.rights_explained_by_email or new.rights_ack_confirmed is distinct from old.rights_ack_confirmed then
    if current_user in ('anon', 'authenticated') then
      raise exception 'The explanation of rights is recorded only by the Orientation Video Call done press.' using errcode = '42501';
    end if;
    if old.rights_explained_at is not null then
      raise exception 'A recorded explanation of rights never changes (welcome call %).', old.id using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $g$;
comment on function public.welcome_rights_guard() is '2026-10-13: only the server records the explanation of rights on welcome_calls, and once recorded it never changes';
drop trigger if exists welcome_rights_guard_t on public.welcome_calls;
create trigger welcome_rights_guard_t before insert or update on public.welcome_calls for each row execute function public.welcome_rights_guard();

-- the readiness row says what completes it now (the same words as step1-viventium-forms.sql; idempotent)
update public.client_journey_step_def set def = def || '{"title": "Client Rights, Code of Ethics and confidentiality: received and reviewed (signed in Step 1) and explained at the Orientation Video Call (19 CSR 15-7.021(24)(B)5)", "stage": "orientation", "proof": "record", "evidence_required": "the Step 1 signature on Client Rights AND the office record at the Orientation Video Call: explained (date, who) and the employee confirmed they understood"}'::jsonb,
  updated_by = 'rights explained 2026-10-13' where key = 'cg.step2.participant_rights';
commit;

do $v$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'welcome_calls' and column_name = 'rights_ack_confirmed') then
    raise exception 'rights explained self-check: the columns are missing'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'welcome_rights_guard_t' and tgrelid = 'public.welcome_calls'::regclass) then
    raise exception 'rights explained self-check: the guard is missing'; end if;
end $v$;
