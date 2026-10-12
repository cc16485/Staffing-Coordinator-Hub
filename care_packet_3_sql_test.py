# Care Library columns on a real local Postgres set up like production: 660's and 661's changes first, the six approved
# topics, then this change, a second run (harmless), the group check, browser roles still locked out, and the undo
# retiring anything still waiting for her OK before the columns go.
# python3 care_packet_3_sql_test.py
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
S1, S2, S3, B3 = (open(os.path.join(HERE, f)).read() for f in ("care_packet_1.sql", "care_packet_2.sql", "care_packet_3.sql", "care_packet_3_rollback.sql"))
c.run(S1); c.run(S2)
for k, t in (("turning", "Turning and repositioning"), ("commode", "Bedside commode"), ("brief_in_bed", "Changing a brief in bed"), ("skin", "Skin checks and bed sores"),
             ("purewick_male", "PureWick for men (male external catheter)"), ("hospice_basics", "Caring for someone on hospice")):
    c.run("insert into public.care_topics (key, title, videos) values (:k, :t, :v::jsonb)", k=k, t=t, v=json.dumps([{"title": "v", "url": "https://www.youtube.com/watch?v=6M5_eTPUWpo"}]))
c.run(S3)
cols = [r[0] for r in c.run("select column_name from information_schema.columns where table_name='care_topics'")]
ck("the six columns are added", all(x in cols for x in ("category", "flag", "pending", "approved_by", "approved_at", "review_note")), cols)
rows = {r[0]: r[1:] for r in c.run("select key, category, pending, active, jsonb_array_length(videos) from public.care_topics")}
ck("the six she approved stay approved and offered, videos untouched", all(v[1] is False and v[2] is True and v[3] == 1 for v in rows.values()) and len(rows) == 6, rows)
ck("each lands in its group", rows["turning"][0] == "moving" and rows["commode"][0] == "personal" and rows["purewick_male"][0] == "personal" and rows["hospice_basics"][0] == "conditions", rows)
ck("the PureWick topic carries her program rule", "Medicaid" in c.run("select flag from public.care_topics where key='purewick_male'")[0][0])
c.run(S3); ck("running the change twice is harmless", c.run("select count(*) from public.care_topics where category='other'")[0][0] == 0)
try: c.run("update public.care_topics set category='junk' where key='skin'"); ck("an unknown group is refused", False)
except DatabaseError: ck("an unknown group is refused", True)
ck("browser roles still hold no rights", not any(c.run(f"select has_table_privilege('{r}','public.care_topics','{p}')")[0][0] for r in ("anon", "authenticated") for p in ("select", "update", "insert")))
c.run("insert into public.care_topics (key, title, category, pending) values ('gait_belt', 'Using a gait belt', 'moving', true)")
c.run(B3)
cols = [r[0] for r in c.run("select column_name from information_schema.columns where table_name='care_topics'")]
ck("the undo removes the columns, keeps every topic, and retires the one still waiting (never offered without her OK)",
   "pending" not in cols and c.run("select count(*) from public.care_topics")[0][0] == 7 and c.run("select active from public.care_topics where key='gait_belt'")[0][0] is False
   and c.run("select count(*) from public.care_topics where active")[0][0] == 6)
for n, okk, d in res: print(("PASS " if okk else "FAIL ") + n + (("\n     " + d) if d else ""))
bad = [x for x in res if not x[1]]; print(f"\n{len(res) - len(bad)}/{len(res)} passed"); raise SystemExit(1 if bad else 0)
