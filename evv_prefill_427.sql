-- =============================================================================
-- 427 · THE PRE-FILLED, VISIT-LINKED EVV CORRECTION FORM
-- =============================================================================
-- Samantha (2026-10-03, "go"): the EVV form link in the two texts that already carry it (the person-tapped "Text
-- <caregiver> the EVV form" on the missed clock-in page, and the clock-out reminder) opens the form already filled in
-- for that visit, and the signed form arrives in the Hub already linked to the caregiver, the client and the AxisCare
-- visit. Nothing new is sent; the EVV form is still never sent automatically on a missed clock-in.
--
-- PRIVACY: the link carries only a random token (https://sc.mo-care.com/evv-correction-form.html?t=<token>). No name,
-- phone, email, client or date is ever in an address.
--
--   public.evv_prefill            one row per link made (server side only, by the two senders). Row security ON.
--                                 The public (anon) has NO access to it. Signed-in staff can read it. Only the server
--                                 key writes it.
--   public.evv_prefill_get(t)     for the public form: ONLY what the form shows (caregiver name, client first name +
--                                 last initial, visit date, scheduled times, the AxisCare times if known, which clock
--                                 is missing), and only while the link is unused and not expired (7 days). Otherwise
--                                 just "expired" / "used" / "not_found".
--   public.evv_submit_prefilled(t, payload)
--                                 for the public form: checks the answers (times, reason, what happened, BOTH
--                                 signatures required, lengths), then saves the form with the caregiver, client and
--                                 visit taken FROM THE ROW (never from the browser), marks the link used, and returns
--                                 the form's number. One use per link. Runs server side (security definer), which is
--                                 why the 422 guard (it wipes links on PUBLIC inserts) does not wipe these: the link
--                                 comes from the office's own row, not from the public.
-- The plain public form (no link) is unchanged: anon INSERT on evv_submissions, guard wipes any claimed link.
--
-- Permissions (never a blanket GRANT): evv_prefill: anon nothing; authenticated SELECT only; service_role select,
-- insert, update. The two functions: EXECUTE to anon and authenticated only (taken away from public first).
-- One transaction; safe to run again (every step checks first or replaces).
-- =============================================================================
begin;

do $$ begin
  if to_regclass('public.evv_submissions') is null then raise exception '427: public.evv_submissions does not exist'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'evv_submissions' and column_name = 'axiscare_visit_id') then
    raise exception '427: run 422 first (evv_submissions has no axiscare_visit_id)';
  end if;
end $$;

create table if not exists public.evv_prefill (
  id                     uuid primary key default gen_random_uuid(),
  token                  uuid not null unique default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  created_by             text,
  expires_at             timestamptz not null default (now() + interval '7 days'),
  axiscare_visit_id      text not null,
  caregiver_axiscare_id  text not null,
  client_axiscare_id     text,
  caregiver_name         text not null,
  client_display         text not null,
  client_name            text,
  visit_date             date not null,
  scheduled_in           text,
  scheduled_out          text,
  actual_in              text,
  actual_out             text,
  which_missing          text not null default 'in',
  used_at                timestamptz,
  submission_id          uuid
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'evv_prefill_which_427' and conrelid = 'public.evv_prefill'::regclass) then
    alter table public.evv_prefill add constraint evv_prefill_which_427 check (which_missing in ('in', 'out', 'both'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'evv_prefill_times_427' and conrelid = 'public.evv_prefill'::regclass) then
    alter table public.evv_prefill add constraint evv_prefill_times_427 check (
      (scheduled_in is null or scheduled_in ~ '^\d{2}:\d{2}$') and (scheduled_out is null or scheduled_out ~ '^\d{2}:\d{2}$')
      and (actual_in is null or actual_in ~ '^\d{2}:\d{2}$') and (actual_out is null or actual_out ~ '^\d{2}:\d{2}$'));
  end if;
end $$;
create index if not exists evv_prefill_visit_427 on public.evv_prefill (axiscare_visit_id);

-- Permissions: this table only.
alter table public.evv_prefill enable row level security;
revoke all on public.evv_prefill from public;
revoke all on public.evv_prefill from anon;
revoke all on public.evv_prefill from authenticated;
grant select on public.evv_prefill to authenticated;
grant select, insert, update on public.evv_prefill to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'evv_prefill' and policyname = 'evv_prefill_staff_read_427') then
    create policy "evv_prefill_staff_read_427" on public.evv_prefill for select to authenticated using (true);
  end if;
end $$;

-- What the public form may know about a link. Nothing else ever leaves the row.
create or replace function public.evv_prefill_get(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare r public.evv_prefill;
begin
  if p_token is null then return jsonb_build_object('status', 'not_found'); end if;
  select * into r from public.evv_prefill where token = p_token;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if r.used_at is not null then return jsonb_build_object('status', 'used'); end if;
  if r.expires_at <= now() then return jsonb_build_object('status', 'expired'); end if;
  return jsonb_build_object('status', 'ok',
    'caregiver_name', r.caregiver_name, 'client_display', r.client_display, 'visit_date', r.visit_date::text,
    'scheduled_in', r.scheduled_in, 'scheduled_out', r.scheduled_out, 'actual_in', r.actual_in, 'actual_out', r.actual_out,
    'which_missing', r.which_missing);
end
$fn$;

-- The signed form, saved from a pre-filled link. Who and which visit come from the row; the answers are checked.
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
  if v_in !~ v_hm then return jsonb_build_object('ok', false, 'error', 'invalid', 'field', 'new_in'); end if;
  if v_out !~ v_hm then return jsonb_build_object('ok', false, 'error', 'invalid', 'field', 'new_out'); end if;
  if v_oin is not null and v_oin !~ v_hm then return jsonb_build_object('ok', false, 'error', 'invalid', 'field', 'orig_in'); end if;
  if v_oout is not null and v_oout !~ v_hm then return jsonb_build_object('ok', false, 'error', 'invalid', 'field', 'orig_out'); end if;
  if length(v_reason) < 1 or length(v_reason) > 300 then return jsonb_build_object('ok', false, 'error', 'invalid', 'field', 'reason'); end if;
  if length(v_notes) < 1 or length(v_notes) > 4000 then return jsonb_build_object('ok', false, 'error', 'invalid', 'field', 'notes'); end if;
  if v_tasks is not null and length(v_tasks) > 2000 then return jsonb_build_object('ok', false, 'error', 'invalid', 'field', 'tasks'); end if;
  if v_sub is not null and v_sub !~ '^\d{4}-\d{2}-\d{2}$' then return jsonb_build_object('ok', false, 'error', 'invalid', 'field', 'submitdate'); end if;
  -- both signatures are required (policy: no manual time change without the client's signature)
  if v_sa !~ v_sig or length(v_sa) > 1500000 then return jsonb_build_object('ok', false, 'error', 'invalid', 'field', 'sig_attendant'); end if;
  if v_sc !~ v_sig or length(v_sc) > 1500000 then return jsonb_build_object('ok', false, 'error', 'invalid', 'field', 'sig_consumer'); end if;

  -- jsonb_populate_record casts each answer to the table's own column types (whatever they are).
  v_rec := jsonb_build_object(
    'attendant', r.caregiver_name, 'consumer', r.client_display, 'visitdate', r.visit_date::text,
    'submitdate', v_sub, 'orig_in', v_oin, 'orig_out', v_oout, 'new_in', v_in, 'new_out', v_out,
    'reason', v_reason, 'tasks', v_tasks, 'notes', v_notes, 'sig_attendant', v_sa, 'sig_consumer', v_sc);
  insert into public.evv_submissions (attendant, consumer, visitdate, submitdate, orig_in, orig_out, new_in, new_out,
      reason, tasks, notes, sig_attendant, sig_consumer, processed, submitted_at,
      caregiver_axiscare_id, caregiver_linked_name, client_axiscare_id, client_linked_name, linked_by, linked_at, axiscare_visit_id)
    select x.attendant, x.consumer, x.visitdate, x.submitdate, x.orig_in, x.orig_out, x.new_in, x.new_out,
      x.reason, x.tasks, x.notes, x.sig_attendant, x.sig_consumer, false, now(),
      r.caregiver_axiscare_id, r.caregiver_name, r.client_axiscare_id, coalesce(r.client_name, r.client_display),
      'axiscare-visit', now(), r.axiscare_visit_id
    from jsonb_populate_record(null::public.evv_submissions, v_rec) x
  returning id into v_id;
  update public.evv_prefill set used_at = now(), submission_id = v_id::text::uuid where id = r.id;
  return jsonb_build_object('ok', true, 'id', v_id::text);
end
$fn$;

revoke all on function public.evv_prefill_get(uuid) from public;
revoke all on function public.evv_submit_prefilled(uuid, jsonb) from public;
grant execute on function public.evv_prefill_get(uuid) to anon, authenticated;
grant execute on function public.evv_submit_prefilled(uuid, jsonb) to anon, authenticated;

-- Read back: refuse to finish (whole transaction undone) unless it is exactly as intended.
do $$ begin
  if not (select relrowsecurity from pg_class where oid = 'public.evv_prefill'::regclass) then raise exception '427: row security is off on evv_prefill'; end if;
  if has_table_privilege('anon', 'public.evv_prefill', 'SELECT') or has_table_privilege('anon', 'public.evv_prefill', 'INSERT')
     or has_table_privilege('anon', 'public.evv_prefill', 'UPDATE') or has_table_privilege('anon', 'public.evv_prefill', 'DELETE')
     or has_table_privilege('anon', 'public.evv_prefill', 'TRUNCATE') then
    raise exception '427: the public can touch evv_prefill';
  end if;
  if has_table_privilege('authenticated', 'public.evv_prefill', 'INSERT') or has_table_privilege('authenticated', 'public.evv_prefill', 'UPDATE')
     or has_table_privilege('authenticated', 'public.evv_prefill', 'DELETE') or has_table_privilege('authenticated', 'public.evv_prefill', 'TRUNCATE') then
    raise exception '427: signed-in accounts can change evv_prefill';
  end if;
  if not has_table_privilege('authenticated', 'public.evv_prefill', 'SELECT') then raise exception '427: staff cannot read evv_prefill'; end if;
  if not (has_table_privilege('service_role', 'public.evv_prefill', 'INSERT') and has_table_privilege('service_role', 'public.evv_prefill', 'UPDATE')) then
    raise exception '427: the server cannot make links';
  end if;
  if not (has_function_privilege('anon', 'public.evv_prefill_get(uuid)', 'EXECUTE') and has_function_privilege('anon', 'public.evv_submit_prefilled(uuid, jsonb)', 'EXECUTE')) then
    raise exception '427: the public form cannot use its two functions';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.evv_submit_prefilled(uuid, jsonb)'::regprocedure) then raise exception '427: evv_submit_prefilled is not security definer'; end if;
  if not has_table_privilege('anon', 'public.evv_submissions', 'INSERT') or has_table_privilege('anon', 'public.evv_submissions', 'SELECT') then
    raise exception '427: the plain public form changed (anon must still send only)';
  end if;
end $$;

commit;
