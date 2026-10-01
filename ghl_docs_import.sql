-- ============================================================================
-- PRE-HIRE PROOFS FROM GOHIGHLEVEL (Desktop 381). Samantha approved 2026-10-01 ("yes to all"). SHARED HUB PROJECT.
-- Safe to run again.
-- The EDL / OIG / FCSR / Checkr uploads (and their RESULTS) and the reference-check uploads on each caregiver's
-- GoHighLevel contact are copied into the Hub's private storage (lead-docs, bgcheck/ghl/...). One row per file here.
-- Kept OUT of the app_data caregiver/candidate blobs on purpose: the Hub page saves those whole, so an import writing
-- into them could be overwritten (or overwrite someone's edit). The Hub reads this table and shows each document where
-- the Hub has none of its own. Never imported: Social Security cards, birth certificates, I-9 documents (her SSN rule).
-- Written only by the server (ghl-docs-import). Staff read it.
-- ============================================================================
create table if not exists public.prehire_docs (
  id             bigserial primary key,
  person_kind    text not null check (person_kind in ('caregiver', 'candidate')),
  person_id      text not null,            -- legacy caregivers[].id or candidates[].id (app_data)
  axiscare_id    text,                     -- when the Hub record has one
  person_name    text,
  check_key      text not null check (check_key in ('edl','oig','fcsr','checkr','ref_pro_1','ref_pro_2','ref_pro_3','ref_personal_1','ref_personal_2')),
  storage_path   text not null,            -- lead-docs bucket
  content_type   text,
  result_text    text,                     -- e.g. the GHL "EDL RESULTS" option, as GHL has it
  ghl_contact_id text,
  ghl_field      text,
  ghl_file_key   text not null,            -- the file's own id inside the GHL field value (re-runs skip it)
  imported_at    timestamptz not null default now(),
  unique (person_kind, person_id, check_key, ghl_file_key)
);
create index if not exists prehire_docs_person_idx on public.prehire_docs (person_kind, person_id);
create index if not exists prehire_docs_axid_idx on public.prehire_docs (axiscare_id);
alter table public.prehire_docs enable row level security;
drop policy if exists prehire_docs_read on public.prehire_docs;
create policy prehire_docs_read on public.prehire_docs for select to authenticated using (true);
revoke all on public.prehire_docs from anon, authenticated;
grant select on public.prehire_docs to authenticated;
grant all on public.prehire_docs to service_role;
grant usage, select on sequence public.prehire_docs_id_seq to service_role;
