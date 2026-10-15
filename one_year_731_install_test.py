# Rehearses the 731 Desktop step (install, re-run, a refused install, undo) against a throwaway local Postgres with the
# rules as they are live (noshow_policy + interview-limits + 461 + 512 + 586), made-up applicants and made-up adverts.
#   HUB=<care-coordinator-hub checkout> python3 one_year_731_install_test.py
import os, glob, re, tempfile, subprocess, sys
import pgserver
from pg8000.native import Connection
HERE = os.path.dirname(os.path.abspath(__file__)); HUB = os.environ.get("HUB", os.path.join(HERE, "..", "cc-hub-live"))
d = tempfile.mkdtemp(prefix="i731_"); srv = pgserver.get_server(d)
host = [kv[5:] for kv in srv.get_uri().split("?", 1)[1].split("&") if kv.startswith("host=")][0]
sock = [p for p in glob.glob(os.path.join(host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
s = Connection(user="postgres", database="postgres", unix_sock=sock)
for stmt in [
  "create role anon", "create role authenticated", "create schema auth",
  # the same two helpers Supabase has: who is calling, read from the request's claims
  """create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true),''),
       (nullif(current_setting('request.jwt.claims', true),'')::jsonb->>'role'))::text $$""",
  """create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb $$""",
  """create table job_applicants (id uuid primary key default gen_random_uuid(), first_name text, last_name text, phone text, email text,
     status text default 'partial', duplicate_of uuid, screen_grade text, screen_flags text[], created_at timestamptz default now(), decline_reason text,
     completed_at timestamptz, age_ok boolean, work_auth boolean, has_transport boolean, position text, prn jsonb, gave_up_at timestamptz, channel text,
     posting_slug text, posting_title text, source text, zip text, city text, job_type text, hours_wanted text, will_build_up boolean,
     experience_kinds text[], sms_consent boolean, role_answers jsonb, has_license boolean, has_insurance boolean, can_pass_background boolean,
     lived_outside_mo boolean, states_lived text, experience_years text, experience text, availability text, referral_source text, work_history jsonb)""",
  "create table job_positions (key text primary key, track text)", "insert into job_positions values ('caregiver', null), ('prn_cna', 'prn')",
  """create table interview_bookings (id uuid primary key default gen_random_uuid(), applicant_id uuid, coordinator_id uuid, starts_at timestamptz,
     ends_at timestamptz, status text default 'booked', cancelled_at timestamptz, cancelled_by text, cancel_reason text, cancel_notified_at timestamptz,
     rescheduled_from timestamptz, confirmed_at timestamptz, reminded_day_at timestamptz, reminded_hour_at timestamptz, created_at timestamptz default now())""",
  "create table coordinator_busy (id serial, coordinator_id uuid, starts_at timestamptz, ends_at timestamptz, source text, source_id text, label text)",
  "create table activity_types (key text, minutes int, lead_hours int, per_slot int)", "insert into activity_types values ('interview', 30, 2, 1)",
  "create table do_not_rehire (id uuid primary key default gen_random_uuid(), name text, phone_digits text, email text, reason text, added_by text)",
  "create table coordinators (id uuid primary key default gen_random_uuid(), active boolean default true)",
  "create table coordinator_availability (coordinator_id uuid, active boolean default true, activity text, day_of_week int, start_time time, end_time time)",
]: s.run(stmt)
def load(path, strip_alter=False, strip_mine=False):
    t = open(path).read()
    if strip_alter: t = re.sub(r"^alter table .*$", "", t, flags=re.M)
    if strip_mine: t = re.sub(r"create or replace function interview_mine[\s\S]*?end \$\$;", "", t)
    t = re.sub(r"^notify .*$", "", t, flags=re.M)
    s.execute_simple(t)
load(os.path.join(HERE, "noshow_policy.sql"), strip_alter=True)
s.run("alter table job_applicants add column if not exists noshow_at timestamptz")
load(os.path.join(HUB, "interview-limits.sql"), strip_mine=True)
load(os.path.join(HERE, "interview_person_461.sql"))
load(os.path.join(HERE, "interview_first_choice_512.sql"))
load(os.path.join(HERE, "screening_gate_586.sql"))
# 647 (2026-10-13): the office screen is office staff only. The same check as live: a sign-in linked to a staff role.
s.run("create table auth_identities (person_id uuid, auth_user_id uuid)")
s.run("create table staff_roles (person_id uuid, entity text, role text)")
s.run("insert into auth_identities values ('00000000-0000-4000-8000-00000000b0b0', '00000000-0000-4000-8000-00000000a0a0')")
s.run("insert into staff_roles values ('00000000-0000-4000-8000-00000000b0b0', 'cc_ihs', 'owner_admin')")
s.run("""create function public.hub_office_ok() returns boolean language sql stable security definer as $$
  select exists (select 1 from public.auth_identities ai join public.staff_roles r on r.person_id = ai.person_id
    where ai.auth_user_id::text = nullif(current_setting('request.jwt.claim.sub', true), '') and r.entity = 'cc_ihs'
      and r.role in ('owner_admin','care_coordinator','staffing_coordinator')) $$""")
d = s.run("select pg_get_functiondef('public.applicant_screen_by_office(uuid,boolean,boolean,boolean,boolean,boolean)'::regprocedure)")[0][0]
s.execute_simple(d.replace("if coalesce(auth.role(),'anon') <> 'authenticated' then raise exception 'sign in first'; end if;",
                           "if not public.hub_office_ok() then raise exception 'office staff only'; end if;"))
s.run("""create table job_postings (id uuid primary key default gen_random_uuid(), status text, summary text, description text,
  responsibilities text, qualifications text, benefits text)""")
s.run("""create table job_templates (id serial primary key, summary text, description text, responsibilities text, qualifications text, benefits text)""")
s.run("""insert into job_postings (status, description, qualifications) values
  ('published', E'Intro.\n\nExperience helps, but reliability and kindness matter more. If you have cared for someone before, even a family member, we would like to hear from you.', E'Be at least 18 years old\nPass all required background screenings'),
  ('published', 'PRN', E'Hold a current CNA certification\nAt least a year of caregiving experience')""")
s.run("""insert into job_templates (description, qualifications) values ('W-2. Experience helps, but reliability and kindness matter more.', 'Be at least 18 years old')""")
s.run("insert into coordinators (id) values ('00000000-0000-4000-8000-0000000000a1')")
s.run("insert into coordinator_availability select '00000000-0000-4000-8000-0000000000a1', true, 'interview', d, '08:00', '17:00' from generate_series(0,6) d")
# an interview booked before 731 by someone who never answered the new question (it must stay exactly as it is)
old = s.run("insert into job_applicants (first_name, status, completed_at, age_ok, work_auth, has_transport) values ('Early', 'new', now(), true, true, true) returning id")[0][0]
s.run("select interview_book(:a, (date_trunc('day', now() at time zone 'America/Chicago') + interval '3 days 10 hours') at time zone 'America/Chicago')", a=old)
before = s.run("select id, starts_at from interview_bookings where applicant_id = :a and status = 'booked'", a=old)[0]
ads_before = s.run("select id::text, description, qualifications from job_postings order by id::text") + s.run("select id::text, description, qualifications from job_templates")

def run(mode="install", extra=None, save=None):
    rep = tempfile.mktemp(suffix=".txt")
    env = dict(os.environ, SB_REPORT=rep, SB_LOCAL_SOCK=sock, SB_REPO=HERE, SB_MODE=mode, SB_SAVE=save or SAVE, **(extra or {}))
    p = subprocess.run([sys.executable, os.path.join(HERE, "one_year_731_install.py")], env=env, capture_output=True, text=True)
    out = open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr
    return p.returncode, out
SAVE = tempfile.mkdtemp(prefix="save731_")

res = []
ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[-1200:]))
c1, o1 = run()
ck("install: finishes clean", c1 == 0 and "731 COMPLETE" in o1, o1)
for line in ["live screening functions are exactly what this was built on", "the experience rule is in", "none still say",
             "a year or more: they can book an interview", "under a year: the application ends there", "unpaid family caregiving: no interview until the office has verified it",
             "pick a time", "the public can't use the office's answer screen", "the office has to say who confirmed", "once the office verifies it, they can book",
             "an answer already given can't be changed", "nothing made-up was left behind"]:
    ck("install proves: " + line, ("✓ " + line) in o1 or (line in o1 and "✗ " + line not in o1), o1)
ck("install: 2 adverts/templates changed (the PRN one already asked for a year)", "2 advert(s)/template(s) now ask" in o1, o1)
now = s.run("select id, starts_at, status from interview_bookings where applicant_id = :a and status = 'booked'", a=old)
ck("install: the interview booked before 731 is untouched (same row, same time, still booked)", len(now) == 1 and now[0][0] == before[0] and now[0][1] == before[1], now)
ck("install: the made-up applicants are gone", s.run("select count(*) from job_applicants where email like 'proof-731-%'")[0][0] == 0)
ck("install: no names or keys in the report", "Proof" not in o1 and "Sevenone" not in o1 and "sbp_" not in o1)
c2, o2 = run()
ck("re-run: recognises it is already in, proves again, finishes clean, changes no advert", c2 == 0 and "already 731" in o2 and "731 COMPLETE" in o2 and "0 advert(s)/template(s)" in o2, o2)
c3, o3 = run(extra={"SB_PINS": '{"one_year_731.sql": "0000"}'})
ck("a file that isn't the reviewed one: stops before anything", c3 == 2 and "is not the reviewed version" in o3 and "PART 2" not in o3, o3)
c4, o4 = run("undo")
ck("undo: the functions are back exactly as before 731", c4 == 0 and "back exactly as before 731" in o4, o4)
ads_after = s.run("select id::text, description, qualifications from job_postings order by id::text") + s.run("select id::text, description, qualifications from job_templates")
ck("undo: every advert and template is back to its old words", "back to the words saved before 731" in o4 and ads_after == ads_before, (o4, ads_after))
ck("undo: the 586 office screen (six answers) is back and the eight-answer one is gone",
   s.run("select count(*) from pg_proc where proname = 'applicant_screen_by_office'")[0][0] == 1
   and s.run("select pronargs from pg_proc where proname = 'applicant_screen_by_office'")[0][0] == 6)
s.run("create or replace function public.applicant_followup_stop(p uuid) returns text language sql stable as $$ select null::text $$")
c5, o5 = run(save=tempfile.mkdtemp(prefix="save731b_"))
ck("someone changed a live function since: stops, changes nothing", c5 == 3 and "aren't the ones this was built on" in o5 and "stop" in o5 and "PART 2" not in o5, o5)
ck("...and nothing 731 was installed", s.run("select pronargs from pg_proc where proname = 'applicant_screen_by_office'")[0][0] == 6)
for n, ok, note in res: print(("PASS  " if ok else "FAIL  ") + n + ("" if ok else "\n" + note))
p = sum(1 for _, ok, _ in res if ok); print(f"ALL {len(res)} CHECKS PASS" if p == len(res) else f"{len(res) - p} OF {len(res)} FAILED")
raise SystemExit(0 if p == len(res) else 1)
