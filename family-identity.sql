-- =============================================================================
-- family-identity.sql · recognising family when they call (I1, her ruling 2026-09-28)
-- =============================================================================
-- The identity door gains ONE deliberate new source: an active member of a Family Circle that is linked to an
-- AxisCare client. Her ruling, encoded:
--   * who: family in a Family Circle, whatever added them (AxisCare's responsible parties or the office). Not inquiry
--     callers before care. GoHighLevel is never an identity source.
--   * a number that is also the CLIENT's (a shared home line) never identifies the family member: they are linked to
--     the client without that number, so calls from it stay with the client.
--   * a number that belongs to anyone else (a caregiver, another client…) is a CLASH: nothing is linked, and it is
--     recorded for her to decide. Never overwritten, never guessed.
--   * a number two family members share is marked shared, so it identifies neither (the call record then says
--     'several' and a person places the call).
--   * leaving the circle ENDS the link (person_end_family_contact); history stays.
--   * recognising is not permission: nothing here touches texting consent or permission to discuss.
-- Both functions are service_role only (our server). Every call, refusals and clashes included, is written to
-- identity_door_audit. Nothing calls these yet: I2 wires the Family Circle paths to them.
-- =============================================================================
begin;

do $guard$ begin
  if to_regprocedure('public.person_link_family_contact(text,text,text,text)') is not null then
    raise exception 'family identity refused: already installed. Nothing was changed.'; end if;
  if to_regclass('public.identity_door_audit') is null or to_regclass('public.person_relationship') is null
     or to_regclass('public.phone_index') is null or to_regclass('public.circle_contacts') is null or to_regclass('public.care_circles') is null then
    raise exception 'family identity refused: the identity layer or the Family Circle tables are missing. Nothing was changed.'; end if;
end $guard$;

-- the audit learns the two new operations and their outcomes (a deliberate allowlist change, her ruling). The new lists
-- are built from what is live (every value the current rules allow, and every value already in the log) plus the new
-- ones, so no earlier door's values can be lost.
do $aud$
declare v_ops text[]; v_outs text[]; c record;
begin
  select array_agg(distinct x order by x) into v_ops from (
    select (regexp_matches(pg_get_constraintdef(oid), '''([^'']+)''', 'g'))[1] as x
      from pg_constraint where conrelid = 'public.identity_door_audit'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%(op = any%'
    union select op from public.identity_door_audit
    union select unnest(array['link_family','end_family'])) t;
  select array_agg(distinct x order by x) into v_outs from (
    select (regexp_matches(pg_get_constraintdef(oid), '''([^'']+)''', 'g'))[1] as x
      from pg_constraint where conrelid = 'public.identity_door_audit'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%(outcome = any%'
    union select outcome from public.identity_door_audit
    union select unnest(array['linked','already_linked','ended','refused','conflict'])) t;
  for c in select conname from pg_constraint where conrelid = 'public.identity_door_audit'::regclass and contype = 'c'
             and (pg_get_constraintdef(oid) ilike '%(op = any%' or pg_get_constraintdef(oid) ilike '%(outcome = any%') loop
    execute 'alter table public.identity_door_audit drop constraint ' || quote_ident(c.conname);
  end loop;
  execute format('alter table public.identity_door_audit add constraint identity_door_audit_op_check check (op in (%s))',
                 (select string_agg(quote_literal(x), ',') from unnest(v_ops) x));
  execute format('alter table public.identity_door_audit add constraint identity_door_audit_outcome_check check (outcome in (%s))',
                 (select string_agg(quote_literal(x), ',') from unnest(v_outs) x));
end $aud$;

create function public.person_link_family_contact(p_contact_id text, p_workflow text, p_acting_staff text, p_evidence text)
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
    if k is null or not coalesce(k.active, true) or (c->>'axiscare_removed_at') is not null or (c->>'stopped_at') is not null then
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
    insert into public.phone_index (phone, person_id, kind, shared) values (v_e164, v_person, null, v_phone <> 'linked')
    on conflict (phone, person_id) do nothing;
    if v_phone <> 'linked' then update public.phone_index set shared = true where phone = v_e164; end if;
    update public.person_identity set primary_phone = coalesce(primary_phone, v_e164) where id = v_person;
  end if;

  insert into public.identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, person_id, evidence, detail)
  values ('link_family', btrim(p_workflow), btrim(p_acting_staff), 'hub', 'contact', p_contact_id, v_outcome, v_person, btrim(p_evidence),
          'phone: ' || v_phone);
  return jsonb_build_object('outcome', v_outcome, 'person_id', v_person, 'phone', v_phone);
end $f$;

create function public.person_end_family_contact(p_contact_id text, p_workflow text, p_acting_staff text, p_reason text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $f$
declare v_person uuid; v_n int;
begin
  select person_id into v_person from public.person_source_id where system = 'hub' and entity_type = 'contact' and source_id = p_contact_id limit 1;
  if v_person is null or nullif(btrim(coalesce(p_acting_staff,'')),'') is null then
    insert into public.identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, detail)
    values ('end_family', coalesce(nullif(btrim(p_workflow),''),'?'), coalesce(nullif(btrim(p_acting_staff),''),'?'), 'hub', 'contact',
            coalesce(p_contact_id,'?'), 'refused', case when v_person is null then 'not linked' else 'who is required' end);
    return jsonb_build_object('outcome','refused','reason',case when v_person is null then 'not linked' else 'who is required' end);
  end if;
  update public.person_relationship set active = false, ended_at = current_date where person_id = v_person and active;
  get diagnostics v_n = row_count;
  insert into public.identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, person_id, evidence, detail)
  values ('end_family', btrim(p_workflow), btrim(p_acting_staff), 'hub', 'contact', p_contact_id, 'ended', v_person,
          nullif(btrim(coalesce(p_reason,'')),''), v_n || ' link(s) ended; the person and their history stay');
  return jsonb_build_object('outcome','ended','links',v_n);
end $f$;

revoke all on function public.person_link_family_contact(text,text,text,text) from public, anon, authenticated, service_role;
revoke all on function public.person_end_family_contact(text,text,text,text) from public, anon, authenticated, service_role;
grant execute on function public.person_link_family_contact(text,text,text,text) to service_role;
grant execute on function public.person_end_family_contact(text,text,text,text) to service_role;

do $verify$ begin
  if has_function_privilege('authenticated','public.person_link_family_contact(text,text,text,text)','execute')
     or has_function_privilege('anon','public.person_link_family_contact(text,text,text,text)','execute')
     or has_function_privilege('authenticated','public.person_end_family_contact(text,text,text,text)','execute') then
    raise exception 'family identity self-check: a browser could reach the door'; end if;
  raise notice 'family identity installed: one new source (a Family Circle member), server only';
end $verify$;
commit;
