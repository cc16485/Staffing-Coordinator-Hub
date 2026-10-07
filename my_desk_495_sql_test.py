# 495 · repeating tasks (desk_repeats), on a local Postgres set up like production with 463 installed and the
# Hub's Client Care owner (domains). Runs the change, the live proof and the undo as the installer will, plus direct
# checks. Made-up people only. python3 my_desk_495_sql_test.py
import os, json
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "my_desk_463_sql_test.py")).read()
exec(src[:src.index("c = conn(); setup(c)")])
from pg8000.native import DatabaseError
def setup495(c):
    setup(c)
    c.run("begin"); c.run(open(os.path.join(HERE, "my_desk_463.sql")).read()); c.run("commit")
c = conn(); setup495(c)
CHANGE, PROOF, BACK = (open(os.path.join(HERE, f)).read() for f in ("my_desk_495.sql", "my_desk_495_proof.sql", "my_desk_495_rollback.sql"))
res = []
def ck(n, cond, d=""): res.append((n, bool(cond), "" if cond else str(d)[:700]))
def one(q, **kw): return c.run(q, **kw)[0][0]
HUBS = {uSAM: ["care_coordinator"], uKRY: ["care_coordinator"], uANG: None, uZAC: ["care_coordinator", "staffing"], uOUT: ["staffing"]}
def as_user(uid, sql, **kw):
    cc = conn()
    try:
        h = HUBS.get(uid); claims = {"sub": uid, "role": "authenticated", "app_metadata": ({"hub_access": h} if h is not None else {})}
        cc.run("begin"); cc.run("set local role authenticated"); cc.run("select set_config('request.jwt.claims', :j, true)", j=json.dumps(claims))
        out = cc.run(sql, **kw); cc.run("commit"); return ("ok", out)
    except DatabaseError as e:
        try: cc.run("rollback")
        except Exception: pass
        return ("refused", str(e.args[0].get("M") if e.args and isinstance(e.args[0], dict) else e))
    finally: cc.close()
ok = lambda r: r[0] == "ok"
def probe():
    try: c.run(PROOF); return None
    except DatabaseError as e:
        m = e.args[0].get("M") if e.args and isinstance(e.args[0], dict) else str(e)
        return json.JSONDecoder().raw_decode(m[m.index("PROBE_RESULT: ") + 14:])[0] if "PROBE_RESULT: " in m else m

c.run("begin"); c.run(CHANGE); c.run("commit")
c.run("begin"); c.run(CHANGE); c.run("commit")
ck("the change goes in, and again harmlessly", one("select to_regclass('public.desk_repeats') is not null"))
r = probe()
ck("the proof answers", isinstance(r, dict), r)
if isinstance(r, dict):
    want = {"found": True, "table": True, "anon_can_read": False, "k_own": True, "k_on_samantha_refused": True, "s_signed_on_krystal": True, "s_unsigned_refused": True, "s_reads_krystals": 2,
            "k_sees_both": 2, "k_skip_signed": True, "k_stop_signed_refused": True, "k_change_signed_refused": True, "k_delete_signed_refused": True, "k_stopped_own": True, "s_stopped_signed": True}
    for k, v in want.items(): ck(f"proof: {k} = {v}", r.get(k) == v, r.get(k))
ck("the proof left nothing behind", one("select count(*) from desk_repeats") == 0)
# direct checks
R = as_user(uKRY, "insert into desk_repeats (person_id, body, rule, time_text) values (:k, 'Payroll (fake)', '{\"kind\":\"biweekly\",\"anchor\":\"2026-10-09\"}', '9 am') returning id::text", k=KRY)
ck("Krystal sets her own repeating task", ok(R), R); rid = R[1][0][0] if ok(R) else None
ck("...Zach (an owner) can read it; Angiel (no Hub role) cannot", len(as_user(uZAC, "select 1 from desk_repeats where id = :i", i=rid)[1]) == 1 and len(as_user(uANG, "select 1 from desk_repeats where id = :i", i=rid)[1]) == 0)
ck("...Zach cannot change or stop Krystal's own rule", not ok(as_user(uZAC, "update desk_repeats set active = false where id = :i returning id", i=rid)) or one("select active from desk_repeats where id = :i", i=rid) is True)
R2 = as_user(uSAM, "insert into desk_repeats (person_id, from_person_id, body, rule) values (:k, :s, 'Timesheets to Samantha (fake)', '{\"kind\":\"weekly\",\"days\":[5]}') returning id::text", k=KRY, s=SAM)
ck("Samantha sets a signed one on Krystal's desk", ok(R2), R2); sid = R2[1][0][0] if ok(R2) else None
ck("a signed one with someone else's name is refused; a signed one on your own desk is refused", not ok(as_user(uSAM, "insert into desk_repeats (person_id, from_person_id, body, rule) values (:k, :z, 'x', '{\"kind\":\"daily\"}')", k=KRY, z=ZAC))
   and not ok(as_user(uSAM, "insert into desk_repeats (person_id, from_person_id, body, rule) values (:s, :s, 'x', '{\"kind\":\"daily\"}')", s=SAM)))
ck("Krystal may skip a day on it; the rev moves", ok(as_user(uKRY, "update desk_repeats set skips = '[\"2026-10-17\"]' where id = :i", i=sid)) and one("select rev from desk_repeats where id = :i", i=sid) == 2)
ck("...but not stop it, change the words or delete it", not ok(as_user(uKRY, "update desk_repeats set active = false where id = :i", i=sid)) and not ok(as_user(uKRY, "update desk_repeats set body = 'y' where id = :i", i=sid))
   and (not ok(as_user(uKRY, "delete from desk_repeats where id = :i", i=sid)) or one("select count(*) from desk_repeats where id = :i", i=sid) == 1))
ck("Zach (the other owner) may read it but not stop Samantha's", (not ok(as_user(uZAC, "update desk_repeats set active = false where id = :i", i=sid))) or one("select active from desk_repeats where id = :i", i=sid) is True)
ck("Samantha stops hers: stopped_at and stopped_by are stamped", ok(as_user(uSAM, "update desk_repeats set active = false where id = :i", i=sid)) and one("select stopped_by::text from desk_repeats where id = :i", i=sid) == SAM)
ck("a new rule cannot start switched off; an empty body is refused; a strange rule shape is refused", not ok(as_user(uKRY, "insert into desk_repeats (person_id, body, rule, active) values (:k, 'x', '{\"kind\":\"daily\"}', false)", k=KRY))
   and not ok(as_user(uKRY, "insert into desk_repeats (person_id, body, rule) values (:k, '', '{\"kind\":\"daily\"}')", k=KRY)) and not ok(as_user(uKRY, "insert into desk_repeats (person_id, body, rule) values (:k, 'x', '[1]')", k=KRY)))
ck("the public key sees nothing", not ok(as_user(uOUT, "select 1 from desk_repeats")) or len(as_user(uOUT, "select 1 from desk_repeats")[1]) == 0)
c.run(BACK)
ck("the undo takes the table away", one("select to_regclass('public.desk_repeats') is null"))
c.run("begin"); c.run(CHANGE); c.run("commit")
ck("the change goes back in after an undo", one("select to_regclass('public.desk_repeats') is not null"))
fails = [x for x in res if not x[1]]
for n, good, d in res: print(("PASS" if good else "FAIL"), "·", n, ("" if good else "→ " + d))
print(f"{len(res) - len(fails)}/{len(res)}" if not fails else f"FAILED {len(fails)} of {len(res)}")
raise SystemExit(1 if fails else 0)
