-- =============================================================================
-- IDENTITY DOOR, HISTORICAL RESOLUTION (PG-2.i3): person_resolve_historical
-- =============================================================================
-- Executes an EXISTING Samantha-approved historical identity resolution after
-- independently revalidating its authority and source chain. It never makes
-- an identity decision; it executes one, and refuses everything else.
--
-- THE TRUST BOUNDARY (her Ruling 2, made technical):
-- SQL cannot call AxisCare, so the service wrapper performs the live
-- authoritative existence check. The wrapper then proves it did so with an
-- ATTESTATION: HMAC-SHA256 over (resolution_id | caregiver_id | first |
-- last | epoch) using a key that lives in exactly two places: the edge
-- function secret AXIS_ATTEST_KEY, and the one-row identity_door_config
-- table below, which carries NO grants for ANY role (not even service_role;
-- only the table owner, postgres, can read it, and only this SECURITY
-- DEFINER function does). A service-role caller that bypasses the wrapper
-- cannot fabricate the attestation: it cannot read the key from the table
-- (no grant, and grants beat BYPASSRLS-free table access), cannot read the
-- edge secret, and cannot alter the table it does not own. Replay is bounded
-- by a 120-second freshness window inside the HMAC, and a replay within the
-- window converges on the idempotent path anyway. The display identity
-- (first/last from live AxisCare, the authoritative system for caregivers)
-- is bound inside the HMAC, so it cannot be substituted without the key.
-- Residual honesty: a raw service-key holder can already write the person
-- tables DIRECTLY (default grants) and needs no door at all; that is key
-- custody, out of scope for any in-database defense, and unchanged here.
--
-- Ruling 1: role history for historical remediation = caregiver/active ONLY.
-- No applicant/former is created, and never a job_applicant role.
-- =============================================================================

create extension if not exists pgcrypto;

-- ── 1. THE ATTESTATION KEY (one row, readable by NOBODY but the owner) ──────
create table if not exists identity_door_config (
  id             int primary key default 1 check (id = 1),
  axis_attest_key text not null,
  updated_at     timestamptz not null default now()
);
alter table identity_door_config enable row level security;
revoke all on identity_door_config from public, anon, authenticated, service_role;

-- ── 2. AUDIT VOCABULARY EXTENSION ───────────────────────────────────────────
do $FIX$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'identity_door_audit'::regclass
             and (pg_get_constraintdef(oid) ilike '%outcome%'
                  or pg_get_constraintdef(oid) ilike '%''resolve_or_create''%')
             and contype = 'c'
  loop
    execute 'alter table identity_door_audit drop constraint ' || quote_ident(c.conname);
  end loop;
end $FIX$;
alter table identity_door_audit add constraint identity_door_audit_op_check
  check (op in ('resolve_or_create','attach_source','resolve_historical'));
alter table identity_door_audit add constraint identity_door_audit_outcome_check
  check (outcome in ('resolved_existing','created_new','conflict','invalid_source',
                     'attached','already_attached',
                     'resolved_created','already_resolved','invalid_resolution'));

