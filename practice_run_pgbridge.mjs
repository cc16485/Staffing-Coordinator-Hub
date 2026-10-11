// A local stand-in for the Supabase management API's SQL endpoint, backed by two real Postgres databases (PGlite): one for the
// Hub project, one for Training. Used only by practice_run_test.py to rehearse the 591-595 Desktop steps. Never touches the
// network beyond localhost.  PGLITE=<path> node practice_run_pgbridge.mjs <port>
import http from 'http'
const { PGlite } = await import(process.env.PGLITE)
const HUB = new PGlite(), TRN = new PGlite()
await HUB.exec(`
create schema storage; create schema cron;
create table cron.job (jobname text, schedule text, active boolean);
insert into cron.job values ('caregiver-journey-sweep', '*/10 * * * *', true), ('caregiver-audit-nightly', '5 11 * * *', true), ('step2-handoff-pass', '*/15 * * * *', true);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, created_at timestamptz default now());
create table public.app_data (key text primary key, data jsonb, updated_at timestamptz default now());
create table public.client_journey (journey_id uuid primary key default gen_random_uuid(), subject text, offer_id text, client_name text, status text, closed_reason text, axiscare_caregiver_id text, created_by text, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.client_journey_step (journey_id uuid, step_key text, state text, evidence jsonb default '{}', completed_by text, completed_by_name text, completed_at timestamptz, blocked_reason text, version int default 1, updated_at timestamptz default now(), primary key (journey_id, step_key));
create table public.client_journey_event (id bigserial primary key, journey_id uuid, step_key text, at timestamptz default now(), actor_email text not null, actor_name text, kind text not null, detail jsonb default '{}', reason text, is_test boolean default false);
create table public.journey_row_version (id bigserial primary key, journey_id uuid, step_key text, saved_at timestamptz default now());
create table public.evidence_history (id bigserial primary key, at timestamptz default now(), source text, record_id text, change text, field text, old_value jsonb, new_value jsonb, actor text default 'server');
create table public.app_data_item_change (id bigserial primary key, at timestamptz default now(), key text, record_id text);
create table public.welcome_calls (id uuid primary key default gen_random_uuid(), candidate_id text, phone text, status text, invited_at timestamptz default now(), starts_at timestamptz, done_at timestamptz, done_by text, closed_reason text, updated_at timestamptz default now());
create table public.coordinator_busy (id bigserial primary key, source text, source_id text, starts_at timestamptz, ends_at timestamptz);
create table public.step1_forms (offer_id uuid primary key, started_at timestamptz, completed_at timestamptz, current_screen text, answers jsonb default '{}', signatures jsonb default '{}', pdfs jsonb default '{}', esign_consent_at timestamptz);
create table public.step1_identity (offer_id uuid primary key, ssn_last4 text, license_last4 text, license_state text, captured_at timestamptz default now(), purge_after timestamptz, reveals int default 0);
create table public.contact_send_refusal (id bigserial primary key, at timestamptz default now(), sender text, channel text, address text, reasons jsonb);
create table public.axiscare_change_log (id bigserial primary key, at timestamptz default now(), kind text, axiscare_caregiver_id text, outcome text, summary text);
create table public.document_access_log (id bigserial primary key, at timestamptz default now(), offer_id text, doc text, by_name text, reason text);
-- the Slice 9 watcher, as installed: a removed record leaves its values in the evidence history
create function public.ev() returns trigger language plpgsql as $f$ begin
  insert into public.evidence_history (source, record_id, change, old_value)
  select 'app_data:' || new.key, o->>'id', 'removed', o from jsonb_array_elements(old.data) o
  where not exists (select 1 from jsonb_array_elements(new.data) n where n->>'id' = o->>'id');
  return null; end $f$;
create trigger ev after update on public.app_data for each row when (old.key in ('candidates', 'caregivers')) execute function public.ev();
`)
await TRN.exec(`
create table public.job_offers (id uuid primary key default gen_random_uuid(), first_name text, last_name text, phone text, email text, position text, pay_rate numeric, hours_type text, interview_date date,
  offered_by text, onboarding_path text, classification text, offer_status text, offer_version int, pd_version int, offer_sent_at timestamptz, offer_sent_by text, offer_expires_at timestamptz,
  created_at timestamptz default now(), notes text, offer_viewed_at timestamptz, offer_signed_at timestamptz, offer_signer_name text, pd_signed_at timestamptz, step1_done_at timestamptz,
  start_link_sent_at timestamptz, viventium_entered_at timestamptz, welcome_sent_at timestamptz, axiscare_applicant_id text, matched_caregiver_id uuid, offer_withdrawn_at timestamptz,
  offer_withdrawn_by text, offer_withdraw_reason text, offer_pdf_path text, pd_pdf_path text);
create table public.offer_events (id bigserial primary key, offer_id uuid, at timestamptz default now(), kind text, by_who text, channel text, result text, doc_version int, detail jsonb);
create table public.courses (id uuid primary key default gen_random_uuid(), slug text, title text, hours numeric);
insert into public.courses (slug, title, hours) values ('agency-orientation', 'Agency Orientation', 2), ('dementia-care', 'Alzheimer''s and Dementia Care', 3), ('on-the-job-training', 'On the job', 0);
create table public.caregivers (id uuid primary key default gen_random_uuid(), emp_id text not null unique, axiscare_id text unique, name text not null, hire_date date, access_token text unique default gen_random_uuid()::text,
  active boolean not null default true, mobile_phone text, email text, status_label text, cleared_reported_at timestamptz, cleared_notified_at timestamptz, cleared_hold_note text, updated_at timestamptz default now());
create table public.enrollments (id uuid primary key default gen_random_uuid(), caregiver_id uuid, course_id uuid, status text default 'not_started', progress numeric default 0, completed_at timestamptz, requirement text, unique (caregiver_id, course_id));
create table public.completions (id uuid primary key default gen_random_uuid(), caregiver_id uuid, course_id uuid, hours numeric, completed_at timestamptz default now(), learner_name text);
create function assign_onboarding() returns trigger language plpgsql as $f$ begin
  if new.status_label is distinct from 'In Training' then return new; end if;
  insert into enrollments (caregiver_id, course_id, requirement) select new.id, id, case when slug = 'on-the-job-training' then 'ojt' else 'pre_service' end from courses on conflict do nothing;
  return new; end $f$;
create trigger trg_assign_onboarding after insert or update of status_label on caregivers for each row execute function assign_onboarding();
`)
const DB = { zngsgedlsxinbygwmxwn: HUB, rdqujxiycycwhskyvrwa: TRN }
http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c
  const m = /\/v1\/projects\/([a-z]+)\/database\/query/.exec(req.url || '')
  if (!m || !DB[m[1]]) { res.writeHead(404); return res.end('{}') }
  try {
    const q = JSON.parse(body).query
    const r = await DB[m[1]].exec(q)
    const last = r[r.length - 1] || { rows: [] }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(last.rows || []))
  } catch (e) { res.writeHead(400); res.end(JSON.stringify({ message: 'ERROR: ' + e.message })) }
}).listen(Number(process.argv[2] || 8790), '127.0.0.1', () => console.log('ready'))
