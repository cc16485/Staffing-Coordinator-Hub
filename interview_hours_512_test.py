#!/usr/bin/env python3
# Rehearsal of 512 from a FRESH copy of this repository, against a fake Supabase Management API that runs every query in a
# REAL Postgres (PGlite) seeded like the live project: Krystal interviewing M-F 8-5 (plus her assessment hours), the 461
# booking rule, and the live open-times rules (open_slots_live_510b.sql). Never touches a real project.
#   PGLITE=<path to @electric-sql/pglite> python3 interview_hours_512_test.py
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); PG = os.environ.get("PGLITE")
if not PG: print("SKIP: set PGLITE to run against a real Postgres"); sys.exit(0)
BASE = os.environ.get("HUB_BASE") or "1057735dd9423c85c311c05c0ab423d90e4db955"   # the base 512 pins
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
tmp = tempfile.mkdtemp(prefix="t512-"); RUN = os.path.join(tmp, "pgrun.mjs")
open(RUN, "w").write("""import fs from 'fs'
const { PGlite } = await import(process.env.PGLITE + '/dist/index.js')
const db = new PGlite(process.env.PGDIR)
let q = fs.readFileSync(0, 'utf8').replace(/^\\s*notify [^;]*;\\s*$/gim, '')
try {
  const multi = (q.match(/;\\s*\\S/g) || []).length > 0 || /^\\s*(do|begin)\\b/i.test(q)
  const r = multi ? (await db.exec(q)).filter(x => x && x.rows).pop() || { rows: [] } : await db.query(q)
  process.stdout.write(JSON.stringify(r.rows))
} catch (e) { process.stdout.write(JSON.stringify({ err: e.message })) }
""")
STATE = {"dir": None}; SEEN = []
def pg(q, d=None):
    p = subprocess.run(["node", RUN], input=q, capture_output=True, text=True, env=dict(os.environ, PGLITE=PG, PGDIR=d or STATE["dir"]))
    try: return json.loads(p.stdout or "[]")
    except Exception: return {"err": (p.stdout or p.stderr)[:300]}
SEED = """create role anon; create role authenticated;
create table coordinators (id uuid primary key default gen_random_uuid(), name text, active boolean default true);
create table coordinator_availability (id serial primary key, coordinator_id uuid, activity text, day_of_week int, start_time time, end_time time, active boolean default true);
create table coordinator_busy (id serial, coordinator_id uuid, starts_at timestamptz, ends_at timestamptz, source text, source_id text, label text);
create table activity_types (key text, label text, minutes int, per_slot int, lead_hours int, horizon_days int, self_book boolean);
insert into activity_types values ('interview','Interview',30,1,20,14,true);
insert into coordinators (id, name) values ('00000000-0000-4000-8000-0000000000a1', 'Krystal');
insert into coordinator_availability (coordinator_id, activity, day_of_week, start_time, end_time)
  select '00000000-0000-4000-8000-0000000000a1', 'interview', d, '08:00', '17:00' from generate_series(1,5) d
  union all select '00000000-0000-4000-8000-0000000000a1', 'assessment', d, '08:00', '13:00' from generate_series(1,5) d;
"""
def fresh(extra=""):
    d = tempfile.mkdtemp(prefix="db512-", dir=tmp); STATE["dir"] = d
    for q in (SEED + extra, open(os.path.join(HERE, "interview_first_choice_512_rollback.sql")).read(), open(os.path.join(HERE, "open_slots_live_510b.sql")).read()):
        r = pg(q); assert not (isinstance(r, dict) and r.get("err")), r
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); q = json.loads(self.rfile.read(n))["query"]; SEEN.append(q)
        r = pg(q)
        if isinstance(r, dict) and r.get("err"): b = json.dumps({"message": r["err"]}).encode(); self.send_response(400)
        else: b = json.dumps(r).encode(); self.send_response(201)
        self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
