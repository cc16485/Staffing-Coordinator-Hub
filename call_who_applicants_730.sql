-- 730 · call_who also knows applicants (Samantha 2026-10-14, item 2: the AI should know who is calling).
-- Same rule as 650's call_who (phone_index people, then live leads), with ONE addition: when neither knows the number,
-- an applicant whose job_applicants.phone is that number is named (role 'applicant', applicant_id). Applicants rarely
-- have a person row (the identity door creates one only at hire), so they texted in as "unknown".
-- Two or more applicants on one number = 'several', never a guess. Read only, server only, exactly as before.
create or replace function public.call_who(p_phone text) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $f$
declare v_digits text; v_people uuid[]; v_leads text[]; v_apps uuid[]; v_person uuid; v_lead text; v_app uuid;
        v_name text; v_roles text[] := '{}';
begin
  v_digits := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  if length(v_digits) <> 10 then return jsonb_build_object('match', 'none'); end if;
  select array_agg(distinct person_id) into v_people from public.phone_index where phone = '+1' || v_digits;
  select array_agg(distinct l->>'id') into v_leads
    from public.app_data a, jsonb_array_elements(case when jsonb_typeof(a.data) = 'array' then a.data else '[]'::jsonb end) l
   where a.key = 'leads' and jsonb_typeof(l) = 'object' and not coalesce((l->>'archived')::boolean, false)
     and (right(regexp_replace(coalesce(l->>'phone', ''), '\D', '', 'g'), 10) = v_digits
          or right(regexp_replace(coalesce(l->>'client_phone', ''), '\D', '', 'g'), 10) = v_digits);
  if coalesce(array_length(v_people, 1), 0) > 1 or coalesce(array_length(v_leads, 1), 0) > 1 then return jsonb_build_object('match', 'several'); end if;
  if coalesce(array_length(v_people, 1), 0) = 0 and coalesce(array_length(v_leads, 1), 0) = 0 then
    -- 730: nobody in the identity layer or the leads; try the applicants
    select array_agg(distinct id) into v_apps from public.job_applicants
     where right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = v_digits;
    if coalesce(array_length(v_apps, 1), 0) > 1 then return jsonb_build_object('match', 'several'); end if;
    if coalesce(array_length(v_apps, 1), 0) = 0 then return jsonb_build_object('match', 'none'); end if;
    v_app := v_apps[1];
    select nullif(btrim(concat_ws(' ', first_name, last_name)), '') into v_name from public.job_applicants where id = v_app;
    return jsonb_build_object('match', 'one', 'person_id', null, 'lead_id', null, 'applicant_id', v_app,
                              'name', left(v_name, 120), 'roles', to_jsonb(array['applicant']));
  end if;
  v_person := v_people[1]; v_lead := v_leads[1];
  if v_person is not null then
    select display_name into v_name from public.person_identity where id = v_person;
    select coalesce(array_agg(distinct entity_type order by entity_type), '{}') into v_roles from public.person_source_id
     where person_id = v_person and not coalesce(needs_review, false);
  end if;
  if v_name is null and v_lead is not null then
    select nullif(btrim(concat_ws(' ', l->>'first_name', l->>'last_name')), '') into v_name
      from public.app_data a, jsonb_array_elements(a.data) l where a.key = 'leads' and l->>'id' = v_lead limit 1;
    v_roles := array_append(v_roles, 'lead');
  end if;
  return jsonb_build_object('match', 'one', 'person_id', v_person, 'lead_id', v_lead, 'name', left(v_name, 120), 'roles', to_jsonb(v_roles));
end $f$;
revoke all on function public.call_who(text) from public, anon, authenticated;
grant execute on function public.call_who(text) to service_role;
