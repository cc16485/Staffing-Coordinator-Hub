# Rehearses the 586 Desktop step (install, re-run, a refused install, undo) against a throwaway local Postgres with the
# booking rules as they are live (noshow_policy + interview-limits + 461 + 512) and made-up applicants.
#   HUB=../cc-hub-live python3 screening_gate_586_install_test.py
import os, glob, re, tempfile, subprocess, sys
import pgserver
from pg8000.native import Connection
HERE = os.path.dirname(os.path.abspath(__file__)); HUB = os.environ.get("HUB", os.path.join(HERE, "..", "cc-hub-live"))
d = tempfile.mkdtemp(prefix="i586_"); srv = pgserver.get_server(d)
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
     completed_at timestamptz, age_ok boolean, work_auth boolean, has_transport boolean, position text, prn jsonb, gave_up_at timestamptz, channel text)""",
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
# an interview booked before 586 by someone who never answered (it must stay exactly as it is)
old = s.run("insert into job_applicants (first_name, status) values ('Early', 'new') returning id")[0][0]
s.run("insert into interview_bookings (applicant_id, starts_at, ends_at) values (:a, now() + interval '2 days', now() + interval '2 days 30 minutes')", a=old)
before = s.run("select id, starts_at from interview_bookings where applicant_id = :a", a=old)[0]

def run(mode="install", extra=None):
    rep = tempfile.mktemp(suffix=".txt")
    env = dict(os.environ, SB_REPORT=rep, SB_LOCAL_SOCK=sock, SB_REPO=HERE, SB_MODE=mode, SB_SAVE=tempfile.mkdtemp(prefix="save586_"), **(extra or {}))
    p = subprocess.run([sys.executable, os.path.join(HERE, "screening_gate_586_install.py")], env=env, capture_output=True, text=True)
    out = open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr
    return p.returncode, out

res = []
ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[-900:]))
c1, o1 = run()
ck("install: finishes clean", c1 == 0 and "586 COMPLETE" in o1, o1)
for line in ["live booking functions are exactly what this was built on", "the screening rule is in", "someone who stopped after step 1 can't book",
             "their link takes them back to the questions", "someone who finished with three yeses can book", "someone who said no can't book",
             "a booking written straight into the table is refused", "the public can't use the office's answer screen",
             "an answer already given can't be changed", "the office can fill in missing answers", "nothing made-up was left behind"]:
    ck("install proves: " + line, ("✓ " + line) in o1 or line in o1 and "✗ " + line not in o1, o1)
ck("install: the interview booked before 586 is marked to stay (1)", "marked to stay as they are: 1" in o1, o1)
now = s.run("select id, starts_at, status from interview_bookings where applicant_id = :a", a=old)
ck("install: that interview is untouched (same row, same time, still booked)", len(now) == 1 and now[0][0] == before[0] and now[0][1] == before[1] and now[0][2] == "booked", now)
ck("install: the made-up applicants are gone", s.run("select count(*) from job_applicants where email like 'proof-586-%'")[0][0] == 0)
ck("install: no names or keys in the report", "Proof" not in o1 and "Fivethree" not in o1 and "sbp_" not in o1)
c2, o2 = run()
ck("re-run: recognises it is already in, proves again, finishes clean", c2 == 0 and "already 586" in o2 and "586 COMPLETE" in o2, o2)
c3, o3 = run(extra={"SB_PINS": '{"screening_gate_586.sql": "0000"}'})
ck("a file that isn't the reviewed one: stops before anything", c3 == 2 and "is not the reviewed version" in o3 and "PART 2" not in o3, o3)
c4, o4 = run("undo")
ck("undo: the booking functions are back exactly as before 586", c4 == 0 and "back exactly as before 586" in o4 and "both 586 guards are gone" in o4, o4)
ck("undo: booking works again as before (the early interview is still there)", s.run("select count(*) from interview_bookings where applicant_id = :a and status = 'booked'", a=old)[0][0] == 1)
s.run("create or replace function public.interview_mine(p_applicant uuid) returns json language sql as $$ select 'null'::json $$")
c5, o5 = run()
ck("someone changed the live booking functions since: stops, changes nothing", c5 == 3 and "aren't the ones this was built on" in o5 and "PART 2" not in o5, o5)
ck("...and nothing 586 was installed", s.run("select count(*) from pg_proc where proname = 'applicant_screening_gap'")[0][0] == 0)
for n, ok, note in res: print(("PASS  " if ok else "FAIL  ") + n + ("" if ok else "\n" + note))
p = sum(1 for _, ok, _ in res if ok); print(f"ALL {len(res)} CHECKS PASS" if p == len(res) else f"{len(res) - p} OF {len(res)} FAILED")
raise SystemExit(0 if p == len(res) else 1)
