#!/usr/bin/env python3
# Stage 2 · Phase A · disposable-schema proof harness.
# Stands up a throwaway Postgres (pgserver), applies journey-episode-phaseA.sql,
# and asserts the 15 required proofs + atomicity/idempotency/failure/concurrency.
# Touches NOTHING real. Prints a PASS/FAIL matrix and exits nonzero on any FAIL.

import os, shutil, glob, threading, time, traceback
import pgserver
from pg8000.native import Connection, DatabaseError

HERE = os.path.dirname(os.path.abspath(__file__))
MIG  = open(os.path.join(HERE, "journey-episode-phaseA.sql")).read()
ROLL = open(os.path.join(HERE, "journey-episode-phaseA-rollback.sql")).read()

DATA = os.path.join(HERE, "pgtest_phaseA")
shutil.rmtree(DATA, ignore_errors=True); os.makedirs(DATA)
srv = pgserver.get_server(DATA)

# find the unix socket
host = None
for kv in srv.get_uri().split("?",1)[1].split("&"):
    if kv.startswith("host="): host = kv[5:]
sock = [p for p in glob.glob(os.path.join(host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
SOCKDIR = host

def conn(role=None):
    c = Connection(user="postgres", database="postgres", unix_sock=sock)
    if role: c.run(f"set role {role}")
    return c

def psql(script):  # returns (ok, output); psql exit code is unreliable, so we assert post-conditions
    try: return True, srv.psql(script)
    except Exception as e: return False, str(e)

results = []
def check(item, name, cond, note=""):
    results.append((item, name, bool(cond), note))

P = [f"00000000-0000-0000-0000-00000000000{i}" for i in range(1,7)]  # P[0..5] -> persons 1..6

# ── setup: roles + FK dependency shape (person_identity) ────────────────────
su = conn()
su.run("do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;")
su.run("do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;")
su.run("do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;")  # Supabase: service_role is BYPASSRLS
su.run("create table person_identity (id uuid primary key default gen_random_uuid(), display_name text)")
su.run("grant all on person_identity to service_role")       # mirrors identity-layer.sql grants
su.run("grant select on person_identity to authenticated")
for i,pid in enumerate(P, start=1):
    su.run(f"insert into person_identity(id,display_name) values ('{pid}','P{i}')")

# snapshot public objects BEFORE the migration (item 15)
def public_tables():
    return set(r[0] for r in su.run("select tablename from pg_tables where schemaname='public'"))
def public_funcs():
    return set(r[0] for r in su.run("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'"))
tables_before = public_tables(); funcs_before = public_funcs()

def obj_exists(regclass):
    return su.run(f"select to_regclass('{regclass}') is not null")[0][0]

# ── PROOF 3: mid-migration failure cannot leave a partial Phase A ───────────
psql("begin;\n" + MIG + "\nselect 1/0;\ncommit;")   # 1/0 aborts the txn; commit -> rollback
check(3, "mid-migration failure leaves NO partial (atomic rollback)",
      obj_exists('journey_episode') is False and obj_exists('episode_source') is False,
      "journey_episode / episode_source absent after a failed wrapped migration")

# ── PROOF 1: empty migration succeeds atomically ────────────────────────────
psql("begin;\n" + MIG + "\ncommit;")
objs = all(obj_exists(x) for x in ['journey_episode','episode_source','episode_door_audit'])
nfun = su.run("select count(*) from pg_proc where proname like 'episode\\_%' escape '\\'")[0][0]
check(1, "empty migration succeeds atomically",
      objs and nfun == 5, f"3 tables present, {nfun}/5 door functions")

# ── PROOF 2: a second execution has defined behavior (idempotent, no dupes) ──
t_after1, f_after1 = public_tables(), public_funcs()
rows1 = su.run("select count(*) from journey_episode")[0][0]
psql("begin;\n" + MIG + "\ncreate table _idem_marker(x int); insert into _idem_marker values (1);\ncommit;")
marker = obj_exists('_idem_marker') and su.run("select count(*) from _idem_marker")[0][0] == 1
same = (public_tables()-{'_idem_marker'}) == t_after1 and public_funcs() == f_after1
rows2 = su.run("select count(*) from journey_episode")[0][0]
check(2, "second execution is idempotent (whole script re-ran & committed, no dupes)",
      marker and same and rows1==rows2==0, "marker committed; object sets identical; still 0 rows")
su.run("drop table if exists _idem_marker")

# ── PROOF 15: migration created ONLY its own objects; person_identity untouched
new_tables = public_tables() - tables_before
new_funcs  = public_funcs()  - funcs_before
pi_cols = set(r[0] for r in su.run("select column_name from information_schema.columns where table_name='person_identity'"))
check(15, "touches no existing prod structures except the FK dependency",
      new_tables == {'journey_episode','episode_source','episode_door_audit'}
      and new_funcs == {'journey_episode_guard','episode_open_provisional','episode_resolve','episode_attach_source','episode_set_state','episode_void'}
      and pi_cols == {'id','display_name'},
      f"new tables={sorted(new_tables)}; person_identity unchanged")

# service_role + authenticated connections
sr = conn("service_role")
au = conn("authenticated")
def door(sql): return sr.run(sql)
def denied(c, sql):
    try: c.run(sql); return False
    except DatabaseError: return True

# ── PROOF 4: authenticated/browser cannot mutate episode storage directly ────
d1 = denied(au, "insert into journey_episode(state) values ('open')")
d2 = denied(au, f"update journey_episode set state='open'")
d3 = denied(au, "delete from journey_episode")
can_select = True
try: au.run("select count(*) from journey_episode")
except DatabaseError: can_select = False
check(4, "authenticated cannot INSERT/UPDATE/DELETE (can only SELECT)",
      d1 and d2 and d3 and can_select, "writes denied, read allowed")

# ── PROOF 5: only the gated Door (service_role EXECUTE) can mutate ───────────
exec_denied = denied(au, "select episode_open_provisional('lead','L0')")
eid0 = door("select episode_open_provisional('lead','LX','','wf','tester')")[0][0]
check(5, "only the Episode Door mutates (authenticated EXECUTE denied; service_role works)",
      exec_denied and eid0 is not None, "door EXECUTE revoked for authenticated; works for service_role")

# ── PROOF 6: provisional resolves in place without changing episode_id ───────
eid = door("select episode_open_provisional('lead','L1','','wf','t')")[0][0]
door(f"select episode_resolve('{eid}'::uuid, '{P[0]}'::uuid)")
row = su.run(f"select episode_id::text, person_id::text, seq, state from journey_episode where episode_id='{eid}'")[0]
origin_kept = su.run(f"select count(*) from episode_source where episode_id='{eid}' and role='origin'")[0][0]
check(6, "provisional resolves in place (same episode_id; person+seq set; origin history kept)",
      row[0]==str(eid) and row[1]==P[0] and row[2]==1 and row[3]=='open' and origin_kept==1,
      f"episode_id unchanged, seq={row[2]}, origin source preserved")

# ── PROOF 8 & 9: seq high-water incl voided; voided seq never reused ─────────
# P2 (index 1): Ea seq1 -> ended; Eb seq2 -> voided; Ec must be seq3, never 2.
ea = door("select episode_open_provisional('lead','L2a')")[0][0]; door(f"select episode_resolve('{ea}'::uuid,'{P[1]}'::uuid)")
door(f"select episode_set_state('{ea}'::uuid,'ended')")
eb = door("select episode_open_provisional('lead','L2b')")[0][0]; door(f"select episode_resolve('{eb}'::uuid,'{P[1]}'::uuid)")
seq_eb = su.run(f"select seq from journey_episode where episode_id='{eb}'")[0][0]
door(f"select episode_void('{eb}'::uuid,'accidental duplicate', null)")
ec = door("select episode_open_provisional('lead','L2c')")[0][0]; door(f"select episode_resolve('{ec}'::uuid,'{P[1]}'::uuid)")
seq_ec = su.run(f"select seq from journey_episode where episode_id='{ec}'")[0][0]
eb_state, eb_seq_after = su.run(f"select state, seq from journey_episode where episode_id='{eb}'")[0]
check(8, "next seq = max(seq)+1 over ALL episodes incl voided (high-water mark)",
      seq_eb==2 and seq_ec==3, f"Ea=1, Eb=2(voided), Ec={seq_ec} (not a reused 2)")
check(9, "voided seq is permanently retired, never reused",
      eb_state=='voided' and eb_seq_after==2 and seq_ec!=2, "Eb keeps retired seq 2; Ec got 3")

# ── PROOF 13: identity resolution and AxisCare attach are separate ops ───────
# after resolve, no 'converted' source exists; attaching axiscare doesn't move seq/person
conv_before = su.run(f"select count(*) from episode_source where episode_id='{ec}' and role='converted'")[0][0]
door(f"select episode_attach_source('{ec}'::uuid,'axiscare','AX-C','converted')")
r13 = su.run(f"select person_id::text, seq, state from journey_episode where episode_id='{ec}'")[0]
conv_after = su.run(f"select count(*) from episode_source where episode_id='{ec}' and role='converted'")[0][0]
check(13, "identity resolution vs AxisCare attach are separate operations",
      conv_before==0 and conv_after==1 and r13[0]==P[1] and r13[1]==3 and r13[2]=='converted',
      "resolve set person only; attach added source, seq/person unchanged, state->converted")

# ── PROOF 10: many sources per episode; each (system,source_ref) one episode ─
door(f"select episode_attach_source('{ec}'::uuid,'ghl','G1','additional')")
door(f"select episode_attach_source('{ec}'::uuid,'lead','L2dup','duplicate')")
nsrc = su.run(f"select count(*) from episode_source where episode_id='{ec}'")[0][0]
# same (system,source_ref) cannot belong to a second episode
other = door("select episode_open_provisional('lead','L9')")[0][0]; door(f"select episode_resolve('{other}'::uuid,'{P[2]}'::uuid)")
res_dup = door(f"select episode_attach_source('{other}'::uuid,'ghl','G1','additional')")[0][0]
check(10, "many sources attach to one episode; each (system,source_ref) is unique to one episode",
      nsrc>=3 and 'conflict' in str(res_dup), f"{nsrc} sources on Ec; re-attaching G1 elsewhere -> {res_dup}")

# ── PROOF 11: origin association cannot be silently replaced ─────────────────
res_org = door(f"select episode_attach_source('{ec}'::uuid,'lead','L2new','origin')")[0][0]
origin_ref = su.run(f"select source_ref from episode_source where episode_id='{ec}' and role='origin'")[0][0]
check(11, "origin cannot be silently replaced (second origin refused)",
      'conflict' in str(res_org) and origin_ref=='L2c', f"second origin -> {res_org}; origin still L2c")

# ── PROOF 12: real-terminal and voided freeze; person_id/seq immutable ───────
f_term = denied(sr, f"update journey_episode set state='open' where episode_id='{ea}'")      # ended -> frozen
f_void = denied(sr, f"update journey_episode set needs_review=true where episode_id='{eb}'")  # voided -> frozen
f_seq  = denied(sr, f"update journey_episode set seq=99 where episode_id='{ec}'")             # seq immutable
f_pers = denied(sr, f"update journey_episode set person_id='{P[0]}' where episode_id='{ec}'")  # person immutable
door_term = door(f"select episode_set_state('{ea}'::uuid,'open')")[0][0]
check(12, "real-terminal & voided are frozen; person_id/seq immutable",
      f_term and f_void and f_seq and f_pers and 'frozen' in str(door_term),
      "direct updates to frozen rows and to person_id/seq all refused")

# ── PROOF 14: no payer/auth/care/schedule/start-date storage in this layer ──
cols = [r[0] for r in su.run("select column_name from information_schema.columns where table_name in ('journey_episode','episode_source')")]
forbidden = [c for c in cols if any(k in c.lower() for k in ('payer','auth','care','schedule','start_date','rate','hours','billing'))]
payer_fn = su.run("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (proname ilike '%payer%' or proname ilike '%change_payer%')")[0][0]
check(14, "no payer/auth/care/schedule/start-date leaked into the episode layer",
      forbidden==[] and payer_fn==0, f"forbidden columns={forbidden}; payer functions in public={payer_fn}")

# ── PROOF 7: two concurrent resolutions -> no same seq, no two active ───────
# fresh person P4 (index 3), two provisional episodes; resolve both concurrently.
xa = door("select episode_open_provisional('lead','L4a')")[0][0]
xb = door("select episode_open_provisional('lead','L4b')")[0][0]
box = {}
c1 = conn("service_role"); c2 = conn("service_role")
c1.run("begin"); c1.run(f"select episode_resolve('{xa}'::uuid,'{P[3]}'::uuid)")  # holds advisory lock, not committed
def worker():
    c2.run("begin")
    box['r2'] = c2.run(f"select episode_resolve('{xb}'::uuid,'{P[3]}'::uuid)")[0][0]  # blocks until c1 commits
    c2.run("commit")
th = threading.Thread(target=worker); th.start()
time.sleep(0.8)                 # ensure c2 is blocked on the per-person lock
c1.run("commit"); th.join()
active = su.run(f"select count(*) from journey_episode where person_id='{P[3]}' and state in ('provisional','open','converted','established')")[0][0]
seqs   = [r[0] for r in su.run(f"select seq from journey_episode where person_id='{P[3]}' and seq is not null")]
# backstop: the DB constraint alone rejects two active rows for one person
backstop = False
try:
    su.run(f"insert into journey_episode(person_id,seq,state) values ('{P[4]}',1,'open')")
    su.run(f"insert into journey_episode(person_id,seq,state) values ('{P[4]}',2,'open')")
except DatabaseError: backstop = True
check(7, "concurrent resolutions cannot get the same seq or create two active episodes",
      active==1 and len(seqs)==len(set(seqs)) and 'conflict' in str(box.get('r2')) and backstop,
      f"1 active for P4; 2nd concurrent resolve -> conflict; unique-active backstop holds")

# ── rollback proof: Phase A removes exactly its objects, in order ────────────
psql("begin;\n" + ROLL + "\ncommit;")
gone = (public_tables()-{'person_identity'}) == tables_before-{'person_identity'} \
       and not any(obj_exists(x) for x in ['journey_episode','episode_source','episode_door_audit'])
check(0, "Phase A rollback removes exactly its objects (person_identity kept)",
      gone and obj_exists('person_identity'), "episode objects dropped; person_identity intact")

# ── report ──────────────────────────────────────────────────────────────────
try: sr.close(); au.close(); c1.close(); c2.close(); su.close()
except Exception: pass
srv.cleanup()
print("\nSTAGE 2 · PHASE A · DISPOSABLE-SCHEMA PROOF")
print("="*76)
ok_all = True
for item,name,ok,note in sorted(results, key=lambda r:(r[0]==0, r[0])):
    tag = "PASS" if ok else "FAIL"
    if not ok: ok_all = False
    label = "rollback" if item==0 else f"#{item:<2}"
    print(f"{tag}  {label}  {name}")
    if note: print(f"          └─ {note}")
print("="*76)
print(("ALL %d PROOFS PASS" % len(results)) if ok_all else "SOME PROOFS FAILED")
import sys; sys.exit(0 if ok_all else 1)
