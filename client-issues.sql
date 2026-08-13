-- =============================================================================
-- CLIENT ISSUES — one durable record per problem
-- =============================================================================
-- WHAT ALREADY EXISTED, and why it is not enough
--   `call-disposition` creates an ops_item of kind 'client_issue' with a 24-hour
--   SLA when a call is marked "client concern". That is a PROMPT — it tells
--   somebody to do something. It is not a record of the problem.
--
--   `concerns_raised` is free text on a check-in. `complaints_table` belongs to
--   the CDS agency. Neither is an issue record.
--
-- THE DISTINCTION THIS SCHEMA EXISTS TO HOLD
--   Reported          somebody told us there is a problem
--   Action completed  an employee did a task
--   Resolved          the underlying problem is actually addressed
--
--   Those are three different things. "Krystal called the caregiver" is an
--   action. A family reporting repeated lateness is not resolved by a phone
--   call; it is resolved when the lateness stops and somebody has confirmed it.
--
--   So: ONE evolving issue, MANY actions underneath it, and resolution is a
--   separate judgment from action completion.
--
-- ops_items remains the work layer. An item points AT an issue; it is not one.
-- =============================================================================

-- ── 1. CATEGORIES ────────────────────────────────────────────────────────────
-- Not identical. Each carries its own routing, urgency, follow-up requirement
-- and escalation posture, because a billing question and a possible abuse
-- report are not the same kind of thing.
--
-- IMPORTANT: nothing here encodes a clinical or regulatory decision rule. Where
-- a real rule exists (reporting obligations, timeframes) it belongs in the
-- policy Knowledge Core and is referenced, not reinvented from general
-- knowledge. `requires_policy_lookup` marks those.
create table if not exists issue_category (
  code                   text primary key,
  label                  text not null,
  default_domain         text not null,   -- MUST be a real Hub domain:
                                          -- client_care, field_quality,
                                          -- scheduling_coverage, family_enquiries,
                                          -- caregiver_performance,
                                          -- recruiting_orientation.
                                          -- An invented domain routes to nobody.
  default_urgency        text not null check (default_urgency in ('critical','high','normal','low')),
  target_hours           int  not null,   -- first response, not resolution
  follow_up_required     boolean not null default false,
  follow_up_days         int,             -- when follow_up_required
  notify_beyond_owner    text,            -- who else must SEE it immediately
  owner_authority        boolean not null default false,  -- genuinely needs Samantha/Zach
  requires_policy_lookup boolean not null default false,
  resolution_means       text not null,   -- what actually counts as resolved
  required_info          text,            -- what intake must capture
  sort                   int not null default 100
);

insert into issue_category (code, label, default_domain, default_urgency, target_hours,
  follow_up_required, follow_up_days, notify_beyond_owner, owner_authority,
  requires_policy_lookup, resolution_means, required_info, sort) values

-- ── SAFETY AND REPORTABLE. Policy governs these, not this file. ──────────────
('suspected_abuse', 'Possible abuse, neglect or exploitation', 'client_care', 'critical', 1,
  true, 7, 'krystal,samantha', true, true,
  'Reported per policy, documented, and the client is safe. Resolution is NOT '
  'the same as the report being made.',
  'what was observed, by whom, when, client condition now, immediate safety', 10),

('safety_concern', 'Safety concern in the home', 'client_care', 'critical', 2,
  true, 7, 'krystal', false, true,
  'The hazard is removed or mitigated and confirmed on a later visit.',
  'what the hazard is, who is at risk, whether anyone is hurt', 20),

('fall_injury_hospital', 'Fall, injury or hospitalisation', 'client_care', 'critical', 1,
  true, 3, 'krystal,samantha', false, true,
  'Client status known, care plan adjusted if needed, family informed, '
  'service resumed or formally on hold.',
  'what happened, when, injuries, hospital, who was present, family notified?', 30),

('medication_concern', 'Medication concern', 'client_care', 'high', 4,
  true, 7, 'krystal', false, true,
  'The discrepancy is explained or corrected and the correction is confirmed.',
  'which medication, what was observed, prescriber contacted?', 40),

