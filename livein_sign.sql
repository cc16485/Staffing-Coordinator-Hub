-- =============================================================================
-- livein_sign.sql · LIVE-IN CAREGIVER AGREEMENT, SIGNED ON A PHONE (Samantha 2026-10-29: "have Sheryelle and Rhonda sign
-- the live-in packet"; she approved the design the same day). Installed by its Desktop step (livein_sign_step.py). Safe
-- to run again.
-- The caregiver reads the 12 real pages on a private link texted from the office line, ticks, types their full name and
-- signs with a finger. Samantha then adds the Caring Companions signature on page 12 in the Hub (HR, Live-In Agreement).
--   livein_sign        one row per agreement sent: the private link (only its hash), the master it was started on, the
--                      employee's and the representative's signatures (small PNGs, base64) and the PDFs. Server only:
--                      the livein-sign function is the only door (owners via sign-in, the caregiver via their link).
--                      Never deleted.
--   livein_sign_event  every step (made, sent, opened, signed, countersigned), append only.
--   PDFs go in the private bucket hr-docs (Desktop 968): never deleted, moved or renamed.
-- =============================================================================
create table if not exists public.livein_sign (
  id uuid primary key default gen_random_uuid(),
  practice boolean not null default false,
  caregiver text not null,
  axiscare_caregiver_id text,
  master_sha text not null,
  token_hash text unique,
  expires_at timestamptz,
  status text not null default 'waiting' check (status in ('waiting', 'signed', 'countersigned', 'cancelled')),
  started_by text not null,
  started_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_by text,
  opened_at timestamptz,
  signed_name text,
  signed_at timestamptz,
  sign_ip text,
  sign_agent text,
  sig_png text,
  pdf_path text,
  rep_name text,
  rep_email text,
  rep_sig_png text,
  countersigned_at timestamptz,
  final_pdf_path text,
  updated_at timestamptz not null default now()
);
create index if not exists livein_sign_caregiver on public.livein_sign (caregiver, started_at);
comment on table public.livein_sign is '2026-10-29: Live-In Caregiver Agreement signed on a private link, countersigned by an owner. Server only (livein-sign). Never deleted.';

create table if not exists public.livein_sign_event (
  id bigserial primary key,
  sign_id uuid not null references public.livein_sign(id),
  at timestamptz not null default now(),
  kind text not null,
  by_email text,
  by_name text,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists livein_sign_event_sign on public.livein_sign_event (sign_id, at);
comment on table public.livein_sign_event is '2026-10-29: every Live-In Agreement signing step, append only.';

create or replace function public.livein_sign_no_delete() returns trigger
language plpgsql set search_path = pg_catalog, public as $f$
begin raise exception 'Live-In Agreement records are kept and cannot be deleted.' using errcode = '42501'; end $f$;
create or replace function public.livein_sign_event_append_only() returns trigger
language plpgsql set search_path = pg_catalog, public as $f$
begin raise exception 'The Live-In Agreement history can only be added to.' using errcode = '42501'; end $f$;
create or replace function public.livein_sign_guard() returns trigger
language plpgsql set search_path = pg_catalog, public as $f$
begin
  -- what was signed never changes: the master, the person, the employee's signature once given, the representative's once given
  if new.master_sha is distinct from old.master_sha or new.caregiver is distinct from old.caregiver or new.practice is distinct from old.practice then
    raise exception 'The agreement on a signing record cannot be changed.' using errcode = '42501'; end if;
  if old.status in ('signed', 'countersigned') and (new.signed_name is distinct from old.signed_name or new.signed_at is distinct from old.signed_at
     or new.sig_png is distinct from old.sig_png or new.pdf_path is distinct from old.pdf_path or new.status = 'waiting' or new.status = 'cancelled') then
    raise exception 'A signed agreement cannot be changed.' using errcode = '42501'; end if;
  if old.status = 'countersigned' and (new.status is distinct from old.status or new.rep_sig_png is distinct from old.rep_sig_png
     or new.rep_name is distinct from old.rep_name or new.countersigned_at is distinct from old.countersigned_at or new.final_pdf_path is distinct from old.final_pdf_path) then
    raise exception 'A countersigned agreement cannot be changed.' using errcode = '42501'; end if;
  new.updated_at := now();
  return new;
end $f$;
drop trigger if exists livein_sign_guard_t on public.livein_sign;
create trigger livein_sign_guard_t before update on public.livein_sign for each row execute function public.livein_sign_guard();
drop trigger if exists livein_sign_no_delete on public.livein_sign;
create trigger livein_sign_no_delete before delete on public.livein_sign for each row execute function public.livein_sign_no_delete();
drop trigger if exists livein_sign_no_truncate on public.livein_sign;
create trigger livein_sign_no_truncate before truncate on public.livein_sign execute function public.livein_sign_no_delete();
drop trigger if exists livein_sign_event_no_change on public.livein_sign_event;
create trigger livein_sign_event_no_change before update or delete on public.livein_sign_event for each row execute function public.livein_sign_event_append_only();
drop trigger if exists livein_sign_event_no_truncate on public.livein_sign_event;
create trigger livein_sign_event_no_truncate before truncate on public.livein_sign_event execute function public.livein_sign_event_append_only();

-- server only
alter table public.livein_sign enable row level security;
alter table public.livein_sign_event enable row level security;
revoke all privileges on table public.livein_sign from anon, authenticated;
revoke all privileges on table public.livein_sign_event from anon, authenticated;
revoke all privileges on sequence public.livein_sign_event_id_seq from anon, authenticated;
grant all on public.livein_sign, public.livein_sign_event to service_role;
grant usage, select on sequence public.livein_sign_event_id_seq to service_role;
