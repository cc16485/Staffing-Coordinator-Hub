# Automatic sending per client + keeping confirmations after a small fix, on a real local Postgres set up like production
# (660, 661, 674 library columns): new columns only, every client starts by hand, existing rows untouched, a second run is
# harmless, browser roles still locked out, the undo keeps confirmations counted. Also the 676 library additions: the
# sit-to-stand topic arrives waiting, the two extra Hoyer videos are appended waiting, nothing approved changes, twice is harmless.
# python3 care_packet_5_sql_test.py
import os, glob, shutil, tempfile, json
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
rd = lambda f: open(os.path.join(HERE, f)).read()
for f in ("care_packet_1.sql", "care_packet_2.sql", "care_packet_3.sql", "care_packet_4.sql"): c.run(rd(f))
seed = json.loads(rd("care_library_seed.json"))
lit = lambda v: "null" if v is None else "'" + str(v).replace("'", "''") + "'"
c.run("insert into public.care_topics (key, title, category, flag, notes, review_note, videos, active, pending) values " + ",".join("(%s, %s, %s, %s, %s, %s, %s::jsonb, true, true)" % (lit(t["key"]), lit(t["title"]), lit(t["category"]), lit(t["flag"]), lit(t["notes"]), lit(t["review_note"]), lit(json.dumps(t["videos"]))) for t in seed))
pid = c.run("insert into public.care_packets (client_key, client_first, ready, version) values ('ax:297','Dan',true,5) returning id")[0][0]
c.run("insert into public.care_packet_recipients (id, packet_id, caregiver_axiscare_id, caregiver_name, ack_version, ack_at) values ('pl_AAAAAAAAAAAAAAAAAAAA', :p, '11', 'Ariel Smith', 4, now())", p=pid)
c.run("insert into public.care_packet_acks (recipient_id, packet_id, version, at) values ('pl_AAAAAAAAAAAAAAAAAAAA', :p, 4, now())", p=pid)
S5 = rd("care_packet_5.sql"); c.run(S5)
ck("every client starts set to send by hand", c.run("select auto_send from public.care_packets")[0][0] is False)
ck("Ariel's row and her confirmation are untouched (still version 4, nothing carried)", c.run("select ack_version, ack_carried_from from public.care_packet_recipients")[0] == [4, None])
c.run("insert into public.care_packet_acks (recipient_id, packet_id, version, at, carried_from, carried_by) values ('pl_AAAAAAAAAAAAAAAAAAAA', :p, 5, now(), 4, 'samantha@mo-care.com')", p=pid)
c.run("update public.care_packet_recipients set ack_version = 5, ack_carried_from = 4, ack_carried_by = 'samantha@mo-care.com'")
ck("a carried-over confirmation saves with who and from which version", c.run("select ack_version, ack_carried_from, ack_carried_by from public.care_packet_recipients")[0] == [5, 4, 'samantha@mo-care.com'] and c.run("select count(*) from public.care_packet_acks")[0][0] == 2)
c.run("update public.care_packets set auto_send = true, auto_send_by = 'samantha@mo-care.com', auto_send_at = now()")
c.run(S5); ck("running it twice is harmless", c.run("select auto_send from public.care_packets")[0][0] is True)
ck("browser roles still hold no rights", not any(c.run(f"select has_table_privilege('{r}','public.{t}','{p}')")[0][0] for r in ("anon", "authenticated") for t in ("care_packets", "care_packet_acks", "care_packet_recipients") for p in ("select", "update")))
# the 676 library additions (the installer's exact statements)
add = json.loads(rd("care_library_seed_2.json"))
q_add = "insert into public.care_topics (key, title, category, flag, notes, review_note, videos, active, pending, updated_by) values " + ",".join("(%s, %s, %s, %s, %s, %s, %s::jsonb, true, true, 'install-676')" % (lit(t["key"]), lit(t["title"]), lit(t["category"]), lit(t["flag"]), lit(t["notes"]), lit(t["review_note"]), lit(json.dumps(t["videos"]))) for t in add["add"]) + " on conflict (key) do nothing"
q_app = ";\n".join("update public.care_topics t set videos = t.videos || coalesce((select jsonb_agg(v) from jsonb_array_elements(%s::jsonb) v where not exists (select 1 from jsonb_array_elements(t.videos) o where o->>'url' = v->>'url')), '[]'::jsonb) where t.key = %s" % (lit(json.dumps(vs)), lit(k)) for k, vs in add["append_videos"].items())
before = c.run("select jsonb_array_length(videos) from public.care_topics where key = 'hoyer'")[0][0]
for _ in range(2): c.run(q_add); c.run("begin; " + q_app + "; commit;")
st = c.run("select category, pending, active, jsonb_array_length(videos), flag from public.care_topics where key = 'sit_to_stand_lift'")[0]
ck("sit-to-stand lift arrives in Moving and falls, waiting for her OK, with 3 videos and the Medicaid lift rule", st[:4] == ['moving', True, True, 3] and 'Medicaid' in st[4], st)
ck("Hoyer gets the 2 extra videos once (a second run adds nothing), all waiting", c.run("select jsonb_array_length(videos) from public.care_topics where key = 'hoyer'")[0][0] == before + 2
   and c.run("select count(*) from public.care_topics t, jsonb_array_elements(t.videos) v where t.key = 'hoyer' and coalesce(v->>'status','approved') = 'approved'")[0][0] == 0)
c.run(rd("care_packet_5_rollback.sql"))
cols = [r[0] for r in c.run("select column_name from information_schema.columns where table_name in ('care_packets','care_packet_recipients','care_packet_acks')")]
ck("the undo removes the new columns and keeps Ariel confirmed and both history rows", "auto_send" not in cols and "ack_carried_from" not in cols and c.run("select ack_version from public.care_packet_recipients")[0][0] == 5 and c.run("select count(*) from public.care_packet_acks")[0][0] == 2)
for n, okk, d in res: print(("PASS " if okk else "FAIL ") + n + (("\n     " + d) if d else ""))
bad = [x for x in res if not x[1]]; print(f"\n{len(res) - len(bad)}/{len(res)} passed"); raise SystemExit(1 if bad else 0)
