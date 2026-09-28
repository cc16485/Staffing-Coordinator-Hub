-- =============================================================================
-- family-recognition.sql · see it in the Family Circle (I3, her ruling 2026-09-28)
-- =============================================================================
-- 1. family_recognition(): for every Family Circle member, one word the Hub shows next to them: recognised, home line,
--    shared number, no number, clash (for the owner), not recognised (with the reason), or left. Signed-in staff who
--    can see leads only; it returns the member's id, the word and a short reason, never a number or a name.
-- 2. Where family numbers came from: I1 saved them without saying. They now carry their source (AxisCare, or entered
--    by the office) and stay 'probable' on purpose: recognising a caller is never permission to text them, so no
--    automatic sender treats a family number as safe. The rule is changed to stamp this on every new number.
-- 3. A correction to I1/I2: replying STOP to texts is not leaving the circle. It stops texts, never recognition, so
--    the rule no longer ends (or refuses) a link because of STOP, and anyone skipped for it is linked now.
-- =============================================================================
begin;

do $guard$ begin
  if to_regprocedure('public.person_link_family_all()') is null then
    raise exception 'family recognition refused: the Family Circle wiring (I2) is not installed. Nothing was changed.'; end if;
  if to_regprocedure('public.family_recognition()') is not null then
    raise exception 'family recognition refused: already installed. Nothing was changed.'; end if;
  if to_regprocedure('public.can_access_data_key(text)') is null then
    raise exception 'family recognition refused: the staff access check is missing. Nothing was changed.'; end if;
end $guard$;

create or replace function public.person_link_family_contact(p_contact_id text, p_workflow text, p_acting_staff text, p_evidence text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $f$
declare
  c jsonb; k record; v_client uuid; v_clients uuid[]; v_person uuid; v_new boolean := false; v_name text; v_digits text; v_e164 text;
  v_owners uuid[]; v_other uuid[]; v_phone text := 'no usable phone'; v_outcome text; v_rel text; v_src text;
  refuse text := null;
begin
  if nullif(btrim(coalesce(p_workflow,'')),'') is null or nullif(btrim(coalesce(p_acting_staff,'')),'') is null
     or nullif(btrim(coalesce(p_evidence,'')),'') is null then
    refuse := 'workflow, who and evidence are all required';
  end if;
  if refuse is null then
    select to_jsonb(x) into c from public.circle_contacts x where x.id::text = p_contact_id;
    if c is null then refuse := 'no such Family Circle member'; end if;
  end if;
  if refuse is null then
    select * into k from public.care_circles where id::text = c->>'circle_id';
    if k is null or not coalesce(k.active, true) or (c->>'axiscare_removed_at') is not null then
      refuse := 'not an active Family Circle member';
    elsif k.axiscare_client_id is null then refuse := 'the circle is not linked to an AxisCare client';
    end if;
  end if;
  if refuse is null then
    select array_agg(distinct person_id) into v_clients from public.person_source_id
     where system = 'axiscare' and entity_type = 'client' and source_id = k.axiscare_client_id;
    if coalesce(array_length(v_clients, 1), 0) <> 1 then refuse := 'the client is not one person in the identity layer';
    else v_client := v_clients[1]; end if;
  end if;
  v_name := nullif(btrim(coalesce(c->>'name','')), '');
  if refuse is null and v_name is null then refuse := 'the member has no name'; end if;
  if refuse is not null then
    insert into public.identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, evidence, detail)
    values ('link_family', coalesce(nullif(btrim(p_workflow),''),'?'), coalesce(nullif(btrim(p_acting_staff),''),'?'), 'hub', 'contact',
            coalesce(p_contact_id,'?'), 'refused', p_evidence, refuse);
    return jsonb_build_object('outcome','refused','reason',refuse);
  end if;

  select person_id into v_person from public.person_source_id where system = 'hub' and entity_type = 'contact' and source_id = p_contact_id limit 1;

  -- the number first: a clash stops everything, before anything is created
  v_digits := right(regexp_replace(coalesce(c->>'phone',''), '\D', '', 'g'), 10);
  if length(v_digits) = 10 then
    v_e164 := '+1' || v_digits;
    select array_agg(distinct pi.person_id) into v_owners from public.phone_index pi
     where pi.phone = v_e164 and (v_person is null or pi.person_id <> v_person);
    if v_client = any(coalesce(v_owners, '{}')) then
      v_phone := 'shares the client''s number: calls from it stay with the client';
    elsif v_owners is not null then
      select array_agg(o) into v_other from unnest(v_owners) o
       where not exists (select 1 from public.person_source_id s where s.person_id = o and s.system = 'hub' and s.entity_type = 'contact');
      if v_other is not null then
        insert into public.identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, person_id, evidence, detail)
        values ('link_family', btrim(p_workflow), btrim(p_acting_staff), 'hub', 'contact', p_contact_id, 'conflict', v_other[1], p_evidence,
                'the number already belongs to someone who is not family in a circle; nothing linked, for the owner to decide');
        return jsonb_build_object('outcome','conflict','reason','the number already belongs to someone else');
      end if;
      v_phone := 'shared with another family member: identifies neither';
    else
      v_phone := 'linked';
    end if;
  end if;

  if v_person is null then
    insert into public.person_identity (display_name) values (v_name) returning id into v_person;
    begin
      insert into public.person_source_id (person_id, system, entity_type, source_id, confidence, needs_review, evidence)
      values (v_person, 'hub', 'contact', p_contact_id, 'confirmed', false, btrim(p_evidence));
    exception when unique_violation then
      delete from public.person_identity where id = v_person;
      select person_id into v_person from public.person_source_id where system = 'hub' and entity_type = 'contact' and source_id = p_contact_id limit 1;
    end;
    v_new := true;
  end if;

  v_rel := nullif(btrim(coalesce(c->>'relationship','')), '');
  v_src := case when c->>'source' = 'axiscare' then 'axiscare' else 'office' end;
  if exists (select 1 from public.person_relationship where person_id = v_person and client_person_id = v_client and active) then
    v_outcome := case when v_new then 'linked' else 'already_linked' end;
  elsif exists (select 1 from public.person_relationship where person_id = v_person and client_person_id = v_client) then
    update public.person_relationship set active = true, ended_at = null
     where id = (select id from public.person_relationship where person_id = v_person and client_person_id = v_client order by id desc limit 1);
    v_outcome := 'linked';
  else
    insert into public.person_relationship (person_id, client_person_id, relationship, responsible_party, source)
    values (v_person, v_client, v_rel, v_src = 'axiscare', v_src);
    v_outcome := 'linked';
  end if;

  if v_phone like 'linked' or v_phone like 'shared with another%' then
    insert into public.phone_index (phone, person_id, kind, shared, source_system, source_record_id, confidence, imported_at)
    values (v_e164, v_person, null, v_phone <> 'linked', case when c->>'source' = 'axiscare' then 'axiscare' else 'office_entry' end,
            'circle_contacts:' || p_contact_id, 'probable', now())
    on conflict (phone, person_id) do nothing;
    if v_phone <> 'linked' then update public.phone_index set shared = true where phone = v_e164; end if;
    update public.person_identity set primary_phone = coalesce(primary_phone, v_e164) where id = v_person;
  end if;

  insert into public.identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, person_id, evidence, detail)
  values ('link_family', btrim(p_workflow), btrim(p_acting_staff), 'hub', 'contact', p_contact_id, v_outcome, v_person, btrim(p_evidence),
          'phone: ' || v_phone);
  return jsonb_build_object('outcome', v_outcome, 'person_id', v_person, 'phone', v_phone);
