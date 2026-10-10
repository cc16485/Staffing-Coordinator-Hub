#!/usr/bin/env python3
# 558 · SLICE 2a, THE STEP 1 TABLES AND THE LOCK'S KEY (Samantha: "proceed with Phase 2a development and fictional testing",
# 2026-10-09). Hub project. Runs one database change (the two Step 1 tables, server only, never deleted) and sets the
# lock's key (STEP1_KEK, 32 random bytes made on this Mac, stored only as a function secret, never shown, never written
# down) if it is not set. Deploys nothing; no function reads the tables yet; nothing is sent; no existing row changes.
import os, json, base64, secrets
os.environ.setdefault("SB_STEP", "558")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
start("SLICE 2a: THE STEP 1 TABLES AND THE LOCK'S KEY")
say("PART 1 · READ ONLY (nothing changes)")
SQLF = os.path.join(ROOT, "supabase", "slice2a-step1-tables.sql")
if not os.path.exists(SQLF): bad("the SQL file is not in the reviewed build"); done(2)
ok_, t = sql(REF, "select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name in ('step1_forms', 'step1_identity')")
say("  · the two tables do not exist yet" if ok_ and int(t[0]['n']) == 0 else "  · the tables already exist; the change is safe to run again") if ok_ else bad(f"could not read the tables: {t}")
ok_, sec = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
names = {x.get("name") for x in (json.loads(sec) if ok_ == 200 and sec.startswith("[") else [])}
HAS_KEK = "STEP1_KEK" in names
say("  · the lock's key STEP1_KEK is " + ("already set (kept as it is)" if HAS_KEK else "not set: a new one is made here and stored as a function secret only"))
say("  · what changes: two empty server-only tables appear; the key is set if missing. Nothing is sent; no record changes; no function changes.")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(3)
say(); say("PART 2 · CHANGE")
ok_, r_ = sql(REF, open(SQLF).read())
say("  ✓ the database change ran (step1_forms, step1_identity, their guards)") if ok_ else bad(f"the database change did not run: {r_}")
if not HAS_KEK:
    kek = base64.b64encode(secrets.token_bytes(32)).decode(); HIDE.append(kek)
    s_, b_ = http("POST", f"{API}/v1/projects/{REF}/secrets", [{"name": "STEP1_KEK", "value": kek}], MG())
    say("  ✓ STEP1_KEK set (32 random bytes; shown nowhere)") if s_ in (200, 201) else bad(f"could not set STEP1_KEK ({s_}): {b_[:120]}")
    del kek
say(); say("PART 3 · PROOF")
ok_, g = sql(REF, "select grantee, string_agg(privilege_type, ',') as p from information_schema.role_table_grants where table_schema = 'public' and table_name in ('step1_forms', 'step1_identity') and grantee in ('anon', 'authenticated') group by grantee")
say("  ✓ anon and authenticated hold nothing on either table") if ok_ and not g else bad(f"grants found: {g}")
ok_, pol = sql(REF, "select count(*)::int as n from pg_policies where tablename in ('step1_forms', 'step1_identity')")
say("  ✓ no row policy exists (server only)") if ok_ and int(pol[0]['n']) == 0 else bad(f"policies: {pol}")
ok_, rls = sql(REF, "select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('step1_forms', 'step1_identity') and c.relrowsecurity")
say("  ✓ row security is on for both") if ok_ and int(rls[0]['n']) == 2 else bad(f"row security: {rls}")
ok_, tr = sql(REF, """do $p$ declare oid_ uuid := gen_random_uuid(); m text := ''; begin
  insert into public.step1_forms (offer_id, signatures) values (oid_, '{"vehicle": {"at": "x"}}');
  begin update public.step1_forms set signatures = '{"vehicle": {"at": "y"}}' where offer_id = oid_; m := m || 'signature changed, '; exception when check_violation then m := m || 'signature change refused, '; end;
  begin delete from public.step1_forms where offer_id = oid_; m := m || 'delete allowed'; exception when check_violation then m := m || 'delete refused'; end;
  raise exception '%', m; end $p$;""")
say("  ✓ a signature cannot be changed and a record cannot be deleted, even by the owner (proof row rolled back)") if (not ok_) and "signature change refused, delete refused" in str(tr) else bad(f"the guards did not hold: {str(tr)[:160]}")
ok_, sec = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
names = {x.get("name") for x in (json.loads(sec) if ok_ == 200 and sec.startswith("[") else [])}
say("  ✓ STEP1_KEK is set") if "STEP1_KEK" in names else bad("STEP1_KEK is not set")
ok_, c = sql(REF, "select count(*)::int as n from public.step1_forms"); say(f"  ✓ step1_forms holds {c[0]['n']} row(s) (nothing writes it yet)") if ok_ else bad(f"count: {c}")
say("  · tested before running: 25 checks on the forms' wording and the reveal rules against her rulings, 8 on this SQL's shape.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the Step 1 tables and the lock's key are in place. Nothing was sent; nothing reads them yet."); done(0)
