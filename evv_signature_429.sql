-- =============================================================================
-- 429 · THE CLIENT SIGNATURE: AT THE SHIFT, AT THE NEXT VISIT, OR VERIFIED BY PHONE
-- =============================================================================
-- Samantha (2026-10-03): "it really needs to be completed at the time of the shift that they are asking for a manual
-- correction, or worst case scenario the next time they are with that client --- if client doesnt sign we can call
-- the client and verify over the phone".
--
-- What this adds:
--   On public.evv_submissions (the signed forms):
--     client_sig_status   'signed' | 'waiting' | 'phone_verified' | 'refused'  (older rows stay empty; the Hub reads an
--                         empty one as signed when a client signature is on it, otherwise as waiting)
--     client_signed_at, client_sign_via ('form' = signed with the caregiver, 'sign_link' = signed later on the
--                         client-signature page)
--     phone_verified_by / phone_verified_at / phone_call_at / phone_verified_with / phone_verified_relationship /
--     phone_verified_confirmed / phone_verified_notes   the office's record of the call (also used for "declined")
--   public.evv_sign       one row per form waiting for the client's signature (server side only). Its random token is
--                         the client-signature link https://sc.mo-care.com/evv-client-sign.html?t=<token>. Staff can
--                         read it; only the server key writes it. The public has no access at all.
--   public.evv_sign_get(t)          for the client-signature page: the caregiver's completed part, read only, while
--                                   the form still waits (else signed / closed / used / expired / not_found).
--   public.evv_sign_submit(t, p)    for the client-signature page: saves ONLY the client's signature (and that the
--                                   client ticked the confirmation). It can never change the caregiver's answers.
--   public.evv_client_phone_record(id, p)   for signed-in office staff only: "Verified by phone" or "Client declined
--                                   to confirm", with who called (from the sign-in, never typed), who they spoke with,
--                                   when, what was confirmed, notes.
--   public.evv_submit_prefilled     replaced: the same checks as 427, plus the caregiver may send her part with
--                                   "client_signs_later": the form is saved as waiting and an evv_sign row is made.
--   The 422 insert guard (same trigger) now also sets client_sig_status for a public insert: signed when a client
--   signature came with it, waiting when not; a public insert can never set phone verification or link fields.
--   A new update guard: signed-in accounts can't change a signature, the signature status or the phone record by a
--   direct update (only through the steps above), and can't accept a form whose client has not signed (waiting or
--   declined). Dismiss still works.
--
-- Permissions (never a blanket GRANT): evv_sign: anon nothing, authenticated SELECT, service_role select/insert/update.
-- EXECUTE: evv_sign_get + evv_sign_submit to anon and authenticated; evv_client_phone_record to authenticated only.
-- One transaction; safe to run again (every step checks first or replaces). Nothing is sent; no row is changed.
-- =============================================================================
begin;

do $$ begin
  if to_regclass('public.evv_prefill') is null then raise exception '429: run 427 first (public.evv_prefill does not exist)'; end if;
  if to_regprocedure('public.evv_submit_prefilled(uuid, jsonb)') is null then raise exception '429: run 427 first (evv_submit_prefilled is missing)'; end if;
end $$;

