-- ============================================================================
-- STEP 1 COMPANY SIGNATURE (2026-10-13). Hub project. Samantha's Employment Agreement has an employer signature line
-- ("printed name of agency administrator; employer signature; date"), and a Missouri court found no agreement where the
-- employer never signed its own line (Baier v. Darden Restaurants, 420 S.W.3d 733, Mo. App. E.D. 2014). A form marked
-- countersign is signed for Caring Companions by a person on the Approve to Work list, after the applicant signs.
--   step1_forms.countersignatures  { form: { at, typed_name, by_name, by_email, by_person, ip, agent, version, fingerprint } }
--   step1_forms.countersigned_pdfs { form: path }   the PDF with BOTH signatures (the applicant's signed PDF is never replaced)
-- Both are write-once per form (the guard is extended). One readiness row, cg.company.countersign, that Approve to Work
-- waits for (complete by itself when no form needs the company's signature).
-- Safe to run twice. Rollback: step1-countersign-rollback.sql (the columns stay, unused; the row goes inactive).
-- ============================================================================
begin;
alter table public.step1_forms add column if not exists countersignatures jsonb not null default '{}'::jsonb;
alter table public.step1_forms add column if not exists countersigned_pdfs jsonb not null default '{}'::jsonb;
create or replace function public.step1_forms_guard() returns trigger
language plpgsql set search_path = pg_catalog, public as $t$
declare k text;
begin
  new.updated_at := now();
  for k in select jsonb_object_keys(old.signatures) loop
    if new.signatures -> k is distinct from old.signatures -> k then
      raise exception 'step1_forms: the signature of % is never changed (offer %)', k, old.offer_id using errcode = 'check_violation';
    end if;
  end loop;
  for k in select jsonb_object_keys(old.pdfs) loop
    if new.pdfs -> k is distinct from old.pdfs -> k then
      raise exception 'step1_forms: the stored PDF of % is never replaced (offer %)', k, old.offer_id using errcode = 'check_violation';
    end if;
  end loop;
  for k in select jsonb_object_keys(coalesce(old.countersignatures, '{}'::jsonb)) loop
    if new.countersignatures -> k is distinct from old.countersignatures -> k then
      raise exception 'step1_forms: the company signature on % is never changed (offer %)', k, old.offer_id using errcode = 'check_violation';
    end if;
  end loop;
  for k in select jsonb_object_keys(coalesce(old.countersigned_pdfs, '{}'::jsonb)) loop
    if new.countersigned_pdfs -> k is distinct from old.countersigned_pdfs -> k then
      raise exception 'step1_forms: the countersigned PDF of % is never replaced (offer %)', k, old.offer_id using errcode = 'check_violation';
    end if;
  end loop;
  if old.completed_at is not null and new.completed_at is distinct from old.completed_at then
    raise exception 'step1_forms: the completion time is never changed (offer %)', old.offer_id using errcode = 'check_violation';
  end if;
  return new;
end $t$;
insert into public.client_journey_step_def (key, catalog_version, def, active, updated_by) values ('cg.company.countersign', 1, '{"subject": "caregiver", "title": "Signed for Caring Companions (the company signature on the agreements that need it)", "stage": "step1", "sort": 19, "owner_role": "owner", "proof": "record", "required": true, "active": true, "payers": [], "after": [], "howto": ["Open their Step 1 screens from their page (See their Step 1 screens), go to the agreement, and sign for Caring Companions. Only people on the Approve to Work list can sign for the company."]}'::jsonb, true, 'step1 countersign 2026-10-13')
  on conflict (key) do update set def = excluded.def, active = true, updated_by = excluded.updated_by;
update public.client_journey_step_def set def = jsonb_set(def, '{after}', (def->'after') || '["cg.company.countersign"]'::jsonb)
 where key = 'cg.approve.work' and not (def->'after') @> '["cg.company.countersign"]'::jsonb;
commit;