-- ── 3. THE OPERATION ────────────────────────────────────────────────────────
create or replace function person_resolve_historical(
  p_resolution_id     text,
  p_ax_caregiver_id   text,
  p_ax_first          text,
  p_ax_last           text,
  p_ax_verified_epoch bigint,
  p_attestation       text,
  p_workflow          text default 'unspecified',
  p_acting_staff      text default 'unspecified'
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key      text;
  v_expected text;
  v_store    jsonb;
  v_rec      jsonb := null;
  v_elem     jsonb;
  v_axid     text;
  v_link     jsonb;
  v_person   uuid;
  v_evidence text;
  v_name     text;
  v_neg      text[] := array['pending','proposed','rejected','ambiguous',
                             'needs_review','needs-review','draft','informational','review'];
  v_kv       record;
  v_bad      boolean := false;
begin
  -- V0: attestation. Fabrication needs the key; nobody but the owner reads it.
  select axis_attest_key into v_key from identity_door_config where id = 1;
  if v_key is null then
    insert into identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, detail)
    values ('resolve_historical', p_workflow, p_acting_staff, 'axiscare', 'caregiver',
            coalesce(p_ax_caregiver_id,''), 'invalid_resolution', 'door not configured (no attestation key)');
    return jsonb_build_object('outcome','invalid_resolution','detail','door not configured');
  end if;
  v_expected := encode(hmac(
      p_resolution_id || '|' || coalesce(p_ax_caregiver_id,'') || '|' ||
      coalesce(p_ax_first,'') || '|' || coalesce(p_ax_last,'') || '|' ||
      coalesce(p_ax_verified_epoch,0)::text,
      v_key, 'sha256'), 'hex');
  if p_attestation is distinct from v_expected
     or abs(extract(epoch from now()) - coalesce(p_ax_verified_epoch,0)) > 120 then
    insert into identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, detail)
    values ('resolve_historical', p_workflow, p_acting_staff, 'axiscare', 'caregiver',
            coalesce(p_ax_caregiver_id,''), 'invalid_resolution',
            'axiscare verification attestation invalid or expired');
    return jsonb_build_object('outcome','invalid_resolution',
      'detail','axiscare verification attestation invalid or expired');
  end if;

  -- V1: load the approved resolution by EXACT id.
  select data into v_store from app_data where key = 'hiring_identity_resolutions';
  if v_store is not null and jsonb_typeof(v_store) = 'array' then
    for v_elem in select * from jsonb_array_elements(v_store) loop
      if v_elem->>'id' = p_resolution_id then v_rec := v_elem; end if;
    end loop;
  end if;
  if v_rec is null then
    insert into identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, detail)
    values ('resolve_historical', p_workflow, p_acting_staff, 'axiscare', 'caregiver',
            coalesce(p_ax_caregiver_id,''), 'invalid_resolution', 'no such approved resolution: ' || p_resolution_id);
    return jsonb_build_object('outcome','invalid_resolution',
      'detail','no such approved resolution');
  end if;

  -- V2: revalidate the Samantha-approval contract from stored data (R1-R5).
  v_axid := trim(coalesce(v_rec->>'axiscare_id',''));
  for v_kv in select key as k, value as v from jsonb_each(v_rec) loop
    if jsonb_typeof(v_kv.v) = 'string'
       and lower(trim(both '"' from v_kv.v::text)) = any(v_neg) then
      v_bad := true;
    end if;
  end loop;
  if v_axid !~ '^\d+$'
     or coalesce(trim(v_rec->>'approved_by'),'') = ''
     or coalesce(trim(v_rec->>'approved_at'),'') = ''
     or coalesce(v_rec->>'source','') <> 'manual-resolution'
     or coalesce(trim(v_rec->>'method'),'') = ''
     or coalesce(trim(v_rec->>'basis'),'') = ''
     or jsonb_typeof(v_rec->'links') <> 'array'
     or jsonb_array_length(v_rec->'links') = 0
     or v_bad then
    insert into identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, detail)
    values ('resolve_historical', p_workflow, p_acting_staff, 'axiscare', 'caregiver', v_axid,
            'invalid_resolution', 'resolution fails the approval contract');
    return jsonb_build_object('outcome','invalid_resolution',
      'detail','resolution fails the approval contract');
  end if;

  -- V3: the live-verified caregiver id must BE the approved ruling's id.
  if p_ax_caregiver_id is distinct from v_axid then
    insert into identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, detail)
    values ('resolve_historical', p_workflow, p_acting_staff, 'axiscare', 'caregiver', v_axid,
            'invalid_resolution', 'verified caregiver id does not match the approved ruling');
    return jsonb_build_object('outcome','invalid_resolution',
      'detail','verified caregiver id does not match the approved ruling');
  end if;

  -- V4: every hire_intake source pointer must still say what the ruling says.
  for v_link in select * from jsonb_array_elements(v_rec->'links') loop
    if v_link->>'store' = 'hire_intake' then
      if not exists (select 1 from hire_intake hi
                     where hi.id::text = v_link->>'record_id'
                       and hi.candidate_id::text = v_axid) then
        insert into identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, detail)
        values ('resolve_historical', p_workflow, p_acting_staff, 'axiscare', 'caregiver', v_axid,
                'invalid_resolution', 'source record no longer says what the ruling says: ' || (v_link->>'record_id'));
        return jsonb_build_object('outcome','invalid_resolution',
          'detail','source record no longer says what the ruling says');
      end if;
    end if;
  end loop;

  -- V5: conflict inspection before creation. Never silently merge.
  select psi.person_id, psi.evidence into v_person, v_evidence
  from person_source_id psi
  where psi.system = 'axiscare' and psi.entity_type = 'caregiver' and psi.source_id = v_axid;
  if v_person is not null then
    if coalesce(v_evidence,'') like '%' || p_resolution_id || '%' then
      insert into identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, person_id)
      values ('resolve_historical', p_workflow, p_acting_staff, 'axiscare', 'caregiver', v_axid,
              'already_resolved', v_person);
      return jsonb_build_object('outcome','already_resolved','person_id', v_person);
    end if;
    insert into identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, person_id, detail)
    values ('resolve_historical', p_workflow, p_acting_staff, 'axiscare', 'caregiver', v_axid,
            'conflict', v_person,
            'caregiver id already belongs to a different canonical person; requires Samantha review');
    return jsonb_build_object('outcome','conflict',
      'detail','caregiver id already belongs to a different canonical person; requires Samantha review');
  end if;

  -- V6: display identity ONLY from the attested live-AxisCare payload.
  v_name := trim(coalesce(p_ax_first,'') || ' ' || coalesce(p_ax_last,''));
  if v_name = '' then
    insert into identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, detail)
    values ('resolve_historical', p_workflow, p_acting_staff, 'axiscare', 'caregiver', v_axid,
            'invalid_resolution', 'authoritative display identity unavailable from AxisCare');
    return jsonb_build_object('outcome','invalid_resolution',
      'detail','authoritative display identity unavailable from AxisCare');
  end if;

  -- CREATE: person + approved source + caregiver/active, atomically.
  -- Ruling 1: NO applicant/former, NO job_applicant role, ever.
  v_evidence := 'historical resolution ' || p_resolution_id
             || ' approved_by ' || (v_rec->>'approved_by')
             || ' approved_at ' || (v_rec->>'approved_at')
             || '; sources ' || (select string_agg(l->>'store' || '/' || (l->>'record_id'), ', ')
                                 from jsonb_array_elements(v_rec->'links') l)
             || '; axiscare verified live at epoch ' || p_ax_verified_epoch::text;
  begin
    insert into person_identity (display_name, first_name, last_name)
    values (v_name, nullif(trim(coalesce(p_ax_first,'')),''), nullif(trim(coalesce(p_ax_last,'')),''))
    returning id into v_person;

    insert into person_source_id (person_id, system, entity_type, source_id, confidence, needs_review, evidence)
    values (v_person, 'axiscare', 'caregiver', v_axid, 'confirmed', false, v_evidence);

    if not exists (select 1 from person_role pr
                   where pr.person_id = v_person and pr.role = 'caregiver') then
      insert into person_role (person_id, role, status) values (v_person, 'caregiver', 'active');
    end if;
  exception when unique_violation then
    select psi.person_id, psi.evidence into v_person, v_evidence
    from person_source_id psi
    where psi.system = 'axiscare' and psi.entity_type = 'caregiver' and psi.source_id = v_axid;
    if v_person is not null and coalesce(v_evidence,'') like '%' || p_resolution_id || '%' then
      insert into identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, person_id, detail)
      values ('resolve_historical', p_workflow, p_acting_staff, 'axiscare', 'caregiver', v_axid,
              'already_resolved', v_person, 'converged after concurrent resolution');
      return jsonb_build_object('outcome','already_resolved','person_id', v_person);
    end if;
    insert into identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, person_id, detail)
    values ('resolve_historical', p_workflow, p_acting_staff, 'axiscare', 'caregiver', v_axid,
            'conflict', v_person, 'lost a concurrent write to different provenance; requires Samantha review');
    return jsonb_build_object('outcome','conflict',
      'detail','lost a concurrent write to different provenance; requires Samantha review');
  end;

  insert into identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, person_id, evidence)
  values ('resolve_historical', p_workflow, p_acting_staff, 'axiscare', 'caregiver', v_axid,
          'resolved_created', v_person, v_evidence);
  return jsonb_build_object('outcome','resolved_created','person_id', v_person);
end $$;

-- ── 4. AUTHORIZATION ────────────────────────────────────────────────────────
revoke all on function person_resolve_historical(text,text,text,text,bigint,text,text,text) from public, anon, authenticated;
grant execute on function person_resolve_historical(text,text,text,text,bigint,text,text,text) to service_role;