alter table public.evv_submissions
  add column if not exists client_sig_status            text,
  add column if not exists client_signed_at             timestamptz,
  add column if not exists client_sign_via              text,
  add column if not exists phone_verified_by            text,
  add column if not exists phone_verified_at            timestamptz,
  add column if not exists phone_call_at                timestamptz,
  add column if not exists phone_verified_with          text,
  add column if not exists phone_verified_relationship  text,
  add column if not exists phone_verified_confirmed     boolean,
  add column if not exists phone_verified_notes         text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'evv_submissions_sig_status_429' and conrelid = 'public.evv_submissions'::regclass) then
    alter table public.evv_submissions add constraint evv_submissions_sig_status_429
      check (client_sig_status is null or client_sig_status in ('signed', 'waiting', 'phone_verified', 'refused'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'evv_submissions_sig_via_429' and conrelid = 'public.evv_submissions'::regclass) then
    alter table public.evv_submissions add constraint evv_submissions_sig_via_429 check (client_sign_via is null or client_sign_via in ('form', 'sign_link'));
  end if;
end $$;
create index if not exists evv_submissions_sig_waiting_429 on public.evv_submissions (client_sig_status) where client_sig_status = 'waiting';

create table if not exists public.evv_sign (
  id                     uuid primary key default gen_random_uuid(),
  token                  uuid not null unique default gen_random_uuid(),
  submission_id          uuid not null unique,
  created_at             timestamptz not null default now(),
  created_by             text,
  expires_at             timestamptz not null default (now() + interval '14 days'),
  caregiver_axiscare_id  text,
  client_axiscare_id     text,
  caregiver_name         text,
  client_display         text,
  visit_date             date,
  visit_id               text,
  used_at                timestamptz,
  closed_at              timestamptz,
  next_visit_id          text,
  next_visit_start       text,
  next_visit_texted_at   timestamptz,
  next_visit_practice_at timestamptz,
  next_visit_tries       integer not null default 0,
  next_visit_refused_at  timestamptz,
  next_check_day         date,
  next_visit_seen        text,
  no_visit_item_at       timestamptz,
  last_note              text
);
create index if not exists evv_sign_open_429 on public.evv_sign (expires_at) where used_at is null and closed_at is null;

-- Permissions: this table only.
alter table public.evv_sign enable row level security;
revoke all on public.evv_sign from public;
revoke all on public.evv_sign from anon;
revoke all on public.evv_sign from authenticated;
grant select on public.evv_sign to authenticated;
grant select, insert, update on public.evv_sign to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'evv_sign' and policyname = 'evv_sign_staff_read_429') then
    create policy "evv_sign_staff_read_429" on public.evv_sign for select to authenticated using (true);
  end if;
end $$;

-- The 422 guard (same trigger, same name), now also deciding the client signature status of a PUBLIC insert.
create or replace function public.evv_submissions_public_insert_guard()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
begin
  if current_user = 'anon' then
    new.processed := false;
    new.processed_by := null;  new.processed_at := null;  new.outcome := null;
    new.caregiver_axiscare_id := null;  new.caregiver_linked_name := null;
    new.client_axiscare_id := null;     new.client_linked_name := null;
    new.linked_by := null;  new.linked_at := null;
    new.axiscare_visit_id := null;  new.axiscare_checked_at := null;  new.axiscare_seen := null;  new.axiscare_done_at := null;
    -- 429: the client signature status follows the signature itself; nothing about a phone call can come from the public
    if coalesce(new.sig_consumer, '') ~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' then
      new.client_sig_status := 'signed';  new.client_signed_at := now();  new.client_sign_via := 'form';
    else
      new.sig_consumer := null;
      new.client_sig_status := 'waiting'; new.client_signed_at := null;   new.client_sign_via := null;
    end if;
    new.phone_verified_by := null;  new.phone_verified_at := null;  new.phone_call_at := null;  new.phone_verified_with := null;
    new.phone_verified_relationship := null;  new.phone_verified_confirmed := null;  new.phone_verified_notes := null;
  end if;
  return new;
end
$fn$;

-- 429: signatures and the phone record change only through their own steps; no accept without the client.
create or replace function public.evv_submissions_sig_guard()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
declare v_was text;
begin
  if current_user in ('anon', 'authenticated') then
    if new.sig_consumer is distinct from old.sig_consumer or new.sig_attendant is distinct from old.sig_attendant
       or new.client_sig_status is distinct from old.client_sig_status or new.client_signed_at is distinct from old.client_signed_at
       or new.client_sign_via is distinct from old.client_sign_via
       or new.phone_verified_by is distinct from old.phone_verified_by or new.phone_verified_at is distinct from old.phone_verified_at
       or new.phone_call_at is distinct from old.phone_call_at or new.phone_verified_with is distinct from old.phone_verified_with
       or new.phone_verified_relationship is distinct from old.phone_verified_relationship
       or new.phone_verified_confirmed is distinct from old.phone_verified_confirmed or new.phone_verified_notes is distinct from old.phone_verified_notes then
      raise exception 'EVV429: a signature or the phone verification can only be recorded through its own step' using errcode = '42501';
    end if;
    v_was := coalesce(old.client_sig_status,
      case when coalesce(old.sig_consumer, '') ~ '^data:image/(png|jpeg);base64,' then 'signed' else 'waiting' end);
    if coalesce(new.processed, false) and not coalesce(old.processed, false) and coalesce(new.outcome, '') <> 'dismissed'
       and v_was in ('waiting', 'refused') then
      raise exception 'EVV429: the client has not signed this form (%). Wait for the next visit, or verify by phone first.', v_was using errcode = 'P0001';
    end if;
  end if;
  return new;
