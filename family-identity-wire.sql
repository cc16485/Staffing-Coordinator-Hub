-- =============================================================================
-- family-identity-wire.sql · keep family recognition current (I2, her ruling 2026-09-28)
-- =============================================================================
-- Every way someone joins or leaves a Family Circle ends in the same two tables (the office's Family Circle screen,
-- "People going into care", the nightly AxisCare sync), so the rule is kept there, once:
--   * a member joins, or rejoins, or their number or circle changes → person_link_family_contact (I1's rule: home line
--     stays the client's, a clash links nothing and is recorded, a shared number identifies nobody);
--   * a member leaves (removed by AxisCare, stopped, or deleted) → person_end_family_contact (history stays);
--   * a circle is closed → everyone in it ends; a circle is linked to (or moved to) an AxisCare client → its members link.
-- Who did it: the signed-in person's email when the Hub wrote it; who carried them in for "People going into care";
-- otherwise 'Hub server' (the nightly AxisCare sync, a server step). These can never block a Family Circle save: a
-- failure is recorded in the audit instead. A corrected name or relationship follows onto the linked person.
-- The one-time pass for people already in circles is person_link_family_all(); person_link_family_practice() runs it
-- and undoes everything, returning only the counts (her ruling: she sees the practice run first).
-- =============================================================================
begin;

do $guard$ begin
  if to_regprocedure('public.person_link_family_contact(text,text,text,text)') is null then
    raise exception 'family wiring refused: the family rule (I1) is not installed. Nothing was changed.'; end if;
  if to_regprocedure('public.person_link_family_all()') is not null then
    raise exception 'family wiring refused: already installed. Nothing was changed.'; end if;
end $guard$;

create function public.family_actor(p_row jsonb) returns text language sql stable as $a$
  select coalesce(nullif((nullif(current_setting('request.jwt.claims', true), '')::jsonb)->>'email', ''),
                  nullif(btrim(coalesce(p_row->>'carried_by', '')), ''), 'Hub server')
$a$;

create function public.family_circle_member_sync() returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $t$
declare who text := public.family_actor(to_jsonb(coalesce(new, old))); n jsonb; o jsonb; now_on boolean; was_on boolean; d_old text; v_person uuid;
begin
  begin
    if tg_op = 'DELETE' then
      perform public.person_end_family_contact(old.id::text, 'circle member deleted', who, 'removed from the Family Circle');
      return old;
    end if;
    n := to_jsonb(new); o := case when tg_op = 'UPDATE' then to_jsonb(old) end;
    now_on := (n->>'axiscare_removed_at') is null and (n->>'stopped_at') is null;
    was_on := o is not null and (o->>'axiscare_removed_at') is null and (o->>'stopped_at') is null;
    if not now_on then
      if was_on then perform public.person_end_family_contact(new.id::text, 'circle member left', who, 'left the Family Circle'); end if;
      return new;
    end if;
    if was_on and coalesce(o->>'phone','') is distinct from coalesce(n->>'phone','') then
      d_old := right(regexp_replace(coalesce(o->>'phone',''), '\D', '', 'g'), 10);
      if length(d_old) = 10 then  -- the old number stops identifying them
        delete from public.phone_index pi using public.person_source_id s
         where s.system = 'hub' and s.entity_type = 'contact' and s.source_id = new.id::text and pi.person_id = s.person_id and pi.phone = '+1' || d_old;
        update public.person_identity p set primary_phone = null from public.person_source_id s
         where s.system = 'hub' and s.entity_type = 'contact' and s.source_id = new.id::text and p.id = s.person_id and p.primary_phone = '+1' || d_old;
      end if;
    end if;
    if was_on and (coalesce(o->>'name','') is distinct from coalesce(n->>'name','')
                   or coalesce(o->>'relationship','') is distinct from coalesce(n->>'relationship','')) then
      select person_id into v_person from public.person_source_id where system = 'hub' and entity_type = 'contact' and source_id = new.id::text limit 1;
      if v_person is not null then
        if nullif(btrim(coalesce(n->>'name','')), '') is not null then
          update public.person_identity set display_name = btrim(n->>'name') where id = v_person; end if;
        update public.person_relationship set relationship = nullif(btrim(coalesce(n->>'relationship','')), '') where person_id = v_person and active;
      end if;
    end if;
    if o is null or not was_on or coalesce(o->>'phone','') is distinct from coalesce(n->>'phone','')
       or coalesce(o->>'circle_id','') is distinct from coalesce(n->>'circle_id','')
       or (v_person is null and coalesce(o->>'name','') is distinct from coalesce(n->>'name','')) then
      perform public.person_link_family_contact(new.id::text, 'circle member ' || lower(tg_op), who,
        'in a Family Circle (' || coalesce(nullif(n->>'source',''), 'office') || ')');
    end if;
  exception when others then
    begin
      insert into public.identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, detail)
      values ('link_family', 'circle trigger', who, 'hub', 'contact', coalesce(new.id, old.id)::text, 'refused', left('could not keep in step: ' || sqlerrm, 300));
    exception when others then null;
    end;
  end;
  return coalesce(new, old);
