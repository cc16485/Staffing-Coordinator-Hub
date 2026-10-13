-- ============================================================================
-- HEPATITIS B IN STEP 1 (Samantha 2026-10-13: "let's keep it [bloodborne pathogens training] in their on-the-job training...
-- they are fine to complete the [Hepatitis B] form in step one"; and "lets keep it easy and offer to everyone").
-- Hub project. Run after hepb-vaccination.sql and the Step 1 tables. Additive only; safe to run twice.
--
--   step1_forms.hepb_form   whether this Step 1 has the Hepatitis B form. Decided ONCE when the Step 1 record is made (the
--                           form approved for real at its exact version, or a practice Step 1) and never changed, so a
--                           Step 1 already under way never gains a new required form. Existing rows stay false: those
--                           people are offered the vaccine by the 30-minute hepatitis B pass at Approve to Work, as before.
--   hepb_record.step1_at    when they answered in Step 1 (the Step 1 form showed the vaccine information of
--                           1910.1030(g)(2)(vii)(I) first, so the offer there is properly sequenced, (f)(2)(i)).
--   hepb_record.step1_pdf   the signed Step 1 form, in the PRIVATE hepb-docs store (a confidential medical record,
--                           (h)(1)(iii)); never in step1_forms.pdfs or the onboarding store the office opens.
-- Nothing here creates a record, sends anything, or changes an existing answer.
-- ============================================================================
begin;
alter table public.step1_forms add column if not exists hepb_form boolean not null default false;
comment on column public.step1_forms.hepb_form is 'Hepatitis B form in this Step 1 (decided once when the Step 1 starts; 2026-10-13)';
alter table public.hepb_record add column if not exists step1_at timestamptz;
alter table public.hepb_record add column if not exists step1_pdf text;
comment on column public.hepb_record.step1_at is 'answered on the Step 1 Hepatitis B form (2026-10-13)';
comment on column public.hepb_record.step1_pdf is 'the signed Step 1 Hepatitis B form, private hepb-docs path (2026-10-13)';

-- the signed Step 1 PDF, like the declination, is never changed once written
create or replace function public.hepb_record_step1_keep() returns trigger
language plpgsql set search_path = pg_catalog, public as $t$
begin
  if old.step1_pdf is not null and new.step1_pdf is distinct from old.step1_pdf then
    raise exception 'hepb_record: the signed Step 1 form is never changed' using errcode = 'check_violation'; end if;
  return new;
end $t$;
drop trigger if exists hepb_record_step1_keep_t on public.hepb_record;
create trigger hepb_record_step1_keep_t before update on public.hepb_record for each row execute function public.hepb_record_step1_keep();
commit;

do $v$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'step1_forms' and column_name = 'hepb_form') then
    raise exception 'hepatitis B in Step 1 self-check: step1_forms.hepb_form is missing'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hepb_record' and column_name = 'step1_pdf') then
    raise exception 'hepatitis B in Step 1 self-check: hepb_record.step1_pdf is missing'; end if;
  if has_table_privilege('authenticated', 'public.hepb_record', 'select') or has_table_privilege('anon', 'public.hepb_record', 'select') then
    raise exception 'hepatitis B in Step 1 self-check: a browser role can read the hepatitis B record'; end if;
end $v$;
