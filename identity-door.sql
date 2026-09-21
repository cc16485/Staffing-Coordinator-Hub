-- =============================================================================
-- IDENTITY DOOR (PG-2.i2): person_resolve_or_create / person_attach_source
-- =============================================================================
-- The one controlled way a person enters the identity spine one-at-a-time.
-- Owner rulings encoded here (2026-09-20):
--   * namespace: ('hub','job_applicant', job_applicants.id::text). The person
--     ROLE stays 'applicant': source namespace and person role are different
--     concepts, so person_role's CHECK is deliberately NOT touched.
--   * AUTHORITATIVE-SOURCE ALLOWLIST: a database-valid tuple is NOT authority.
--     Eligibility lives in the explicit lists inside each function, and a
--     future source type becomes eligible only by editing them deliberately.
--     Knowing or inventing a UUID is not authority to mint a person: the
--     exact row must exist in job_applicants.
--   * GHL is never an identity authority (excluded by the allowlist and
--     called out in the refusal text).
--   * conflicts fail closed, write no identity decision, and surface for
--     Samantha's approval. No automated conflict winner.
--   * deterministic resolve/create needs no per-person approval.
-- Transactionality: person + mapping + role are one atomic block. The race
-- between two simultaneous calls is settled by the existing partial unique
-- index (person_source_hub_uniq / person_source_axiscare_uniq): the loser's
-- subtransaction rolls back (its person row vanishes with it), the winner is
-- re-selected, and both callers converge on one canonical person.
-- Audit: every call, including refusals and conflicts, lands in
-- identity_door_audit (append-only: INSERT+SELECT only, for every role).
-- Authorization: EXECUTE is revoked from PUBLIC/anon/authenticated and
-- granted to service_role only. Browsers can never reach these functions.
-- =============================================================================

-- ── 1. NAMESPACE MIGRATION (Option 1, owner-ruled) ───────────────────────────
alter table person_source_id drop constraint if exists person_source_id_entity_type_check;
alter table person_source_id add constraint person_source_id_entity_type_check
  check (entity_type in ('client','caregiver','contact','applicant','lead',
                         'referral_partner','job_applicant'));
-- person_role's CHECK is not modified: the role for these people is 'applicant'.

-- ── 2. APPEND-ONLY AUDIT ─────────────────────────────────────────────────────
create table if not exists identity_door_audit (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  op           text not null check (op in ('resolve_or_create','attach_source')),
  workflow     text not null,
  acting_staff text not null,
  system       text not null,
  entity_type  text not null,
  source_id    text not null,
  outcome      text not null check (outcome in
                 ('resolved_existing','created_new','conflict',
                  'invalid_source','attached','already_attached')),
  person_id    uuid,
  evidence     text,
  detail       text
);
alter table identity_door_audit enable row level security;
revoke all on identity_door_audit from public, anon, authenticated;
revoke update, delete, truncate on identity_door_audit from service_role;
grant insert, select on identity_door_audit to service_role;
grant usage on sequence identity_door_audit_id_seq to service_role;

-- ── 3. RESOLVE OR CREATE ─────────────────────────────────────────────────────
create or replace function person_resolve_or_create(
  p_system       text,
  p_entity_type  text,
  p_source_id    text,
  p_display_name text default null,
  p_first        text default null,
  p_last         text default null,
  p_phone        text default null,
  p_email        text default null,
  p_workflow     text default 'unspecified',
  p_acting_staff text default 'unspecified',
  p_evidence     text default null
) returns jsonb
language plpgsql
security invoker
as $$
declare
  v_person   uuid;
  v_exists   boolean;
  v_detail   text := null;
  v_coincide int;
