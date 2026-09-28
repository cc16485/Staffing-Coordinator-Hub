-- Rollback for family-identity.sql: removes the two functions and the audit's new values, ONLY while nothing has been
-- linked (once family are linked, ending those links is I2's rollback, and the audit keeps its history).
begin;
do $r$ begin
  if exists (select 1 from public.identity_door_audit where op in ('link_family','end_family')) then
    raise exception 'family identity rollback refused: links have been made (they are history). End them instead. Nothing was changed.'; end if;
end $r$;
drop function if exists public.person_link_family_contact(text,text,text,text);
drop function if exists public.person_end_family_contact(text,text,text,text);
do $aud$
declare v_ops text[]; v_outs text[]; c record;
begin
  -- the lists as they are now, minus the family values (nothing uses them: checked above)
  select array_agg(distinct x order by x) into v_ops from (
    select (regexp_matches(pg_get_constraintdef(oid), '''([^'']+)''', 'g'))[1] as x
      from pg_constraint where conrelid = 'public.identity_door_audit'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%(op = any%') t
   where x not in ('link_family','end_family');
  select array_agg(distinct x order by x) into v_outs from (
    select (regexp_matches(pg_get_constraintdef(oid), '''([^'']+)''', 'g'))[1] as x
      from pg_constraint where conrelid = 'public.identity_door_audit'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%(outcome = any%') t
   where x not in ('linked','already_linked','ended','refused')
      or exists (select 1 from public.identity_door_audit where outcome = x);
  for c in select conname from pg_constraint where conrelid = 'public.identity_door_audit'::regclass and contype = 'c'
             and (pg_get_constraintdef(oid) ilike '%(op = any%' or pg_get_constraintdef(oid) ilike '%(outcome = any%') loop
    execute 'alter table public.identity_door_audit drop constraint ' || quote_ident(c.conname);
  end loop;
  execute format('alter table public.identity_door_audit add constraint identity_door_audit_op_check check (op in (%s))',
                 (select string_agg(quote_literal(x), ',') from unnest(v_ops) x));
  execute format('alter table public.identity_door_audit add constraint identity_door_audit_outcome_check check (outcome in (%s))',
                 (select string_agg(quote_literal(x), ',') from unnest(v_outs) x));
end $aud$;
commit;
