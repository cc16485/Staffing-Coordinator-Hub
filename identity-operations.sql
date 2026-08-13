-- =============================================================================
-- CARING COMPANIONS — IDENTITY, OPERATIONALISED
-- =============================================================================
-- The audit phase is over. This turns the identity foundation into the thing
-- the office actually uses:
--
--   Who is calling  ->  what roles they hold  ->  who they are connected to
--   ->  who on our team owns their needs  ->  does relevant work already exist
--
-- Architectural rule, encoded here and not negotiable elsewhere:
--   THE HUB decides who a person IS.
--   AXISCARE decides care and service facts.
--   GHL is a communication endpoint.
-- GHL must never determine that two humans are one person because it happened
-- to match a phone number.
--
-- Additive only. Nothing in identity-layer.sql is redefined.
-- =============================================================================

-- ── 1. THE AUTHORITATIVE VOCABULARY ──────────────────────────────────────────
-- Small and closed on purpose. GHL has accumulated 237 tags including
-- 'applicant qualified' AND 'qualified applicant'; that drift happens when the
-- vocabulary lives in whatever someone typed. It lives here instead.
--
-- We are NOT cleaning up those 237 tags. Hub roles are authoritative and GHL
-- is told; its tag history stays as CRM activity, not as identity.
create table if not exists identity_vocabulary (
  kind       text not null check (kind in ('role','lifecycle','relationship')),
  value      text not null,
  label      text not null,
  notes      text,
  sort       int not null default 100,
  primary key (kind, value)
);

insert into identity_vocabulary (kind, value, label, notes, sort) values
  ('role','client',          'Client',              'receives care from us', 10),
  ('role','client_contact',  'Client Contact',      'family, responsible party, emergency contact', 20),
  ('role','caregiver',       'Caregiver',           'works in the field', 30),
  ('role','applicant',       'Applicant',           'in the hiring pipeline', 40),
  ('role','lead',            'Lead',                'prospective client or family', 50),
  ('role','referral_partner','Referral Partner',    'professional or organisation who refers', 60),
  ('role','staff',           'Office Staff',        'works in the office', 70),

  ('lifecycle','active',     'Active',              'current', 10),
  ('lifecycle','prospective','Prospective',         'not yet started', 20),
  ('lifecycle','inactive',   'Inactive',            'paused, on hold, dormant', 30),
  ('lifecycle','former',     'Former',              'ended. Never deleted.', 40),

  ('relationship','daughter','Daughter',            null, 10),
  ('relationship','son',     'Son',                 null, 20),
  ('relationship','spouse',  'Spouse',              null, 30),
  ('relationship','niece',   'Niece',               null, 40),
  ('relationship','nephew',  'Nephew',              null, 50),
  ('relationship','sibling', 'Sibling',             null, 60),
  ('relationship','parent',  'Parent',              null, 70),
  ('relationship','guardian','Guardian',            'legal', 80),
  ('relationship','poa',     'Power of Attorney',   'legal', 90),
  ('relationship','friend',  'Friend',              null, 100),
  ('relationship','neighbor','Neighbor',            null, 110),
  ('relationship','other',   'Other',               'describe in notes', 999)
on conflict (kind, value) do update
  set label = excluded.label, notes = excluded.notes, sort = excluded.sort;

-- person_role.status already constrains to active/former/prospective.
-- 'inactive' is a real lifecycle state we need, so widen it.
do $$
begin
  alter table person_role drop constraint if exists person_role_status_check;
  alter table person_role add constraint person_role_status_check
    check (status in ('active','prospective','inactive','former'));
exception when others then null;
end $$;

-- ── 2. THE IDENTITY REVIEW QUEUE ─────────────────────────────────────────────
-- ONLY genuine ambiguity belongs here. Incomplete data is not a review item:
-- a lead with no surname is normal, not a question for a human. Creating review
-- work for missing fields is how a queue becomes noise nobody reads.
create table if not exists identity_review (
  id          bigserial primary key,
  reason      text not null check (reason in (
                'source_mismatch',        -- two source systems disagree
                'probable_ghl_overwrite', -- one GHL contact, two humans
                'ambiguous_household',    -- a line we genuinely cannot resolve
                'conflicting_names',      -- same source id, different names
                'unknown_caller_kept'     -- worth retaining and classifying
              )),
  phone       text,
  person_id   uuid references person_identity(id) on delete cascade,
  detail      jsonb not null default '{}'::jsonb,
  status      text not null default 'open'
                check (status in ('open','resolved','dismissed')),
  resolved_by text,
  resolved_at timestamptz,
  resolution  text,
  created_at  timestamptz not null default now(),
  -- One open review per reason per line. Re-running detection must never
  -- multiply the queue.
  unique (reason, phone, person_id)
);
create index if not exists identity_review_open on identity_review (status, reason);

-- ── 3. CALLER CONTEXT: THE ANSWER THE OFFICE SEES ────────────────────────────
-- Returns ONE row per candidate person. When more than one person holds the
-- number, it returns them all and sets ambiguous. It never picks.
--
-- Open work is matched by NAME against ops_items, because ops_items predates
-- this layer and carries no person_id. That is a known weakness, not a design:
-- it will get exact once items start carrying identity ids. It is reported as
-- 'possible' rather than 'related' so nobody mistakes it for certainty.
create or replace function caller_context(p_phone text, p_scope text default 'basic')
returns jsonb
language plpgsql
security invoker
stable
as $$
declare
  v_people jsonb;
  v_count  int;
  v_shared boolean;
