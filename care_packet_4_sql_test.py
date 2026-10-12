# The Care Library's "Bed-bound and hospice care" group on a real local Postgres set up like production (660, 661, the six
# Dan topics, 674's columns and researched topics): Dan's six move in, one she moved herself stays put, nothing else changes,
# a second run is harmless, an unknown group is still refused, and the undo puts each back.
# python3 care_packet_4_sql_test.py
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
rd = lambda f: open(os.path.join(HERE, f)).read()
lit = lambda v: "null" if v is None else "'" + str(v).replace("'", "''") + "'"
c.run(rd("care_packet_1.sql")); c.run(rd("care_packet_2.sql"))
old = json.loads(rd("care_topics_seed.json")); old = old if isinstance(old, list) else old["topics"]
c.run("insert into public.care_topics (key, title, notes, videos) values " + ",".join("(%s, %s, %s, %s::jsonb)" % (lit(t["key"]), lit(t["title"]), lit(t["notes"]), lit(json.dumps(t["videos"]))) for t in old))
c.run(rd("care_packet_3.sql"))
seed = json.loads(rd("care_library_seed.json"))
c.run("insert into public.care_topics (key, title, category, flag, notes, review_note, videos, active, pending) values " + ",".join("(%s, %s, %s, %s, %s, %s, %s::jsonb, true, true)" % (lit(t["key"]), lit(t["title"]), lit(t["category"]), lit(t["flag"]), lit(t["notes"]), lit(t["review_note"]), lit(json.dumps(t["videos"]))) for t in seed))
c.run("update public.care_topics set category = 'signs' where key = 'commode'")   # she moved this one herself
q = "select key, category, pending, active, approved_by, flag, notes, videos::text from public.care_topics"
before = {r[0]: r[1:] for r in c.run(q)}
S4 = rd("care_packet_4.sql"); c.run(S4)
after = {r[0]: r[1:] for r in c.run(q)}
bb = sorted(k for k, v in after.items() if v[0] == "bedbound")
ck("Dan's topics move into Bed-bound and hospice care", bb == sorted(["hospice_basics", "turning", "skin", "brief_in_bed", "purewick_male"]), bb)
ck("a topic she moved herself stays where she put it", after["commode"][0] == "signs", after["commode"])
ck("no researched topic moves (bed bath stays in Personal care)", after["bed_bath"][0] == "personal" and all(after[t["key"]][0] == t["category"] for t in seed))
ck("nothing else changes: waiting/approved, rules, notes, videos", all(before[k][1:] == after[k][1:] for k in before))
c.run(S4); ck("running it twice is harmless", sorted(k for k, v in {r[0]: r[1:] for r in c.run(q)}.items() if v[0] == "bedbound") == bb)
try: c.run("update public.care_topics set category = 'junk' where key = 'skin'"); ck("an unknown group is still refused", False)
except DatabaseError: ck("an unknown group is still refused", True)
ck("browser roles still hold no rights", not any(c.run(f"select has_table_privilege('{r}','public.care_topics','{p}')")[0][0] for r in ("anon", "authenticated") for p in ("select", "update")))
c.run(rd("care_packet_4_rollback.sql"))
rb = {r[0]: r[1] for r in c.run("select key, category from public.care_topics")}
ck("the undo puts each back in its starting group", rb["hospice_basics"] == "conditions" and rb["turning"] == "moving" and rb["skin"] == "personal" and rb["purewick_male"] == "personal" and rb["commode"] == "signs", rb)
for n, okk, d in res: print(("PASS " if okk else "FAIL ") + n + (("\n     " + d) if d else ""))
bad = [x for x in res if not x[1]]; print(f"\n{len(res) - len(bad)}/{len(res)} passed"); raise SystemExit(1 if bad else 0)
