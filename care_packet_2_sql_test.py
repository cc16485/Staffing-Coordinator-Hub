# 661 · the step 2 send columns on a real local Postgres set up like production: 660's tables first, then the change, a
# second run (harmless), the browser roles still locked out, the check on last_send_kind, and the undo keeping step 1.
# python3 care_packet_2_sql_test.py
import os, glob, shutil, tempfile
import pgserver
from pg8000.native import Connection, DatabaseError
HERE = os.path.dirname(os.path.abspath(__file__))
D = tempfile.mkdtemp(prefix="supg-"); shutil.rmtree(D, ignore_errors=True); os.makedirs(D)
srv = pgserver.get_server(D)
host = [kv[5:] for kv in srv.get_uri().split("?", 1)[1].split("&") if kv.startswith("host=")][0]
SOCK = [p for p in glob.glob(os.path.join(host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
c = Connection(user="postgres", database="postgres", unix_sock=SOCK)
res = []
def ck(n, cond, d=""): res.append((n, bool(cond), "" if cond else str(d)[:400]))
c.run("drop schema if exists public cascade; create schema public")
for r in ("anon", "authenticated", "service_role"):
    try: c.run(f"create role {r}")
    except DatabaseError: pass
c.run("alter default privileges in schema public grant all on tables to anon, authenticated, service_role")
S1, S2, B2 = (open(os.path.join(HERE, f)).read() for f in ("care_packet_1.sql", "care_packet_2.sql", "care_packet_2_rollback.sql"))
c.run(S1)
pid = c.run("insert into public.care_packets (client_key, client_first, ready) values ('ax:900','Dan',true) returning id")[0][0]
c.run("insert into public.care_packet_recipients (id, packet_id, caregiver_axiscare_id, caregiver_name) values ('pl_AAAAAAAAAAAAAAAAAAAA', :p, '11', 'Ariel Smith')", p=pid)
c.run(S2)
cols = [r[0] for r in c.run("select column_name from information_schema.columns where table_name='care_packet_recipients' order by column_name")]
ck("the five columns are added", all(x in cols for x in ("last_sent_at", "last_sent_by", "last_send_kind", "last_send_id", "send_count")), cols)
ck("the existing caregiver row keeps everything, send_count 0 and nothing texted", c.run("select caregiver_name, send_count, last_sent_at from public.care_packet_recipients")[0] == ['Ariel Smith', 0, None])
c.run("update public.care_packet_recipients set last_sent_at=now(), last_send_kind='reminder', send_count=2")
ck("the function's send record saves", c.run("select last_send_kind, send_count from public.care_packet_recipients")[0] == ['reminder', 2])
try: c.run("update public.care_packet_recipients set last_send_kind='spam'"); ck("an unknown text kind is refused", False)
except DatabaseError: ck("an unknown text kind is refused", True)
c.run(S2); ck("running the change twice is harmless", c.run("select send_count from public.care_packet_recipients")[0][0] == 2)
ck("browser roles still hold no rights", not any(c.run(f"select has_table_privilege('{r}','public.care_packet_recipients','{p}')")[0][0] for r in ("anon", "authenticated") for p in ("select", "update")))
c.run(B2)
cols = [r[0] for r in c.run("select column_name from information_schema.columns where table_name='care_packet_recipients'")]
ck("the undo removes the five columns and keeps the caregiver row", "send_count" not in cols and c.run("select count(*) from public.care_packet_recipients")[0][0] == 1)
for n, okk, d in res: print(("PASS " if okk else "FAIL ") + n + (("\n     " + d) if d else ""))
bad = [x for x in res if not x[1]]; print(f"\n{len(res) - len(bad)}/{len(res)} passed"); raise SystemExit(1 if bad else 0)
