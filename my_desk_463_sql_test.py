# 463 · My Desk storage on a real local Postgres set up like production: people, sign-ins (auth.users with the hub
# list in app_metadata), Hub roles, jwt_hub_access, and the project's default privileges that hand extra rights to every
# new table. Runs the change, the live proof and the undo exactly as the installer will, plus direct checks of every
# rule. Made-up people only. python3 my_desk_463_sql_test.py
import os, json, glob, shutil, tempfile, uuid
import pgserver
from pg8000.native import Connection, DatabaseError
HERE = os.path.dirname(os.path.abspath(__file__))
D = tempfile.mkdtemp(prefix="supg-"); shutil.rmtree(D, ignore_errors=True); os.makedirs(D)
srv = pgserver.get_server(D)
host = [kv[5:] for kv in srv.get_uri().split("?", 1)[1].split("&") if kv.startswith("host=")][0]
SOCK = [p for p in glob.glob(os.path.join(host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
conn = lambda: Connection(user="postgres", database="postgres", unix_sock=SOCK)
SAM, KRY, ANG, ZAC, OUT = (str(uuid.uuid4()) for _ in range(5))      # person ids
uSAM, uKRY, uANG, uZAC, uOUT = (str(uuid.uuid4()) for _ in range(5))  # sign-in ids

def setup(c):
    c.run("drop schema if exists public cascade; drop schema if exists auth cascade; create schema public; create schema auth")
    for r in ("anon", "authenticated", "service_role"):
        try: c.run(f"create role {r}")
        except DatabaseError: pass
    c.run("alter role service_role bypassrls")
    c.run("grant usage on schema public, auth to anon, authenticated, service_role")
    # the project's default privileges (010): new tables come with extras for the browser roles
    c.run("alter default privileges in schema public grant all on tables to anon, authenticated")
    c.run("create table auth.users(id uuid primary key, email text, raw_app_meta_data jsonb, raw_user_meta_data jsonb)")
    c.run("""create function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$""")
    c.run("grant execute on function auth.uid() to anon, authenticated")
    c.run("""create function public.jwt_hub_access() returns jsonb language sql stable as $$
      select nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'app_metadata' -> 'hub_access' $$""")
    c.run("create table public.persons(person_id uuid primary key, full_name text not null, primary_email text unique, active boolean not null default true)")
    c.run("create table public.auth_identities(person_id uuid references public.persons on delete cascade, project_ref text, auth_user_id uuid, login_email text, primary key (person_id, project_ref))")
    c.run("create table public.staff_roles(person_id uuid references public.persons on delete cascade, entity text, role text, primary key (person_id, entity, role))")
    c.run("revoke all on public.persons, public.auth_identities, public.staff_roles from anon, authenticated")
    c.run("grant select on public.persons, public.auth_identities, public.staff_roles to authenticated")
    people = [(SAM, uSAM, "Samantha Smith", "samantha@mo-care.com", ["care_coordinator"]),
              (KRY, uKRY, "Krystal Land", "krystal@mo-care.com", ["care_coordinator"]),
              (ANG, uANG, "Angiel Falig", "angiel@example.invalid", None),
              (ZAC, uZAC, "Zach Example", "zach@example.invalid", ["care_coordinator", "staffing"]),
              (OUT, uOUT, "Outside Person", "out@example.invalid", ["staffing"])]
    for pid, uid, name, email, hubs in people:
        c.run("insert into public.persons values (:p, :n, :e, true)", p=pid, n=name, e=email)
        c.run("insert into public.auth_identities values (:p, 'zngsgedlsxinbygwmxwn', :u, :e)", p=pid, u=uid, e=email)
        c.run("insert into auth.users values (:u, :e, :m, '{}')", u=uid, e=email, m=json.dumps({"hub_access": hubs} if hubs else {"provider": "email"}))
    c.run("insert into public.staff_roles values (:s,'cc_ihs','owner_admin'), (:k,'cc_ihs','care_coordinator'), (:z,'cc_ihs','owner_admin'), (:o,'cds','owner_admin')", s=SAM, k=KRY, z=ZAC, o=OUT)

c = conn(); setup(c)
CHANGE, PROOF, BACK = (open(os.path.join(HERE, f)).read() for f in ("my_desk_463.sql", "my_desk_463_proof.sql", "my_desk_463_rollback.sql"))
res = []
def ck(n, cond, d=""): res.append((n, bool(cond), "" if cond else str(d)[:700]))
def one(q, **kw): return c.run(q, **kw)[0][0]
HUBS = {uSAM: ["care_coordinator"], uKRY: ["care_coordinator"], uANG: None, uZAC: ["care_coordinator", "staffing"], uOUT: ["staffing"]}
def as_user(uid, sql, hubs="real", **kw):
    cc = conn()
    try:
        h = HUBS.get(uid) if hubs == "real" else hubs
        claims = {"sub": uid, "role": "authenticated", "app_metadata": ({"hub_access": h} if h is not None else {})}
        cc.run("begin"); cc.run("set local role authenticated")
        cc.run("select set_config('request.jwt.claims', :j, true)", j=json.dumps(claims))
        out = cc.run(sql, **kw); cc.run("commit"); return ("ok", out)
    except DatabaseError as e:
        try: cc.run("rollback")
        except Exception: pass
        return ("refused", str(e.args[0].get("M") if e.args and isinstance(e.args[0], dict) else e))
    finally: cc.close()
def as_anon(sql):
    cc = conn()
    try: cc.run("begin"); cc.run("set local role anon"); out = cc.run(sql); cc.run("commit"); return ("ok", out)
    except DatabaseError as e:
        try: cc.run("rollback")
        except Exception: pass
        return ("refused", str(e))
    finally: cc.close()
def probe():
    try: c.run(PROOF); return None
    except DatabaseError as e:
        m = e.args[0].get("M") if e.args and isinstance(e.args[0], dict) else str(e)
        return json.JSONDecoder().raw_decode(m[m.index("PROBE_RESULT: ") + 14:])[0] if "PROBE_RESULT: " in m else m
ok = lambda r: r[0] == "ok"
rows = lambda r: len(r[1]) if r[0] == "ok" else -1

# ── install ──
c.run("begin"); c.run(CHANGE); c.run("commit")
ck("the change goes in", one("select to_regclass('public.desk_lines') is not null"))
c.run("begin"); c.run(CHANGE); c.run("commit")
ck("running the change twice is harmless (same tables, same rules)", one("select count(*) from pg_policies where tablename like 'desk%' or tablename like 'kind%'") == 23,
   one("select count(*) from pg_policies where tablename like 'desk%' or tablename like 'kind%'"))

# ── the live proof, run here exactly as the installer runs it ──
r = probe()
ck("the proof answers", isinstance(r, dict), r)
if isinstance(r, dict):
    want = {"found_krystal": True, "found_samantha": True, "samantha_owner": True, "krystal_owner": False, "krystal_coordinator": True,
            "anon_anything": False, "signed_in_bulk": False, "anon_functions": False, "tidy_signed_in": False, "rls_on": True,
            "k_is_me": True, "k_hub_ok": True, "k_is_owner": False, "k_add_own": "went in", "k_add_samantha": "refused", "k_sticky_own": "went in",
            "k_self_star": "refused", "k_switch_desk": "refused", "s_is_owner": True, "s_add_own": "went in", "s_reads_krystal": 1,
            "s_rewrites_krystal": 0, "s_writes_on_krystal": "refused", "s_leaves_note": "went in", "s_signs_own_desk": "refused",
            "s_visit": "went in", "s_star_unfinished": "refused", "k_reads_samantha": 0, "k_sees_note": 1, "k_rewrites_note": "refused",
            "k_moves_answers_note": "went in", "k_sees_visit": 1, "k_gives_star": "refused", "k_clips_kind_word": "went in",
            "k_fakes_suggestion": "refused", "k_decides_suggestion": "went in", "s_star_finished": "went in", "s_edits_own_note": "went in",
            "s_marks_seen": "refused", "staffing_only_reads": 0, "star_landed": True, "note_words_kept": True, "decided": "kind"}
    for k, v in want.items(): ck(f"proof: {k} = {v}", r.get(k) == v, r.get(k))
    names = {t["name"]: t for t in r.get("team", [])}
    ck("proof lists the team by first name (Angiel included, no emails)", "Angiel" in names and "Krystal" in names and "@" not in json.dumps(r.get("team")), r.get("team"))
    ck("proof: Angiel has a sign-in but no Hub role (the case the job-title rule is for)", names.get("Angiel", {}).get("roles") == [] and names["Angiel"]["login"], names.get("Angiel"))
ck("the proof left nothing behind", one("select (select count(*) from desk_lines) + (select count(*) from desk_stickies) + (select count(*) from desk_visits) + (select count(*) from kind_words)") == 0)

# ── direct checks of each rule ──
L = as_user(uKRY, "insert into desk_lines (person_id, place, day, body) values (:p, 'day', current_date, 'Call Mary') returning id", p=KRY)
ck("Krystal writes on her own page", ok(L), L); lid = L[1][0][0] if ok(L) else None
ck("Krystal reads her own page", rows(as_user(uKRY, "select id from desk_lines")) == 1)
ck("Angiel (no Hub role, CC Hub sign-in) can't read Krystal's page", rows(as_user(uANG, "select id from desk_lines")) == 0)
ck("Angiel can keep her own desk", ok(as_user(uANG, "insert into desk_lines (person_id, place, body) values (:p, 'later', 'mine')", p=ANG)))
ck("Krystal can't read Angiel's desk", rows(as_user(uKRY, "select id from desk_lines where person_id = :p", p=ANG)) == 0)
ck("Samantha (owner) reads both desks", rows(as_user(uSAM, "select id from desk_lines")) == 2)
ck("Zach (owner) reads both desks too", rows(as_user(uZAC, "select id from desk_lines")) == 2)
ck("an owner role for another company (CDS) doesn't count here", rows(as_user(uOUT, "select id from desk_lines", hubs=["care_coordinator"])) == 0)
ck("someone signed in with only the Staffing hub can't use a desk", not ok(as_user(uOUT, "insert into desk_lines (person_id, place, body) values (:p, 'later', 'x')", p=OUT)))
ck("Krystal's own desk is closed to her from a Staffing-only sign-in", rows(as_user(uKRY, "select id from desk_lines", hubs=["staffing"])) == 0)
u = as_user(uSAM, "update desk_lines set body = 'x' where id = :i returning id", i=lid)
ck("Samantha can't rewrite Krystal's line", ok(u) and rows(u) == 0, u)
d = as_user(uSAM, "delete from desk_lines where id = :i returning id", i=lid)
ck("Samantha can't erase Krystal's line", ok(d) and rows(d) == 0, d)
ck("Krystal can't move her line onto Samantha's desk", not ok(as_user(uKRY, "update desk_lines set person_id = :p where id = :i", p=SAM, i=lid)))
ck("a line can't be made by Krystal on Samantha's desk", not ok(as_user(uKRY, "insert into desk_lines (person_id, place, body) values (:p, 'later', 'x')", p=SAM)))
ck("no star on an unfinished line", not ok(as_user(uSAM, "select desk_star_line(:i, true)", i=lid)))
as_user(uKRY, "update desk_lines set done_at = now() where id = :i", i=lid)
ck("an owner stars a finished line", ok(as_user(uSAM, "select desk_star_line(:i, true)", i=lid)) and one("select owner_star_by::text from desk_lines where id = :i", i=lid) == SAM)
ck("Krystal can't star (not an owner)", not ok(as_user(uKRY, "select desk_star_line(:i, true)", i=lid)))
ck("Krystal can't remove the owner's star herself", not ok(as_user(uKRY, "update desk_lines set owner_star_by = null where id = :i", i=lid)))
ck("Krystal can still change her own line's words after the star", ok(as_user(uKRY, "update desk_lines set body = 'Call Mary back' where id = :i", i=lid)))
ck("the browser can't add a line with a star already on it", not ok(as_user(uKRY, "insert into desk_lines (person_id, place, body, owner_star_by) values (:p, 'later', 'x', :s)", p=KRY, s=SAM)))
own = as_user(uSAM, "insert into desk_lines (person_id, place, body, kind, done_at) values (:p, 'later', 'mine', 'todo', now()) returning id", p=SAM)
ck("an owner can't star a line on her own desk", ok(own) and not ok(as_user(uSAM, "select desk_star_line(:i, true)", i=own[1][0][0])), own)
ck("'day' lines need a day", not ok(as_user(uKRY, "insert into desk_lines (person_id, place, body) values (:p, 'day', 'x')", p=KRY)))
ck("a very long line is refused", not ok(as_user(uKRY, "insert into desk_lines (person_id, place, body) values (:p, 'later', repeat('x', 1001))", p=KRY)))
ck("each change bumps the line's version (two screens can tell)", one("select rev from desk_lines where id = :i", i=lid) >= 3)

N = as_user(uSAM, "insert into desk_stickies (person_id, color, body, from_person_id) values (:k, 'honey', 'Check on Linda?', :s) returning id", k=KRY, s=SAM)
ck("Samantha leaves Krystal a signed note", ok(N), N); nid = N[1][0][0] if ok(N) else None
ck("Krystal can't sign a note as Samantha", not ok(as_user(uKRY, "insert into desk_stickies (person_id, body, from_person_id) values (:k, 'x', :s)", k=KRY, s=SAM)))
ck("Angiel (not an owner) can't leave notes on Krystal's desk", not ok(as_user(uANG, "insert into desk_stickies (person_id, body, from_person_id) values (:k, 'x', :a)", k=KRY, a=ANG)))
ck("Krystal sees the note", rows(as_user(uKRY, "select id from desk_stickies where id = :i", i=nid)) == 1)
ck("Krystal moves it, marks it seen and says got it", ok(as_user(uKRY, "update desk_stickies set x = 10, seen_at = now(), ack_at = now() where id = :i", i=nid)))
ck("Krystal can't change its words", not ok(as_user(uKRY, "update desk_stickies set body = 'x' where id = :i", i=nid)))
ck("Krystal can't recolor it", not ok(as_user(uKRY, "update desk_stickies set color = 'pink' where id = :i", i=nid)))
ck("Samantha edits her note's words", ok(as_user(uSAM, "update desk_stickies set body = 'Check on Linda today?' where id = :i", i=nid)))
ck("Samantha can't mark it seen for Krystal", not ok(as_user(uSAM, "update desk_stickies set seen_at = now() + interval '1 day' where id = :i", i=nid)))
ck("Samantha can't peel it off Krystal's desk (she can take it back instead)", not ok(as_user(uSAM, "update desk_stickies set erased_at = now() where id = :i", i=nid)))
S = as_user(uKRY, "insert into desk_stickies (person_id, color, body) values (:k, 'pink', 'mine') returning id", k=KRY)
sid = S[1][0][0] if ok(S) else None
ck("Samantha can't move Krystal's own sticky", ok(as_user(uSAM, "update desk_stickies set x = 99 where id = :i", i=sid)) and one("select x from desk_stickies where id = :i", i=sid) != 99)
ck("Krystal peels her owner's note off", ok(as_user(uKRY, "update desk_stickies set erased_at = now() where id = :i", i=nid)))
N2 = as_user(uSAM, "insert into desk_stickies (person_id, body, from_person_id) values (:k, 'oops', :s) returning id", k=KRY, s=SAM)
ck("Samantha takes back a note she left", ok(as_user(uSAM, "delete from desk_stickies where id = :i returning id", i=N2[1][0][0])) and one("select count(*) from desk_stickies where id = :i", i=N2[1][0][0]) == 0)
ck("a note can't arrive already marked seen", not ok(as_user(uSAM, "insert into desk_stickies (person_id, body, from_person_id, seen_at) values (:k, 'x', :s, now())", k=KRY, s=SAM)))

ck("Samantha records that she stopped by", ok(as_user(uSAM, "insert into desk_visits (desk_person_id, visitor_person_id, day) values (:k, :s, current_date) on conflict (desk_person_id, visitor_person_id, day) do update set at = now()", k=KRY, s=SAM)))
ck("...twice in a day just updates the time", ok(as_user(uSAM, "insert into desk_visits (desk_person_id, visitor_person_id, day) values (:k, :s, current_date) on conflict (desk_person_id, visitor_person_id, day) do update set at = now()", k=KRY, s=SAM)))
ck("Krystal sees that Samantha stopped by", rows(as_user(uKRY, "select 1 from desk_visits")) == 1)
ck("Angiel doesn't see Krystal's visits", rows(as_user(uANG, "select 1 from desk_visits")) == 0)
ck("Krystal can't record a visit (not an owner)", not ok(as_user(uKRY, "insert into desk_visits (desk_person_id, visitor_person_id, day) values (:a, :k, current_date)", a=ANG, k=KRY)))
ck("a visit can't be signed as someone else", not ok(as_user(uSAM, "insert into desk_visits (desk_person_id, visitor_person_id, day) values (:k, :z, current_date)", k=KRY, z=ZAC)))
ck("nobody can erase a visit", not ok(as_user(uSAM, "delete from desk_visits")) and one("select count(*) from desk_visits") == 1)

ck("Krystal saves her desk mat and pad labels", ok(as_user(uKRY, "insert into desk_settings (person_id, mat, pad_labels) values (:k, 'sage', '{\"yellow\":\"remember\"}')", k=KRY)))
ck("Krystal can't switch her own desk on or off", not ok(as_user(uKRY, "update desk_settings set has_desk = false where person_id = :k", k=KRY)))
ck("an owner switches someone's desk on", ok(as_user(uSAM, "select desk_set_has_desk(:a, true)", a=ANG)) and one("select has_desk from desk_settings where person_id = :a", a=ANG) is True)
ck("...and Angiel can still save her own mat afterwards", ok(as_user(uANG, "update desk_settings set mat = 'navy' where person_id = :a", a=ANG)))
ck("Krystal can't switch Angiel's desk", not ok(as_user(uKRY, "select desk_set_has_desk(:a, false)", a=ANG)))
ck("Samantha sees Krystal's mat (owners see the desk as it is)", rows(as_user(uSAM, "select mat from desk_settings where person_id = :k", k=KRY)) == 1)
ck("a photo that isn't a small JPEG is refused", not ok(as_user(uKRY, "update desk_settings set photo = 'data:image/png;base64,AAAA' where person_id = :k", k=KRY)))
ck("Krystal stamps and folds her own page", ok(as_user(uKRY, "insert into desk_pages (person_id, day, stamp, dogear) values (:k, current_date, 'house', true)", k=KRY)))
ck("Samantha can't stamp Krystal's page", not ok(as_user(uSAM, "insert into desk_pages (person_id, day, stamp) values (:k, current_date - 1, 'sun')", k=KRY)))

c.run("insert into kind_words (quote, status, suggested_by) values ('Sugg', 'suggested', 'server'), ('Jar', 'kind', null)")
ck("Angiel sees jar words but not suggestions waiting for a decision", rows(as_user(uANG, "select 1 from kind_words")) == 1)
ck("Krystal (Care Coordinator) sees the suggestion too", rows(as_user(uKRY, "select 1 from kind_words")) == 2)
sugg = one("select id::text from kind_words where status = 'suggested'")
ck("Angiel can't decide about a suggestion (no Hub role)", not ok(as_user(uANG, "select kind_word_decide(:i, true)", i=sugg)) and one("select status from kind_words where id = :i", i=sugg) == "suggested")
ck("nobody can edit or delete a kind word from a browser", not ok(as_user(uSAM, "update kind_words set quote = 'x'")) and not ok(as_user(uSAM, "delete from kind_words")))
ck("Angiel can clip a kind word by hand", ok(as_user(uANG, "insert into kind_words (quote, status, created_by) values ('Kind!', 'kind', :a)", a=ANG)))
ck("...but not clip it as someone else", not ok(as_user(uANG, "insert into kind_words (quote, status, created_by) values ('x', 'kind', :k)", k=KRY)))
kwid = one("select id::text from kind_words where quote = 'Jar'")
c.run("insert into kind_word_drops (kind_word_id, person_id) values (:w, :k)", w=kwid, k=KRY)
ck("Krystal tapes a tucked kind word to her desk", ok(as_user(uKRY, "update kind_word_drops set state = 'taped' where person_id = :k", k=KRY)))
ck("...but can't move it to someone else's desk", not ok(as_user(uKRY, "update kind_word_drops set person_id = :a where person_id = :k", a=ANG, k=KRY)))
ck("the browser can't tuck kind words onto desks itself", not ok(as_user(uKRY, "insert into kind_word_drops (kind_word_id, person_id) values (:w, :a)", w=kwid, a=ANG)))

ck("the public key reads nothing", all(not ok(as_anon(f"select 1 from {t}")) for t in ("desk_lines", "desk_stickies", "desk_pages", "desk_settings", "desk_visits", "kind_words", "kind_word_drops")))
ck("the public key calls nothing", not ok(as_anon("select desk_me()")) and not ok(as_anon("select desk_tidy()")))
ck("no bulk delete for anyone signed in", not ok(as_user(uSAM, "truncate desk_lines")))
ck("tidying is for the server only", not ok(as_user(uSAM, "select desk_tidy()")))

# tidy: erased > 30 days and pages > 13 months go; stamps stay
c.run("insert into desk_lines (person_id, place, day, body, erased_at) values (:k, 'day', current_date, 'old erase', now() - interval '31 days'), (:k, 'day', current_date, 'fresh erase', now() - interval '2 days'), (:k, 'day', current_date - interval '14 months', 'ancient', null)", k=KRY)
c.run("insert into desk_pages (person_id, day, stamp) values (:k, current_date - interval '14 months', 'sun')", k=KRY)
t = json.loads(one("select desk_tidy()::text"))
ck("tidy removes 30-day-old erased lines and 13-month-old pages", t["erased_lines"] == 1 and t["old_lines"] == 1 and one("select count(*) from desk_lines where body = 'fresh erase'") == 1, t)
ck("tidy keeps the stamps", one("select count(*) from desk_pages where stamp = 'sun'") == 1)

# ── undo ──
c.run(BACK)
ck("the undo takes it all back out", one("select count(*) from pg_class where relname like 'desk\\_%' or relname like 'kind\\_word%'") == 0
   and one("select count(*) from pg_proc where proname like 'desk\\_%' or proname like 'kind\\_word\\_%'") == 0)
ck("...and leaves people, sign-ins and roles alone", one("select count(*) from persons") == 5 and one("select count(*) from staff_roles") == 4)
c.run("begin"); c.run(CHANGE); c.run("commit")
ck("the change goes back in cleanly after an undo", one("select to_regclass('public.desk_lines') is not null"))

fails = [x for x in res if not x[1]]
for n, good, d in res: print(("PASS" if good else "FAIL"), "·", n, ("" if good else "→ " + d))
print(f"{len(res) - len(fails)} / {len(res)}")
srv.cleanup() if hasattr(srv, "cleanup") else None
raise SystemExit(1 if fails else 0)
