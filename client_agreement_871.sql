-- client_agreement_871.sql · Client Care Agreement signed on a tablet, Stage 1 (Samantha 2026-10-16: "Yes, start building
-- stage 1: the tablet form, finger signature and signed PDF saved in the Hub").
-- One row per agreement: what the office set up (level, rate, start date, addenda), what the family filled in on the
-- tablet (client, POA, contacts and their permissions, home access, choices), the six initials taps, the client's
-- finger signature + typed name + e-sign consent with its audit record, the office countersignature, and the path of the
-- signed PDF. Only the client-agreement function (service role) reads or writes it: RLS on, no policies, and the browser
-- roles hold no privileges. Signatures and signed PDFs live in the private bucket client-agreements (no storage policies,
-- so only the service role can touch it), and its objects can never be deleted or renamed. New objects only; nothing
-- existing is changed.
begin;

create table if not exists public.client_agreements (
  id                 uuid primary key default gen_random_uuid(),
  axiscare_client_id text not null check (axiscare_client_id ~ '^[0-9]{1,12}$'),
  doc                text not null default 'client-care-agreement' check (doc ~ '^[a-z0-9-]{3,60}$'),
  version            text not null check (length(version) between 3 and 40),
  pdf_sha256         text not null check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  status             text not null default 'draft' check (status in ('draft', 'signed', 'countersigned', 'void')),
  office             jsonb not null default '{}'::jsonb check (jsonb_typeof(office) = 'object'),
  answers            jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  initials           jsonb not null default '{}'::jsonb check (jsonb_typeof(initials) = 'object'),
  client_sign        jsonb check (client_sign is null or jsonb_typeof(client_sign) = 'object'),
  office_sign        jsonb check (office_sign is null or jsonb_typeof(office_sign) = 'object'),
  signed_pdf_path    text check (signed_pdf_path is null or length(signed_pdf_path) <= 300),
  void_reason        text check (void_reason is null or length(void_reason) <= 300),
  created_by         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  signed_at          timestamptz,
  countersigned_at   timestamptz
);
create index if not exists client_agreements_ax on public.client_agreements (axiscare_client_id, created_at desc);

alter table public.client_agreements enable row level security;
revoke all on public.client_agreements from anon, authenticated;

-- the private bucket: finger signatures (PNG) and signed agreements (PDF)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-agreements', 'client-agreements', false, 15728640, array['image/png', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- a signed agreement is a record: its files can never be deleted or renamed (the same guard the hepb-docs bucket has)
create or replace function public.client_agreements_keep_files() returns trigger
language plpgsql security definer set search_path = public, storage as $$
begin
  if (tg_op = 'DELETE' and old.bucket_id = 'client-agreements')
     or (tg_op = 'UPDATE' and old.bucket_id = 'client-agreements' and (new.name is distinct from old.name or new.bucket_id is distinct from old.bucket_id)) then
    raise exception 'client-agreements files are kept for the record and cannot be deleted or renamed';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function public.client_agreements_keep_files() from public;
drop trigger if exists client_agreements_keep_files on storage.objects;
create trigger client_agreements_keep_files before delete or update on storage.objects
  for each row execute function public.client_agreements_keep_files();

commit;
