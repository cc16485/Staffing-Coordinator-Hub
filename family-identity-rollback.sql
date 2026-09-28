-- Rollback for family-identity.sql: removes the two functions and the audit's new values, ONLY while nothing has been
-- linked (once family are linked, ending those links is I2's rollback, and the audit keeps its history).
begin;
do $r$ begin
  if exists (select 1 from public.identity_door_audit where op in ('link_family','end_family')) then
    raise exception 'family identity rollback refused: links have been made (they are history). End them instead. Nothing was changed.'; end if;
end $r$;
drop function if exists public.person_link_family_contact(text,text,text,text);
drop function if exists public.person_end_family_contact(text,text,text,text);
alter table public.identity_door_audit drop constraint if exists identity_door_audit_op_check;
alter table public.identity_door_audit add constraint identity_door_audit_op_check check (op in ('resolve_or_create','attach_source'));
alter table public.identity_door_audit drop constraint if exists identity_door_audit_outcome_check;
alter table public.identity_door_audit add constraint identity_door_audit_outcome_check
  check (outcome in ('resolved_existing','created_new','conflict','invalid_source','attached','already_attached'));
commit;