end $f$;

-- STOP is not leaving (the trigger and the pass, as installed in I2, less the STOP test)
create or replace function public.family_circle_member_sync() returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $t$
declare who text := public.family_actor(to_jsonb(coalesce(new, old))); n jsonb; o jsonb; now_on boolean; was_on boolean; d_old text; v_person uuid;
begin
  begin
    if tg_op = 'DELETE' then
      perform public.person_end_family_contact(old.id::text, 'circle member deleted', who, 'removed from the Family Circle');
      return old;
    end if;
    n := to_jsonb(new); o := case when tg_op = 'UPDATE' then to_jsonb(old) end;
    now_on := (n->>'axiscare_removed_at') is null;
    was_on := o is not null and (o->>'axiscare_removed_at') is null;
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

create or replace function public.person_link_family_all() returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $f$
declare m record; r jsonb; t jsonb := '{}'::jsonb; key text;
begin
  for m in select c.id from public.circle_contacts c join public.care_circles k on k.id::text = c.circle_id::text
            where coalesce(k.active, true) and k.axiscare_client_id is not null
              and (to_jsonb(c)->>'axiscare_removed_at') is null order by c.id loop
    r := public.person_link_family_contact(m.id::text, 'one-time pass', 'owner-approved one-time pass', 'already in a Family Circle on 2026-09-28');
    key := r->>'outcome' || case when r->>'outcome' in ('linked','already_linked') then ' · ' || coalesce(r->>'phone','?')
                                 when r->>'outcome' = 'refused' then ' · ' || coalesce(r->>'reason','?') else '' end;
    t := jsonb_set(t, array[key], to_jsonb(coalesce((t->>key)::int, 0) + 1));
  end loop;
  return t;
