-- =============================================================================
-- GATE 4b · PEOPLE GOING INTO CARE (approved 2026-09-28)
-- =============================================================================
-- When an inquiry is an AxisCare client, a coordinator decides, one click per
-- person, who joins the client's Family Circle: the client themselves (so they
-- get care updates too), the caller, and anyone on the Journey's People list.
-- AxisCare responsible parties still go through family-circles "rp_add" (confirm
-- and read-back); this file only adds the Family Circle step and the notes that
-- say where a circle member came from and when they were sent to AxisCare.
--
--   circle_contacts + carried_from   'client' | 'caller' | 'person:<person_key>'
--                   + carried_by, carried_at            who added them from People, when
--                   + axiscare_sent_by, axiscare_sent_at who sent them to AxisCare, when
--                   one carry per person per circle (unique index)
--   people_into_care_add(lead, who, person_key, staff)   the door (service_role only)
--   people_into_care_audit                              append-only, codes only
--
-- Rules the door enforces:
--   * the lead must already be an AxisCare client
--   * family (the caller and People) need a recorded YES to "permission to discuss
--     care": the Family Circle is who hears about care. The client needs none.
--   * texts stay OFF (sms_consent false): texting consent is asked by a person and
--     ticked on the circle, never carried by software
--   * a circle is created for the client only when none exists, and linked through
--     the existing family_circle_link door, under the same lock
-- Nothing here sends anything, writes to AxisCare, or touches the identity layer.
-- =============================================================================
begin;

do $guard$ begin
  if to_regclass('public.care_circles') is null or to_regclass('public.circle_contacts') is null then
    raise exception 'people_into_care refused: the Family Circle tables are missing. Nothing was changed.'; end if;
  if to_regclass('public.journey_person_current') is null then
    raise exception 'people_into_care refused: Gate 4a (people on the Journey) is not installed. Nothing was changed.'; end if;
  if to_regprocedure('public.family_circle_link(text,text,text,text)') is null then
    raise exception 'people_into_care refused: the family_circle_link door is missing. Nothing was changed.'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'circle_contacts'
             and column_name in ('carried_from','carried_by','carried_at','axiscare_sent_by','axiscare_sent_at')) then
    raise exception 'people_into_care refused: already installed (circle_contacts has the new columns). Nothing was changed.'; end if;
end $guard$;

alter table public.circle_contacts add column carried_from text;
alter table public.circle_contacts add column carried_by text;
alter table public.circle_contacts add column carried_at timestamptz;
alter table public.circle_contacts add column axiscare_sent_by text;
alter table public.circle_contacts add column axiscare_sent_at timestamptz;
alter table public.circle_contacts add constraint circle_contacts_carried_shape
  check (carried_from is null or carried_from in ('client','caller') or carried_from ~ '^person:[0-9a-f-]{36}$');
create unique index circle_contacts_carried_once on public.circle_contacts ((circle_id::text), carried_from) where carried_from is not null;

create table public.people_into_care_audit (
  id bigserial primary key, at timestamptz not null default now(), outcome text not null,
  lead_id text, who text, person_key uuid, acting_staff text, contact_id text
);
create function public.people_into_care_guard() returns trigger language plpgsql as $g$
begin raise exception '% is append-only (% refused)', tg_table_name, tg_op; end $g$;
create trigger people_into_care_audit_append_only before update or delete on public.people_into_care_audit for each row execute function public.people_into_care_guard();
create trigger people_into_care_audit_no_truncate before truncate on public.people_into_care_audit for each statement execute function public.people_into_care_guard();

