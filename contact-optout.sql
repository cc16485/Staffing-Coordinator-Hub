-- =============================================================================
-- contact-optout.sql · Step 0 · 0b-1 · the Hub's own opt-out record (2026-09-27)
--
-- Samantha's send rule: if ANY authoritative source tells us not to send on this channel, do not send.
-- The sources are GHL Do Not Disturb, a STOP (or equivalent) through our messaging, a manual opt-out by
-- staff, the existing inquiry do-not-contact flag, the Family Circle "stopped" mark, and THIS record.
-- This record does not replace any of them (no competing authority): the shared check
-- (_shared/optout.ts) reads all of them at send time and refuses if any one says no.
--
--   contact_optout          append-only: one row per opt-out or opt-back-in, with source and evidence
--   contact_optout_current  view: the latest word per address and channel (opted_out true or false)
--   contact_send_refusal    append-only log: every send a sender refused, and why
--   contact_optout_record() / contact_optout_revoke() / contact_send_refusal_log()   the only doors
--
-- Addresses are stored normalised: phones as E.164 (+1XXXXXXXXXX), emails lower-cased and trimmed.
-- Channels: sms, email, all. No sender uses this yet (0b-2 and 0b-3 wire them).
-- Additive and rerunnable while empty; refuses to reinstall once any row exists.
-- =============================================================================
begin;

do $guard$
declare n bigint;
begin
  if to_regclass('public.contact_optout') is not null then
    select count(*) into n from public.contact_optout;
    if n > 0 then raise exception 'contact_optout refused: % row(s) already recorded. Nothing was changed.', n; end if;
  end if;
  if to_regclass('public.contact_send_refusal') is not null then
    select count(*) into n from public.contact_send_refusal;
    if n > 0 then raise exception 'contact_optout refused: % refusal(s) already logged. Nothing was changed.', n; end if;
  end if;
end $guard$;

drop view if exists public.contact_optout_current;
drop function if exists public.contact_optout_record(text, text, text, text, text);
drop function if exists public.contact_optout_revoke(text, text, text, text);
drop function if exists public.contact_send_refusal_log(text, text, text, jsonb);
drop table if exists public.contact_optout;
drop table if exists public.contact_send_refusal;
drop function if exists public.contact_optout_guard();
drop function if exists public.contact_address_norm(text);

-- one normalisation, shared by the table, the doors and the check
create function public.contact_address_norm(p text) returns text language sql immutable as $$
  select case
    when p is null or btrim(p) = '' then null
    when position('@' in p) > 0 then lower(btrim(p))
    when length(regexp_replace(p, '\D', '', 'g')) = 10 then '+1' || regexp_replace(p, '\D', '', 'g')
    when length(regexp_replace(p, '\D', '', 'g')) = 11 and left(regexp_replace(p, '\D', '', 'g'), 1) = '1' then '+' || regexp_replace(p, '\D', '', 'g')
    else null end $$;

create table public.contact_optout (
  id          bigserial primary key,
  address     text not null check (address = public.contact_address_norm(address)),
  channel     text not null check (channel in ('sms','email','all')),
  opted_out   boolean not null,                       -- true: stop · false: opted back in (re-consent)
  source      text not null check (source in ('ghl_dnd','stop_text','staff','inquiry_dnc','circle_stop','hub')),
  evidence    text not null check (length(btrim(evidence)) > 0),
  recorded_by text not null check (length(btrim(recorded_by)) > 0),
  recorded_at timestamptz not null default now(),
  check (not (channel = 'email' and position('@' in address) = 0)),
  check (not (channel = 'sms' and position('@' in address) > 0))
);
comment on table public.contact_optout is
  '0b-1 · append-only opt-out and opt-back-in record. One of several authorities the shared send check reads; never the only one.';
create index contact_optout_lookup on public.contact_optout (address, channel, recorded_at desc);

create view public.contact_optout_current with (security_invoker = true) as
  select distinct on (address, channel) address, channel, opted_out, source, evidence, recorded_by, recorded_at
    from public.contact_optout order by address, channel, recorded_at desc, id desc;

create table public.contact_send_refusal (
  id        bigserial primary key,
  sender    text not null check (length(btrim(sender)) > 0),
  channel   text not null check (channel in ('sms','email')),
  address   text not null,                             -- normalised; masked when shown to staff
  reasons   jsonb not null check (jsonb_typeof(reasons) = 'array' and jsonb_array_length(reasons) > 0),
  at        timestamptz not null default now()
);
comment on table public.contact_send_refusal is '0b-1 · append-only: every send refused by the shared opt-out check, and why';
create index contact_send_refusal_at on public.contact_send_refusal (at desc);

create function public.contact_optout_guard() returns trigger language plpgsql as $$
begin raise exception '% is append-only (% refused)', tg_table_name, tg_op; end $$;
create trigger contact_optout_append_only before update or delete on public.contact_optout for each row execute function public.contact_optout_guard();
create trigger contact_optout_no_truncate before truncate on public.contact_optout for each statement execute function public.contact_optout_guard();
create trigger contact_send_refusal_append_only before update or delete on public.contact_send_refusal for each row execute function public.contact_optout_guard();
create trigger contact_send_refusal_no_truncate before truncate on public.contact_send_refusal for each statement execute function public.contact_optout_guard();

