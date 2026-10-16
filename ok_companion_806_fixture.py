# A throwaway local Postgres with the applicant rules as they are live before 806: noshow_policy + interview-limits + 461 +
# 512 + 586 + 731 (the 731 install test's own fixture) plus the screen (recruit-screening's trigger, screen_fix's
# applicant_screen), the opening list (early_interest) and ops_settings. Made-up rows only. Used by ok_companion_806_sql_test.py
# and ok_companion_806_install_test.py.
#   from ok_companion_806_fixture import make; s, sock = make(hub_root)
import os, glob, re, tempfile
import pgserver
from pg8000.native import Connection
HERE = os.path.dirname(os.path.abspath(__file__))
OFFICE = '00000000-0000-4000-8000-00000000a0a0'

def make(hub):
    d = tempfile.mkdtemp(prefix="i806_"); srv = pgserver.get_server(d)
    host = [kv[5:] for kv in srv.get_uri().split("?", 1)[1].split("&") if kv.startswith("host=")][0]
    sock = [p for p in glob.glob(os.path.join(host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
    s = Connection(user="postgres", database="postgres", unix_sock=sock)
    for stmt in [
      "create role anon", "create role authenticated", "create role service_role", "create schema auth",
      """create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true),''),
           (nullif(current_setting('request.jwt.claims', true),'')::jsonb->>'role'))::text $$""",
      """create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb $$""",
      """create table job_applicants (id uuid primary key default gen_random_uuid(), first_name text, last_name text, phone text, email text,
         status text default 'partial', duplicate_of uuid, screen_grade text, screen_flags text[], created_at timestamptz default now(), decline_reason text,
         completed_at timestamptz, age_ok boolean, work_auth boolean, has_transport boolean, position text, prn jsonb, gave_up_at timestamptz, channel text,
         posting_slug text, posting_title text, source text, zip text, city text, job_type text, hours_wanted text, will_build_up boolean,
         experience_kinds text[], sms_consent boolean, role_answers jsonb, has_license boolean, has_insurance boolean, can_pass_background boolean,
         lived_outside_mo boolean, states_lived text, experience_years text, experience text, availability text, referral_source text, work_history jsonb,
         miles_out numeric, notes text, screened_by text, screened_at timestamptz)""",
      "create table job_positions (key text primary key, label text not null default '', screener jsonb not null default '[]', sort int default 0, active boolean not null default true, track text)",
      "insert into job_positions (key, label, track) values ('caregiver', 'Caregiver', null), ('prn_cna', 'PRN CNA Team', 'prn')",
      """create table interview_bookings (id uuid primary key default gen_random_uuid(), applicant_id uuid, coordinator_id uuid, starts_at timestamptz,
         ends_at timestamptz, status text default 'booked', cancelled_at timestamptz, cancelled_by text, cancel_reason text, cancel_notified_at timestamptz,
         rescheduled_from timestamptz, confirmed_at timestamptz, reminded_day_at timestamptz, reminded_hour_at timestamptz, created_at timestamptz default now())""",
      "create table coordinator_busy (id serial, coordinator_id uuid, starts_at timestamptz, ends_at timestamptz, source text, source_id text, label text)",
      "create table activity_types (key text, minutes int, lead_hours int, per_slot int)", "insert into activity_types values ('interview', 30, 2, 1)",
      "create table do_not_rehire (id uuid primary key default gen_random_uuid(), name text, phone_digits text, email text, reason text, added_by text)",
      "create table coordinators (id uuid primary key default gen_random_uuid(), active boolean default true)",
      "create table coordinator_availability (coordinator_id uuid, active boolean default true, activity text, day_of_week int, start_time time, end_time time)",
      "create table app_data (key text primary key, data jsonb)",
      "insert into app_data values ('ops_settings', '{\"applicant_msgs_v2_live\": true}')",
      "create table zip_points (zip text primary key, city text not null, state text not null default 'MO', lat double precision not null, lon double precision not null)",
      "insert into zip_points values ('65802','Springfield','MO',37.2133,-93.2994), ('65714','Nixa','MO',37.0434,-93.2950)",
      "create table screening_settings (id int primary key default 1, office_zip text not null default '65802', review_miles int not null default 45, far_miles int not null default 90)",
      "insert into screening_settings (id) values (1)",
      """create table early_interest (id bigint generated always as identity primary key, created_at timestamptz not null default now(), site text not null,
         kind text not null, name text not null, email text, phone text, zip text, for_whom text, interests text[], timing text, experience text,
         message text, may_contact boolean not null default false, source text)""",
    ]: s.run(stmt)
    def load(path, strip_alter=False, strip_mine=False):
        t = open(path).read()
        if strip_alter: t = re.sub(r"^alter table .*$", "", t, flags=re.M)
        if strip_mine: t = re.sub(r"create or replace function interview_mine[\s\S]*?end \$\$;", "", t)
        t = re.sub(r"^notify .*$", "", t, flags=re.M)
        s.execute_simple(t)
    load(os.path.join(HERE, "noshow_policy.sql"), strip_alter=True)
    s.run("alter table job_applicants add column if not exists noshow_at timestamptz")
    load(os.path.join(hub, "interview-limits.sql"), strip_mine=True)
    load(os.path.join(HERE, "interview_person_461.sql"))
    load(os.path.join(HERE, "interview_first_choice_512.sql"))
    load(os.path.join(HERE, "screening_gate_586.sql"))
    s.run("create table auth_identities (person_id uuid, auth_user_id uuid)")
    s.run("create table staff_roles (person_id uuid, entity text, role text)")
    s.run(f"insert into auth_identities values ('00000000-0000-4000-8000-00000000b0b0', '{OFFICE}')")
    s.run("insert into staff_roles values ('00000000-0000-4000-8000-00000000b0b0', 'cc_ihs', 'owner_admin')")
    s.run("""create function public.hub_office_ok() returns boolean language sql stable security definer as $$
      select exists (select 1 from public.auth_identities ai join public.staff_roles r on r.person_id = ai.person_id
        where ai.auth_user_id::text = nullif(current_setting('request.jwt.claim.sub', true), '') and r.entity = 'cc_ihs'
          and r.role in ('owner_admin','care_coordinator','staffing_coordinator')) $$""")
    d_ = s.run("select pg_get_functiondef('public.applicant_screen_by_office(uuid,boolean,boolean,boolean,boolean,boolean)'::regprocedure)")[0][0]
    s.execute_simple(d_.replace("if coalesce(auth.role(),'anon') <> 'authenticated' then raise exception 'sign in first'; end if;",
                                "if not public.hub_office_ok() then raise exception 'office staff only'; end if;"))
    load(os.path.join(HERE, "one_year_731.sql"))
    # the screen as live: recruit-screening's miles + trigger, screen_fix's applicant_screen and trigger columns
    s.execute_simple("""create or replace function public.miles_between(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
      returns numeric language sql immutable as $$ select round((3958.8 * 2 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2)
        + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2))))::numeric, 1) $$;
      create or replace function public.applicant_screen_trigger() returns trigger language plpgsql security definer set search_path = public as $$
      begin
        if new.completed_at is not null or new.decline_reason is not null then perform public.applicant_screen(new.id); end if;
        return null;
      end $$;""")
    sf = open(os.path.join(HERE, "screen_fix.sql")).read()
    s.execute_simple(re.search(r"CREATE OR REPLACE FUNCTION public\.applicant_screen\(p_id uuid\).*?\$function\$;", sf, re.S).group(0))
    s.execute_simple(re.search(r"drop trigger if exists applicant_screen_after.*?applicant_screen_trigger\(\);", sf, re.S).group(0))
    return s, sock

def as_anon(s):
    s.run("select set_config('request.jwt.claims', '{\"role\":\"anon\"}', false), set_config('request.jwt.claim.role', 'anon', false), set_config('request.jwt.claim.sub', '', false)")
def as_office(s):
    s.run(f"""select set_config('request.jwt.claims', '{{"sub":"{OFFICE}","role":"authenticated","email":"office@example.invalid"}}', false),
              set_config('request.jwt.claim.role', 'authenticated', false), set_config('request.jwt.claim.sub', '{OFFICE}', false)""")
