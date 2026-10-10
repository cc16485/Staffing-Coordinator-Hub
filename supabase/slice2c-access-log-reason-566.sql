-- 566 (2026-10-10) · SLICE 2c: why each identity reveal happened. One nullable column on the append-only access log.
-- Additive; no row changes; safe to run twice.
alter table public.document_access_log add column if not exists reason text;
comment on column public.document_access_log.reason is '2c · the reason typed by the screening staff member for an identity reveal (doc = identity:ssn | identity:dob | identity:license); null for document opens';
