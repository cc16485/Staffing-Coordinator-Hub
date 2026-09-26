#!/usr/bin/env python3
# Stage 2 v2 Journey foundation · disposable-Postgres proof. Never touches production.
import os, re, shutil, glob, json, subprocess, threading, time, hashlib
import pgserver
from pg8000.native import Connection, DatabaseError

H = os.path.dirname(os.path.abspath(__file__))
MIG_PATH = os.path.join(H, "journey-foundation-v2.sql")
MIG = open(MIG_PATH).read()
RB = open(os.path.join(H, "journey-foundation-v2-rollback.sql")).read()
PHASEA = open(os.path.join(H, "journey-episode-phaseA.sql")).read()
FPSQL = open(os.path.join(H, "journey-foundation-v2-fingerprint.sql")).read()
PSQL = os.path.join(os.path.dirname(pgserver.__file__), "pginstall", "bin", "psql")

RESULTS = []
def ck(name, cond, note=""):
    RESULTS.append((name, bool(cond), note if not cond else ""))

# ----------------------------------------------------------------------------- cluster
class Cluster:
    def __init__(self, tag):
        self.dir = os.path.join(H, "pgtest_v2_" + tag)
        shutil.rmtree(self.dir, ignore_errors=True); os.makedirs(self.dir)
        self.srv = pgserver.get_server(self.dir)
        q = self.srv.get_uri().split("?", 1)[1]
        self.host = [kv[5:] for kv in q.split("&") if kv.startswith("host=")][0]
        self.sock = [p for p in glob.glob(os.path.join(self.host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
        self.port = self.sock.rsplit(".", 1)[1]
        self.su = self.conn()

    def conn(self, role=None):
        c = Connection(user="postgres", database="postgres", unix_sock=self.sock)
        if role: c.run(f"set role {role}")
        return c

    def psql(self, text):
        f = os.path.join(self.dir, "_script.sql"); open(f, "w").write(text)
        p = subprocess.run([PSQL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-h", self.host, "-p", self.port,
                            "-U", "postgres", "-d", "postgres", "-f", f], capture_output=True, text=True)
        return p.returncode, (p.stderr or "") + (p.stdout or "")

    def close(self):
        try: self.su.close()
        except Exception: pass
        self.srv.cleanup(); shutil.rmtree(self.dir, ignore_errors=True)

def setup_supabase_like(cl):
    s = cl.su
    for r in ["anon", "authenticated"]:
        s.run(f"do $$ begin create role {r} nologin; exception when duplicate_object then null; end $$;")
    s.run("do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;")
    s.run("grant usage on schema public to anon, authenticated, service_role")
    # Supabase's default privileges: ALL on new public objects to the API roles
    s.run("alter default privileges in schema public grant all on tables to anon, authenticated, service_role")
    s.run("alter default privileges in schema public grant all on sequences to anon, authenticated, service_role")
    s.run("alter default privileges in schema public grant all on functions to anon, authenticated, service_role")
    # identity layer (mirrors identity-layer.sql grants)
    s.run("create table person_identity (id uuid primary key default gen_random_uuid(), display_name text)")
    s.run("create table person_source_id (id bigserial primary key, person_id uuid references person_identity(id), "
          "system text, entity_type text, source_id text, confidence text default 'confirmed')")
    for t in ["person_identity", "person_source_id"]:
        s.run(f"revoke all on {t} from anon"); s.run(f"grant select on {t} to authenticated"); s.run(f"grant all on {t} to service_role")
    # data that lives OUTSIDE the Journey foundation and must never change
    s.run("create table client_queue (id uuid primary key default gen_random_uuid(), axiscare_client_id text, episode_n int, status text)")
    s.run("insert into client_queue (axiscare_client_id, episode_n, status) values ('AX1',1,'complete'),('AX2',1,'pending')")
    s.run("create table app_data (key text primary key, data jsonb)")
    s.run("""insert into app_data values ('leads','[{"id":"L-100"}]'),('client_status_log','[{"id":"latest","map":{"AX2":"Active"}}]')""")
    s.run("create function outside_fn() returns int language sql as $$ select 42 $$")
    persons = {}
    for i in range(1, 13):
        pid = s.run("insert into person_identity (display_name) values (:n) returning id", n=f"P{i}")[0][0]
        persons[i] = str(pid)
    return persons

JOURNEY_TABLES = ["journey_episode", "episode_fact", "episode_source", "episode_review", "episode_door_audit"]
JOURNEY_VIEWS = ["episode_fact_current", "episode_range", "episode_order", "journey_episode_current"]

FIXTURES = ["person_identity", "person_source_id"]   # the tests themselves add rows here
def outside_fp(cl, fixture_data=True):
    s = cl.su
    tabs = [r[0] for r in s.run("select table_name from information_schema.tables where table_schema='public' "
                                "and table_name <> all(:j) order by 1", j=JOURNEY_TABLES + JOURNEY_VIEWS)]
    parts = []
    for t in tabs:
        cols = s.run("select string_agg(column_name||':'||data_type||':'||coalesce(column_default,''), ',' order by ordinal_position) "
                     "from information_schema.columns where table_schema='public' and table_name=:t", t=t)[0][0]
        data = "fixture" if (not fixture_data and t in FIXTURES) else \
               s.run(f'select md5(coalesce(string_agg(x::text, \'|\' order by x::text), \'\')) from public."{t}" x')[0][0]
        parts.append(f"{t}|{cols}|{data}")
    fns = s.run("select string_agg(p.oid::regprocedure::text||':'||md5(p.prosrc), ',' order by 1) from pg_proc p "
                "join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' "
                "and p.proname not like 'episode\\_%' escape '\\' and p.proname not like 'journey\\_%' escape '\\'")[0][0]
    return hashlib.md5(("\n".join(parts) + "\n" + (fns or "")).encode()).hexdigest()

def journey_fp(cl):
    return cl.su.run(FPSQL)[0][0]

def counts(cl):
    out = {}
    for t in JOURNEY_TABLES:
        out[t] = cl.su.run(f"select count(*) from public.{t}")[0][0] if cl.su.run(
            "select to_regclass(:t) is not null", t="public." + t)[0][0] else None
    return out

def has_obj(cl, name):
    return cl.su.run("select to_regclass(:n) is not null", n="public." + name)[0][0]

def has_col(cl, table, col):
    return cl.su.run("select count(*) from information_schema.columns where table_schema='public' "
                     "and table_name=:t and column_name=:c", t=table, c=col)[0][0] > 0

# ----------------------------------------------------------------------------- Door calls
UUID_KEYS = {"p_person_id", "p_episode_id", "p_other_episode_id", "p_supersedes_fact_id", "p_corrected_into", "p_review_id"}
DATE_KEYS = {"p_began_on", "p_ended_on", "p_began_not_before", "p_began_not_after", "p_end_on", "p_end_not_before",
             "p_end_not_after", "p_on_date", "p_not_before", "p_not_after"}
AUDITED_OK = {}
def door(c, fn, **kw):
    args = []
    for k in kw:
        if k in UUID_KEYS: args.append(f"{k} => cast(:{k} as uuid)")
        elif k in DATE_KEYS: args.append(f"{k} => cast(:{k} as date)")
        else: args.append(f"{k} => :{k}")
    r = c.run(f"select public.{fn}({', '.join(args)})", **kw)[0][0]
    return r if isinstance(r, dict) else json.loads(r)

def err_code(fn):
    try:
        fn(); return None
    except DatabaseError as e:
        d = e.args[0] if e.args and isinstance(e.args[0], dict) else {}
        return d.get("C", "ERR") + " " + str(d.get("M", ""))[:240]

def row_snapshot(c, eid):
    return c.run("select row_to_json(e)::text from public.journey_episode e where episode_id = cast(:e as uuid)", e=eid)[0][0]

# =============================================================================
# CLUSTER 1 · production-like: Phase A deployed, then v2
# =============================================================================
cl = Cluster("main")
P = setup_supabase_like(cl)
rc, out = cl.psql("begin;\n" + PHASEA + "\ncommit;\n")
ck("setup · Phase A foundation installed (production starting state)", rc == 0 and has_col(cl, "journey_episode", "seq"), out[-300:])
OUT0 = outside_fp(cl)
OUT0_DEF = outside_fp(cl, fixture_data=False)
FPA = journey_fp(cl)

# --- empty-foundation guard, Phase A tables -------------------------------------
cl.su.run("insert into episode_door_audit (op, outcome) values ('void','test row')")
rc, out = cl.psql(MIG)
ck("guard · a row in Phase A episode_door_audit aborts the migration", rc != 0 and "refused" in out, out[-300:])
ck("guard · after refusal, Phase A is byte-identical and the row remains",
   journey_fp(cl) == FPA and cl.su.run("select count(*) from episode_door_audit")[0][0] == 1)
cl.su.run("delete from episode_door_audit")
cl.su.run("insert into journey_episode (state) values ('provisional')")
rc, out = cl.psql(MIG)
ck("guard · a row in Phase A journey_episode aborts the migration", rc != 0 and "refused" in out, out[-300:])
ck("guard · after refusal, nothing changed", journey_fp(cl) == FPA and has_col(cl, "journey_episode", "seq"))
cl.su.run("delete from journey_episode")

# --- atomic failure -----------------------------------------------------------------
broken = MIG.replace("-- 9. SELF-CHECK", "select 1/0;  -- injected failure\n-- 9. SELF-CHECK", 1)
rc, out = cl.psql(broken)
ck("atomic · failure injected after all objects are built rolls everything back",
   rc != 0 and journey_fp(cl) == FPA and not has_obj(cl, "episode_fact") and has_col(cl, "journey_episode", "seq"), out[-200:])
failing_check = MIG.replace("  if bad <> '' then\n    raise exception 'journey_foundation_v2 self-check failed:%', bad;",
                            "  if true then\n    raise exception 'journey_foundation_v2 self-check failed:%', bad;", 1)
rc, out = cl.psql(failing_check)
ck("atomic · a failing self-check rolls everything back",
   rc != 0 and "self-check failed" in out and journey_fp(cl) == FPA and not has_obj(cl, "episode_fact"), out[-200:])
ck("atomic · data outside Journey untouched by the failed runs", outside_fp(cl) == OUT0)

# --- install ---------------------------------------------------------------------------
rc, out = cl.psql(MIG)
ck("install · v2 migration succeeds on the empty Phase A foundation", rc == 0, out[-400:])
F1 = journey_fp(cl)
ck("install · Phase A seq column is gone", not has_col(cl, "journey_episode", "seq"))
ck("install · data outside Journey untouched", outside_fp(cl) == OUT0)

rc, out = cl.psql(MIG)
ck("rerun · on an empty v2 install it succeeds with an identical fingerprint", rc == 0 and journey_fp(cl) == F1, out[-300:])

# --- single definition of "active" ----------------------------------------------------------
lit = "in ('provisional','open','converted','established')"
ck("active-state · the active set is written exactly once in the migration", MIG.count(lit) == 1, str(MIG.count(lit)))
srcs = cl.su.run("select p.proname, p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
                 "where n.nspname='public' and (p.proname like 'episode\\_%' escape '\\' or p.proname like 'journey\\_%' escape '\\')")
leaks = [n for n, src in srcs if n != "journey_state_is_active" and re.search(r"'converted'\s*,\s*'established'", src)]
views_def = " ".join(r[0] for r in cl.su.run("select pg_get_viewdef(c.oid) from pg_class c where c.relname = any(:v)", v=JOURNEY_VIEWS))
idx = cl.su.run("select indexdef from pg_indexes where indexname='journey_episode_one_active_uq'")[0][0]
src_of = dict(srcs)
users = ["episode_resolve", "episode_open_for_person", "episode_set_state", "journey_state_is_frozen"]
ck("active-state · index, Doors and views all use journey_state_is_active, no copies",
   not leaks and "journey_state_is_active" in idx and "journey_state_is_active" in views_def
   and "'converted'" not in views_def
   and all(("journey_state_is_active" in src_of.get(n, "") or "journey_state_is_terminal" in src_of.get(n, "")
            or "journey_state_is_frozen" in src_of.get(n, "")) for n in users)
   and "journey_state_is_active" in src_of["episode_resolve"] and "journey_state_is_active" in src_of["episode_open_for_person"],
   f"leaks={leaks}")

svc = cl.conn("service_role")

# --- 1. provisional -> resolved keeps episode_id ---------------------------------------
r = door(svc, "episode_open_provisional", p_origin_system="lead", p_origin_ref="L-100", p_began_on="2026-09-20")
E1 = r.get("episode_id")
door(svc, "episode_attach_source", p_episode_id=E1, p_system="booking", p_source_ref="BK-1", p_role="additional")
r_noprior = door(svc, "episode_resolve", p_episode_id=E1, p_person_id=P[1])
n_before = svc.run("select count(*) from journey_episode")[0][0]
r = door(svc, "episode_resolve", p_episode_id=E1, p_person_id=P[1], p_prior_history="none_found",
         p_prior_evidence="checked Hub persons and linked AxisCare ids")
row = svc.run("select person_id::text, state from journey_episode where episode_id=cast(:e as uuid)", e=E1)[0]
ck("resolve · first episode for a person needs its prior-history statement", r_noprior.get("outcome") == "prior_history_required", str(r_noprior))
ck("resolve · provisional -> resolved keeps the same episode_id and its sources",
   r.get("outcome") == "resolved" and r.get("episode_id") == E1 and row == [P[1], "open"]
   and svc.run("select count(*) from episode_source where episode_id=cast(:e as uuid)", e=E1)[0][0] == 2
   and svc.run("select count(*) from journey_episode")[0][0] == n_before, str(r))

# --- 2. baseline with prior history unobserved -------------------------------------------
r_np = door(svc, "episode_open_for_person", p_person_id=P[3], p_state="established", p_began_basis="before_observation",
            p_began_not_after="2026-09-12", p_began_evidence="Active at first observation")
r = door(svc, "episode_open_for_person", p_person_id=P[2], p_state="established", p_began_basis="before_observation",
         p_began_not_after="2026-09-12",
         p_began_evidence="Active at first observation (client_status_log baseline, not a durable record)",
         p_prior_history="unobserved", p_prior_evidence="already in care when observation began")
A = r.get("episode_id")
cur = svc.run("select prior_history_status, began_lo::text, lifetime_ordinal, lifetime_ordinal_reason "
              "from journey_episode_current where episode_id=cast(:e as uuid)", e=A)[0]
ck("baseline · opening a person's first lifecycle without a prior-history statement is refused",
   r_np.get("outcome") == "prior_history_required", str(r_np))
ck("baseline · established episode with prior history UNOBSERVED and an open-ended start",
   r.get("outcome") == "opened" and cur[0] == "unobserved" and cur[1] == "-infinity", str(cur))
ck("no fake numbering · no seq column, and the baseline's lifetime ordinal is NULL (history not documented)",
   not has_col(cl, "journey_episode", "seq") and cur[2] is None and cur[3] == "complete history not documented", str(cur))

# --- 3. documented end freezes, atomically -------------------------------------------------
r_noend = door(svc, "episode_set_state", p_episode_id=A, p_state="ended")
state_after_noend = svc.run("select state from journey_episode where episode_id=cast(:e as uuid)", e=A)[0][0]
r = door(svc, "episode_set_state", p_episode_id=A, p_state="ended", p_end_basis="documented", p_end_on="2026-10-01",
         p_end_evidence="discharge confirmed by Client Intake")
st = svc.run("select state from journey_episode where episode_id=cast(:e as uuid)", e=A)[0][0]
nend = svc.run("select count(*) from episode_fact where episode_id=cast(:e as uuid) and fact_type='ended'", e=A)[0][0]
ck("end · a terminal state without a documented end is refused and nothing changes",
   r_noend.get("outcome") == "end_required" and state_after_noend == "established", str(r_noend))
ck("end · documented end written and episode frozen in the same call", r.get("outcome") == "state_set" and st == "ended" and nend == 1)
SNAP_A = row_snapshot(svc, A)
e_upd = err_code(lambda: svc.run("update journey_episode set needs_review = true where episode_id=cast(:e as uuid)", e=A))
ck("freeze · a direct UPDATE of the frozen row is rejected", e_upd is not None and "frozen" in e_upd, str(e_upd))
ck("freeze · Doors refuse to change, void or attach to a frozen episode",
   door(svc, "episode_set_state", p_episode_id=A, p_state="closed", p_end_basis="documented", p_end_on="2026-10-02",
        p_end_evidence="x").get("outcome") == "frozen"
   and door(svc, "episode_void", p_episode_id=A, p_reason="x").get("outcome") == "frozen"
   and door(svc, "episode_attach_source", p_episode_id=A, p_system="booking", p_source_ref="BK-9").get("outcome") == "frozen")

# --- 4. return gets a new episode_id -------------------------------------------------------
r = door(svc, "episode_open_for_person", p_person_id=P[2], p_state="open", p_began_basis="documented",
         p_began_on="2027-04-01", p_began_evidence="reactivation observed and confirmed",
         p_evidence_ref="client_status_log:tr_AX2_2027-04-01T001700Z")
B = r.get("episode_id")
order = svc.run("select count(*) from episode_order where earlier_episode_id=cast(:a as uuid) and later_episode_id=cast(:b as uuid)", a=A, b=B)[0][0]
ck("return · the same person's return is a NEW episode_id, derived after the baseline",
   r.get("outcome") == "opened" and B and B != A and order >= 1, str(r))
ck("return · the baseline row is byte-identical after the return", row_snapshot(svc, A) == SNAP_A)

# --- 5. AxisCare client id is person-level -------------------------------------------------
cl.su.run("insert into person_source_id (person_id, system, entity_type, source_id) values (cast(:p as uuid),'axiscare','client','AX2')", p=P[2])
r_ax = door(svc, "episode_attach_source", p_episode_id=B, p_system="axiscare", p_source_ref="AX2")
r_bare = door(svc, "episode_attach_source", p_episode_id=B, p_system="axiscare_observation", p_source_ref="AX2")
r_obs = door(svc, "episode_attach_source", p_episode_id=B, p_system="axiscare_observation",
             p_source_ref="tr_AX2_2027-04-01T001700Z", p_role="evidence")
both = svc.run("select count(distinct e.episode_id) from journey_episode e join person_source_id s on s.person_id = e.person_id "
               "where s.system='axiscare' and s.source_id='AX2'")[0][0]
ck("axiscare · the client id cannot be attached to an episode (person-level only)",
   r_ax.get("outcome") == "invalid_source" and r_bare.get("outcome") == "invalid_source", f"{r_ax} {r_bare}")
ck("axiscare · one person-level id reaches BOTH lifecycles through the person, stored once",
   both == 2 and cl.su.run("select count(*) from person_source_id where source_id='AX2'")[0][0] == 1
   and svc.run("select count(*) from episode_source where source_ref='AX2'")[0][0] == 0)

# --- 6. episode-source event references -----------------------------------------------------
r_dup = door(svc, "episode_attach_source", p_episode_id=E1, p_system="axiscare_observation",
             p_source_ref="tr_AX2_2027-04-01T001700Z", p_role="evidence")
r_ev = door(svc, "episode_attach_source", p_episode_id=B, p_system="axiscare_event",
            p_source_ref="ce_client_created_AX2_2026-09-01", p_role="evidence")
r_origin2 = door(svc, "episode_attach_source", p_episode_id=E1, p_system="lead", p_source_ref="L-101", p_role="origin")
ck("sources · an observation-specific reference attaches once; reusing it on another episode is refused",
   r_obs.get("outcome") == "attached" and r_dup.get("outcome") == "conflict", f"{r_obs} {r_dup}")
ck("sources · client-event references attach; a second origin on one episode is refused",
   r_ev.get("outcome") == "attached" and r_origin2.get("outcome") == "conflict", f"{r_ev} {r_origin2}")

# --- 7. one active episode per person ----------------------------------------------------------
r = door(svc, "episode_open_for_person", p_person_id=P[2], p_state="open", p_began_basis="documented",
         p_began_on="2027-05-01", p_began_evidence="second open attempt")
rev = svc.run("select count(*) from episode_review where kind='open_conflict' and person_id=cast(:p as uuid)", p=P[2])[0][0]
e_raw = err_code(lambda: svc.run("insert into journey_episode (person_id, state) values (cast(:p as uuid), 'open')", p=P[2]))
ck("one-active · a second active episode is refused by the Door and queued for review",
   r.get("outcome") == "conflict" and rev == 1, str(r))
ck("one-active · the database index blocks a second active episode even without the Door",
   e_raw is not None and e_raw.startswith("23505"), str(e_raw))

# --- 8. concurrent return attempts ----------------------------------------------------------------
def open_p(person, delay_commit=0, results=None, key=None, barrier=None):
    c = cl.conn("service_role")
    try:
        if barrier: barrier.wait()
        c.run("begin")
        out = door(c, "episode_open_for_person", p_person_id=person, p_state="established",
                   p_began_basis="before_observation", p_began_not_after="2026-09-12", p_began_evidence="race",
                   p_prior_history="unobserved", p_prior_evidence="race test")
        if delay_commit: c.run(f"select pg_sleep({delay_commit})")
        c.run("commit")
        results[key] = out.get("outcome")
    except DatabaseError as e:
        results[key] = "error " + str(e)[:80]
    finally:
        c.close()

res = {}
t1 = threading.Thread(target=open_p, args=(P[4], 1.5, res, "first"))
t1.start(); time.sleep(0.3)
t2 = threading.Thread(target=open_p, args=(P[4], 0, res, "second"))
t2.start(); t1.join(); t2.join()
nP4 = svc.run("select count(*) from journey_episode where person_id=cast(:p as uuid)", p=P[4])[0][0]
ck("concurrency · a return attempt waits on the per-person lock, then gets a conflict (1 episode)",
   res.get("first") == "opened" and res.get("second") == "conflict" and nP4 == 1, str(res))
ok_rounds = True
for i in range(5):
    pid = cl.su.run("insert into person_identity (display_name) values ('race') returning id::text")[0][0]
    res = {}; bar = threading.Barrier(2)
    ts = [threading.Thread(target=open_p, args=(pid, 0, res, k, bar)) for k in ("a", "b")]
    [t.start() for t in ts]; [t.join() for t in ts]
    n = svc.run("select count(*) from journey_episode where person_id=cast(:p as uuid)", p=pid)[0][0]
    ok_rounds &= sorted(res.values()) == ["conflict", "opened"] and n == 1
ck("concurrency · 5 simultaneous double-attempts each produce exactly one episode", ok_rounds)
res = {}
def raw_insert(key, hold):
    c = cl.conn("service_role")
    try:
        c.run("begin")
        c.run("insert into journey_episode (person_id, state) values (cast(:p as uuid), 'open')", p=P[6])
        if hold: c.run(f"select pg_sleep({hold})")
        c.run("commit"); res[key] = "ok"
    except DatabaseError as e:
        res[key] = (e.args[0].get("C") if e.args and isinstance(e.args[0], dict) else "ERR")
    finally:
        c.close()
t1 = threading.Thread(target=raw_insert, args=("a", 1.0)); t1.start(); time.sleep(0.3)
t2 = threading.Thread(target=raw_insert, args=("b", 0)); t2.start(); t1.join(); t2.join()
ck("concurrency · two raw concurrent inserts bypassing the Door: the index lets exactly one commit",
   sorted(res.values()) == ["23505", "ok"], str(res))

# --- 9. overlap protection -----------------------------------------------------------------------
r_h1 = door(svc, "episode_record_historical", p_person_id=P[7], p_began_on="2020-01-01", p_ended_on="2020-06-30",
            p_evidence="agency file", p_acting_seat="owner_decision")
H7 = r_h1.get("episode_id")
r_ovh = door(svc, "episode_record_historical", p_person_id=P[7], p_began_on="2020-03-01", p_ended_on="2020-09-01",
             p_evidence="conflicting file", p_acting_seat="owner_decision")
r_ovo = door(svc, "episode_open_for_person", p_person_id=P[7], p_state="open", p_began_basis="documented",
             p_began_on="2020-05-01", p_began_evidence="bad date")
nP7 = svc.run("select count(*) from journey_episode where person_id=cast(:p as uuid)", p=P[7])[0][0]
ck("overlap · a historical lifecycle that would overlap a known one is not created (review instead)",
   r_h1.get("outcome") == "created" and r_ovh.get("outcome") == "review" and nP7 == 1, f"{r_h1} {r_ovh}")
ck("overlap · opening a lifecycle inside a known one is refused and reviewed", r_ovo.get("outcome") == "conflict_overlap", str(r_ovo))

# --- 10. undated / ambiguous history -> review, never an episode ----------------------------------
n2 = svc.run("select count(*) from journey_episode where person_id=cast(:p as uuid)", p=P[2])[0][0]
r_und = door(svc, "episode_record_historical", p_person_id=P[2], p_evidence="family says there was care years ago",
             p_acting_seat="owner_decision")
r_half = door(svc, "episode_record_historical", p_person_id=P[2], p_began_on="2023-01-01",
              p_evidence="start date only", p_acting_seat="owner_decision")
r_seat = door(svc, "episode_record_historical", p_person_id=P[2], p_began_on="2023-01-01", p_ended_on="2023-02-01",
              p_evidence="dated, but not confirmed by Owner / Decision", p_acting_seat="client_intake")
n2b = svc.run("select count(*) from journey_episode where person_id=cast(:p as uuid)", p=P[2])[0][0]
revs = svc.run("select count(*) from episode_review where kind='historical_evidence' and seat='owner_decision' "
               "and person_id=cast(:p as uuid)", p=P[2])[0][0]
ck("history · undated, half-dated or unconfirmed history creates a review and ZERO episodes",
   [r_und.get("outcome"), r_half.get("outcome"), r_seat.get("outcome")] == ["review"] * 3 and n2b == n2 and revs == 3)

# --- 11. history before the baseline, several older, and one found in between -------------------
SNAP_B = row_snapshot(svc, B)
rH = door(svc, "episode_record_historical", p_person_id=P[2], p_began_on="2024-01-01", p_ended_on="2024-06-01",
          p_evidence="WellSky export", p_acting_seat="owner_decision")
rH0 = door(svc, "episode_record_historical", p_person_id=P[2], p_began_on="2022-01-01", p_ended_on="2022-12-31",
           p_evidence="paper file", p_acting_seat="owner_decision")
rX = door(svc, "episode_record_historical", p_person_id=P[2], p_began_on="2023-02-01", p_ended_on="2023-03-01",
          p_evidence="found between two known lifecycles", p_acting_seat="owner_decision")
rY = door(svc, "episode_record_historical", p_person_id=P[2], p_began_on="2026-12-01", p_ended_on="2027-01-15",
          p_evidence="short stay between baseline end and return", p_acting_seat="owner_decision")
Hh, H0, X, Y = rH.get("episode_id"), rH0.get("episode_id"), rX.get("episode_id"), rY.get("episode_id")
def before(a, b):
    return svc.run("select count(*) from episode_order where earlier_episode_id=cast(:a as uuid) and later_episode_id=cast(:b as uuid)",
                   a=a, b=b)[0][0] > 0
chain = [H0, X, Hh, A, Y, B]
ck("history · lifecycles found before the baseline are created and ordered before it",
   all(r.get("outcome") == "created" for r in (rH, rH0)) and before(Hh, A) and before(H0, Hh))
ck("history · a lifecycle found BETWEEN two known ones is ordered between them, nothing rewritten",
   rX.get("outcome") == "created" and rY.get("outcome") == "created"
   and all(before(chain[i], chain[i + 1]) for i in range(len(chain) - 1))
   and row_snapshot(svc, A) == SNAP_A and row_snapshot(svc, B) == SNAP_B)
ords = svc.run("select count(*) from journey_episode_current where person_id=cast(:p as uuid) and lifetime_ordinal is not null", p=P[2])[0][0]
ck("no fake numbering · with prior history unobserved, no episode of the person gets a lifetime ordinal", ords == 0)

# --- 12. lifetime ordinal ONLY when complete history is documented (derived, never stored) --------
rP8h = door(svc, "episode_record_historical", p_person_id=P[8], p_began_on="2019-01-01", p_ended_on="2019-02-01",
            p_evidence="agency record", p_acting_seat="owner_decision")
P8H = rP8h.get("episode_id")
r_ci = door(svc, "episode_record_fact", p_episode_id=P8H, p_fact_type="prior_history", p_prior_history="documented_complete",
            p_evidence="complete agency records", p_acting_seat="client_intake")
r_od = door(svc, "episode_record_fact", p_episode_id=P8H, p_fact_type="prior_history", p_prior_history="documented_complete",
            p_evidence="complete agency records reviewed", p_acting_seat="owner_decision")
rP8e = door(svc, "episode_open_for_person", p_person_id=P[8], p_state="open", p_began_basis="documented",
            p_began_on="2019-06-01", p_began_evidence="new lifecycle")
P8E = rP8e.get("episode_id")
o1 = dict(svc.run("select episode_id::text, lifetime_ordinal from journey_episode_current where person_id=cast(:p as uuid)", p=P[8]))
rP8x = door(svc, "episode_record_historical", p_person_id=P[8], p_began_on="2019-03-01", p_ended_on="2019-04-01",
            p_evidence="found between", p_acting_seat="owner_decision")
o2 = dict(svc.run("select episode_id::text, lifetime_ordinal from journey_episode_current where person_id=cast(:p as uuid)", p=P[8]))
ck("ordinal · a fact on a frozen lifecycle from Client Intake goes to Owner / Decision review",
   r_ci.get("outcome") == "review" and r_od.get("outcome") == "recorded", f"{r_ci} {r_od}")
ck("ordinal · derived 1, 2 only when documented complete history orders every lifecycle",
   o1.get(P8H) == 1 and o1.get(P8E) == 2, str(o1))
ck("ordinal · a discovered in-between lifecycle re-derives 1, 2, 3 without touching any row",
   o2.get(P8H) == 1 and o2.get(rP8x.get("episode_id")) == 2 and o2.get(P8E) == 3, str(o2))

# --- 13. append-only fact correction ----------------------------------------------------------------
old_end = svc.run("select fact_id::text from episode_fact where episode_id=cast(:e as uuid) and fact_type='ended'", e=A)[0][0]
r_ci = door(svc, "episode_record_fact", p_episode_id=A, p_fact_type="ended", p_basis="documented", p_on_date="2026-10-03",
            p_evidence="corrected discharge date", p_supersedes_fact_id=old_end, p_acting_seat="client_intake")
r_od = door(svc, "episode_record_fact", p_episode_id=A, p_fact_type="ended", p_basis="documented", p_on_date="2026-10-03",
            p_evidence="corrected discharge date (signed form)", p_supersedes_fact_id=old_end, p_acting_seat="owner_decision")
r_again = door(svc, "episode_record_fact", p_episode_id=A, p_fact_type="ended", p_basis="documented", p_on_date="2026-10-04",
               p_evidence="second correction of the same old fact", p_supersedes_fact_id=old_end, p_acting_seat="owner_decision")
ends_all = svc.run("select count(*) from episode_fact where episode_id=cast(:e as uuid) and fact_type='ended'", e=A)[0][0]
cur_end = svc.run("select on_date::text from episode_fact_current where episode_id=cast(:e as uuid) and fact_type='ended'", e=A)
ck("correction · Client Intake cannot correct frozen history; Owner / Decision can",
   r_ci.get("outcome") == "review" and r_od.get("outcome") == "recorded", f"{r_ci} {r_od}")
ck("correction · the old fact is kept, the current truth shows the correction",
   ends_all == 2 and cur_end == [["2026-10-03"]] and r_again.get("outcome") in ("invalid", "conflict"), f"{cur_end} {r_again}")
r_ov = door(svc, "episode_record_fact", p_episode_id=A, p_fact_type="ended", p_basis="documented", p_on_date="2027-05-01",
            p_evidence="would overlap the return", p_supersedes_fact_id=r_od.get("fact_id"), p_acting_seat="owner_decision")
ck("correction · a correction that would make two lifecycles overlap is refused", r_ov.get("outcome") == "conflict_overlap", str(r_ov))
e1 = err_code(lambda: svc.run("update episode_fact set evidence='x'"))
e2 = err_code(lambda: svc.run("delete from episode_fact"))
e3 = err_code(lambda: cl.su.run("update episode_fact set evidence='x'"))
e4 = err_code(lambda: cl.su.run("truncate episode_fact"))
ck("correction · facts cannot be updated, deleted or truncated (service_role denied; owner blocked by trigger)",
   all(x is not None for x in (e1, e2, e3, e4)) and e1.startswith("42501") and e2.startswith("42501"), f"{e1} | {e2} | {e3} | {e4}")
ck("freeze · the baseline row is still byte-identical after corrections", row_snapshot(svc, A) == SNAP_A)

# --- 14. void and erroneous ----------------------------------------------------------------------------
r = door(svc, "episode_open_provisional", p_origin_system="lead", p_origin_ref="L-900")
E9 = r.get("episode_id")
r_v = door(svc, "episode_void", p_episode_id=E9, p_reason="duplicate inquiry", p_corrected_into=E1)
cnt = svc.run("select counted from episode_range where episode_id=cast(:e as uuid)", e=E9)[0][0]
SNAP_H7 = row_snapshot(svc, H7)
r_er_ci = door(svc, "episode_record_fact", p_episode_id=H7, p_fact_type="erroneous", p_evidence="wrong person's file",
               p_acting_seat="client_intake")
r_er_od = door(svc, "episode_record_fact", p_episode_id=H7, p_fact_type="erroneous", p_evidence="wrong person's file",
               p_acting_seat="owner_decision")
cnt7 = svc.run("select counted from episode_range where episode_id=cast(:e as uuid)", e=H7)[0][0]
r_after = door(svc, "episode_open_for_person", p_person_id=P[7], p_state="open", p_began_basis="documented",
               p_began_on="2020-05-01", p_began_evidence="now possible", p_prior_history="none_found",
               p_prior_evidence="the only earlier record was marked erroneous")
ck("void · a voided episode is excluded from order and counting", r_v.get("outcome") == "voided" and cnt is False)
ck("void · an erroneous frozen record is excluded via an Owner / Decision fact; its row is unchanged",
   r_er_ci.get("outcome") == "review" and r_er_od.get("outcome") == "recorded" and cnt7 is False
   and row_snapshot(svc, H7) == SNAP_H7 and r_after.get("outcome") == "opened", f"{r_er_ci} {r_er_od} {r_after}")

# --- 14b. frozen episodes: supporting facts vs material changes ----------------------------------
def pairs_of(pid):
    return svc.run("select count(*) from (select distinct earlier_episode_id, later_episode_id from episode_order "
                   "where person_id=cast(:p as uuid)) x", p=pid)[0][0]
SNAP_Hh, SNAP_H0, SNAP_X = row_snapshot(svc, Hh), row_snapshot(svc, H0), row_snapshot(svc, X)
pairs_before = pairs_of(P[2])
r_sup1 = door(svc, "episode_record_fact", p_episode_id=Hh, p_fact_type="prior_history", p_prior_history="unobserved",
              p_evidence="nothing is known before this file", p_acting_seat="client_intake")
r_sup2 = door(svc, "episode_record_fact", p_episode_id=H0, p_fact_type="precedes", p_other_episode_id=X,
              p_evidence="file sequence agrees", p_acting_seat="client_intake")
ords2 = svc.run("select count(*) from journey_episode_current where person_id=cast(:p as uuid) and lifetime_ordinal is not null", p=P[2])[0][0]
ck("frozen facts · consistent supporting facts from Client Intake are recorded normally",
   r_sup1.get("outcome") == "recorded" and r_sup2.get("outcome") == "recorded", f"{r_sup1} {r_sup2}")
ck("frozen facts · supporting facts leave rows, derived order and ordinals unchanged",
   row_snapshot(svc, Hh) == SNAP_Hh and row_snapshot(svc, H0) == SNAP_H0 and row_snapshot(svc, X) == SNAP_X
   and pairs_of(P[2]) == pairs_before and ords2 == 0)
# two ended lifecycles whose order is unknown
ra = door(svc, "episode_open_for_person", p_person_id=P[10], p_state="open", p_began_basis="unknown",
          p_began_evidence="start not on record", p_prior_history="unobserved", p_prior_evidence="no history")
E10a = ra.get("episode_id")
door(svc, "episode_set_state", p_episode_id=E10a, p_state="ended", p_end_basis="observed_window",
     p_end_not_before="2025-01-01", p_end_not_after="2025-12-31", p_end_evidence="ended sometime in 2025")
rb = door(svc, "episode_open_for_person", p_person_id=P[10], p_state="open", p_began_basis="unknown",
          p_began_evidence="start not on record")
E10b = rb.get("episode_id")
door(svc, "episode_set_state", p_episode_id=E10b, p_state="ended", p_end_basis="observed_window",
     p_end_not_before="2026-01-01", p_end_not_after="2026-02-01", p_end_evidence="ended early 2026")
SNAP_10a, SNAP_10b = row_snapshot(svc, E10a), row_snapshot(svc, E10b)
unknown_before = pairs_of(P[10]) == 0
r_ord_ci = door(svc, "episode_record_fact", p_episode_id=E10a, p_fact_type="precedes", p_other_episode_id=E10b,
                p_evidence="intake notes", p_acting_seat="client_intake")
still_unknown = pairs_of(P[10]) == 0
r_ord_od = door(svc, "episode_record_fact", p_episode_id=E10a, p_fact_type="precedes", p_other_episode_id=E10b,
                p_evidence="intake notes reviewed", p_acting_seat="owner_decision")
ck("frozen facts · a NEW order between frozen lifecycles needs Owner / Decision",
   rb.get("outcome") == "opened" and unknown_before and r_ord_ci.get("outcome") == "review" and still_unknown
   and r_ord_od.get("outcome") == "recorded" and pairs_of(P[10]) == 1, f"{rb} {r_ord_ci} {r_ord_od}")
began_a = svc.run("select fact_id::text from episode_fact_current where episode_id=cast(:e as uuid) and fact_type='began'", e=E10a)[0][0]
r_bnd_ci = door(svc, "episode_record_fact", p_episode_id=E10a, p_fact_type="began", p_basis="documented", p_on_date="2024-06-01",
                p_evidence="start date found", p_supersedes_fact_id=began_a, p_acting_seat="client_intake")
r_bnd_od = door(svc, "episode_record_fact", p_episode_id=E10a, p_fact_type="began", p_basis="documented", p_on_date="2024-06-01",
                p_evidence="start date found and verified", p_supersedes_fact_id=began_a, p_acting_seat="owner_decision")
err_fact = svc.run("select fact_id::text from episode_fact_current where episode_id=cast(:e as uuid) and fact_type='erroneous'", e=H7)[0][0]
r_un_ci = door(svc, "episode_record_fact", p_episode_id=H7, p_fact_type="retract", p_supersedes_fact_id=err_fact,
               p_evidence="it was the right person after all", p_acting_seat="client_intake")
ck("frozen facts · changing an accepted boundary needs Owner / Decision",
   r_bnd_ci.get("outcome") == "review" and r_bnd_od.get("outcome") == "recorded", f"{r_bnd_ci} {r_bnd_od}")
ck("frozen facts · unmarking an erroneous record needs Owner / Decision",
   r_un_ci.get("outcome") == "review"
   and svc.run("select counted from episode_range where episode_id=cast(:e as uuid)", e=H7)[0][0] is False, str(r_un_ci))
ck("frozen facts · the frozen rows stay byte-identical through all of it",
   row_snapshot(svc, E10a) == SNAP_10a and row_snapshot(svc, E10b) == SNAP_10b and row_snapshot(svc, H7) == SNAP_H7)

# --- 15. reviews --------------------------------------------------------------------------------------
rv = svc.run("select review_id::text from episode_review where seat='owner_decision' and status='open' limit 1")[0][0]
r1 = door(svc, "episode_review_resolve", p_review_id=rv, p_status="resolved", p_resolution="checked", p_acting_seat="client_intake")
r2 = door(svc, "episode_review_resolve", p_review_id=rv, p_status="resolved", p_resolution="checked", p_acting_seat="owner_decision")
r3 = door(svc, "episode_review_resolve", p_review_id=rv, p_status="dismissed", p_resolution="again", p_acting_seat="owner_decision")
e_rv = err_code(lambda: svc.run("update episode_review set detail='{}'::jsonb where review_id=cast(:r as uuid)", r=rv))
ck("reviews · Owner / Decision items need that seat; closed reviews cannot be reopened or edited",
   r1.get("outcome") == "seat_required" and r2.get("outcome") == "resolved" and r3.get("outcome") == "already_closed"
   and e_rv is not None, f"{r1} {r2} {r3} {e_rv}")

# --- 16. frozen rows never rewritten -------------------------------------------------------------------
frozen_ids = [r[0] for r in svc.run("select episode_id::text from journey_episode where state in ('ended','closed','voided')")]
ck("freeze · every frozen row rejects a direct update",
   all(err_code(lambda e=e: svc.run("update journey_episode set needs_review = not needs_review where episode_id=cast(:e as uuid)", e=e))
       for e in frozen_ids))
e_del = err_code(lambda: cl.su.run("delete from journey_episode where episode_id=cast(:e as uuid)", e=A))
e_tr = err_code(lambda: cl.su.run("truncate journey_episode cascade"))
ck("freeze · episode rows cannot be deleted or truncated, even by the owner", e_del is not None and e_tr is not None, f"{e_del} {e_tr}")

# --- 17. browser mutation blocked -----------------------------------------------------------------------
au = cl.conn("authenticated"); an = cl.conn("anon")
reads_ok = all(err_code(lambda t=t: au.run(f"select count(*) from public.{t}")) is None
               for t in ["journey_episode", "episode_fact", "episode_source", "episode_review"] + JOURNEY_VIEWS)
audit_denied = (err_code(lambda: au.run("select count(*) from episode_door_audit")) or "").startswith("42501")
writes = {
  "insert episode": lambda: au.run("insert into journey_episode (state) values ('provisional')"),
  "update episode": lambda: au.run("update journey_episode set needs_review = true"),
  "delete episode": lambda: au.run("delete from journey_episode"),
  "insert fact":    lambda: au.run("insert into episode_fact (episode_id, fact_type, evidence, asserted_by, acting_seat) "
                                   "values (cast(:e as uuid),'erroneous','x','x','system')", e=B),
  "insert source":  lambda: au.run("insert into episode_source (episode_id, system, source_ref, role) values (cast(:e as uuid),'lead','L-9','evidence')", e=B),
  "update review":  lambda: au.run("update episode_review set status='dismissed'"),
  "insert audit":   lambda: au.run("insert into episode_door_audit (op, outcome) values ('void','x')"),
  "truncate fact":  lambda: au.run("truncate episode_fact"),
}
w_codes = {k: err_code(f) for k, f in writes.items()}
doors = ["episode_open_provisional()", f"episode_void(cast('{B}' as uuid), 'x')",
         f"episode_open_for_person(cast('{P[9]}' as uuid), 'open', 'unknown', 'x')"]
d_codes = [err_code(lambda d=d: au.run(f"select public.{d}")) for d in doors]
anon_codes = [err_code(lambda t=t: an.run(f"select count(*) from public.{t}")) for t in JOURNEY_TABLES + JOURNEY_VIEWS] + \
             [err_code(lambda: an.run("select public.episode_open_provisional()"))]
ck("browser · signed-in users can read Journey tables and views but not the audit", reads_ok and audit_denied)
ck("browser · every direct write by a signed-in user is denied",
   all(v and v.startswith("42501") for v in w_codes.values()), str(w_codes))
ck("browser · signed-in users cannot execute any Door", all(v and v.startswith("42501") for v in d_codes), str(d_codes))
ck("browser · anonymous users can read nothing and execute nothing", all(v and v.startswith("42501") for v in anon_codes), str(anon_codes))

# --- 18. Door / audit / RLS / grants ------------------------------------------------------------------------
defs = cl.su.run("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' "
                 "and (p.proname like 'episode\\_%' escape '\\' or p.proname like 'journey\\_%' escape '\\') and p.prosecdef")[0][0]
rls = cl.su.run("select bool_and(relrowsecurity) from pg_class where relname = any(:t) and relnamespace='public'::regnamespace", t=JOURNEY_TABLES)[0][0]
ops = dict(cl.su.run("select op, count(*) from episode_door_audit group by op"))
a_upd = err_code(lambda: svc.run("update episode_door_audit set detail='x'"))
a_del = err_code(lambda: cl.su.run("delete from episode_door_audit"))
ck("security · no Journey function runs as definer; RLS is on for every Journey table", defs == 0 and rls is True)
ck("audit · every Door type left audit rows", all(ops.get(o, 0) > 0 for o in
   ("open_provisional", "resolve", "open_for_person", "set_state", "record_fact", "record_historical",
    "attach_source", "void", "review_resolve")), str(ops))
ck("audit · audit rows cannot be changed or deleted (service_role denied; owner blocked)",
   a_upd is not None and a_upd.startswith("42501") and a_del is not None, f"{a_upd} {a_del}")

# --- 19. rerun / rollback with data present ------------------------------------------------------------------
C_BEFORE = counts(cl); FP_BEFORE = journey_fp(cl)
rc, out = cl.psql(MIG)
ck("rerun · with Journey rows present the migration refuses and nothing changes",
   rc != 0 and "refused" in out and counts(cl) == C_BEFORE and journey_fp(cl) == FP_BEFORE, out[-200:])
rc, out = cl.psql(RB)
ck("rollback · with Journey rows present the rollback refuses and nothing changes",
   rc != 0 and "refused" in out and counts(cl) == C_BEFORE and journey_fp(cl) == FP_BEFORE, out[-200:])
ck("outside · outside tables and all outside definitions unchanged after every step (fixture rows added by tests excluded)",
   outside_fp(cl, fixture_data=False) == OUT0_DEF)

INVENTORY = cl.su.run("""
  select 'table' k, c.relname from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname = any(:t)
  union all select 'view', c.relname from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='v' and c.relname = any(:v)
  union all select 'index', indexname from pg_indexes where schemaname='public' and tablename = any(:t)
  union all select 'trigger', tgname from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relname = any(:t) and relnamespace='public'::regnamespace)
  union all select 'function', p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and (p.proname like 'episode\\_%' escape '\\' or p.proname like 'journey\\_%' escape '\\')
  union all select 'policy', tablename||'.'||policyname from pg_policies where schemaname='public' and tablename = any(:t)
  order by 1, 2""", t=JOURNEY_TABLES, v=JOURNEY_VIEWS)
for c in (svc, au, an): c.close()
cl.close()

# =============================================================================
# CLUSTER 2 · rollback on an empty install, recovery, cross-cluster determinism
# =============================================================================
c2 = Cluster("second")
setup_supabase_like(c2)
c2.psql("begin;\n" + PHASEA + "\ncommit;\n")
OUT2 = outside_fp(c2); FPA2 = journey_fp(c2)
rc1, _ = c2.psql(MIG); F2 = journey_fp(c2)
rc2, out = c2.psql(RB)
gone = not any(has_obj(c2, t) for t in JOURNEY_TABLES + JOURNEY_VIEWS) and c2.su.run(
    "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' "
    "and (p.proname like 'episode\\_%' escape '\\' or p.proname like 'journey\\_%' escape '\\')")[0][0] == 0
ck("determinism · a fresh cluster produces the identical v2 fingerprint", rc1 == 0 and F2 == F1, f"{F2} vs {F1}")
ck("rollback · on an empty install it removes every Journey object and nothing else",
   rc2 == 0 and gone and outside_fp(c2) == OUT2, out[-200:])
rc3, _ = c2.psql("begin;\n" + PHASEA + "\ncommit;\n")
ck("recovery · the archived Phase A foundation reinstalls to its original fingerprint", rc3 == 0 and journey_fp(c2) == FPA2)
rc4, _ = c2.psql(MIG)
ck("recovery · v2 installs again from there with the identical fingerprint", rc4 == 0 and journey_fp(c2) == F1)
c2.close()

# =============================================================================
print("\nSTAGE 2 v2 JOURNEY FOUNDATION · DISPOSABLE PROOF\n" + "=" * 78)
allok = True
for name, good, note in RESULTS:
    allok &= good
    print(("PASS  " if good else "FAIL  ") + name + (("\n        └─ " + note[:600]) if note else ""))
print("=" * 78)
print(("ALL %d PROOFS PASS" % len(RESULTS)) if allok else "%d of %d FAILED" % (sum(1 for r in RESULTS if not r[1]), len(RESULTS)))
print("\nmigration sha256:", hashlib.sha256(open(MIG_PATH, "rb").read()).hexdigest())
print("journey fingerprint (v2):", F1)
print("\nOBJECT INVENTORY")
for k, n in INVENTORY: print(f"  {k:9} {n}")
