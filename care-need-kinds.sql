-- =============================================================================
-- TRACK 3c · CARE NEEDS FOR MATCHING: THE KINDS OF FACT (Samantha "go", 2026-10-12; the one skill list approved the same day)
-- =============================================================================
-- Twenty-five kinds on the fact record: one per skill on the approved list (18), the lift type, the advanced tasks we do
-- not provide, pets and smoking in the home, the caregiver gender preference and Spanish. Kept on every layer (intake,
-- assessment, plan, current); only the care plan and later layers are ever enforced by the match rule (match-rules.js).
-- Adds catalog rows only: no table, fact, lead or Journey changes; nothing reads them for matching yet. Refuses if any
-- already exists (nothing is overwritten). Rollback: care-need-kinds-rollback.sql makes them inactive, never deletes.
-- =============================================================================
begin;
do $guard$ begin
  if exists (select 1 from public.fact_kind where created_by = 'match_needs' or kind like 'need\_%' escape '\' or kind in ('home_cats','home_dogs','home_smoking','pref_caregiver_gender')) then
    raise exception 'Care need kinds refused: some already exist. Nothing was changed.'; end if;
end $guard$;
insert into public.fact_kind (kind, label, fact_group, value_shape, choices, layers, must_verify, created_by)
select k, l, 'care_needs', 'choice', '["required","preferred","no"]'::jsonb, '{intake,assessment,plan,current}', false, 'match_needs'
from (values
  ('need_companionship','Needs: companionship and conversation'), ('need_meals_housekeeping','Needs: meals and light housekeeping'),
  ('need_med_reminders','Needs: medication reminders'), ('need_transportation','Needs: driving to appointments and errands'),
  ('need_bathing','Needs: bathing or showering'), ('need_dressing_grooming','Needs: dressing and grooming'),
  ('need_toileting','Needs: toileting and incontinence care'), ('need_feeding','Needs: feeding'),
  ('need_walking_wheelchair','Needs: walking or wheelchair help'), ('need_transfers_gait_belt','Needs: transfers with a gait belt'),
  ('need_two_person_transfers','Needs: two-person transfers'), ('need_hoyer_lift','Needs: a Hoyer or other mechanical lift'),
  ('need_bedbound_care','Needs: bedbound care and repositioning'), ('need_catheter_bag','Needs: emptying a catheter bag and cleaning around the site'),
  ('need_ostomy_bag','Needs: emptying an ostomy bag and cleaning around the site'), ('need_hospice_support','Needs: hospice and end-of-life support'),
  ('need_dementia_care','Needs: dementia or Alzheimer''s care'), ('need_parkinsons_care','Needs: Parkinson''s care')
) as v(k, l);
insert into public.fact_kind (kind, label, fact_group, value_shape, choices, layers, must_verify, created_by) values
 ('need_lift_type',        'Lift type',                                  'care_needs', 'choice',  '["full_body_sling","sit_to_stand","other"]', '{intake,assessment,plan,current}', false, 'match_needs'),
 ('need_advanced_tasks',   'Advanced tasks we do not provide',           'care_needs', 'choices', '["catheter_change","stoma_care","bowel_program","prescription_creams","nurse_set_medication","passive_range_of_motion"]', '{intake,assessment,plan,current}', false, 'match_needs'),
 ('home_cats',             'Cats in the home',                           'care_needs', 'choice',  '["yes","no"]', '{intake,assessment,plan,current}', false, 'match_needs'),
 ('home_dogs',             'Dogs in the home',                           'care_needs', 'choice',  '["yes","no"]', '{intake,assessment,plan,current}', false, 'match_needs'),
 ('home_smoking',          'Someone smokes in the home',                 'care_needs', 'choice',  '["yes","no"]', '{intake,assessment,plan,current}', false, 'match_needs'),
 ('pref_caregiver_gender', 'Caregiver gender',                           'care_needs', 'choice',  '["female_required","female_preferred","male_required","male_preferred","no_preference"]', '{intake,assessment,plan,current}', false, 'match_needs'),
 ('need_spanish',          'Spanish-speaking caregiver',                 'care_needs', 'choice',  '["required","preferred","no"]', '{intake,assessment,plan,current}', false, 'match_needs');
do $verify$ begin
  if (select count(*) from public.fact_kind where created_by = 'match_needs' and active) <> 25 then raise exception 'Care need kinds self-check: expected 25'; end if;
  raise notice 'Care need kinds installed: 25, all four layers, all always-review';
end $verify$;
commit;
