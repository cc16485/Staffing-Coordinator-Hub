# 873 · the family-copy column on a real local Postgres: added empty, never null or a list, still closed to browsers, and
# the undo. python3 agreement_copy_873_sql_test.py
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
c.run(open(os.path.join(HERE, "agreement_contacts_872.sql")).read())
c.run("insert into public.client_agreements (axiscare_client_id, version, pdf_sha256) values ('296', 'Rev. 10/2026', repeat('a',64))")
CHANGE, BACK = (open(os.path.join(HERE, f)).read() for f in ("agreement_copy_873.sql", "agreement_copy_873_rollback.sql"))
c.run(CHANGE)
ck("the copies column is added, empty for the agreement already there", c.run("select copies::text from public.client_agreements")[0][0] == "{}")
c.run(CHANGE); ck("a second run changes nothing", c.run("select count(*) from information_schema.columns where table_name='client_agreements' and column_name='copies'")[0][0] == 1)
for bad_v in ("null", "'[1]'::jsonb"):
    try: c.run(f"update public.client_agreements set copies = {bad_v}"); ck(f"copies can never be {bad_v}", False)
    except DatabaseError: ck(f"copies can never be {bad_v}", True)
c.run("""update public.client_agreements set copies = '{"emails":[{"to":"a@b.co"}],"print_path":"x"}'::jsonb""")
ck("the agreement table is still closed to the browser roles", not any(c.run(f"select has_table_privilege('{r}','public.client_agreements','select')")[0][0] for r in ("anon", "authenticated")))
c.run(BACK); ck("undo: the column is gone, the agreement stays", c.run("select count(*) from information_schema.columns where table_name='client_agreements' and column_name='copies'")[0][0] == 0 and c.run("select count(*) from public.client_agreements")[0][0] == 1)
c.close(); srv.cleanup() if hasattr(srv, "cleanup") else None
bad = [r for r in res if not r[1]]
for n, ok, d in res: print(("PASS " if ok else "FAIL ") + n + ("\n     " + d if d else ""))
print(f"\n{len(res) - len(bad)}/{len(res)} passed"); raise SystemExit(1 if bad else 0)
