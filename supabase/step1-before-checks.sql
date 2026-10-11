-- =============================================================================
-- STEP 1 BEFORE CHECKS (Samantha 2026-10-11: "we CANNOT run background checks and references before we have their signed
-- permission, which is in the Step 1 documents"; "yes to all"). Hub project.
-- On the new path a person is put into Background & References by the SERVER, only when their Step 1 is complete (every
-- form signed, the reference consent, the background check disclosure and the EDL/FCSR consent among them). Never by the
-- office before that. This function is that one door:
--   step1_candidate_create(offer_id, record)   server only (service role); idempotent:
--     · a record already carrying this offer id: returned as it is (created false)
--     · a record with the same phone (last ten digits) or the same first and last name and NO offer id: linked to the offer
--       (offer id and path added; nothing else touched), the way the office's own move links one
--     · otherwise the record is added with the next person number (app_data_id_counter: a number is never given twice)
-- CASE.NET (Samantha 2026-10-11: "check case.net ... as one of the background checks"): a readiness row cg.check.casenet
-- (the office searches Case.net by name and records the result, the date and the proof; the Hub never types into the court
-- site), required before Approve to Advance and Approve to Work like the EDL and FCSR checks. Its value history is kept
-- (evidence_field_kept learns casenet).
-- Rollback: step1-before-checks-rollback.sql drops the function and sets the Case.net row inactive and out of the two
-- approvals (records it made stay; nothing is deleted).
-- =============================================================================
create or replace function public.step1_candidate_create(p_offer_id text, p_record jsonb)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
set lock_timeout = '5s'
as $fn$
declare cd jsonb; i int; c jsonb; idx int := -1; how text := 'created'; nxt bigint; maxid bigint; d10 text;
begin
  if coalesce(p_offer_id, '') = '' or jsonb_typeof(p_record) <> 'object' then
    raise exception 'step1_candidate_create: an offer id and a record are needed' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('step1_land'));
  insert into public.app_data (key, data) values ('candidates', '[]'::jsonb) on conflict (key) do nothing;
  select data into cd from public.app_data where key = 'candidates' for update;
  if jsonb_typeof(cd) <> 'array' then return jsonb_build_object('ok', false, 'reason', 'no_list'); end if;
  d10 := right(regexp_replace(coalesce(p_record->>'phone', ''), '\D', '', 'g'), 10);
  for i in 0 .. jsonb_array_length(cd) - 1 loop
    c := cd->i;
    if jsonb_typeof(c) <> 'object' then continue; end if;
    if c->>'offer_id' = p_offer_id then return jsonb_build_object('ok', true, 'created', false, 'how', 'already', 'id', c->'id'); end if;
  end loop;
  for i in 0 .. jsonb_array_length(cd) - 1 loop
    c := cd->i;
    if jsonb_typeof(c) <> 'object' or coalesce(c->>'offer_id', '') <> '' or coalesce(c->>'not_hired', '') = 'true' then continue; end if;
    if (length(d10) = 10 and right(regexp_replace(coalesce(c->>'phone', ''), '\D', '', 'g'), 10) = d10)
       or (lower(coalesce(c->>'first', '')) = lower(coalesce(p_record->>'first', '')) and lower(coalesce(c->>'last', '')) = lower(coalesce(p_record->>'last', ''))
           and coalesce(p_record->>'first', '') <> '') then idx := i; exit; end if;
  end loop;
  if idx >= 0 then
    c := (cd->idx) || jsonb_build_object('offer_id', p_offer_id, 'onboarding_path', coalesce(p_record->>'onboarding_path', 'new'));
    update public.app_data set data = jsonb_set(data, array[idx::text], c), updated_at = now() where key = 'candidates';
    return jsonb_build_object('ok', true, 'created', false, 'how', 'linked', 'id', c->'id');
  end if;
  select coalesce(max((v->>'id')::bigint), 0) into maxid from jsonb_array_elements(cd) v where jsonb_typeof(v) = 'object' and (v->>'id') ~ '^[0-9]{1,15}$';
  insert into public.app_data_id_counter (key, last_id) values ('candidates', 0) on conflict (key) do nothing;
  select last_id into nxt from public.app_data_id_counter where key = 'candidates' for update;
  nxt := greatest(coalesce(nxt, 0), maxid) + 1;
  update public.app_data_id_counter set last_id = nxt, updated_at = now() where key = 'candidates';
  c := (p_record - 'id' - '_rev') || jsonb_build_object('id', nxt, 'offer_id', p_offer_id);
  update public.app_data set data = data || jsonb_build_array(c), updated_at = now() where key = 'candidates';
  return jsonb_build_object('ok', true, 'created', true, 'how', how, 'id', nxt);