begin
  select count(*), coalesce(bool_or(ph.shared), false)
    into v_count, v_shared
  from phone_index ph where ph.phone = p_phone;

  if v_count = 0 then
    return jsonb_build_object(
      'status','unknown',
      'phone', p_phone,
      'headline','Unknown caller',
      'guidance','Ask who is calling and what it is about. If they matter, ' ||
                 'classify them so the next call is recognised.',
      'match_count', 0
    );
  end if;

  select jsonb_agg(p order by p->>'display_name') into v_people
  from (
    select jsonb_build_object(
      'person_id', pi.id,
      'display_name', pi.display_name,
      'roles', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'role', pr.role, 'status', pr.status,
                 'label', coalesce(vr.label, pr.role),
                 'coordinator', pr.coordinator,
                 'payer', case when p_scope in ('care','full') then pr.payer end,
                 'since', pr.started_at, 'ended', pr.ended_at
               ) order by pr.status, pr.role), '[]'::jsonb)
        from person_role pr
        left join identity_vocabulary vr on vr.kind='role' and vr.value=pr.role
        where pr.person_id = pi.id
      ),
      'relationships', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'to', cli.display_name,
                 'relationship', coalesce(vv.label, rel.relationship),
                 'responsible_party', rel.responsible_party,
                 'emergency_contact', rel.emergency_contact,
                 'billing_contact', rel.billing_contact,
                 'client_status', (select pr2.status from person_role pr2
                                   where pr2.person_id = cli.id and pr2.role='client'
                                   limit 1),
                 'client_coordinator', (select pr2.coordinator from person_role pr2
                                        where pr2.person_id = cli.id and pr2.role='client'
                                        limit 1)
               ) order by rel.rank), '[]'::jsonb)
        from person_relationship rel
        join person_identity cli on cli.id = rel.client_person_id
        left join identity_vocabulary vv
               on vv.kind='relationship' and vv.value=rel.relationship
        where rel.person_id = pi.id and rel.active
      ),
      'known_in', (
        select coalesce(jsonb_agg(distinct psi.system), '[]'::jsonb)
        from person_source_id psi where psi.person_id = pi.id
      ),
      'needs_reconciliation', exists (
        select 1 from person_source_id psi
        where psi.person_id = pi.id and (psi.needs_review or psi.confidence <> 'confirmed')
      )
    ) as p
    from phone_index ph
    join person_identity pi on pi.id = ph.person_id
    where ph.phone = p_phone
    group by pi.id, pi.display_name
  ) s;

  return jsonb_build_object(
    'status', case when v_count > 1 then 'ambiguous' else 'identified' end,
    'phone', p_phone,
    'match_count', v_count,
    'shared_line', v_shared,
    'people', coalesce(v_people, '[]'::jsonb),
    'headline', case when v_count > 1
                     then 'Possible matches — shared household phone'
                     else (v_people->0->>'display_name') end,
    'guidance', case when v_count > 1
                     then 'Ask the caller who you are speaking with. Do not assume.'
                     else null end
  );
end $$;

-- ── 4. DOES WORK ALREADY EXIST FOR THIS PERSON? ──────────────────────────────
-- The point is not a nicer caller ID. It is that a caregiver ringing about
-- Patsy for the third time should land on the EXISTING issue, so the office
-- adds an update instead of opening a fourth one.
create or replace function caller_open_work(p_person_id uuid)
returns jsonb
language sql
security invoker
stable
as $$
  with me as (
    select pi.display_name as nm from person_identity pi where pi.id = p_person_id
  ),
  mine as (
    -- the person themselves, plus any client they are connected to
    select nm from me
    union
    select cli.display_name
    from person_relationship rel
    join person_identity cli on cli.id = rel.client_person_id
    where rel.person_id = p_person_id and rel.active
  ),
  items as (
    select e from app_data, jsonb_array_elements(data) e where key = 'ops_items'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',      e->>'id',
           'title',   e->>'title',
           'owner',   e->>'owner',
           'status',  e->>'status',
           'due',     e->>'due',
           'updated', e->>'updated_at',
           'match',   'possible'   -- matched by NAME, not by identity id
         )), '[]'::jsonb)
  from items, mine
  where coalesce(e->>'status','open') not in ('done','closed','cancelled')
    and mine.nm is not null and length(mine.nm) > 3
    and (
      (e->>'title')   ilike '%' || mine.nm || '%' or
      (e->>'client')  ilike '%' || mine.nm || '%' or
      (e->>'subject') ilike '%' || mine.nm || '%'
    );
$$;

-- ── 5. LOCK DOWN ─────────────────────────────────────────────────────────────
alter table identity_vocabulary enable row level security;
alter table identity_review     enable row level security;
do $$
declare t text;
begin
  foreach t in array array['identity_vocabulary','identity_review'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    begin
      execute format($p$create policy %I on public.%I for select to authenticated using (true)$p$,
                     t || '_read', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
grant update on identity_review to authenticated;

-- =============================================================================
-- WHAT THIS DELIBERATELY DOES NOT DO:
--   * it does not write to GHL, or read identity FROM GHL tags
--   * it does not clean up the 237 existing tags. Hub roles are authoritative;
--     GHL tag history stays as CRM activity
--   * it does not create review work for incomplete data, only for genuine
--     ambiguity
--   * ops_items matching is by name and says so. It becomes exact when items
--     start carrying a person_id, not before.
-- =============================================================================