end $t$;

create function public.family_circle_sync() returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $t$
declare who text := public.family_actor(to_jsonb(new)); m record;
begin
  begin
    if coalesce(old.active, true) and not coalesce(new.active, true) then
      for m in select id from public.circle_contacts where circle_id::text = new.id::text loop
        perform public.person_end_family_contact(m.id::text, 'circle closed', who, 'the Family Circle was closed'); end loop;
    elsif old.axiscare_client_id is not null and new.axiscare_client_id is null then
      for m in select id from public.circle_contacts where circle_id::text = new.id::text loop
        perform public.person_end_family_contact(m.id::text, 'circle unlinked', who, 'the Family Circle was unlinked from its AxisCare client'); end loop;
    elsif coalesce(new.active, true) and new.axiscare_client_id is not null
          and (old.axiscare_client_id is distinct from new.axiscare_client_id or not coalesce(old.active, true)) then
      for m in select id from public.circle_contacts where circle_id::text = new.id::text loop
        if old.axiscare_client_id is not null and old.axiscare_client_id is distinct from new.axiscare_client_id then
          perform public.person_end_family_contact(m.id::text, 'circle moved', who, 'the circle moved to another client'); end if;
        perform public.person_link_family_contact(m.id::text, 'circle linked', who, 'the Family Circle was linked to AxisCare client ' || new.axiscare_client_id);
      end loop;
    end if;
  exception when others then
    begin
      insert into public.identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, detail)
      values ('link_family', 'circle trigger', who, 'hub', 'contact', 'circle:' || new.id::text, 'refused', left('could not keep in step: ' || sqlerrm, 300));
    exception when others then null;
    end;
  end;
  return new;
end $t$;

create trigger family_circle_member_sync after insert or update or delete on public.circle_contacts
  for each row execute function public.family_circle_member_sync();
create trigger family_circle_sync after update on public.care_circles
  for each row execute function public.family_circle_sync();

-- the one-time pass: every active member of an active circle linked to an AxisCare client
create function public.person_link_family_all() returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $f$
declare m record; r jsonb; t jsonb := '{}'::jsonb; key text;
begin
  for m in select c.id from public.circle_contacts c join public.care_circles k on k.id::text = c.circle_id::text
            where coalesce(k.active, true) and k.axiscare_client_id is not null
              and (to_jsonb(c)->>'axiscare_removed_at') is null and (to_jsonb(c)->>'stopped_at') is null order by c.id loop
    r := public.person_link_family_contact(m.id::text, 'one-time pass', 'owner-approved one-time pass', 'already in a Family Circle on 2026-09-28');
    key := r->>'outcome' || case when r->>'outcome' in ('linked','already_linked') then ' · ' || coalesce(r->>'phone','?')
                                 when r->>'outcome' = 'refused' then ' · ' || coalesce(r->>'reason','?') else '' end;
    t := jsonb_set(t, array[key], to_jsonb(coalesce((t->>key)::int, 0) + 1));
  end loop;
  return t;
end $f$;

-- the practice run: the same pass, then everything undone; only the counts come back
create function public.person_link_family_practice() returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $f$
declare r jsonb; msg text;
begin
  begin
    r := public.person_link_family_all();
    raise exception using errcode = 'CC001', message = r::text;
  exception when sqlstate 'CC001' then
    get stacked diagnostics msg = message_text; r := msg::jsonb;
  end;
  return r;
end $f$;

revoke all on function public.family_actor(jsonb) from public, anon, authenticated;
revoke all on function public.family_circle_member_sync() from public, anon, authenticated, service_role;
revoke all on function public.family_circle_sync() from public, anon, authenticated, service_role;
revoke all on function public.person_link_family_all() from public, anon, authenticated, service_role;
revoke all on function public.person_link_family_practice() from public, anon, authenticated, service_role;
grant execute on function public.family_actor(jsonb) to service_role;
grant execute on function public.person_link_family_all() to service_role;
grant execute on function public.person_link_family_practice() to service_role;

do $verify$ begin
  if has_function_privilege('authenticated','public.person_link_family_all()','execute')
     or has_function_privilege('anon','public.person_link_family_all()','execute') then
    raise exception 'family wiring self-check: a browser could run the one-time pass'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'family_circle_member_sync') or not exists (select 1 from pg_trigger where tgname = 'family_circle_sync') then
    raise exception 'family wiring self-check: a trigger is missing'; end if;
  raise notice 'family wiring installed: joins and leaves keep recognition current; the one-time pass waits';
end $verify$;
commit;
