#!/usr/bin/env python3
# Gate 4b · proof of the people-going-into-care INSTALLER on a disposable Postgres (real Journey foundation, fact record,
# Gate 4a people, the Family Circle and its link door). Never touches production.
import os, sys, json, hashlib, subprocess, shutil, tempfile
H = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(H, "client_fact_install_proof.py")).read()
exec(compile(src[:src.index("def run(")], "cluster", "exec"))
KSQL = os.path.join(H, "people-into-care.sql"); KSHA = hashlib.sha256(open(KSQL, "rb").read()).hexdigest()
FIX = os.path.join(H, "client-fact-care-began-fix.sql"); PPL = os.path.join(H, "journey-people.sql")
res = []
def ck(n, c, note=""): res.append((n, bool(c), "" if c else str(note)[:600]))
def runp(script, mig, sha, sock):
    rep = tempfile.mktemp()
    p = subprocess.run([sys.executable, os.path.join(H, script)], capture_output=True, text=True,
        env=dict(os.environ, SB_MIGFILE=mig, SB_EXPECTED_SHA=sha, SB_REPORT=rep, SB_LOCAL_SOCK=sock, SB_SKIP_FUNCTION="1"))
    return p.returncode, open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr
def psqlf(sock, path):
    host = os.path.dirname(sock); port = sock.rsplit(".", 1)[1]
    b = os.path.join(os.path.dirname(pgserver.__file__), "pginstall", "bin", "psql")
    return subprocess.run([b, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", host, "-p", port, "-U", "postgres", "-d", "postgres", "-f", path], capture_output=True, text=True)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
d, srv, sock, s = cluster()
runp("client_fact_install.py", SQL, SHA, sock); runp("care_began_fix_install.py", FIX, sha(FIX), sock)
rc, out = runp("journey_people_install.py", PPL, sha(PPL), sock); assert rc == 0, out
rc, out = runp("people_into_care_install.py", KSQL, KSHA, sock)
ck("before the Family Circle exists: stops, nothing changed", rc == 4 and "✗ the Family Circle tables" in out, out)
s.run("create table care_circles (id uuid primary key default gen_random_uuid(), client_name text not null, active boolean default true)")
s.run("""create table circle_contacts (id bigserial primary key, circle_id text not null, name text not null, relationship text, phone text, email text,
         sms_consent boolean default false, is_primary boolean default false, wants_changes boolean default true, source text default 'office', axiscare_list_number int,
         hipaa_authorized boolean, can_make_medical_decisions boolean)""")
p = psqlf(sock, os.path.join(H, "family-circles-link.sql")); assert p.returncode == 0, p.stderr[-300:]
# a converted inquiry whose AxisCare client the hub knows
s.run("insert into person_identity (id, display_name) values ('00000000-0000-0000-0000-0000000000a1','Proof Client')")
s.run("insert into person_source_id (person_id, system, entity_type, source_id) values ('00000000-0000-0000-0000-0000000000a1','axiscare','client','801')")
s.run("""update app_data set data = data || '[{"id":"L9","first_name":"Pat","last_name":"Proof","relationship":"daughter","phone":"4175550900",
         "client_first_name":"Proof","client_last_name":"Client","client_phone":"4175550901","axiscare_client_id":"801"}]'::jsonb where key='leads'""")
s.run("set role service_role"); s.run("select public.episode_open_provisional(p_origin_system => 'lead', p_origin_ref => 'L9')"); s.run("reset role")
rc, out = runp("people_into_care_install.py", KSQL, "0" * 64, sock); ck("a file that isn't the proven build: stops", rc == 2, out)
s.run("alter table circle_contacts add column org_id text not null default 'x'"); s.run("alter table circle_contacts alter column org_id drop default")
rc, out = runp("people_into_care_install.py", KSQL, KSHA, sock)
ck("a required circle column the door would leave empty: stops and names it, nothing changed", rc == 4 and "org_id" in out
   and not s.run("select count(*) from information_schema.columns where table_name='circle_contacts' and column_name='carried_from'")[0][0], out)
s.run("alter table circle_contacts drop column org_id")
rc, out = runp("people_into_care_install.py", KSQL, KSHA, sock)
ck("the real run: every line is a ✓", rc == 0 and "✗" not in out and "RESULT: INSTALLED" in out, out)
ck("…the client went into a Family Circle with texts off, the caller without a yes was refused, and nothing was kept",
   "the client was added to their Family Circle with texts off" in out and "permission needed" in out
   and s.run("select count(*) from circle_contacts")[0][0] == 0 and s.run("select count(*) from care_circles")[0][0] == 0, out)
rc, out = runp("people_into_care_install.py", KSQL, KSHA, sock); ck("running it again: stops (already installed)", rc == 4 and "✗ not installed yet" in out, out)
print(out if "--show" in sys.argv else "", end="")
s.close(); srv.cleanup(); shutil.rmtree(d, ignore_errors=True)
for n, ok, note in res: print(("PASS" if ok else "FAIL") + " · " + n + ("" if ok else "  ::  " + note))
print(f"{sum(1 for r in res if r[1])}/{len(res)}")
print("people-into-care.sql sha256", KSHA)
for fn in ("family-circles", "client-convert"):
    print(fn + "/index.ts sha256", sha(os.path.join(H, "supabase/functions", fn, "index.ts")))