end
$fn$;
drop trigger if exists evv_submissions_sig_guard_429 on public.evv_submissions;
create trigger evv_submissions_sig_guard_429 before update on public.evv_submissions
  for each row execute function public.evv_submissions_sig_guard();

-- 427's save from a pre-filled link, now also allowing "the client signs at my next visit".
create or replace function public.evv_submit_prefilled(p_token uuid, p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
declare
  r public.evv_prefill;
  v_id public.evv_submissions.id%type;
  v_hm constant text := '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$';
  v_sig constant text := '^data:image/png;base64,[A-Za-z0-9+/=]+$';
  v_in text; v_out text; v_oin text; v_oout text; v_reason text; v_notes text; v_tasks text; v_sub text; v_sa text; v_sc text;
  v_later boolean;
  v_rec jsonb;
begin
  if p_token is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  select * into r from public.evv_prefill where token = p_token for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if r.used_at is not null then return jsonb_build_object('ok', false, 'error', 'used'); end if;
  if r.expires_at <= now() then return jsonb_build_object('ok', false, 'error', 'expired'); end if;

  v_in   := btrim(coalesce(p_payload->>'new_in', ''));
  v_out  := btrim(coalesce(p_payload->>'new_out', ''));
  v_oin  := nullif(btrim(coalesce(p_payload->>'orig_in', '')), '');
  v_oout := nullif(btrim(coalesce(p_payload->>'orig_out', '')), '');
  v_reason := btrim(coalesce(p_payload->>'reason', ''));
  v_notes  := btrim(coalesce(p_payload->>'notes', ''));
  v_tasks  := nullif(btrim(coalesce(p_payload->>'tasks', '')), '');
  v_sub    := nullif(btrim(coalesce(p_payload->>'submitdate', '')), '');
  v_sa     := coalesce(p_payload->>'sig_attendant', '');
  v_sc     := coalesce(p_payload->>'sig_consumer', '');
  v_later  := (p_payload->'client_signs_later') = 'true'::jsonb;
  if v_in !~ v_hm then return jsonb_build_object('ok', false, 'error', 'invalid', 'field', 'new_in'); end if;
  if v_out !~ v_hm then return jsonb_build_object('ok', false, 'error', 'invalid', 'field', 'new_out'); end if;
  if v_oin is not null and v_oin !~ v_hm then return jsonb_build_object('ok', false, 'error', 'invalid', 'field', 'orig_in'); end if;
  if v_oout is not null and v_oout !~ v_hm then return jsonb_build_object('ok', false, 'error', 'invalid', 'field', 'orig_out'); end if;
  if length(v_reason) < 1 or length(v_reason) > 300 then return jsonb_build_object('ok', false, 'error', 'invalid', 'field', 'reason'); end if;
  if length(v_notes) < 1 or length(v_notes) > 4000 then return jsonb_build_object('ok', false, 'error', 'invalid', 'field', 'notes'); end if;
  if v_tasks is not null and length(v_tasks) > 2000 then return jsonb_build_object('ok', false, 'error', 'invalid', 'field', 'tasks'); end if;
  if v_sub is not null and v_sub !~ '^\d{4}-\d{2}-\d{2}$' then return jsonb_build_object('ok', false, 'error', 'invalid', 'field', 'submitdate'); end if;
  -- the caregiver's signature is always required
  if v_sa !~ v_sig or length(v_sa) > 1500000 then return jsonb_build_object('ok', false, 'error', 'invalid', 'field', 'sig_attendant'); end if;
  -- the client's signature: required now, unless the caregiver says the client signs at her next visit (429)
  if v_sc = '' and v_later then
    v_sc := null;
  elsif v_sc !~ v_sig or length(v_sc) > 1500000 then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'field', 'sig_consumer');
  else
    v_later := false;
  end if;

  v_rec := jsonb_build_object(
    'attendant', r.caregiver_name, 'consumer', r.client_display, 'visitdate', r.visit_date::text,
    'submitdate', v_sub, 'orig_in', v_oin, 'orig_out', v_oout, 'new_in', v_in, 'new_out', v_out,
    'reason', v_reason, 'tasks', v_tasks, 'notes', v_notes, 'sig_attendant', v_sa, 'sig_consumer', v_sc);
  insert into public.evv_submissions (attendant, consumer, visitdate, submitdate, orig_in, orig_out, new_in, new_out,
      reason, tasks, notes, sig_attendant, sig_consumer, processed, submitted_at,
      caregiver_axiscare_id, caregiver_linked_name, client_axiscare_id, client_linked_name, linked_by, linked_at, axiscare_visit_id,
      client_sig_status, client_signed_at, client_sign_via)
    select x.attendant, x.consumer, x.visitdate, x.submitdate, x.orig_in, x.orig_out, x.new_in, x.new_out,
      x.reason, x.tasks, x.notes, x.sig_attendant, x.sig_consumer, false, now(),
      r.caregiver_axiscare_id, r.caregiver_name, r.client_axiscare_id, coalesce(r.client_name, r.client_display),
      'axiscare-visit', now(), r.axiscare_visit_id,
      case when v_later then 'waiting' else 'signed' end, case when v_later then null else now() end, case when v_later then null else 'form' end
    from jsonb_populate_record(null::public.evv_submissions, v_rec) x
  returning id into v_id;
  update public.evv_prefill set used_at = now(), submission_id = v_id::text::uuid where id = r.id;
  if v_later then
    -- the client-signature link: one use, 14 days; texted to the CAREGIVER at her next visit with this client (timekeeper)
    insert into public.evv_sign (submission_id, created_by, caregiver_axiscare_id, client_axiscare_id, caregiver_name, client_display, visit_date, visit_id)
      values (v_id::text::uuid, 'caregiver form (client signs at the next visit)', r.caregiver_axiscare_id, r.client_axiscare_id,
              r.caregiver_name, r.client_display, r.visit_date, r.axiscare_visit_id);
  end if;
  return jsonb_build_object('ok', true, 'id', v_id::text, 'waiting', v_later);
