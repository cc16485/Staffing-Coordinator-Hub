# 872 · the Stage 2 database change on a real local Postgres: the running-late switch (added once, everyone's current
# choice carried over, never reset by a second run), the link from a Family Circle member back to the agreement (no
# duplicates), the review column, and the undo. python3 agreement_contacts_872_sql_test.py
import os, glob, shutil, tempfile
import pgserver
from pg8000.native import Connection, DatabaseError
HERE = os.path.dirname(os.path.abspath(__file__))
D = tempfile.mkdtemp(prefix="supg-"); shutil.rmtree(D, ignore_errors=True); os.makedirs(D)
srv = pgserver.get_server(D)
host = [kv[5:] for kv in srv.get_uri().split("?", 1)[1].split("&") if kv.startswith("host=")][0]
SOCK = [p for p in glob.glob(os.path.join(host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
conn = lambda: Connection(user="postgres", database="postgres", unix_sock=SOCK)
res = []
def ck(n, cond, d=""): res.append((n, bool(cond), "" if cond else str(d)[:500]))
c = conn()
c.run("drop schema if exists public cascade; create schema public")
c.run("drop schema if exists storage cascade; create schema storage")
c.run("create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[])")
c.run("create table storage.objects (id bigserial primary key, bucket_id text, name text)")
for r in ("anon", "authenticated", "service_role"):
    try: c.run(f"create role {r}")
    except DatabaseError: pass
c.run("grant usage on schema public, storage to anon, authenticated, service_role")
c.run(open(os.path.join(HERE, "client_agreement_871.sql")).read())
c.run("""create table public.circle_contacts (id bigserial primary key, circle_id uuid, name text, phone text, sms_consent boolean default false,
  wants_changes boolean default true, wants_general boolean default true, stopped_at timestamptz)""")
c.run("insert into public.circle_contacts (name, sms_consent, wants_changes) values ('Linda', true, true), ('Wes', true, false), ('Sue', false, null)")
CHANGE, BACK = (open(os.path.join(HERE, f)).read() for f in ("agreement_contacts_872.sql", "agreement_contacts_872_rollback.sql"))
c.run(CHANGE)
got = dict(c.run("select name, wants_late from public.circle_contacts"))
ck("running-late switch added with everyone's current choice: Linda on, Wes (no caregiver-change texts) off, Sue on as before", got == {"Linda": True, "Wes": False, "Sue": True}, got)
ck("the switch can never be empty", c.run("select is_nullable from information_schema.columns where table_name='circle_contacts' and column_name='wants_late'")[0][0] == "NO")
c.run("update public.circle_contacts set wants_late = true where name = 'Wes'")
c.run(CHANGE)
ck("a second run never resets anyone (Wes turned running-late texts on: stays on)", c.run("select wants_late from public.circle_contacts where name='Wes'")[0][0] is True)
c.run("insert into public.circle_contacts (name) values ('New')")
ck("a person added later starts with running-late texts allowed (texting consent still decides)", c.run("select wants_late, sms_consent from public.circle_contacts where name='New'")[0] == [True, False])
aid = c.run("insert into public.client_agreements (axiscare_client_id, version, pdf_sha256) values ('296', 'Rev. 10/2026', repeat('a',64)) returning id")[0][0]
c.run("update public.circle_contacts set from_agreement = :a, from_agreement_n = 1 where name = 'Linda'", a=aid)
try: c.run("update public.circle_contacts set from_agreement = :a, from_agreement_n = 1 where name = 'Sue'", a=aid); ck("the same contact of one agreement cannot become two members", False)
except DatabaseError: ck("the same contact of one agreement cannot become two members", True)
try: c.run("update public.circle_contacts set from_agreement = gen_random_uuid(), from_agreement_n = 2 where name = 'Sue'"); ck("a member can only point at a real agreement", False)
except DatabaseError: ck("a member can only point at a real agreement", True)
try: c.run("update public.circle_contacts set from_agreement = :a, from_agreement_n = 5 where name = 'Sue'", a=aid); ck("contact numbers are 1 to 4", False)
except DatabaseError: ck("contact numbers are 1 to 4", True)
c.run("""update public.client_agreements set contacts_review = '{"people":{}}'::jsonb""")
try: c.run("update public.client_agreements set contacts_review = '[1]'::jsonb"); ck("the review must be a record (object)", False)
except DatabaseError: ck("the review must be a record (object)", True)
ck("the agreement table is still closed to the browser roles", not any(c.run(f"select has_table_privilege('{r}','public.client_agreements','select')")[0][0] for r in ("anon", "authenticated")))
c.run(BACK)
cols = [r[0] for r in c.run("select column_name from information_schema.columns where table_name in ('circle_contacts','client_agreements')")]
ck("undo: the new columns are gone, the people stay", not {"wants_late", "from_agreement", "from_agreement_n", "contacts_review"} & set(cols) and c.run("select count(*) from public.circle_contacts")[0][0] == 4, cols)
c.run(CHANGE)
ck("after an undo the change can run again (switch re-added from wants_changes)", dict(c.run("select name, wants_late from public.circle_contacts"))["Wes"] is False)
c.close(); srv.cleanup() if hasattr(srv, "cleanup") else None
bad = [r for r in res if not r[1]]
for n, ok, d in res: print(("PASS " if ok else "FAIL ") + n + ("\n     " + d if d else ""))
print(f"\n{len(res) - len(bad)}/{len(res)} passed"); raise SystemExit(1 if bad else 0)