begin
  -- AUTHORITATIVE-SOURCE ALLOWLIST for creation. Deliberate additions only.
  if not (p_system = 'hub' and p_entity_type = 'job_applicant') then
    insert into identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, detail)
    values ('resolve_or_create', p_workflow, p_acting_staff, p_system, p_entity_type, p_source_id,
            'invalid_source',
            case when p_system = 'ghl'
                 then 'GHL is never an identity authority'
                 else 'source type is not on the authoritative allowlist' end);
    return jsonb_build_object('outcome','invalid_source',
      'detail', case when p_system = 'ghl'
                     then 'GHL is never an identity authority'
                     else 'source type is not on the authoritative allowlist' end);
  end if;

  -- AUTHORITY CHECK: the exact row must exist. A uuid alone is not authority.
  begin
    select exists (select 1 from job_applicants ja where ja.id = p_source_id::uuid)
      into v_exists;
  exception when others then
    v_exists := false;   -- not even a valid uuid
  end;
  if not v_exists then
    insert into identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, detail)
    values ('resolve_or_create', p_workflow, p_acting_staff, p_system, p_entity_type, p_source_id,
            'invalid_source', 'no such job_applicants row; a uuid is not authority to mint a person');
    return jsonb_build_object('outcome','invalid_source',
      'detail','no such job_applicants row; a uuid is not authority to mint a person');
  end if;

  -- RESOLVE: exact tuple, nothing else.
  select psi.person_id into v_person
  from person_source_id psi
  where psi.system = p_system and psi.entity_type = p_entity_type
    and psi.source_id = p_source_id;
  if v_person is not null then
    insert into identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, person_id)
    values ('resolve_or_create', p_workflow, p_acting_staff, p_system, p_entity_type, p_source_id,
            'resolved_existing', v_person);
    return jsonb_build_object('outcome','resolved_existing','person_id', v_person);
  end if;

  -- CREATE: needs a display name (for the row, never for matching).
  if coalesce(trim(p_display_name), '') = '' then
    insert into identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, detail)
    values ('resolve_or_create', p_workflow, p_acting_staff, p_system, p_entity_type, p_source_id,
            'invalid_source', 'display name required to create a person');
    return jsonb_build_object('outcome','invalid_source',
      'detail','display name required to create a person');
  end if;

  -- Name coincidence is REPORTED, never matched on, never blocking
  -- (the backfill's own precedent).
  select count(*) into v_coincide
  from person_identity pi where lower(pi.display_name) = lower(trim(p_display_name));
  if v_coincide > 0 then
    v_detail := 'name coincidence reported: ' || v_coincide ||
                ' existing person(s) share this display name; created separately, never merged';
  end if;

  begin
    insert into person_identity (display_name, first_name, last_name, primary_phone, primary_email)
    values (trim(p_display_name), p_first, p_last, p_phone, p_email)
    returning id into v_person;

    insert into person_source_id (person_id, system, entity_type, source_id, confidence, needs_review, evidence)
    values (v_person, p_system, p_entity_type, p_source_id, 'confirmed', false,
            coalesce(p_evidence, 'identity door: deterministic job_applicants row match'));

    -- Semantic role is 'applicant'. Never 'job_applicant'.
    if not exists (select 1 from person_role pr
                   where pr.person_id = v_person and pr.role = 'applicant') then
      insert into person_role (person_id, role, status) values (v_person, 'applicant', 'active');
    end if;
  exception when unique_violation then
    -- The race: another transaction attached this tuple first. This
    -- subtransaction rolled back (our person row is gone with it).
    -- Converge on the winner.
    select psi.person_id into v_person
    from person_source_id psi
    where psi.system = p_system and psi.entity_type = p_entity_type
      and psi.source_id = p_source_id;
    if v_person is null then
      raise;   -- a different unique violation: fail loudly, not silently
    end if;
    insert into identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, person_id, detail)
    values ('resolve_or_create', p_workflow, p_acting_staff, p_system, p_entity_type, p_source_id,
            'resolved_existing', v_person, 'converged after concurrent create');
    return jsonb_build_object('outcome','resolved_existing','person_id', v_person,
                              'detail','converged after concurrent create');
  end;

  insert into identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, person_id, evidence, detail)
  values ('resolve_or_create', p_workflow, p_acting_staff, p_system, p_entity_type, p_source_id,
          'created_new', v_person, p_evidence, v_detail);
  return jsonb_build_object('outcome','created_new','person_id', v_person, 'detail', v_detail);
end $$;

-- ── 4. ATTACH SOURCE (hire-time; axiscare caregiver only, v1) ────────────────
create or replace function person_attach_source(
  p_person_id    uuid,
  p_system       text,
  p_entity_type  text,
  p_source_id    text,
  p_evidence     text,
  p_workflow     text default 'unspecified',
  p_acting_staff text default 'unspecified'
) returns jsonb
language plpgsql
security invoker
as $$
declare
  v_existing uuid;
