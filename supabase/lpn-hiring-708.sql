-- ============================================================================
-- 708 · LPN HIRING, THE HUB PROJECT (Samantha approved the LPN nurse visit plan, 2026-10-14; Natasha Early is our W-2 RN).
-- Hub project (zngsgedlsxinbygwmxwn). Additive only; safe to run twice. Nothing is sent; no person's record changes; no
-- switch changes. Rollback: lpn-hiring-708-rollback.sql (the four rows go inactive; the columns stay, empty; nothing deleted).
--
--   step1_forms.nurse_form          whether this Step 1 has the "Your Nursing License" form. Decided ONCE when the Step 1
--                                   record is made (only for an LPN or RN offer: job_offers.position_key in the Training
--                                   Platform) and never changed (a trigger refuses it), the Hepatitis B pattern. Every
--                                   existing row stays false; a caregiver's Step 1 never has it.
--   step1_identity.nurse_license_sealed / nurse_license_last4
--                                   the nursing license number, sealed in the function like the driver's license number
--                                   (AES-256-GCM, key only in STEP1_KEK); the record shows "on file, ending" and the last four.
--                                   The table stays server only (anon and authenticated hold nothing on it).
--   axiscare_change_log kind        learns 'caregiver_class' (the LPN or RN class added at Approve to Work, read back);
--                                   every kind already allowed stays allowed.
--   four caregiver readiness rows   each applies only when { "licensed_nurse": true } (an LPN or RN offer), so no caregiver
--                                   card ever shows them; each is required for Approve to Work for a nurse:
--     cg.credential.nurse_license   the office's Nursys QuickConfirm check (who, date, result, screenshot, expiration)
--     cg.nurse.orientation          the 7-topic nurse orientation (Personal Care Provider Manual 2.6)
--     cg.nurse.section2_ack         the signed statement that she read Section 2 of the manual (manual 2.3)
--     cg.step2.position_description the Viventium Step 2 LPN packet (job description, RN supervision acknowledgment,
--                                   documentation expectations), one tick on Step 2 Verify
-- ============================================================================
do $guard$ begin
  if to_regclass('public.step1_forms') is null or to_regclass('public.step1_identity') is null then raise exception '708 refused: the Step 1 tables are missing. Nothing was changed.'; end if;
  if to_regclass('public.client_journey_step_def') is null then raise exception '708 refused: the journey catalog is missing. Nothing was changed.'; end if;
  if to_regclass('public.axiscare_change_log') is null then raise exception '708 refused: axiscare_change_log is missing. Nothing was changed.'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'step1_forms' and column_name = 'hepb_form') then raise exception '708 refused: step1_forms.hepb_form is missing (704 first). Nothing was changed.'; end if;
end $guard$;

begin;
set local lock_timeout = '5s';
alter table public.step1_forms add column if not exists nurse_form boolean not null default false;
comment on column public.step1_forms.nurse_form is '708 · the Your Nursing License form is in this Step 1 (an LPN or RN offer); decided once when the Step 1 starts, never changed';
create or replace function public.step1_forms_nurse_form_keep() returns trigger
language plpgsql set search_path = pg_catalog, public as $t$
begin
  if new.nurse_form is distinct from old.nurse_form then
    raise exception 'step1_forms: whether a Step 1 has the nursing license form is decided when it starts and never changed (offer %)', old.offer_id using errcode = 'check_violation';
  end if;
  return new;
end $t$;
drop trigger if exists step1_forms_nurse_form_keep_t on public.step1_forms;
create trigger step1_forms_nurse_form_keep_t before update on public.step1_forms for each row execute function public.step1_forms_nurse_form_keep();

alter table public.step1_identity add column if not exists nurse_license_sealed text;
alter table public.step1_identity add column if not exists nurse_license_last4 text;
comment on column public.step1_identity.nurse_license_sealed is '708 · the nursing license number, sealed in the function (AES-256-GCM); never stored in the clear';
comment on column public.step1_identity.nurse_license_last4 is '708 · the last four characters of the nursing license number ("on file, ending ...")';
revoke all privileges on table public.step1_identity from anon, authenticated;

/* the change log kind list: every kind allowed now, plus caregiver_class (read from the live constraint, never retyped) */
do $k$ declare cn text; d text; kinds text[]; begin
  select conname, pg_get_constraintdef(oid) into cn, d from pg_constraint
   where conrelid = 'public.axiscare_change_log'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%caregiver_status%';
  if cn is null then raise exception '708 refused: the change log kind list was not found. Nothing was changed.'; end if;
  if d ~ '(^|[^a-z0-9_])caregiver_class([^a-z0-9_]|$)' then return; end if;
  /* every kind named in the constraint, in order, whatever form Postgres prints it in (ARRAY['a'::text, ...] or '{a,b}') */
  select array_agg(w order by ord) into kinds from (select m[1] as w, min(ord) as ord from regexp_matches(d, '([a-z][a-z0-9_]*)', 'g') with ordinality as t(m, ord)
    where m[1] not in ('check', 'kind', 'any', 'array', 'text', 'in') group by m[1]) x;
  if kinds is null or array_length(kinds, 1) < 10 then raise exception '708 refused: the change log kind list could not be read (%). Nothing was changed.', d; end if;
  execute format('alter table public.axiscare_change_log drop constraint %I', cn);
  execute format('alter table public.axiscare_change_log add constraint axiscare_change_log_kind_check check (kind = any (%L::text[]))', array_append(kinds, 'caregiver_class'));
end $k$;

