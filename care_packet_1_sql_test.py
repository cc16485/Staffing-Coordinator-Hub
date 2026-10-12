# 660 · the caregiver packet tables on a real local Postgres set up like production (the project's default privileges hand
# every new table to the browser roles, so the revoke must hold). Runs the change, the installer's topic insert and proof
# queries, a second run (refused cleanly by "already there" in the installer, and harmless here), and the undo.
# python3 care_packet_1_sql_test.py
import os, json, glob, shutil, tempfile
import pgserver
from pg8000.native import Connection, DatabaseError
HERE = os.path.dirname(os.path.abspath(__file__))
D = tempfile.mkdtemp(prefix="supg-"); shutil.rmtree(D, ignore_errors=True); os.makedirs(D)
srv = pgserver.get_server(D)
host = [kv[5:] for kv in srv.get_uri().split("?", 1)[1].split("&") if kv.startswith("host=")][0]
SOCK = [p for p in glob.glob(os.path.join(host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
conn = lambda: Connection(user="postgres", database="postgres", unix_sock=SOCK)
lit = lambda v: "null" if v is None else "'" + str(v).replace("'", "''") + "'"
res = []
def ck(n, cond, d=""): res.append((n, bool(cond), "" if cond else str(d)[:500]))
c = conn()
c.run("drop schema if exists public cascade; create schema public")
for r in ("anon", "authenticated", "service_role"):
    try: c.run(f"create role {r}")
    except DatabaseError: pass
c.run("alter role service_role bypassrls")
c.run("grant usage on schema public to anon, authenticated, service_role")
c.run("alter default privileges in schema public grant all on tables to anon, authenticated, service_role")
c.run("alter default privileges in schema public grant all on sequences to anon, authenticated, service_role")
CHANGE, BACK = (open(os.path.join(HERE, f)).read() for f in ("care_packet_1.sql", "care_packet_1_rollback.sql"))
seed = json.load(open(os.path.join(HERE, "care_topics_seed.json")))
c.run(CHANGE)
ck("the change runs", c.run("select to_regclass('public.care_packets') is not null")[0][0])
rows = ",\n".join("(%s, %s, %s, %s::jsonb, true, 'install-660')" % (lit(t["key"]), lit(t["title"]), lit(t["notes"]), lit(json.dumps(t["videos"]))) for t in seed)
c.run(f"insert into public.care_topics (key, title, notes, videos, active, updated_by) values\n{rows}\non conflict (key) do nothing")
ck(f"the installer's insert puts in all {len(seed)} topics, notes and videos intact", c.run("select count(*) from public.care_topics")[0][0] == len(seed)
   and c.run("select videos->0->>'url' from public.care_topics where key='purewick_male'")[0][0] == "https://vimeo.com/968970613"
   and "1800 mL" in c.run("select notes from public.care_topics where key='purewick_male'")[0][0])
for role in ("anon", "authenticated"):
    for t in ("care_topics", "care_packets", "care_packet_recipients", "care_packet_acks"):
        ck(f"{role} holds no rights on {t}", not any(c.run(f"select has_table_privilege('{role}','public.{t}','{p}')")[0][0] for p in ("select", "insert", "update", "delete")))
    cc = conn(); cc.run("begin"); cc.run(f"set local role {role}")
    try: cc.run("select * from public.care_packets"); ck(f"{role} reading packets is refused", False)
    except DatabaseError: ck(f"{role} reading packets is refused", True)
    cc.close()
ck("row security on for all four", c.run("select bool_and(relrowsecurity) from pg_class where oid in ('public.care_topics'::regclass,'public.care_packets'::regclass,'public.care_packet_recipients'::regclass,'public.care_packet_acks'::regclass)")[0][0])
# the function's writes, as the service role
s = conn(); s.run("begin"); s.run("set local role service_role")
pid = s.run("insert into public.care_packets (client_key, axiscare_client_id, client_first, about, items, ready) values ('ax:900','900','Dan','On hospice','[{\"topic\":\"turning\",\"notes\":\"\"}]'::jsonb, true) returning id")[0][0]
s.run("insert into public.care_packet_recipients (id, packet_id, caregiver_axiscare_id, caregiver_name) values ('pl_AAAAAAAAAAAAAAAAAAAA', :p, '11', 'Ariel Smith')", p=pid)
s.run("insert into public.care_packet_acks (recipient_id, packet_id, version) values ('pl_AAAAAAAAAAAAAAAAAAAA', :p, 1)", p=pid)
s.run("commit")
ck("the function (service role) writes a packet, a recipient and a confirmation", c.run("select count(*) from public.care_packet_acks")[0][0] == 1)
for bad_sql, name in [("insert into public.care_packets (client_key) values ('Dan Smith')", "a client key that is not ax:/lead: is refused"),
                      ("insert into public.care_packets (client_key) values ('ax:900')", "a second packet for the same client is refused"),
                      ("insert into public.care_packet_recipients (id, packet_id, caregiver_axiscare_id, caregiver_name) values ('pl_short', '%s', '12', 'X')" % pid, "a malformed recipient id is refused"),
                      ("insert into public.care_packet_recipients (id, packet_id, caregiver_axiscare_id, caregiver_name) values ('pl_BBBBBBBBBBBBBBBBBBBB', '%s', '11', 'Ariel again')" % pid, "a second row for the same caregiver and packet is refused"),
                      ("insert into public.care_topics (key, title) values ('Bad Key', 'x')", "a bad topic key is refused"),
                      ("insert into public.care_topics (key, title, videos) values ('ok_key', 'x', '{}'::jsonb)", "topic videos must be a list")]:
    try: c.run(bad_sql); ck(name, False)
    except DatabaseError: ck(name, True)
# a second run of the change is harmless (the installer refuses before it anyway)
c.run(CHANGE); ck("running the change twice keeps the data", c.run("select count(*) from public.care_packets")[0][0] == 1 and c.run("select count(*) from public.care_topics")[0][0] == len(seed))
c.run(BACK)
ck("the undo removes all four tables", c.run("select count(*) from pg_class where relname in ('care_topics','care_packets','care_packet_recipients','care_packet_acks') and relkind='r'")[0][0] == 0)
c.close(); srv.cleanup() if hasattr(srv, "cleanup") else None
for n, okk, d in res: print(("PASS " if okk else "FAIL ") + n + (("\n     " + d) if d else ""))
bad = [x for x in res if not x[1]]; print(f"\n{len(res) - len(bad)}/{len(res)} passed"); raise SystemExit(1 if bad else 0)