-- record an opt-out (idempotent: the same word from the same source is not written twice in a row)
create function public.contact_optout_record(p_address text, p_channel text, p_source text, p_evidence text, p_staff text)
returns jsonb language plpgsql security invoker as $$
declare a text := public.contact_address_norm(p_address); cur record;
begin
  if a is null then return jsonb_build_object('outcome','invalid_address'); end if;
  if p_channel not in ('sms','email','all') then return jsonb_build_object('outcome','invalid_channel'); end if;
  if nullif(btrim(p_evidence), '') is null or nullif(btrim(p_staff), '') is null then return jsonb_build_object('outcome','evidence_and_staff_required'); end if;
  if (p_channel = 'email') <> (position('@' in a) > 0) and p_channel <> 'all' then return jsonb_build_object('outcome','channel_address_mismatch'); end if;
  perform pg_advisory_xact_lock(hashtext('contact_optout'), hashtext(a));
  select * into cur from public.contact_optout_current where address = a and channel = p_channel;
  if found and cur.opted_out and cur.source = p_source then return jsonb_build_object('outcome','already_opted_out'); end if;
  insert into public.contact_optout (address, channel, opted_out, source, evidence, recorded_by)
  values (a, p_channel, true, p_source, btrim(p_evidence), btrim(p_staff));
  return jsonb_build_object('outcome','recorded','address', a, 'channel', p_channel);
end $$;

-- opt back in: only a person, with evidence (the other authorities, e.g. GHL DND, still apply on their own)
create function public.contact_optout_revoke(p_address text, p_channel text, p_evidence text, p_staff text)
returns jsonb language plpgsql security invoker as $$
declare a text := public.contact_address_norm(p_address); cur record;
begin
  if a is null then return jsonb_build_object('outcome','invalid_address'); end if;
  if nullif(btrim(p_evidence), '') is null or nullif(btrim(p_staff), '') is null then return jsonb_build_object('outcome','evidence_and_staff_required'); end if;
  perform pg_advisory_xact_lock(hashtext('contact_optout'), hashtext(a));
  select * into cur from public.contact_optout_current where address = a and channel = p_channel;
  if not found or not cur.opted_out then return jsonb_build_object('outcome','not_opted_out'); end if;
  insert into public.contact_optout (address, channel, opted_out, source, evidence, recorded_by)
  values (a, p_channel, false, 'staff', btrim(p_evidence), btrim(p_staff));
  return jsonb_build_object('outcome','revoked','address', a, 'channel', p_channel);
end $$;

create function public.contact_send_refusal_log(p_sender text, p_channel text, p_address text, p_reasons jsonb)
returns void language sql security invoker as $$
  insert into public.contact_send_refusal (sender, channel, address, reasons)
  values (p_sender, p_channel, coalesce(public.contact_address_norm(p_address), '(unreadable)'), p_reasons) $$;

alter table public.contact_optout enable row level security;
alter table public.contact_send_refusal enable row level security;
revoke all on public.contact_optout, public.contact_send_refusal, public.contact_optout_current from public, anon, authenticated, service_role;
revoke all on sequence public.contact_optout_id_seq, public.contact_send_refusal_id_seq from public, anon, authenticated, service_role;
grant select on public.contact_optout, public.contact_optout_current, public.contact_send_refusal to authenticated;
grant select, insert on public.contact_optout, public.contact_send_refusal to service_role;
grant select on public.contact_optout_current to service_role;
grant usage, select on sequence public.contact_optout_id_seq, public.contact_send_refusal_id_seq to service_role;
create policy contact_optout_read on public.contact_optout for select to authenticated using (true);
create policy contact_send_refusal_read on public.contact_send_refusal for select to authenticated using (true);
revoke all on function public.contact_optout_record(text,text,text,text,text) from public, anon, authenticated, service_role;
revoke all on function public.contact_optout_revoke(text,text,text,text) from public, anon, authenticated, service_role;
revoke all on function public.contact_send_refusal_log(text,text,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.contact_optout_record(text,text,text,text,text) to service_role;
grant execute on function public.contact_optout_revoke(text,text,text,text) to service_role;
grant execute on function public.contact_send_refusal_log(text,text,text,jsonb) to service_role;
grant execute on function public.contact_address_norm(text) to authenticated, service_role;

do $verify$
begin
  if has_table_privilege('authenticated', 'public.contact_optout', 'insert') or has_table_privilege('anon', 'public.contact_optout', 'select')
     or has_function_privilege('authenticated', 'public.contact_optout_record(text,text,text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.contact_optout_record(text,text,text,text,text)', 'execute')
     or has_table_privilege('service_role', 'public.contact_optout', 'update') or has_table_privilege('service_role', 'public.contact_optout', 'delete') then
    raise exception 'contact_optout self-check failed: privileges'; end if;
  if public.contact_address_norm('(417) 555-0101') <> '+14175550101' or public.contact_address_norm(' A@B.com ') <> 'a@b.com' then
    raise exception 'contact_optout self-check failed: address normalisation'; end if;
  if (select bool_or(prosecdef) from pg_proc where proname in ('contact_optout_record','contact_optout_revoke','contact_send_refusal_log')) then
    raise exception 'contact_optout self-check failed: definer'; end if;
end $verify$;

-- prove the door WORKS (not only that it refuses): record a test opt-out, read it back, then undo it
do $doorcheck$
declare r jsonb;
begin
  begin
    r := public.contact_optout_record('+14170000000', 'sms', 'hub', 'installer self-check', 'installer');
    if r->>'outcome' <> 'recorded' or not exists (select 1 from public.contact_optout_current where address = '+14170000000' and opted_out) then
      raise exception 'contact_optout self-check failed: the record door did not work';
    end if;
    raise exception using message = 'contact_optout_selfcheck_rollback';
  exception when others then
    if sqlerrm <> 'contact_optout_selfcheck_rollback' then raise; end if;
  end;
  if exists (select 1 from public.contact_optout) then raise exception 'contact_optout self-check failed: the test row was not undone'; end if;
end $doorcheck$;

commit;
