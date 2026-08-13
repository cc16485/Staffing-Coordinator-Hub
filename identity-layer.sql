-- =============================================================================
-- CARING COMPANIONS — CROSS-SYSTEM IDENTITY LAYER
-- =============================================================================
-- V1 FOUNDATION. People and relationships, not a client CRM.
--
-- When the phone rings the office should already know who is calling, or say
-- clearly that it does not. Today GHL holds undifferentiated contacts and
-- deduplicates on phone, so a shared household line silently merges a client
-- with her daughter.
--
-- Rules enforced structurally rather than by convention:
--   * a person is not a phone number   -> phone_index is MANY-to-many
--   * a person is not one role         -> several at once, history preserved
--   * a relationship is TO A CLIENT    -> a table, not a tag
--   * identity is by SOURCE ID         -> never by name
--   * nobody is deleted, only ended    -> status + ended_at, never DELETE
--   * AxisCare ids are trusted, GHL ids are NOT -> see person_source_id
--
-- client_queue carries none of this. It stays a scheduling handoff.
-- Read this before running it. Nothing else depends on it yet.
-- =============================================================================

-- ── 1. THE PERSON ────────────────────────────────────────────────────────────
create table if not exists person_identity (
  id            uuid primary key default gen_random_uuid(),
  display_name  text not null,
  first_name    text,
  last_name     text,
  primary_phone text,               -- E.164. Convenience only; phone_index is
                                    -- authoritative for lookup.
  primary_email text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── 2. THE CROSS-SYSTEM MAP ──────────────────────────────────────────────────
-- Identity resolution keys off THIS table and never off a name.
--
-- The asymmetry below is deliberate and is the most important thing in the
-- file. AxisCare ids are authoritative, so one of them may never point at two
-- people. GHL ids are NOT authoritative: its phone/email upsert may already
-- have collapsed a client and her daughter into a single contact. Forcing a
-- unique constraint on GHL ids would make that damage unrepresentable, and we
-- would silently drop the second person instead of seeing the collision.
create table if not exists person_source_id (
  id          bigserial primary key,
  person_id   uuid not null references person_identity(id) on delete cascade,
  system      text not null check (system in ('axiscare','ghl','hub')),
  entity_type text not null check (entity_type in
                ('client','caregiver','contact','applicant','lead','referral_partner')),
  source_id   text not null,
  -- How much we trust this link. GHL links start 'probable' until a human or a
  -- second signal confirms them.
  confidence  text not null default 'confirmed'
                check (confidence in ('confirmed','probable','suspect')),
  needs_review boolean not null default false,
  created_at  timestamptz not null default now()
);

-- AxisCare: one client id, one person. One caregiver id, one person. Hard.
create unique index if not exists person_source_axiscare_uniq
  on person_source_id (entity_type, source_id)
  where system = 'axiscare';

-- Hub ids are ours, so they are trustworthy too.
create unique index if not exists person_source_hub_uniq
  on person_source_id (entity_type, source_id)
  where system = 'hub';

-- GHL: NOT unique. A contact pointing at two people is a real, recordable
-- state that means "this contact was merged and needs splitting".
create index if not exists person_source_ghl_lookup
  on person_source_id (source_id) where system = 'ghl';

-- A person may not hold the same source link twice.
create unique index if not exists person_source_no_dupes
  on person_source_id (person_id, system, entity_type, source_id);
create index if not exists person_source_person on person_source_id (person_id);

-- Every GHL contact that appears to represent more than one human.
create or replace view ghl_contact_collisions as
  select source_id as ghl_contact_id,
         count(distinct person_id)::int as people,
         array_agg(distinct pi.display_name order by pi.display_name) as names
  from person_source_id psi
  join person_identity pi on pi.id = psi.person_id
  where psi.system = 'ghl'
  group by source_id
  having count(distinct person_id) > 1;

-- ── 3. WHAT THEY ARE TO US ───────────────────────────────────────────────────
-- Not mutually exclusive, and history is kept. A caregiver who applied through
-- GHL holds BOTH rows: applicant/former and caregiver/active. She is one person
-- who changed, not two people.
--
-- The unique index is partial on 'active' only. That is what lets a client who
-- discharged and later returned have two client rows — one former, one active —
-- instead of the schema forcing us to overwrite her history.
create table if not exists person_role (
  id         bigserial primary key,
  person_id  uuid not null references person_identity(id) on delete cascade,
  role       text not null check (role in
               ('client','caregiver','client_contact','applicant',
                'lead','referral_partner')),
  status     text not null default 'active'
               check (status in ('active','former','prospective')),
  payer      text,          -- clients only. NULL rather than guessed.
  position   text,          -- caregivers only
  coordinator text,         -- who owns them in the office
  started_at date,
  ended_at   date,
  end_reason text,          -- 'discharged','deceased','terminated','resigned'
  updated_at timestamptz not null default now(),
  -- Ended roles must record when. Presenting someone as active forever is the
  -- failure mode this is here to prevent.
  check (status <> 'former' or ended_at is not null)
);
create unique index if not exists person_role_one_active
  on person_role (person_id, role) where status = 'active';
create index if not exists person_role_lookup on person_role (role, status);

-- ── 4. WHO THEY ARE TO A CLIENT ──────────────────────────────────────────────
-- The part that makes the screen say "Niece of Patsy Smith" instead of a name.
-- Cathy related to three clients gets three rows, not three contact records.
create table if not exists person_relationship (
  id                bigserial primary key,
  person_id         uuid not null references person_identity(id) on delete cascade,
  client_person_id  uuid not null references person_identity(id) on delete cascade,
  relationship      text,        -- 'daughter','son','spouse','niece','POA','neighbor'
  responsible_party boolean not null default false,
  emergency_contact boolean not null default false,
  billing_contact   boolean not null default false,
  rank              int  not null default 100,   -- who to call first
  active            boolean not null default true,
  ended_at          date,
  source            text not null default 'office'
                      check (source in ('axiscare','office')),
  created_at        timestamptz not null default now(),
  unique (person_id, client_person_id, relationship),
  check (person_id <> client_person_id)
);
create index if not exists person_rel_client on person_relationship (client_person_id);
create index if not exists person_rel_person on person_relationship (person_id);

-- ── 5. CALLER LOOKUP ─────────────────────────────────────────────────────────
-- MANY-to-many on purpose, and non-negotiable. A household line legitimately
-- belongs to several people. The correct answer to that call is "2 possible
-- matches", never a confident wrong name.
create table if not exists phone_index (
  id         bigserial primary key,
  phone      text not null,          -- E.164 only. Normalise on write.
  person_id  uuid not null references person_identity(id) on delete cascade,
  kind       text check (kind in ('mobile','home','work','other')),
  shared     boolean not null default false,
  created_at timestamptz not null default now(),
  unique (phone, person_id)
);
create index if not exists phone_index_lookup on phone_index (phone);

-- ── 5b. SCAN CACHE ───────────────────────────────────────────────────────────
-- Scratch space for the GHL collision audit, and nothing else. A full contact
-- scan cannot finish inside one edge-function invocation, so the audit pages in
-- time-boxed chunks and parks what it has here between calls. That also makes a
-- scan resumable rather than all-or-nothing.
--
-- This is OUR data about GHL, not identity. Truncated at the start of every
-- scan. Nothing reads it except the audit.
create table if not exists identity_scan_cache (
  ghl_contact_id text primary key,
  first_name     text,
  last_name      text,
  phone          text,          -- normalised to E.164 on write
  email          text,
  tags           jsonb,
  scanned_at     timestamptz not null default now()
);
create index if not exists identity_scan_phone on identity_scan_cache (phone);
create index if not exists identity_scan_email on identity_scan_cache (email);

-- ── 6. THE ANSWER THE OFFICE SEES ────────────────────────────────────────────
-- One row per candidate person. If it returns two rows the screen says
-- ambiguous and shows both; it never picks one.
--
-- p_scope gates the confidential fields. Recognising a caller is not the same
-- as being entitled to their payer or their care notes, and the existing Hub
-- authority rules stay in force above this. 'basic' is the safe default.
create or replace function identify_caller(p_phone text, p_scope text default 'basic')
returns table (
  person_id        uuid,
  display_name     text,
  roles            text[],
  role_statuses    text[],
  payer            text,
  coordinator      text,
  related_clients  text[],
  relationships    text[],
  responsible      boolean,
  shared_line      boolean,
  match_count      int
)
language sql
security invoker            -- callers see only what their own grants allow
stable
as $$
  with hits as (
    select pi.id, pi.display_name, bool_or(ph.shared) as shared
    from phone_index ph
    join person_identity pi on pi.id = ph.person_id
    where ph.phone = p_phone
    group by pi.id, pi.display_name
  )
  select
    h.id,
    h.display_name,
    coalesce(array_agg(distinct pr.role)   filter (where pr.role is not null), '{}'),
    coalesce(array_agg(distinct pr.status) filter (where pr.status is not null), '{}'),
    case when p_scope in ('care','full')
         then max(pr.payer) filter (where pr.role = 'client') end,
    max(pr.coordinator) filter (where pr.role in ('client','caregiver')),
    coalesce(array_agg(distinct cli.display_name) filter (where cli.id is not null), '{}'),
    coalesce(array_agg(distinct rel.relationship) filter (where rel.relationship is not null), '{}'),
    coalesce(bool_or(rel.responsible_party), false),
    bool_or(h.shared),
    (select count(*)::int from hits)
  from hits h
  left join person_role         pr  on pr.person_id = h.id
  left join person_relationship rel on rel.person_id = h.id and rel.active
  left join person_identity     cli on cli.id = rel.client_person_id
  group by h.id, h.display_name;
$$;

-- ── 7. COMPLETENESS, FOR THE CONTROL CENTRE ──────────────────────────────────
-- So a client who has been invisible for six months shows up as a number
-- rather than as a surprise.
create or replace view identity_completeness as
  select
    (select count(*)::int from person_role where role='client'    and status='active') as active_clients,
    (select count(*)::int from person_role where role='caregiver' and status='active') as active_caregivers,
    (select count(*)::int from person_relationship where active)                       as client_contacts,
    (select count(distinct person_id)::int from person_source_id where system='axiscare') as linked_axiscare,
    (select count(distinct person_id)::int from person_source_id where system='ghl')      as linked_ghl,
    (select count(*)::int from person_source_id where needs_review)                     as needs_review,
    (select count(*)::int from ghl_contact_collisions)                                  as ghl_collisions,
    (select count(*)::int from phone_index p
       where (select count(*) from phone_index q where q.phone = p.phone) > 1)          as shared_phone_rows,
    (select count(*)::int from person_identity pi
       where not exists (select 1 from phone_index ph where ph.person_id = pi.id))      as no_phone_on_file;

-- ── 8. LOCK IT DOWN ──────────────────────────────────────────────────────────
-- This holds client and family PII. Nothing here is ever readable by anon.
alter table person_identity     enable row level security;
alter table person_source_id    enable row level security;
alter table person_role         enable row level security;
alter table person_relationship enable row level security;
alter table phone_index         enable row level security;
alter table identity_scan_cache enable row level security;

do $$
declare t text;
begin
  foreach t in array array['person_identity','person_source_id','person_role',
                           'person_relationship','phone_index','identity_scan_cache']
  loop
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

revoke all on ghl_contact_collisions, identity_completeness from anon;
grant select on ghl_contact_collisions, identity_completeness to authenticated;

-- =============================================================================
-- DELIBERATELY NOT ENCODED, because it is not known yet:
--   * whether AxisCare exposes responsible parties, emergency contacts,
--     billing contacts or family relationships at all. If it does not, client
--     contact identity is NOT solved — the office enters relationships by hand
--     and person_relationship.source records which is which.
--   * whether caregivers become full GHL contacts or stay Hub-side with GHL
--     holding only a phone pointer. Same operational result; different cost and
--     a very different messaging blast radius.
--   * which GHL custom fields exist. Nothing here writes to GHL. That shape is
--     chosen from the inventory, not invented alongside it.
-- =============================================================================