('condition_change', 'Change in client condition', 'client_care', 'high', 8,
  true, 7, 'krystal', false, false,
  'Care plan reviewed against the new condition and updated, or documented '
  'as no change needed.',
  'what changed, when it started, who noticed', 50),

-- ── CARE DELIVERY ────────────────────────────────────────────────────────────
('caregiver_late_noshow', 'Caregiver late or no-show', 'field_quality', 'high', 4,
  true, 14, null, false, false,
  'The pattern stops. A single conversation is an ACTION, not resolution — '
  'the follow-up confirms it did not recur.',
  'which shift, how late, first time or repeated, was care missed', 60),

('missed_incomplete_care', 'Missed or incomplete care', 'field_quality', 'high', 8,
  true, 14, null, false, false,
  'The missed care is made up or formally waived, and the cause is addressed.',
  'which tasks, which visit, why', 70),

('care_plan_concern', 'Care plan or task concern', 'client_care', 'normal', 24,
  true, 14, null, false, false,
  'The plan is corrected, or the expectation is corrected. Both parties agree.',
  'which task, what is expected versus happening', 80),

-- ── RELATIONSHIP ─────────────────────────────────────────────────────────────
('family_complaint', 'Family complaint about a caregiver', 'field_quality', 'high', 8,
  true, 14, 'krystal', false, false,
  'The behaviour changes and the family confirms it, or the caregiver is '
  'changed. A coaching conversation alone is an action.',
  'what specifically happened, how often, what the family wants', 90),

('caregiver_concern_about_client', 'Caregiver concern about client or family', 'field_quality', 'high', 8,
  true, 14, 'krystal', false, false,
  'The caregiver is safe and supported, and the situation is addressed or '
  'the assignment changed.',
  'what happened, is the caregiver willing to return', 100),

('mismatch', 'Caregiver and client mismatch', 'field_quality', 'normal', 24,
  true, 21, null, false, false,
  'A replacement is in place and the first visits have gone well.',
  'why it is not working, from whose side', 110),

('caregiver_change_request', 'Request for a different caregiver', 'field_quality', 'normal', 24,
  true, 21, null, false, false,
  'New caregiver assigned and the first visit is confirmed to have gone well.',
  'reason, preferences, urgency', 120),

-- ── SCHEDULING AND MONEY ─────────────────────────────────────────────────────
('coverage_concern', 'Schedule or coverage concern', 'scheduling_coverage', 'high', 4,
  false, null, null, false, false,
  'The shift is covered, or the family has agreed an alternative.',
  'which shifts, which dates', 130),

('billing_hours_question', 'Billing or hours question', 'client_care', 'normal', 24,
  false, null, null, false, false,
  'The family understands the charge, or an error is corrected.',
  'which period, what they expected', 140),

('payer_authorization', 'Payer or authorisation issue', 'client_care', 'high', 8,
  true, 7, 'samantha', false, true,
  'Authorisation confirmed, extended, or service formally adjusted to match. '
  'Unpaid delivered care is the failure mode.',
  'payer, authorisation number, hours remaining, dates', 150),

-- ── NOT ACTUALLY AN ISSUE ────────────────────────────────────────────────────
-- ── REPORTED BY PHONE, KIND NOT YET KNOWN ────────────────────────────────────
-- A call disposition of "client concern" tells us a problem exists. It does not
-- tell us which KIND, and the category decides urgency, follow-up and what
-- resolution means. So the issue is created honestly unclassified and triage
-- sets the real category. Guessing one at intake would silently apply the wrong
-- follow-up rule.
('needs_triage', 'Reported concern, not yet classified', 'client_care', 'high', 4,
  false, null, null, false, false,
  'Not resolvable while unclassified. Triage sets the real category, and that '
  'category decides what resolution means.',
  'who it is about, what they said, who reported it', 5),

('general_question', 'General question, not an issue', 'client_care', 'low', 48,
  false, null, null, false, false,
  'Answered.',
  'what they asked', 200)