begin
  -- ATTACH ALLOWLIST: v1 permits only the AxisCare caregiver identity.
  if not (p_system = 'axiscare' and p_entity_type = 'caregiver') then
    insert into identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, detail)
    values ('attach_source', p_workflow, p_acting_staff, p_system, p_entity_type, p_source_id,
            'invalid_source',
            case when p_system = 'ghl'
                 then 'GHL is never an identity authority'
                 else 'source type is not on the attach allowlist' end);
    return jsonb_build_object('outcome','invalid_source',
      'detail', case when p_system = 'ghl'
                     then 'GHL is never an identity authority'
                     else 'source type is not on the attach allowlist' end);
  end if;

  if coalesce(trim(p_evidence), '') = '' then
    insert into identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, detail)
    values ('attach_source', p_workflow, p_acting_staff, p_system, p_entity_type, p_source_id,
            'invalid_source', 'evidence text is required to attach a source identity');
    return jsonb_build_object('outcome','invalid_source',
      'detail','evidence text is required to attach a source identity');
  end if;

  if not exists (select 1 from person_identity pi where pi.id = p_person_id) then
    insert into identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, detail)
    values ('attach_source', p_workflow, p_acting_staff, p_system, p_entity_type, p_source_id,
            'invalid_source', 'no such person');
    return jsonb_build_object('outcome','invalid_source','detail','no such person');
  end if;

  select psi.person_id into v_existing
  from person_source_id psi
  where psi.system = p_system and psi.entity_type = p_entity_type
    and psi.source_id = p_source_id;

  if v_existing is not null and v_existing = p_person_id then
    insert into identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, person_id)
    values ('attach_source', p_workflow, p_acting_staff, p_system, p_entity_type, p_source_id,
            'already_attached', p_person_id);
    return jsonb_build_object('outcome','already_attached','person_id', p_person_id);
  end if;

  if v_existing is not null then
    -- CONFLICT: fail closed, no identity writes, surfaces for Samantha.
    insert into identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, person_id, detail)
    values ('attach_source', p_workflow, p_acting_staff, p_system, p_entity_type, p_source_id,
            'conflict', p_person_id,
            'source identity already maps to a different person (' || v_existing ||
            '); requires Samantha-approved human resolution');
    return jsonb_build_object('outcome','conflict',
      'detail','source identity already maps to a different person; requires Samantha-approved human resolution');
  end if;

  begin
    insert into person_source_id (person_id, system, entity_type, source_id, confidence, needs_review, evidence)
    values (p_person_id, p_system, p_entity_type, p_source_id, 'confirmed', false, trim(p_evidence));

    if not exists (select 1 from person_role pr
                   where pr.person_id = p_person_id and pr.role = 'caregiver') then
      insert into person_role (person_id, role, status) values (p_person_id, 'caregiver', 'active');
    end if;
  exception when unique_violation then
    select psi.person_id into v_existing
    from person_source_id psi
    where psi.system = p_system and psi.entity_type = p_entity_type
      and psi.source_id = p_source_id;
    if v_existing = p_person_id then
      insert into identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, person_id, detail)
      values ('attach_source', p_workflow, p_acting_staff, p_system, p_entity_type, p_source_id,
              'already_attached', p_person_id, 'converged after concurrent attach');
      return jsonb_build_object('outcome','already_attached','person_id', p_person_id);
    end if;
    insert into identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, person_id, detail)
    values ('attach_source', p_workflow, p_acting_staff, p_system, p_entity_type, p_source_id,
            'conflict', p_person_id,
            'lost a concurrent attach to a different person; requires Samantha-approved human resolution');
    return jsonb_build_object('outcome','conflict',
      'detail','lost a concurrent attach to a different person; requires Samantha-approved human resolution');
  end;

  insert into identity_door_audit (op, workflow, acting_staff, system, entity_type, source_id, outcome, person_id, evidence)
  values ('attach_source', p_workflow, p_acting_staff, p_system, p_entity_type, p_source_id,
          'attached', p_person_id, trim(p_evidence));
  return jsonb_build_object('outcome','attached','person_id', p_person_id);
end $$;

-- ── 5. AUTHORIZATION: service only, fail closed ─────────────────────────────
revoke all on function person_resolve_or_create(text,text,text,text,text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function person_resolve_or_create(text,text,text,text,text,text,text,text,text,text,text) to service_role;
revoke all on function person_attach_source(uuid,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function person_attach_source(uuid,text,text,text,text,text,text) to service_role;
