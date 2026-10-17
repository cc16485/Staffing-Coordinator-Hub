# 874 · the sign-from-home links table on a real local Postgres: hashes only, one live link per agreement, phone or
# email, closed to browsers, and the undo. python3 agreement_links_874_sql_test.py
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
c.run(open(os.path.join(HERE, "agreement_copy_873.sql")).read())
aid = c.run("select id from public.client_agreements limit 1")[0][0]
CHANGE, BACK = (open(os.path.join(HERE, f)).read() for f in ("agreement_links_874.sql", "agreement_links_874_rollback.sql"))
c.run(CHANGE); c.run(CHANGE)
ck("the links table is in (a second run changes nothing)", c.run("select to_regclass('public.client_agreement_links') is not null")[0][0])
H = lambda ch: ch * 64
def ins(extra="", h="a", to_phone="'4178637309'", to_email="null", channels="array['sms']"):
    c.run(f"insert into public.client_agreement_links (agreement_id, token_hash, to_name, to_phone, to_email, channels, sent_by, expires_at {',' if extra else ''}{extra.split('=')[0] if extra else ''}) values (:a, :h, 'Nancy Anderson', {to_phone}, {to_email}, {channels}, 'kr@mo-care.com', now() + interval '7 days' {',' if extra else ''}{extra.split('=')[1] if extra else ''})", a=aid, h=H(h))
ins()
try: ins(h="b"); ck("only one live link per agreement", False)
except DatabaseError: ck("only one live link per agreement", True)
c.run("update public.client_agreement_links set revoked_at = now(), revoked_by = 'kr'"); ins(h="b")
ck("a cancelled link makes room for a new one", c.run("select count(*) from public.client_agreement_links")[0][0] == 2)
c.run("update public.client_agreement_links set revoked_at = now() where revoked_at is null")
for why, kw in (("the secret must be a SHA-256 hash, never the secret itself", dict(h="z")), ("a phone must be 10 digits", dict(h="c", to_phone="'417-863'")),
                ("a link needs a phone or an email", dict(h="d", to_phone="null")), ("only text and email", dict(h="e", channels="array['fax']"))):
    try:
        if kw.get("h") == "z": c.run("insert into public.client_agreement_links (agreement_id, token_hash, to_name, to_phone, channels, sent_by, expires_at) values (:a, 'pL-Y5CyZWDovmYgOw8ant1Xf8DCEh9YKZPL5DgNrjU4', 'Nancy', '4178637309', array['sms'], 'kr', now())", a=aid)
        else: ins(**kw)
        ck(why, False)
    except DatabaseError: ck(why, True)
for role in ("anon", "authenticated"):
    ck(f"{role} holds no rights on the links table", not any(c.run(f"select has_table_privilege('{role}','public.client_agreement_links','{p}')")[0][0] for p in ("select", "insert", "update", "delete")))
ck("row security is on", c.run("select relrowsecurity from pg_class where oid = 'public.client_agreement_links'::regclass")[0][0])
c.run(BACK); ck("undo: the table is gone, the agreement stays", c.run("select to_regclass('public.client_agreement_links') is null")[0][0] and c.run("select count(*) from public.client_agreements")[0][0] == 1)
c.close(); srv.cleanup() if hasattr(srv, "cleanup") else None
bad = [r for r in res if not r[1]]
for n, ok, d in res: print(("PASS " if ok else "FAIL ") + n + ("\n     " + d if d else ""))
print(f"\n{len(res) - len(bad)}/{len(res)} passed"); raise SystemExit(1 if bad else 0)
