-- =============================================================================
-- GATE 3 · THE FIRST KINDS OF FACT (approved 2026-09-28)
-- =============================================================================
-- Sixteen kinds, each recording something no lead field records today (anything that
-- overlaps an existing field waits for Gate 5). All on the intake layer. Every kind is
-- "always review". Two must be verified before they stop showing "needs verification".
-- Adds catalog rows only: no table, fact, lead or Journey changes.
-- Refuses if any of these kinds already exists (nothing is overwritten).
-- =============================================================================
begin;
do $guard$ begin
  if exists (select 1 from public.fact_kind where kind in ('preferred_name','living_situation','facility_name','why_now','falls','recent_stay',
      'allergies','other_everyday_help','requested_start_date','medicaid_existing_provider','medicaid_hours_authorized','medicaid_provider_change',
      'va_veteran','va_program','private_minimums_explained','private_who_pays')) then
    raise exception 'Gate 3 kinds refused: some already exist. Nothing was changed.'; end if;
end $guard$;

insert into public.fact_kind (kind, label, fact_group, value_shape, choices, layers, must_verify, created_by) values
 ('preferred_name',            'Preferred name',                           'person', 'text',    null, '{intake}', false, 'gate3'),
 ('living_situation',          'Living situation',                         'person', 'choice',  '["alone","spouse_partner","family","paid_help","facility","other"]', '{intake}', false, 'gate3'),
 ('facility_name',             'Facility or community',                    'person', 'text',    null, '{intake}', false, 'gate3'),
 ('why_now',                   'What changed',                             'why',    'choices', '["fall","discharge","caregiver_cant_continue","memory_worse","provider_cant_staff","new_diagnosis","other"]', '{intake}', false, 'gate3'),
 ('falls',                     'Falls',                                    'care',   'object',  null, '{intake}', false, 'gate3'),
 ('recent_stay',               'Recent hospital or rehab stay',            'care',   'object',  null, '{intake}', false, 'gate3'),
 ('allergies',                 'Allergies and sensitivities',              'care',   'text',    null, '{intake}', false, 'gate3'),
 ('other_everyday_help',       'Other everyday help',                      'care',   'choices', '["grooming","incontinence","eating","meal_prep","med_reminders","laundry","companionship"]', '{intake}', false, 'gate3'),
 ('requested_start_date',      'Start date they want',                     'help',   'date',    null, '{intake}', false, 'gate3'),
 ('medicaid_existing_provider','Medicaid: already has an in-home provider','payer',  'choice',  '["no","yes","not_sure"]', '{intake}', false, 'gate3'),
 ('medicaid_hours_authorized', 'Medicaid: hours authorized per week',      'payer',  'number',  null, '{intake}', true,  'gate3'),
 ('medicaid_provider_change',  'Medicaid: needs a provider change',        'payer',  'bool',    null, '{intake}', false, 'gate3'),
 ('va_veteran',                'VA: who the veteran is',                   'payer',  'choice',  '["client","spouse","other"]', '{intake}', true, 'gate3'),
 ('va_program',                'VA: which program',                        'payer',  'choice',  '["aid_attendance","community_care","not_sure"]', '{intake}', false, 'gate3'),
 ('private_minimums_explained','Private pay: minimums explained',          'payer',  'bool',    null, '{intake}', false, 'gate3'),
 ('private_who_pays',          'Private pay: who pays',                    'payer',  'text',    null, '{intake}', false, 'gate3');

do $verify$ begin
  if (select count(*) from public.fact_kind where created_by = 'gate3' and active) <> 16 then raise exception 'Gate 3 kinds self-check: expected 16'; end if;
  raise notice 'Gate 3 kinds installed: 16, all intake, all always-review';
end $verify$;
commit;