insert into public.client_journey_step_def (key, catalog_version, def, active, updated_by) values ('cg.credential.nurse_license', 1, '{"subject": "caregiver", "title": "Nursing license verified on Nursys QuickConfirm (LPN or RN)", "stage": "screening", "sort": 92, "owner_role": "staffing_coordinator", "proof": "proof", "permission": "office", "evidence_required": "Nursys QuickConfirm result + date checked + who checked + screenshot or PDF + expiration date (19 CSR 15-7.021(24)(B)10; manual 2.2)", "required": true, "active": true, "payers": [], "after": ["cg.offer.signed"], "applies": {"licensed_nurse": true}, "howto": ["Search the nurse on Nursys QuickConfirm (nursys.com, the Missouri State Board of Nursing''s primary source equivalent). Save the report as a PDF or screenshot.", "Press Record: the result, the date you checked, the license type, the issuing state, single state or multistate, any discipline shown, and the expiration date, with the saved report. Anything but an active license with no discipline blocks the card until an owner reviews it.", "The expiration date is watched: an expired license shows on this card and the nightly audit raises it."]}'::jsonb, true, '708 lpn hiring 2026-10-14') on conflict (key) do update set def = excluded.def, active = true, updated_by = excluded.updated_by;
insert into public.client_journey_step_def (key, catalog_version, def, active, updated_by) values ('cg.nurse.orientation', 1, '{"subject": "caregiver", "title": "Nurse orientation, all 7 topics (Personal Care Provider Manual 2.6)", "stage": "orientation", "sort": 88, "owner_role": "staffing_coordinator", "proof": "proof", "permission": "office", "evidence_required": "date + who gave it + each of the 7 topics covered (manual 2.6), optional signed checklist", "required": true, "active": true, "payers": [], "after": ["cg.approve.advance"], "applies": {"licensed_nurse": true}, "howto": ["Before the first nurse visit. Print the nurse orientation checklist from this row, go through all 7 topics, and have the nurse and the trainer sign it.", "Press Record: the date, who gave it, and tick each topic. Upload the signed checklist if you have it."]}'::jsonb, true, '708 lpn hiring 2026-10-14') on conflict (key) do update set def = excluded.def, active = true, updated_by = excluded.updated_by;
insert into public.client_journey_step_def (key, catalog_version, def, active, updated_by) values ('cg.nurse.section2_ack', 1, '{"subject": "caregiver", "title": "Signed statement: read Section 2 of the Personal Care Provider Manual (manual 2.3)", "stage": "orientation", "sort": 89, "owner_role": "staffing_coordinator", "proof": "proof", "permission": "office", "evidence_required": "the signed statement (uploaded) + the date signed (manual 2.3: documentation in the personnel file that she was given and has read Section 2)", "required": true, "active": true, "payers": [], "after": ["cg.approve.advance"], "applies": {"licensed_nurse": true}, "howto": ["Give her Section 2 of the MO HealthNet Personal Care Provider Manual. Print the statement from this row (it has her name and license on it); she signs and dates it after reading.", "Press Record: upload the signed statement and enter the date she signed."]}'::jsonb, true, '708 lpn hiring 2026-10-14') on conflict (key) do update set def = excluded.def, active = true, updated_by = excluded.updated_by;
insert into public.client_journey_step_def (key, catalog_version, def, active, updated_by) values ('cg.step2.position_description', 1, '{"subject": "caregiver", "title": "Viventium Step 2: LPN packet signed (job description, RN supervision acknowledgment, documentation expectations)", "stage": "step2", "sort": 64.5, "owner_role": "staffing_coordinator", "proof": "confirmed", "permission": "office", "evidence_required": "verified_in_viventium:by a named office person, with time (one tick on Step 2 Verify)", "required": true, "active": true, "payers": [], "after": ["cg.approve.advance"], "applies": {"licensed_nurse": true}, "howto": ["Open Viventium, confirm the LPN packet is signed (the job description, the RN supervision acknowledgment and the documentation expectations; for an RN the RN job description and the documentation expectations), then tick the packet line on Verify Viventium Step 2 Complete. Never inferred from an active payroll record."]}'::jsonb, true, '708 lpn hiring 2026-10-14') on conflict (key) do update set def = excluded.def, active = true, updated_by = excluded.updated_by;
commit;

do $v$ declare n int; d text; begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'step1_forms' and column_name = 'nurse_form') then raise exception '708 self-check: step1_forms.nurse_form is missing'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'step1_forms_nurse_form_keep_t' and not tgisinternal) then raise exception '708 self-check: the nurse_form keep trigger is missing'; end if;
  select count(*) into n from information_schema.columns where table_schema = 'public' and table_name = 'step1_identity' and column_name in ('nurse_license_sealed', 'nurse_license_last4');
  if n <> 2 then raise exception '708 self-check: the nursing license columns are missing'; end if;
  if has_table_privilege('authenticated', 'public.step1_identity', 'select') or has_table_privilege('anon', 'public.step1_identity', 'select') then raise exception '708 self-check: a browser role can read step1_identity'; end if;
  select pg_get_constraintdef(oid) into d from pg_constraint where conname = 'axiscare_change_log_kind_check';
  if d is null or d not like '%caregiver_class%' or d not like '%caregiver_level%' or d not like '%client_created%' then raise exception '708 self-check: the change log kind list is not as expected'; end if;
  select count(*) into n from public.client_journey_step_def where key in ('cg.credential.nurse_license', 'cg.nurse.orientation', 'cg.nurse.section2_ack', 'cg.step2.position_description') and active and def->'applies'->>'licensed_nurse' = 'true';
  if n <> 4 then raise exception '708 self-check: expected 4 active nurse rows that apply only to licensed nurses, found %', n; end if;
  if has_table_privilege('authenticated', 'public.client_journey_step_def', 'insert') then raise exception '708 self-check: the catalog must stay server-written'; end if;
end $v$;