end
$fn$;

-- The client-signature page: what it may show. Only while the form still waits for the client.
create or replace function public.evv_sign_get(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare s public.evv_sign; f public.evv_submissions; v_st text;
begin
  if p_token is null then return jsonb_build_object('status', 'not_found'); end if;
  select * into s from public.evv_sign where token = p_token;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select * into f from public.evv_submissions where id = s.submission_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  v_st := coalesce(f.client_sig_status, 'waiting');
  if v_st = 'signed' then return jsonb_build_object('status', 'signed'); end if;
  if v_st in ('phone_verified', 'refused') or f.processed or s.closed_at is not null then return jsonb_build_object('status', 'closed'); end if;
  if s.used_at is not null then return jsonb_build_object('status', 'used'); end if;
  if s.expires_at <= now() then return jsonb_build_object('status', 'expired'); end if;
  return jsonb_build_object('status', 'ok',
    'caregiver_name', f.attendant, 'client_display', coalesce(s.client_display, f.consumer), 'visit_date', f.visitdate::text,
    'submitted_on', (f.submitted_at at time zone 'America/Chicago')::date::text,
    'orig_in', left(f.orig_in::text, 5), 'orig_out', left(f.orig_out::text, 5), 'new_in', left(f.new_in::text, 5), 'new_out', left(f.new_out::text, 5),
    'reason', f.reason, 'tasks', f.tasks, 'notes', f.notes,
    'sig_attendant', case when coalesce(f.sig_attendant, '') ~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' then f.sig_attendant end);
end
$fn$;

-- The client-signature page: saves ONLY the client's signature on a form that still waits for it.
create or replace function public.evv_sign_submit(p_token uuid, p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
declare s public.evv_sign; f public.evv_submissions; v_sc text; v_n int;
begin
  if p_token is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  select * into s from public.evv_sign where token = p_token for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select * into f from public.evv_submissions where id = s.submission_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if coalesce(f.client_sig_status, 'waiting') = 'signed' then return jsonb_build_object('ok', false, 'error', 'signed'); end if;
  if f.client_sig_status in ('phone_verified', 'refused') or f.processed or s.closed_at is not null then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  if s.used_at is not null then return jsonb_build_object('ok', false, 'error', 'used'); end if;
  if s.expires_at <= now() then return jsonb_build_object('ok', false, 'error', 'expired'); end if;
  if (p_payload->'confirm') is distinct from 'true'::jsonb then return jsonb_build_object('ok', false, 'error', 'invalid', 'field', 'confirm'); end if;
  v_sc := coalesce(p_payload->>'sig_consumer', '');
  if v_sc !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' or length(v_sc) > 1500000 then return jsonb_build_object('ok', false, 'error', 'invalid', 'field', 'sig_consumer'); end if;
  update public.evv_submissions set sig_consumer = v_sc, client_sig_status = 'signed', client_signed_at = now(), client_sign_via = 'sign_link'
   where id = f.id and coalesce(client_sig_status, 'waiting') = 'waiting' and not processed;
  get diagnostics v_n = row_count;
  if v_n <> 1 then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  update public.evv_sign set used_at = now() where id = s.id;
  return jsonb_build_object('ok', true);
end
$fn$;

-- The office: "Verified by phone" or "Client declined to confirm". Signed-in staff only; who called comes from the sign-in.
create or replace function public.evv_client_phone_record(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
declare
  claims jsonb; v_by text; f public.evv_submissions; v_st text;
  v_out text; v_with text; v_rel text; v_notes text; v_conf boolean; v_call timestamptz;
begin
  begin claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb; exception when others then claims := null; end;
  if coalesce(claims->>'role', '') <> 'authenticated' then return jsonb_build_object('ok', false, 'error', 'not_staff'); end if;
  v_by := left(coalesce(nullif(claims->>'email', ''), nullif(claims->>'sub', ''), 'office'), 200);
  if p_id is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  select * into f from public.evv_submissions where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if f.processed then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  v_st := coalesce(f.client_sig_status, case when coalesce(f.sig_consumer, '') ~ '^data:image/(png|jpeg);base64,' then 'signed' else 'waiting' end);
  v_out := coalesce(p_payload->>'outcome', '');
  if v_out not in ('phone_verified', 'refused') then return jsonb_build_object('ok', false, 'error', 'invalid', 'field', 'outcome'); end if;
  if v_st in ('signed', 'phone_verified') or (v_st = 'refused' and v_out = 'refused') then return jsonb_build_object('ok', false, 'error', 'already', 'status', v_st); end if;
  v_with  := btrim(coalesce(p_payload->>'spoke_with', ''));
  v_rel   := nullif(btrim(coalesce(p_payload->>'relationship', '')), '');
  v_notes := nullif(btrim(coalesce(p_payload->>'notes', '')), '');
  v_conf  := (p_payload->'confirmed') = 'true'::jsonb;
  if length(v_with) < 1 or length(v_with) > 120 then return jsonb_build_object('ok', false, 'error', 'invalid', 'field', 'spoke_with'); end if;
  if v_rel is not null and length(v_rel) > 60 then return jsonb_build_object('ok', false, 'error', 'invalid', 'field', 'relationship'); end if;
  if v_notes is not null and length(v_notes) > 2000 then return jsonb_build_object('ok', false, 'error', 'invalid', 'field', 'notes'); end if;
  begin v_call := (p_payload->>'call_at')::timestamptz; exception when others then v_call := null; end;
  if v_call is null or v_call > now() + interval '10 minutes' or v_call < now() - interval '60 days' then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'field', 'call_at');
  end if;
  if v_out = 'phone_verified' and not v_conf then return jsonb_build_object('ok', false, 'error', 'invalid', 'field', 'confirmed'); end if;
  if v_out = 'refused' and v_notes is null then return jsonb_build_object('ok', false, 'error', 'invalid', 'field', 'notes'); end if;
  update public.evv_submissions set client_sig_status = v_out, phone_verified_by = v_by, phone_verified_at = now(), phone_call_at = v_call,
         phone_verified_with = v_with, phone_verified_relationship = v_rel, phone_verified_confirmed = (v_out = 'phone_verified' and v_conf),
         phone_verified_notes = v_notes
   where id = f.id;
  update public.evv_sign set closed_at = now(), last_note = 'closed by the office: ' || v_out where submission_id = f.id and used_at is null and closed_at is null;
  return jsonb_build_object('ok', true, 'status', v_out, 'by', v_by);
end
$fn$;

revoke all on function public.evv_submit_prefilled(uuid, jsonb) from public;
revoke all on function public.evv_sign_get(uuid) from public;
revoke all on function public.evv_sign_submit(uuid, jsonb) from public;
revoke all on function public.evv_client_phone_record(uuid, jsonb) from public;
revoke all on function public.evv_client_phone_record(uuid, jsonb) from anon;
grant execute on function public.evv_submit_prefilled(uuid, jsonb) to anon, authenticated;
grant execute on function public.evv_sign_get(uuid) to anon, authenticated;
grant execute on function public.evv_sign_submit(uuid, jsonb) to anon, authenticated;
grant execute on function public.evv_client_phone_record(uuid, jsonb) to authenticated;

-- Read back: refuse to finish (whole transaction undone) unless it is exactly as intended.
do $$
declare v_missing text;
begin
  select string_agg(c, ', ') into v_missing from unnest(array['client_sig_status','client_signed_at','client_sign_via','phone_verified_by','phone_verified_at',
    'phone_call_at','phone_verified_with','phone_verified_relationship','phone_verified_confirmed','phone_verified_notes']) c
   where not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'evv_submissions' and column_name = c);
  if v_missing is not null then raise exception '429: columns missing after the change: %', v_missing; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.evv_sign'::regclass) then raise exception '429: row security is off on evv_sign'; end if;
  if has_table_privilege('anon', 'public.evv_sign', 'SELECT') or has_table_privilege('anon', 'public.evv_sign', 'INSERT')
     or has_table_privilege('anon', 'public.evv_sign', 'UPDATE') or has_table_privilege('anon', 'public.evv_sign', 'DELETE')
     or has_table_privilege('anon', 'public.evv_sign', 'TRUNCATE') then
    raise exception '429: the public can touch evv_sign';
  end if;
  if has_table_privilege('authenticated', 'public.evv_sign', 'INSERT') or has_table_privilege('authenticated', 'public.evv_sign', 'UPDATE')
     or has_table_privilege('authenticated', 'public.evv_sign', 'DELETE') or has_table_privilege('authenticated', 'public.evv_sign', 'TRUNCATE') then
    raise exception '429: signed-in accounts can change evv_sign';
  end if;
  if not has_table_privilege('authenticated', 'public.evv_sign', 'SELECT') then raise exception '429: staff cannot read evv_sign'; end if;
  if not (has_table_privilege('service_role', 'public.evv_sign', 'INSERT') and has_table_privilege('service_role', 'public.evv_sign', 'UPDATE')) then
    raise exception '429: the server cannot make signature links';
  end if;
  if not (has_function_privilege('anon', 'public.evv_sign_get(uuid)', 'EXECUTE') and has_function_privilege('anon', 'public.evv_sign_submit(uuid, jsonb)', 'EXECUTE')
          and has_function_privilege('anon', 'public.evv_submit_prefilled(uuid, jsonb)', 'EXECUTE')) then
    raise exception '429: the public pages cannot use their functions';
  end if;
  if has_function_privilege('anon', 'public.evv_client_phone_record(uuid, jsonb)', 'EXECUTE') then raise exception '429: the public could record a phone verification'; end if;
  if not has_function_privilege('authenticated', 'public.evv_client_phone_record(uuid, jsonb)', 'EXECUTE') then raise exception '429: staff cannot record a phone verification'; end if;
  if not (select bool_and(prosecdef) from pg_proc where oid in ('public.evv_sign_get(uuid)'::regprocedure, 'public.evv_sign_submit(uuid, jsonb)'::regprocedure,
          'public.evv_client_phone_record(uuid, jsonb)'::regprocedure, 'public.evv_submit_prefilled(uuid, jsonb)'::regprocedure)) then
    raise exception '429: a function is not security definer';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'evv_submissions_public_insert_guard_422' and tgrelid = 'public.evv_submissions'::regclass) then
    raise exception '429: the 422 insert guard is missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'evv_submissions_sig_guard_429' and tgrelid = 'public.evv_submissions'::regclass) then
    raise exception '429: the update guard is missing';
  end if;
  if not has_table_privilege('anon', 'public.evv_submissions', 'INSERT') or has_table_privilege('anon', 'public.evv_submissions', 'SELECT')
     or has_table_privilege('anon', 'public.evv_submissions', 'UPDATE') then
    raise exception '429: the plain public form changed (anon must still send only)';
  end if;
end $$;

commit;