on conflict (code) do update set
  label = excluded.label, default_domain = excluded.default_domain,
  default_urgency = excluded.default_urgency, target_hours = excluded.target_hours,
  follow_up_required = excluded.follow_up_required, follow_up_days = excluded.follow_up_days,
  notify_beyond_owner = excluded.notify_beyond_owner,
  owner_authority = excluded.owner_authority,
  requires_policy_lookup = excluded.requires_policy_lookup,
  resolution_means = excluded.resolution_means, required_info = excluded.required_info,
  sort = excluded.sort;

-- ── 2. THE ISSUE ─────────────────────────────────────────────────────────────
create table if not exists client_issue (
  id              uuid primary key default gen_random_uuid(),
  category        text not null references issue_category(code),

  /* IDENTITY, DEGRADED ON PURPOSE.
     A real client link is preferred. Until AxisCare exists, free text is
     honest and reconcilable. We do NOT fabricate a client record to satisfy
     a foreign key — that would put a fake person in the system of record. */
  client_person_id     uuid references person_identity(id) on delete set null,
  axiscare_client_id   text,
  client_name_free_text text,
  client_link_status   text not null default 'unresolved'
                         check (client_link_status in ('unresolved','free_text','linked')),

  /* Who told us, and who it is about. */
  reported_by_person_id uuid references person_identity(id) on delete set null,
  reported_by_name      text,
  reported_by_role      text,   -- family, caregiver, client, referral partner, staff
  about_caregiver_id    text,

  /* LIFECYCLE. Deliberately not a task status.
       reported     somebody told us
       triaged      category, owner and urgency set
       in_progress  somebody is working it
       waiting      blocked on someone else, and we know who
       resolving    the fix is in place, not yet confirmed
       follow_up    confirming it actually worked
       resolved     the underlying problem is addressed
       closed_no_action  judged not to be an issue */
  state           text not null default 'reported'
                    check (state in ('reported','triaged','in_progress','waiting',
                                     'resolving','follow_up','resolved','closed_no_action')),
  urgency         text not null default 'normal'
                    check (urgency in ('critical','high','normal','low')),
  summary         text not null,
  detail          text,

  /* OWNERSHIP. Attention rises without accountability moving — a stale or
     serious issue becomes visible to Krystal or Samantha while the coordinator
     stays owner. Ownership transfers only by deliberate handoff. */
  owner           text,
  domain          text,
  waiting_on      text,

  /* RESOLUTION. Separate from action completion, on purpose. */
  resolution_note text,
  resolved_at     timestamptz,
  resolved_by     text,
  follow_up_due   date,
  follow_up_done  boolean not null default false,

  /* SAMANTHA DEPENDENCY, recorded as it happens. */
  reached_samantha_at timestamptz,
  samantha_reason     text check (samantha_reason in
                        ('owner_work','exception','administrative_leakage')),

  source          text not null default 'manual'
                    check (source in ('manual','call_disposition','conversation',
                                      'caregiver_report','family_report',
                                      'care_note','evv_anomaly','axiscare_event')),
  source_ref      text,
  reported_at     timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists client_issue_open on client_issue (state, urgency)
  where state not in ('resolved','closed_no_action');
create index if not exists client_issue_client on client_issue (client_person_id);
create index if not exists client_issue_name on client_issue (lower(client_name_free_text));

-- ── 3. WHAT WAS ACTUALLY DONE ────────────────────────────────────────────────
-- Many per issue. This is the history that makes "one evolving issue" real
-- instead of five unrelated tasks.
create table if not exists issue_action (
  id            bigserial primary key,
  issue_id      uuid not null references client_issue(id) on delete cascade,
  action_type   text not null,   -- called_family, coached_caregiver, changed_schedule…
  note          text not null,
  by_whom       text,
  ops_item_id   text,            -- the work item this came from, if any
  state_after   text,            -- the issue state this action moved it to
  at            timestamptz not null default now()
);
create index if not exists issue_action_issue on issue_action (issue_id, at desc);

-- ── 4. DUPLICATE HELP, NOT AUTO-MERGE ────────────────────────────────────────
-- A second call about the same problem should join the existing issue. But
-- keyword similarity is not proof, so this SHOWS candidates and a human
-- confirms. Auto-merging on a keyword would silently bury a second, different
-- problem for the same client.
create or replace function issue_candidates(
  p_client_text text, p_client_person uuid default null, p_category text default null)
returns table (
  issue_id uuid, category text, summary text, state text, urgency text,
  owner text, reported_at timestamptz, action_count int, why_suggested text)
language sql security invoker stable as $$
  select i.id, i.category, i.summary, i.state, i.urgency, i.owner, i.reported_at,
         (select count(*)::int from issue_action a where a.issue_id = i.id),
         case
           when p_client_person is not null and i.client_person_id = p_client_person
             then 'same linked client'
           when p_client_text is not null and i.client_name_free_text is not null
                and lower(i.client_name_free_text) = lower(p_client_text)
             then 'same client name'
           else 'same category, recent'
         end
  from client_issue i
  where i.state not in ('resolved','closed_no_action')
    and (
      (p_client_person is not null and i.client_person_id = p_client_person)
      or (p_client_text is not null and lower(i.client_name_free_text) = lower(p_client_text))
      or (p_category is not null and i.category = p_category
          and i.reported_at > now() - interval '14 days')
    )
  order by i.reported_at desc
  limit 10;
$$;

-- ── 5. WHAT THE COORDINATOR SEES ─────────────────────────────────────────────
create or replace function issue_context(p_issue uuid)
returns jsonb language sql security invoker stable as $$
  select jsonb_build_object(
    'issue_id', i.id,
    'what_happened', i.summary,
    'detail', i.detail,
    'who_it_concerns', coalesce(cli.display_name, i.client_name_free_text, '(client not identified)'),
    'client_link', i.client_link_status,
    'reported_by', coalesce(i.reported_by_name, '(unknown)') ||
                   coalesce(' (' || i.reported_by_role || ')', ''),
    'category', c.label,
    'urgency', i.urgency,
    'state', i.state,
    'owner', coalesce(i.owner, 'UNASSIGNED'),
    'waiting_on', i.waiting_on,
    'age_hours', round(extract(epoch from (now() - i.reported_at)) / 3600)::int,
    'target_hours', c.target_hours,
    'overdue', (now() - i.reported_at) > (c.target_hours || ' hours')::interval
               and i.state not in ('resolved','closed_no_action'),
    'already_done', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'what', a.action_type, 'note', a.note, 'by', a.by_whom, 'at', a.at
             ) order by a.at desc), '[]'::jsonb)
      from issue_action a where a.issue_id = i.id),
    'what_would_resolve_this', c.resolution_means,
    'follow_up_required', c.follow_up_required,
    'follow_up_due', i.follow_up_due,
    'needs_policy_lookup', c.requires_policy_lookup,
    'owner_authority_required', c.owner_authority,
    'notify_beyond_owner', c.notify_beyond_owner
  )
  from client_issue i
  join issue_category c on c.code = i.category
  left join person_identity cli on cli.id = i.client_person_id
  where i.id = p_issue;
$$;

-- ── 6. LOCK DOWN ─────────────────────────────────────────────────────────────
alter table client_issue   enable row level security;
alter table issue_action   enable row level security;
alter table issue_category enable row level security;
do $$
declare t text;
begin
  foreach t in array array['client_issue','issue_action','issue_category'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    begin
      execute format($p$create policy %I on public.%I for select to authenticated using (true)$p$,
                     t || '_read', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
grant usage, select on sequence issue_action_id_seq to authenticated;

-- =============================================================================
-- DELIBERATELY NOT HERE:
--   * no clinical or regulatory decision rules. `requires_policy_lookup` marks
--     the categories where a real rule exists; the rule lives in the policy
--     Knowledge Core, not invented here from general knowledge.
--   * no auto-merge. issue_candidates() suggests; a human confirms.
--   * no fabricated client record. Free text until AxisCare, then reconcile the
--     SAME issue to the canonical client rather than opening a new one.
--   * ops_items stays the work layer. An item points at an issue.
-- =============================================================================