end $f$;

-- anyone skipped because they had replied STOP: linked now (still family; still never texted)
do $stop$ declare m record; begin
  for m in select c.id from public.circle_contacts c join public.care_circles k on k.id::text = c.circle_id::text
            where coalesce(k.active, true) and k.axiscare_client_id is not null and (to_jsonb(c)->>'axiscare_removed_at') is null
              and (to_jsonb(c)->>'stopped_at') is not null
              and not exists (select 1 from public.person_source_id s join public.person_relationship r on r.person_id = s.person_id and r.active
                               where s.system = 'hub' and s.entity_type = 'contact' and s.source_id = c.id::text) loop
    perform public.person_link_family_contact(m.id::text, 'correction: STOP is not leaving', 'owner-approved correction',
      'in a Family Circle; replied STOP to texts, which stops texts, not recognition');
  end loop;
end $stop$;

-- the numbers already saved: say where they came from; recognising is not permission to text
update public.phone_index p
   set source_system = case when m.source = 'axiscare' then 'axiscare' else 'office_entry' end,
       source_record_id = 'circle_contacts:' || s.source_id, confidence = 'probable', imported_at = coalesce(p.imported_at, now())
  from public.person_source_id s join public.circle_contacts m on m.id::text = s.source_id
 where s.system = 'hub' and s.entity_type = 'contact' and p.person_id = s.person_id and p.source_system is null;

create function public.family_recognition_all() returns table (contact_id text, state text, reason text)
language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $f$
begin
  return query
  with last as (
    select distinct on (a.source_id) a.source_id, a.op, a.outcome, coalesce(a.detail, '') as detail
      from public.identity_door_audit a
     where a.system = 'hub' and a.entity_type = 'contact' and a.op in ('link_family', 'end_family')
     order by a.source_id, a.id desc)
  select m.id::text,
    case
      when (to_jsonb(m)->>'axiscare_removed_at') is not null then 'left'
      when l.source_id is null then case when k.axiscare_client_id is null then 'not_recognised' else 'not_checked' end
      when l.op = 'end_family' then 'left'
      when l.outcome = 'conflict' then 'clash'
      when l.outcome = 'refused' then 'not_recognised'
      when l.detail like '%shares the client%' then 'home_line'
      when l.detail like '%no usable phone%' then 'no_number'
      when l.detail like '%shared with another%' or exists (select 1 from public.phone_index p join public.person_source_id s
             on s.person_id = p.person_id and s.system = 'hub' and s.entity_type = 'contact' and s.source_id = m.id::text where p.shared) then 'shared'
      else 'recognised' end,
    case
      when (to_jsonb(m)->>'axiscare_removed_at') is not null then null
      when l.source_id is null and k.axiscare_client_id is null then 'the circle isn''t linked to a client'
      when l.outcome = 'refused' then case
        when l.detail like '%not linked to an AxisCare client%' then 'the circle isn''t linked to a client'
        when l.detail like '%not an active Family Circle member%' then 'no longer in the circle'
        when l.detail like '%not one person in the identity layer%' then 'the client isn''t in the identity layer yet'
        when l.detail like '%no name%' then 'needs a name'
        when l.detail like 'could not keep in step%' then 'the check failed; it is in the log'
        else 'see the log' end
      else null end
  from public.circle_contacts m left join public.care_circles k on k.id::text = m.circle_id::text
  left join last l on l.source_id = m.id::text
  where k.id is not null and coalesce(k.active, true);   -- the circles the Hub shows
end $f$;
-- what the Hub calls: the same list, for signed-in staff who can see leads
create function public.family_recognition() returns table (contact_id text, state text, reason text)
language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $f$
begin
  if not public.can_access_data_key('leads') then raise exception 'not allowed'; end if;
  return query select * from public.family_recognition_all();
end $f$;
revoke all on function public.family_recognition_all() from public, anon, authenticated;
grant execute on function public.family_recognition_all() to service_role;
revoke all on function public.family_recognition() from public, anon;
grant execute on function public.family_recognition() to authenticated, service_role;

do $verify$ begin
  if has_function_privilege('anon', 'public.family_recognition()', 'execute')
     or has_function_privilege('authenticated', 'public.family_recognition_all()', 'execute') then
    raise exception 'family recognition self-check: an outside visitor could read it'; end if;
  if exists (select 1 from public.phone_index p join public.person_source_id s on s.person_id = p.person_id
              where s.system = 'hub' and s.entity_type = 'contact' and (p.source_system is null or p.confidence <> 'probable')) then
    raise exception 'family recognition self-check: a family number has no source, or is marked safe to text'; end if;
  raise notice 'family recognition installed';
end $verify$;
commit;
