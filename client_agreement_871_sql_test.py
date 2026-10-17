# 871 · the client agreement table, private bucket and file guard on a real local Postgres set up like production (the
# project's default privileges hand every new table to the browser roles, so the revoke must hold). A small stand-in
# storage schema plays Supabase Storage. Runs the change, the function's writes as the service role, a second run, and
# the undo. python3 client_agreement_871_sql_test.py
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
c.run("alter role service_role bypassrls")
c.run("grant usage on schema public, storage to anon, authenticated, service_role")
c.run("grant all on all tables in schema storage to service_role")
c.run("grant all on all sequences in schema storage to service_role")
c.run("alter default privileges in schema public grant all on tables to anon, authenticated, service_role")
c.run("alter default privileges in schema public grant all on sequences to anon, authenticated, service_role")
CHANGE, BACK = (open(os.path.join(HERE, f)).read() for f in ("client_agreement_871.sql", "client_agreement_871_rollback.sql"))
c.run(CHANGE)
ck("the change runs", c.run("select to_regclass('public.client_agreements') is not null")[0][0])
for role in ("anon", "authenticated"):
    ck(f"{role} holds no rights on client_agreements", not any(c.run(f"select has_table_privilege('{role}','public.client_agreements','{p}')")[0][0] for p in ("select", "insert", "update", "delete")))
    cc = conn(); cc.run("begin"); cc.run(f"set local role {role}")
    try: cc.run("select * from public.client_agreements"); ck(f"{role} reading agreements is refused", False)
    except DatabaseError: ck(f"{role} reading agreements is refused", True)
    cc.close()
ck("row security is on", c.run("select relrowsecurity from pg_class where oid = 'public.client_agreements'::regclass")[0][0])
b = c.run("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'client-agreements'")
ck("the bucket is private, 15 MB, PNG and PDF only", b and b[0][0] is False and b[0][1] == 15728640 and sorted(b[0][2]) == ["application/pdf", "image/png"], b)
SHA = "d2c6df31fd5bcca031916a31355dfff0321a0c68c4c8445fb41d9ab9350b93f9"
s = conn(); s.run("begin"); s.run("set local role service_role")
aid = s.run(f"insert into public.client_agreements (axiscare_client_id, version, pdf_sha256, office, created_by) values ('296', 'Rev. 10/2026', '{SHA}', '{{\"answers\":{{}}}}'::jsonb, 'kr@mo-care.com') returning id")[0][0]
s.run("update public.client_agreements set status = 'signed', client_sign = '{\"typed_name\":\"Edward Anderson\"}'::jsonb, signed_at = now() where id = :i", i=aid)
s.run("insert into storage.objects (bucket_id, name) values ('client-agreements', 'signed/296/x.pdf'), ('other', 'tmp.png')")
s.run("commit")
ck("the function (service role) writes and signs an agreement", c.run("select status from public.client_agreements where id = :i", i=aid)[0][0] == "signed")
for bad_sql, name in [("insert into public.client_agreements (axiscare_client_id, version, pdf_sha256) values ('Ed', 'v1x', '%s')" % SHA, "a client id that is not an AxisCare number is refused"),
                      ("insert into public.client_agreements (axiscare_client_id, version, pdf_sha256) values ('296', 'v1x', 'abc')", "a bad document fingerprint is refused"),
                      ("update public.client_agreements set status = 'approved'", "an unknown status is refused"),
                      ("update public.client_agreements set answers = '[]'::jsonb", "answers must be an object"),
                      ("delete from storage.objects where bucket_id = 'client-agreements'", "a signed file cannot be deleted"),
                      ("update storage.objects set name = 'renamed.pdf' where bucket_id = 'client-agreements'", "a signed file cannot be renamed")]:
    try: c.run(bad_sql); ck(name, False)
    except DatabaseError: ck(name, True)
c.run("delete from storage.objects where bucket_id = 'other'")
ck("files in other buckets are untouched by the guard", c.run("select count(*) from storage.objects where bucket_id = 'other'")[0][0] == 0)
c.run(CHANGE); ck("running the change twice keeps the data and the bucket", c.run("select count(*) from public.client_agreements")[0][0] == 1 and c.run("select count(*) from storage.buckets")[0][0] == 1)
c.run(BACK)
ck("the undo removes the table and the guard, leaves the bucket and its files", c.run("select to_regclass('public.client_agreements') is null")[0][0]
   and c.run("select count(*) from storage.objects where bucket_id = 'client-agreements'")[0][0] == 1 and c.run("select count(*) from storage.buckets")[0][0] == 1)
c.run("delete from storage.objects where bucket_id = 'client-agreements'")
ck("after the undo, nothing blocks clean-up", c.run("select count(*) from storage.objects")[0][0] == 0)
c.close(); srv.cleanup() if hasattr(srv, "cleanup") else None
bad = [r for r in res if not r[1]]
for n, ok, d in res: print(("PASS " if ok else "FAIL ") + n + ("\n     " + d if d else ""))
print(f"\n{len(res) - len(bad)}/{len(res)} passed"); raise SystemExit(1 if bad else 0)
