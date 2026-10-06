# 465 · kind words tucked under the right desks, on a local Postgres set up like production with 463 installed and the
# Hub's Client Care owner (domains). Runs the change, the live proof and the undo as the installer will, plus direct
# checks. Made-up people only. python3 my_desk_465_sql_test.py
import os, json
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "my_desk_463_sql_test.py")).read()
exec(src[:src.index("c = conn(); setup(c)")])
from pg8000.native import DatabaseError
def setup465(c):
    setup(c)
    c.run("begin"); c.run(open(os.path.join(HERE, "my_desk_463.sql")).read()); c.run("commit")
    c.run("create table public.domains(entity text, code text, label text, owner_person uuid, backup_person uuid, escalation_person uuid, active boolean default true, sort_order int default 100, primary key (entity, code))")
    c.run("revoke all on public.domains from anon, authenticated; grant select on public.domains to authenticated")
    c.run("insert into public.domains(entity, code, label, owner_person) values ('cc_ihs','client_care','Client Care', :k), ('cc_ihs','payer_programs','Payer programs', :a)", k=KRY, a=ANG)
c = conn(); setup465(c)
CHANGE, PROOF, BACK = (open(os.path.join(HERE, f)).read() for f in ("my_desk_465.sql", "my_desk_465_proof.sql", "my_desk_465_rollback.sql"))
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
ck("the change goes in, and again harmlessly", one("select to_regprocedure('public.kind_word_clip(text,text,text,text,text,date,jsonb)') is not null"))
r = probe()
ck("the proof answers", isinstance(r, dict), r)
if isinstance(r, dict):
    want = {"found": True, "owners": 2, "desk_people": 3, "client_care_owner": "Krystal", "deliver_open_to_pages": False, "clip_open_to_public": False, "clip_for_signed_in": True,
            "empty_refused": True, "page_can_deliver": False, "review_to": 2, "review_to_krystal": False, "review_to_samantha": True, "client_to": 2, "client_to_samantha": True,
            "caregiver_to_krystal": True, "caregiver_to_samantha": False, "decided_to": 3, "all_kind": True, "k_sees_own_drops": 2, "k_sees_samantha_drops": 0, "k_sees_jar": 4,
            "s_reads_others_drops": 2}
    for k, v in want.items(): ck(f"proof: {k} = {v}", r.get(k) == v, r.get(k))
ck("the proof left nothing behind", one("select (select count(*) from kind_words) + (select count(*) from kind_word_drops)") == 0)

# direct checks
R = as_user(uANG, "select kind_word_clip('So kind (fake)', 'The Wilson family', 'James T.', 'caregiver', 'call', current_date, '{\"type\":\"caregiver\",\"id\":\"9\",\"name\":\"James T.\"}'::jsonb)")
ck("Angiel (a desk by job title, no Hub role) can clip a kind word", ok(R), R)
wid = (lambda v: (json.loads(v) if isinstance(v, str) else v)["id"])(R[1][0][0]) if ok(R) else None
ck("...it is in the jar straight away (no waiting)", one("select status from kind_words where id = :i", i=wid) == "kind")
ck("...tucked under the owners' and Client Care's desks, not hers", sorted(x[0] for x in c.run("select p.full_name from kind_word_drops d join persons p using (person_id) where kind_word_id = :i", i=wid)) == ["Krystal Land", "Samantha Smith", "Zach Example"])
ck("Krystal sees it tucked under her page", len(as_user(uKRY, "select 1 from kind_word_drops where kind_word_id = :i and person_id = :k", i=wid, k=KRY)[1]) == 1)
ck("someone signed in with only the Staffing hub can't clip", not ok(as_user(uOUT, "select kind_word_clip('x','','','','other',null,null)")))
ck("a page can't tuck a kind word under someone itself", not ok(as_user(uKRY, "select kind_word_deliver(:i)", i=wid)))
ck("a made-up link shape is refused", not ok(as_user(uKRY, "select kind_word_clip('x','','','','other',null,'[1,2]'::jsonb)")))
ck("a strange source is filed as other", ok(as_user(uKRY, "select kind_word_clip('Lovely (fake)','A neighbor','','','gossip',null,null)")) and one("select source from kind_words where quote = 'Lovely (fake)'") == "other")
sid = one("insert into kind_words (quote, status, suggested_by, link) values ('Suggested (fake)', 'suggested', 'server', '{\"type\":\"client\",\"ax\":\"5\",\"name\":\"Linda\"}') returning id::text")
ck("Angiel (no Hub role) can't say a suggestion is kind", not ok(as_user(uANG, "select kind_word_decide(:i, true)", i=sid)))
ck("Krystal says yes: it is tucked under the owners' desks (she owns Client Care and decided it, so hers too)", ok(as_user(uKRY, "select kind_word_decide(:i, true)", i=sid))
   and sorted(x[0] for x in c.run("select p.full_name from kind_word_drops d join persons p using (person_id) where kind_word_id = :i", i=sid)) == ["Krystal Land", "Samantha Smith", "Zach Example"])
sid2 = one("insert into kind_words (quote, status, suggested_by) values ('Not kind (fake)', 'suggested', 'server') returning id::text")
ck("a 'no' tucks it under nobody", ok(as_user(uSAM, "select kind_word_decide(:i, false)", i=sid2)) and one("select count(*) from kind_word_drops where kind_word_id = :i", i=sid2) == 0)
ck("Krystal tapes a kind word to her desk", ok(as_user(uKRY, "update kind_word_drops set state = 'taped' where kind_word_id = :i and person_id = :k", i=wid, k=KRY)))

# undo
c.run(BACK)
ck("the undo takes clip and deliver back out", one("select to_regprocedure('public.kind_word_clip(text,text,text,text,text,date,jsonb)') is null and to_regprocedure('public.kind_word_deliver(uuid)') is null"))
sid3 = one("insert into kind_words (quote, status, suggested_by) values ('After undo (fake)', 'suggested', 'server') returning id::text")
ck("...and deciding still works as it did in 463 (no tucking)", ok(as_user(uKRY, "select kind_word_decide(:i, true)", i=sid3)) and one("select count(*) from kind_word_drops where kind_word_id = :i", i=sid3) == 0)
ck("...kind words and drops already made stay", one("select count(*) from kind_word_drops where kind_word_id = :i", i=wid) == 3)
c.run("begin"); c.run(CHANGE); c.run("commit")
ck("the change goes back in after an undo", one("select to_regprocedure('public.kind_word_deliver(uuid)') is not null"))
fails = [x for x in res if not x[1]]
for n, good, d in res: print(("PASS" if good else "FAIL"), "·", n, ("" if good else "→ " + d))
print(f"{len(res) - len(fails)} / {len(res)}")
raise SystemExit(1 if fails else 0)