create function public.people_into_care_add(p_lead_id text, p_who text, p_person_key uuid, p_staff text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $d$
declare
  v_staff text := nullif(btrim(coalesce(p_staff,'')),''); v_code text; v_msg text;
  v_lead jsonb; v_ax text; v_self boolean; v_ep uuid; v_p record; v_key text;
  v_name text; v_rel text; v_phone text; v_email text; v_client_name text;
  v_circle public.care_circles%rowtype; v_created boolean := false; v_link jsonb; v_contact text; v_existing text;
begin
  <<check>> begin
    if v_staff is null then v_code := 'staff_required'; v_msg := 'who is doing this is missing'; exit check; end if;
    if p_who is null or p_who not in ('client','caller','person') then v_code := 'invalid_who'; v_msg := 'say whether this is the client, the caller or a person on the list'; exit check; end if;
    select e into v_lead from public.app_data a,
           jsonb_array_elements(case when jsonb_typeof(a.data) = 'array' then a.data else '[]'::jsonb end) e
     where a.key = 'leads' and e->>'id' = p_lead_id limit 1;
    if v_lead is null then v_code := 'no_such_lead'; v_msg := 'that inquiry was not found (save it first)'; exit check; end if;
    v_ax := btrim(coalesce(v_lead->>'axiscare_client_id',''));
    if v_ax !~ '^\d+$' then v_code := 'not_a_client_yet'; v_msg := 'they are not an AxisCare client yet; Convert first'; exit check; end if;
    perform pg_advisory_xact_lock(hashtext('family_circle'), hashtext(v_ax));
    v_self := lower(btrim(coalesce(v_lead->>'relationship',''))) ~ '^(self|myself|me|client|the client|patient)$';
    select episode_id into v_ep from public.episode_source where system = 'lead' and role = 'origin' and source_ref = p_lead_id;
    select pi.display_name into v_client_name from public.person_source_id s join public.person_identity pi on pi.id = s.person_id
     where s.system = 'axiscare' and s.entity_type = 'client' and s.source_id = v_ax limit 1;

    if p_who = 'client' then
      v_key := 'client';
      v_name := nullif(btrim(concat_ws(' ', nullif(btrim(coalesce(v_lead->>'client_first_name','')),''), nullif(btrim(coalesce(v_lead->>'client_last_name','')),''))),'');
      if v_name is null and v_self then v_name := nullif(btrim(concat_ws(' ', nullif(btrim(coalesce(v_lead->>'first_name','')),''), nullif(btrim(coalesce(v_lead->>'last_name','')),''))),''); end if;
      v_rel := 'Self (the client)';
      v_phone := coalesce(nullif(btrim(coalesce(v_lead->>'client_phone','')),''), case when v_self then nullif(btrim(coalesce(v_lead->>'phone','')),'') end);
      v_email := case when v_self then nullif(btrim(coalesce(v_lead->>'email','')),'') end;
    elsif p_who = 'caller' then
      if v_self then v_code := 'caller_is_the_client'; v_msg := 'the caller is the client; add them as the client'; exit check; end if;
      if v_ep is null then v_code := 'no_journey'; v_msg := 'this inquiry has no Journey yet'; exit check; end if;
      select * into v_p from public.journey_person_current where episode_id = v_ep and is_caller;
      if not found or v_p.permission <> 'yes' then v_code := 'permission_needed'; v_msg := 'record a yes to "permission to discuss care" for them first'; exit check; end if;
      v_key := 'caller';
      v_name := nullif(btrim(concat_ws(' ', nullif(btrim(coalesce(v_lead->>'first_name','')),''), nullif(btrim(coalesce(v_lead->>'last_name','')),''))),'');
      v_rel := coalesce(nullif(btrim(coalesce(v_p.relationship,'')),''), nullif(btrim(coalesce(v_lead->>'relationship','')),''));
      v_phone := nullif(btrim(coalesce(v_lead->>'phone','')),''); v_email := nullif(btrim(coalesce(v_lead->>'email','')),'');
    else
      if v_ep is null then v_code := 'no_journey'; v_msg := 'this inquiry has no Journey yet'; exit check; end if;
      select * into v_p from public.journey_person_current where episode_id = v_ep and person_key = p_person_key and not is_caller;
      if not found then v_code := 'no_such_person'; v_msg := 'that person is not on this Journey (or was removed)'; exit check; end if;
      if v_p.permission <> 'yes' then v_code := 'permission_needed'; v_msg := 'record a yes to "permission to discuss care" for them first'; exit check; end if;
      v_key := 'person:' || p_person_key::text;
      v_name := v_p.name; v_rel := v_p.relationship; v_phone := v_p.phone; v_email := v_p.email;
    end if;
    if v_name is null then v_code := 'name_required'; v_msg := 'their name is missing on the inquiry'; exit check; end if;
    if v_phone is null and v_email is null then v_code := 'no_way_to_reach'; v_msg := 'add a phone or an email for them first'; exit check; end if;

    select * into v_circle from public.care_circles where active is true and axiscare_client_id = v_ax limit 1;
    if not found then
      if v_client_name is null then v_code := 'not_a_hub_client'; v_msg := 'this AxisCare client has no person in the hub yet (answer "Who is this?" first)'; exit check; end if;
      insert into public.care_circles (client_name) values (v_client_name) returning * into v_circle;
      v_link := public.family_circle_link(v_circle.id::text, v_ax, v_staff, 'people_into_care');
      if coalesce(v_link->>'outcome','') <> 'linked' then
        raise exception 'people_into_care: the new circle could not be linked (%)', coalesce(v_link->>'outcome','no answer'); end if;
      select * into v_circle from public.care_circles where id::text = v_circle.id::text;
      v_created := true;
    end if;
    /* the client is named exactly as their circle is, so messages to them say "you" */
    if p_who = 'client' then v_name := coalesce(nullif(btrim(coalesce(v_circle.client_name,'')),''), v_name); end if;
    select id::text into v_existing from public.circle_contacts where circle_id::text = v_circle.id::text and carried_from = v_key limit 1;
    if v_existing is not null then v_code := 'already_in_circle'; v_msg := 'they are already in the Family Circle'; exit check; end if;
  end check;

  if v_code is not null then
    insert into public.people_into_care_audit (outcome, lead_id, who, person_key, acting_staff, contact_id)
    values ('refused:' || v_code, left(p_lead_id, 80), left(p_who, 10), p_person_key, v_staff, v_existing);
    return jsonb_build_object('outcome', 'refused', 'reason', v_code, 'message', v_msg, 'contact_id', v_existing);
  end if;

  insert into public.circle_contacts (circle_id, name, relationship, phone, email, sms_consent, is_primary, carried_from, carried_by, carried_at)
  values (v_circle.id, v_name, v_rel, v_phone, v_email, false,
          p_who <> 'client' and not exists (select 1 from public.circle_contacts m where m.circle_id::text = v_circle.id::text and m.is_primary is true),
          v_key, v_staff, now())
  returning id::text into v_contact;
  insert into public.people_into_care_audit (outcome, lead_id, who, person_key, acting_staff, contact_id)
  values ('added', left(p_lead_id, 80), p_who, p_person_key, v_staff, v_contact);
  return jsonb_build_object('outcome', 'added', 'contact_id', v_contact, 'circle_id', v_circle.id::text, 'circle_created', v_created);
exception when unique_violation then
  insert into public.people_into_care_audit (outcome, lead_id, who, person_key, acting_staff) values ('refused:already_in_circle', left(p_lead_id, 80), left(p_who, 10), p_person_key, v_staff);
  return jsonb_build_object('outcome', 'refused', 'reason', 'already_in_circle', 'message', 'they are already in the Family Circle');
end $d$;

alter table public.people_into_care_audit enable row level security;
revoke all on public.people_into_care_audit from public, anon, authenticated, service_role;
revoke all on sequence public.people_into_care_audit_id_seq from public, anon, authenticated, service_role;
grant select on public.people_into_care_audit to authenticated, service_role;
create policy people_into_care_audit_read on public.people_into_care_audit for select to authenticated using (public.can_access_data_key('leads'));
revoke all on function public.people_into_care_add(text, text, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.people_into_care_add(text, text, uuid, text) to service_role;
revoke all on function public.people_into_care_guard() from public, anon, authenticated, service_role;

do $verify$ begin
  if has_function_privilege('authenticated', 'public.people_into_care_add(text,text,uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.people_into_care_add(text,text,uuid,text)', 'execute') then
    raise exception 'people_into_care self-check: the door is reachable from a browser'; end if;
  if has_table_privilege('authenticated','public.people_into_care_audit','insert') or has_table_privilege('service_role','public.people_into_care_audit','insert')
     or has_table_privilege('anon','public.people_into_care_audit','select') then
    raise exception 'people_into_care self-check: someone other than the door could write the log, or a visitor could read it'; end if;
  if (select count(*) from public.circle_contacts where carried_from is not null) <> 0 then
    raise exception 'people_into_care self-check: carried rows exist before anyone carried anyone'; end if;
  raise notice 'people_into_care installed: one door; the Family Circle keeps where each member came from';
end $verify$;
commit;
