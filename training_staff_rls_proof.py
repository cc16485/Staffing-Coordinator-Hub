#!/usr/bin/env python3
# training-staff-rls.sql (Training Platform) in a disposable Postgres shaped like it: auth.users + auth.uid(), the
# "auth_all" policies, the waiver-docs storage policy, and one policy shared with anon. Never touches production.
import os, uuid, hashlib
H = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(H, "journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
TPR = os.path.expanduser("~/Claude/Projects/Caring Companions Training Platform/supabase")
MIG = open(os.path.join(TPR, "training-staff-rls.sql")).read(); RB = open(os.path.join(TPR, "training-staff-rls-rollback.sql")).read()
res = []
def ck(n, g, note=""): res.append((n, bool(g), "" if g else str(note)[-600:]))
c = Cluster("tsr"); P = setup_supabase_like(c); s = c.su
for q in ["create schema if not exists auth",
          "create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, deleted_at timestamptz, banned_until timestamptz)",
          "create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$",
          "grant usage on schema auth to anon, authenticated", "grant execute on function auth.uid() to anon, authenticated",
          "create table caregivers (id uuid primary key default gen_random_uuid(), name text, access_token text)",
          "create table app_settings (key text primary key, value jsonb)",
          "create table courses (id int primary key, title text)",
          "create schema if not exists storage", "create table storage.objects (id bigserial primary key, bucket_id text, name text)",
          "grant usage on schema storage to anon, authenticated"]: s.run(q)
for t in ("caregivers", "app_settings", "courses"):
    s.run(f"alter table {t} enable row level security"); s.run(f"grant all on {t} to authenticated, anon")
    if t != "courses": s.run(f'create policy "auth_all_{t}" on {t} for all to authenticated using (true) with check (true)')
s.run('create policy "courses_read_everyone" on courses for select to anon, authenticated using (true)')
s.run("alter table storage.objects enable row level security"); s.run("grant all on storage.objects to authenticated, anon"); s.run("grant usage, select on sequence storage.objects_id_seq to authenticated")
s.run("""create policy "auth_all_waiver_docs" on storage.objects for all to authenticated using (bucket_id = 'waiver-docs') with check (bucket_id = 'waiver-docs')""")
s.run("insert into caregivers(name, access_token) values ('Tia Train', 'tok1'), ('Bo Care', 'tok2')")
s.run("""insert into app_settings values ('hub_read_key', '{"key":"secret"}')"""); s.run("insert into courses values (1, 'Basic 12h')")
s.run("insert into storage.objects(bucket_id, name) values ('waiver-docs', 'certificates/a.pdf'), ('public-assets', 'logo.png')")
U = {k: str(uuid.uuid4()) for k in ("staff", "outsider", "unconfirmed", "banned", "deleted")}
for k, email, conf, ban, dele in (("staff", "samantha@mo-care.com", True, None, None), ("outsider", "someone@gmail.com", True, None, None),
                                  ("unconfirmed", "fake@mo-care.com", False, None, None), ("banned", "gone@mo-care.com", True, "2099-01-01", None),
                                  ("deleted", "old@mo-care.com", True, None, "2026-01-01")):
    s.run("insert into auth.users values (cast(:i as uuid), :e, case when :c then now() end, cast(:d as timestamptz), cast(:b as timestamptz))", i=U[k], e=email, c=conf, b=ban, d=dele)
def as_user(who):
    cc = c.conn(); cc.run("select set_config('request.jwt.claim.sub', :u, false)", u=U[who] if who in U else ""); cc.run("set role " + ("anon" if who == "anon" else "authenticated")); return cc
def count(who, sql):
    cc = as_user(who)
    try: return cc.run(sql)[0][0]
    except Exception as e: return "ERR:" + str(e)[:80]
    finally: cc.close()
def can_insert(who):
    cc = as_user(who)
    try: cc.run("insert into caregivers(name) values ('x')"); return True
    except Exception: return False
    finally: cc.close()
ck("before: an outside account (any confirmed gmail) can read every caregiver and the hub key (the exposure)",
   count("outsider", "select count(*) from caregivers") == 2 and count("outsider", "select count(*) from app_settings") == 1)
rc, out = c.psql(MIG)
ck("installs cleanly and its own self-check passes", rc == 0, out[-300:])
ck("a confirmed @mo-care.com staff account: reads caregivers, settings and the waiver documents, and can write",
   count("staff", "select count(*) from caregivers") == 2 and count("staff", "select count(*) from app_settings") == 1 and can_insert("staff")
   and count("staff", "select count(*) from storage.objects where bucket_id = 'waiver-docs'") == 1)
for who, label in (("outsider", "a confirmed outside account (gmail)"), ("unconfirmed", "an @mo-care.com account whose email was never confirmed"),
                   ("banned", "a banned staff account"), ("deleted", "a deleted staff account")):
    ck(f"{label}: sees no caregivers, settings or documents, and cannot write",
       count(who, "select count(*) from caregivers") == 0 and count(who, "select count(*) from app_settings") == 0
       and count(who, "select count(*) from storage.objects") == 0 and not can_insert(who))
ck("the document store keeps its own bucket rule: staff still cannot see other buckets through this policy", count("staff", "select count(*) from storage.objects where bucket_id = 'public-assets'") == 0)
ck("a policy that is also granted to anon (public course list) is left exactly as it was", count("anon", "select count(*) from courses") == 1 and count("outsider", "select count(*) from courses") == 1
   and "is_training_staff" not in (s.run("select qual from pg_policies where policyname = 'courses_read_everyone'")[0][0] or ""))
ck("the public key (anon) still gets nothing from caregivers", count("anon", "select count(*) from caregivers") == 0)
ck("anon cannot call the staff check itself", s.run("select has_function_privilege('anon', 'public.is_training_staff()', 'execute')")[0][0] is False)
ck("every rewritten policy is saved first (3: caregivers, settings, documents)", s.run("select count(*) from training_policy_backup")[0][0] == 3)
rc, out = c.psql(MIG)
ck("rerun: nothing is wrapped twice, nothing new saved", rc == 0 and s.run("select count(*) from training_policy_backup")[0][0] == 3
   and s.run("select qual from pg_policies where policyname = 'auth_all_caregivers'")[0][0].count("is_training_staff") == 1)
rc, out = c.psql(RB)
ck("rollback restores the exact original policies (the outsider could read again, which is why rollback warns)",
   rc == 0 and s.run("select qual from pg_policies where policyname = 'auth_all_caregivers'")[0][0] == "true" and count("outsider", "select count(*) from caregivers") >= 2, out[-200:])
c.close()
print("\nTRAINING · STAFF-ONLY DATA ACCESS · DISPOSABLE PROOF\n" + "=" * 60); ok = True
for n, g, note in res: ok &= g; print(("PASS  " if g else "FAIL  ") + n + (("\n   └─ " + note) if note else ""))
print("=" * 60); print(f"ALL {len(res)} PROOFS PASS" if ok else "FAILED"); print("training-staff-rls.sql sha256:", hashlib.sha256(MIG.encode()).hexdigest())