WH = os.path.join(tmp, "wt"); subprocess.run(["git", "worktree", "add", "-q", "--detach", WH, "HEAD"], cwd=HERE, check=True)
SQLSHA, RBSHA = sha(os.path.join(HERE, "interview_first_choice_512.sql")), sha(os.path.join(HERE, "interview_first_choice_512_rollback.sql"))
def run(yes="yes", **over):
    SEEN.clear(); rep = os.path.join(tmp, "r.txt")
    if os.path.exists(rep): os.unlink(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_API_BASE=URL, SB_REPO=WH, SB_BASE=BASE, SB_SQL_SHA=SQLSHA, SB_RB_SHA=RBSHA, SB_YES=yes)
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(WH, "interview_hours_512.py")], env=env, capture_output=True, text=True, stdin=subprocess.DEVNULL, start_new_session=True)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
q1 = lambda q: pg(q)
fresh(); rc, r = run(); print(r)
ck("DONE from a fresh copy: the rule, the hours and the order in one go", rc == 0 and "RESULT: DONE" in r and "✗" not in r, r)
hrs = q1("select c.name, a.activity, a.day_of_week d, a.start_time::text st, a.end_time::text en from coordinator_availability a join coordinators c on c.id=a.coordinator_id order by 1,2,3")
iv = [(x["name"], x["d"], x["st"], x["en"]) for x in hrs if x["activity"] == "interview"]
ck("Krystal interviews M-F 8:30-1:30 and Samantha 10:00-4:30 (no other interview hours)", sorted(iv) == sorted([("Krystal", d, "08:30:00", "13:30:00") for d in range(1, 6)] + [("Samantha", d, "10:00:00", "16:30:00") for d in range(1, 6)]), iv)
ck("Krystal's assessment hours are untouched", len([x for x in hrs if x["activity"] == "assessment"]) == 5)
od = {x["name"]: x["booking_order"] for x in q1("select name, booking_order from coordinators")}
ck("booking order: Krystal 1, Samantha 2 (Samantha added, active)", od == {"Krystal": 1, "Samantha": 2}, od)
ck("the live booking rule is the 512 one", "coalesce(c.booking_order, 1000)" in q1("select prosrc from pg_proc where proname='interview_book'")[0]["prosrc"])
ck("the proof reads open times inside 8:30-4:30 with both free from 10 to 1:30", "✓ every open time is between 8:30am and 4:30pm" in r, r)
ck("nothing is booked, sent or deleted beyond the interview hours", not any(re.search(r"insert into public\.interview_bookings|send|delete from public\.(?!coordinator_availability)", qq) for qq in SEEN if "create or replace function" not in qq.lower()), [qq[:100] for qq in SEEN])
ck("no keys or tokens in the report", not re.search(r"eyJ|sbp_", r), r)
rc, r = run(); ck("run again: already this build, still DONE, nothing doubled", rc == 0 and "already this build" in r and "RESULT: DONE" in r and len(q1("select 1 from coordinators where name='Samantha'")) == 1, r)
fresh(); rc, r = run(yes="no")
ck("no yes: nothing changed at all", "nothing was changed" in r and q1("select count(*)::int n from coordinators")[0]["n"] == 1 and "booking_order" not in json.dumps(q1("select column_name from information_schema.columns where table_name='coordinators'")), r)
fresh(); pg("create or replace function interview_book(p_applicant uuid, p_starts timestamptz) returns uuid language plpgsql as $$ begin return null; end $$;")
rc, r = run(); ck("a booking rule changed by hand: stops, nothing changed", rc != 0 and "isn't the one this was built on" in r and q1("select count(*)::int n from coordinators")[0]["n"] == 1, r)
fresh("insert into coordinators (name) values ('Krystal B');")
rc, r = run(); ck("two Krystals: stops, nothing changed (it won't guess)", rc != 0 and "expected one Krystal" in r, r)
fresh(); rc, r = run(SB_SQL_SHA="0" * 64); ck("a rule file that isn't the reviewed one: stops before anything", rc != 0 and "not the reviewed build" in r and not SEEN, r)
H.shutdown(); subprocess.run(["git", "worktree", "remove", "--force", WH], cwd=HERE); shutil.rmtree(tmp, ignore_errors=True)
for n, ok, note in res: print(("PASS " if ok else "FAIL ") + n + ("" if ok else "\n      " + note))
print("ALL %d CHECKS PASS" % len(res) if all(x[1] for x in res) else "FAILED"); sys.exit(0 if all(x[1] for x in res) else 1)