end $fn$;
revoke all on function public.step1_candidate_create(text, jsonb) from public, anon, authenticated;
grant execute on function public.step1_candidate_create(text, jsonb) to service_role;
do $v$ begin
  if exists (select 1 from information_schema.routine_privileges where routine_schema = 'public' and routine_name = 'step1_candidate_create'
              and grantee in ('anon', 'authenticated', 'PUBLIC')) then raise exception 'step1-before-checks self-check: a browser can call step1_candidate_create'; end if;
end $v$;

-- ── Case.net ──
insert into public.client_journey_step_def (key, catalog_version, def, active, updated_by) values ('cg.check.casenet', 1, '{"subject": "caregiver", "title": "Case.net court records search (Missouri)", "stage": "screening", "sort": 43, "owner_role": "staffing_coordinator", "proof": "proof", "permission": "screening", "evidence_required": "result+date+document (the Case.net name search result)", "required": true, "active": true, "payers": [], "after": ["cg.consent.checks"], "howto": ["Open Case.net (courts.mo.gov/casenet, Name Search), search their full name and date of birth, save the result page as a PDF, then Record Case.net on their Background & References row with the result, the date and that PDF."]}'::jsonb, true, 'case.net 2026-10-11')
  on conflict (key) do update set def = excluded.def, active = true, updated_at = now(), updated_by = excluded.updated_by;
update public.client_journey_step_def set def = jsonb_set(def, '{after}', (def->'after') || '["cg.check.casenet"]'::jsonb), updated_at = now(), updated_by = 'case.net 2026-10-11'
 where key in ('cg.approve.advance', 'cg.approve.work') and not (def->'after') @> '["cg.check.casenet"]'::jsonb;
do $ef$ begin
  if to_regprocedure('public.evidence_field_kept(text,text)') is not null then
    execute $q$create or replace function public.evidence_field_kept(p_key text, p_field text) returns boolean
language sql immutable set search_path = pg_catalog as $f$
  select case
    when p_field is null or p_field ~* '(ssn|dob|birth|_number$|_no$|_phone$|_email$|_name$|_history$)' then false
    when p_key in ('candidates', 'caregivers') then
         p_field ~ '^(oig|fcsr|edl|casenet|ncsr|sor|ems|cnr|bgc|bg|mvr|fp|tb|cpr|dl|i9|w4|orient|alz|ojt_online|annual|eligibility)(_|$)'
      or p_field ~ '^r[1-5](s|_proof|_pdf|_status|_date|_at|_by|_verified[a-z_]*)$'
      or p_field ~ '^step2_(verified_at|verified_by|checklist|done_at|done_by|done_how|receipt|i9_s2_by|i9_s2_at)$'
      or p_field ~ '^approved_to_work'
      or p_field ~ '(_expires|_expiry|_exp)$'
      or p_field in ('hire_date', 'axiscare_id', 'status', 'level', 'cred', 'th_synced', 'first_contact', 'step1_done_at', 'offer_id')
    when p_key = 'medicaid_plans' then p_field in ('fusion_verified', 'pdf', 'pdf_earlier', 'start', 'changes', 'plan_start', 'plan_end',
         'generated', 'services', 'received_on', 'confirmed_by', 'confirmed_at', 'name_confirmed', 'dcn', 'reuploads', 'ghe_months')
    when p_key = 'ghe_forms' then p_field in ('status', 'f', 'checks', 'radios', 'client', 'client_id', 'visit_date', 'nurse', 'total',
         'sig_nurse', 'sig_part', 'sig_sup', 'rn_reviewer', 'rn_reviewed_at', 'rn_reviewed_by', 'ready_at', 'ready_by', 'uploaded_on',
         'uploaded_by', 'upload_due', 'uploaded_on_time', 'fusion_checked', 'amends', 'amend_reason', 'amended_by', 'superseded_by', 'superseded_at')
    else true end
$f$$q$;
  end if;
end $ef$;
do $v2$ begin
  if not exists (select 1 from public.client_journey_step_def where key = 'cg.check.casenet' and active) then raise exception 'self-check: the Case.net row is not active'; end if;
  if exists (select 1 from public.client_journey_step_def where key in ('cg.approve.advance', 'cg.approve.work') and not (def->'after') @> '["cg.check.casenet"]'::jsonb) then raise exception 'self-check: an approval does not wait for Case.net'; end if;
end $v2$;
