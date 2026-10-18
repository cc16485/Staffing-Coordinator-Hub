-- Rules guard (2026-10-18) · lets the Hub's GitHub check ask "is THIS exact rules file approved?" before a PR merges.
-- Why: twice (EDL quarterly 10-14, Supervisory #495 10-18) a Hub PR changed a G2 rules file and merged before its
-- "approve the new rules" Desktop step, so caregiver connect and the other server jobs refused to run (fail closed).
-- What it opens: one yes/no answer for one (file, fingerprint) pair. It cannot list the approved fingerprints, read
-- notes or dates, or change anything; the table itself stays server-only (G2). A fingerprint is the SHA-256 of a file
-- the Hub already serves publicly, so a yes/no about it reveals nothing private.
-- Rollback: rules_guard_rpc_rollback.sql (drops the function; the table is untouched).
begin;
create or replace function public.rules_fingerprint_approved(p_file text, p_sha256 text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when p_file is null or p_sha256 is null then false
    when p_file !~ '^[a-z0-9-]+\.js$' or p_sha256 !~ '^[0-9a-f]{64}$' then false
    else exists (select 1 from public.rules_approved r where r.file = p_file and r.sha256 = p_sha256)
  end
$$;
revoke all on function public.rules_fingerprint_approved(text, text) from public;
grant execute on function public.rules_fingerprint_approved(text, text) to anon, authenticated, service_role;
commit;
