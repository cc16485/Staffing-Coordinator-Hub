#!/usr/bin/env python3
# Rehearsal of 499 / 499b (Past and Deceased previews) from a FRESH copy at the commit being tested, against a FAKE Supabase:
# a throwaway local Postgres with the people tables, a fake Management API, fake sign-in and a fake client-journey care_state
# (it answers from the same tables, with the real careState rule). Never touches a real project. (REHEARSE_COMMIT pins a commit)
import json, os, re, subprocess, sys, tempfile, threading, http.server, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "my_desk_463_sql_test.py")).read()
exec(src[:src.index("c = conn(); setup(c)")])
from pg8000.native import DatabaseError
REF = "zngsgedlsxinbygwmxwn"; COMMIT = os.environ.get("REHEARSE_COMMIT") or subprocess.run(["git", "rev-parse", "HEAD"], cwd=HERE, capture_output=True, text=True).stdout.strip()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
S = {"signed_out": 0, "extra_col": False}
def q1(sql_, **kw):
    c = conn()
    try: rows = c.run(sql_, **kw); cols = [x["name"] for x in (c.columns or [])]; return [dict(zip(cols, r)) for r in (rows or [])]
    finally: c.close()
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body):
        b = json.dumps(body, default=str).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path.startswith(f"/v1/projects/{REF}/api-keys?reveal=true") and self.headers.get("Authorization") == "Bearer sbp_fake":
            return self._send(200, [{"name": "anon", "api_key": "eyJanon"}, {"name": "service_role", "api_key": "eyJsvc"}])
        self._send(404, {})
    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0)); body = json.loads(raw or b"{}")
        if self.path.endswith(f"/v1/projects/{REF}/database/query"):
            if self.headers.get("Authorization") != "Bearer sbp_fake": return self._send(401, {"message": "bad token"})
            cc = conn()
            try:
                rows = cc.run(body["query"]); cols = [c["name"] for c in (cc.columns or [])]
                return self._send(201, [dict(zip(cols, r)) for r in (rows or [])])
            except DatabaseError as e:
                try: cc.run("rollback")
                except Exception: pass
                return self._send(400, {"message": str(e)[:200]})
            finally: cc.close()
        if self.path == "/auth/v1/admin/generate_link": return self._send(200, {"properties": {"hashed_token": "h1"}}) if self.headers.get("apikey") == "eyJsvc" else self._send(401, {})
        if self.path == "/auth/v1/verify": return self._send(200, {"access_token": "eyJme"}) if body.get("token_hash") == "h1" else self._send(400, {})
        if self.path.startswith("/auth/v1/logout"): S["signed_out"] += 1; return self._send(204, {})
        if self.path == "/functions/v1/client-journey":
            if self.headers.get("Authorization") != "Bearer eyJme": return self._send(401, {"error": "sign in"})
            rs = q1("""select r.status, r.end_reason from person_source_id s join person_role r on r.person_id = s.person_id and r.role = 'client'
                       where s.system = 'axiscare' and s.entity_type = 'client' and s.source_id = :a""", a=str(body.get("axiscare_client_id")))
            st = "deceased" if any("deceas" in str(r["end_reason"] or "").lower() for r in rs) and not any(r["status"] == "active" for r in rs) else \
                 "active" if any(r["status"] == "active" for r in rs) else "past" if rs else "unknown"
            return self._send(200, {"state": st, "can": {"pause": st in ("active", "starting"), "end": st in ("active", "starting", "paused"), "resume": False, "return": st == "past"}})
        self._send(404, {})
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
T = tempfile.mkdtemp(prefix="reh499-"); W = os.path.join(T, "hub")
subprocess.run(["git", "worktree", "add", "-q", "--detach", W, COMMIT], cwd=HERE, check=True)
def fresh():
    c = conn(); setup(c)
    for t in ("person_role", "person_source_id", "person_identity"): c.run(f"drop table if exists public.{t} cascade")
    c.run("create table public.person_identity (id uuid primary key default gen_random_uuid(), display_name text not null, first_name text, last_name text, primary_phone text, created_at timestamptz not null default now())")
    c.run("""create table public.person_source_id (id bigserial primary key, person_id uuid not null references public.person_identity(id) on delete cascade, system text not null,
      entity_type text not null, source_id text not null, confidence text not null default 'confirmed', needs_review boolean not null default false, evidence text)""")
    c.run("create unique index person_source_axiscare_uniq on public.person_source_id (entity_type, source_id) where system = 'axiscare'")
    c.run("""create table public.person_role (id bigserial primary key, person_id uuid not null references public.person_identity(id), role text not null,
      status text not null default 'active' check (status in ('active','former','prospective')), started_at date, ended_at date, end_reason text, updated_at timestamptz not null default now())""")
    c.run("insert into public.person_identity (id, display_name) values ('00000000-0000-0000-0000-000000000001', 'Edward Anderson')")
    c.run("insert into public.person_source_id (person_id, system, entity_type, source_id) values ('00000000-0000-0000-0000-000000000001', 'axiscare', 'client', '296')")
    c.run("insert into public.person_role (person_id, role, status) values ('00000000-0000-0000-0000-000000000001', 'client', 'active')")
    c.close(); S["signed_out"] = 0
def run(mode="add", **over):
    rep = os.path.join(T, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_API_BASE=URL, SB_FN_BASE=URL, SB_MODE=mode); env.update(over)
    p = subprocess.run([sys.executable, os.path.join(W, "samples_499.py")], env=env, capture_output=True, text=True, timeout=300)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
count = lambda: q1("select (select count(*) from person_identity)::int as p, (select count(*) from person_source_id)::int as s, (select count(*) from person_role)::int as r")[0]
try:
    fresh(); code, out = run()
    ck("DONE: two samples added and proven", code == 0 and "RESULT: DONE" in out and "✗" not in out, out)
    ck("...exactly two people, two numbers, two roles added; Edward untouched", count() == {"p": 3, "s": 3, "r": 3} and q1("select status from person_role where person_id = '00000000-0000-0000-0000-000000000001'")[0]["status"] == "active", count())
    rows = q1("select s.source_id, p.display_name, r.status, r.ended_at, r.end_reason from person_source_id s join person_identity p on p.id = s.person_id join person_role r on r.person_id = p.id where s.source_id like '99%' order by 1")
    ck("...Past: ended role, no date, no reason; Deceased: ended role, no date, 'deceased'", [(x["source_id"], x["display_name"], x["status"], x["ended_at"], x["end_reason"]) for x in rows]
       == [("9900001", "TEST Past Sample", "former", None, None), ("9900002", "TEST Deceased Sample", "former", None, "deceased")], rows)
    ck("...the profile reads Past and Deceased with no Pause or End", "TEST Past Sample: the profile reads Past" in out and "TEST Deceased Sample: the profile reads Deceased" in out, out)
    ck("...both on the shift jobs' quiet list", "both are on the list every shift job skips" in out, out)
    ck("...the in-run sign-in was signed out, and no key or token is in the report", S["signed_out"] == 1 and not re.search(r"eyJ|sbp_", out), out)
    ck("...the report gives her the two links", "#p/A9900001/summary" in out and "#p/A9900002/summary" in out, out)
    code, out = run()
    ck("run again: nothing doubled", code == 0 and "already here (kept" in out and count() == {"p": 3, "s": 3, "r": 3}, out)
    code, out = run("remove")
    ck("499b: removes exactly the two samples", code == 0 and "both samples removed" in out and count() == {"p": 1, "s": 1, "r": 1}, out)
    code, out = run("remove")
    ck("499b again: nothing to remove", code == 0 and "already removed" in out, out)
    fresh(); c = conn(); c.run("insert into person_identity (id, display_name) values ('00000000-0000-0000-0000-000000000009', 'Real Person')")
    c.run("insert into person_source_id (person_id, system, entity_type, source_id) values ('00000000-0000-0000-0000-000000000009', 'axiscare', 'client', '9900001')"); c.close()
    code, out = run(); code2, out2 = run("remove")
    ck("a real person on 9900001: both add and remove refuse, nothing changes", code == 2 and code2 == 2 and "belongs to a real person" in out and count() == {"p": 2, "s": 2, "r": 1}, out + out2)
    fresh(); c = conn(); c.run("alter table person_identity add column must_have text not null"); c.close(); code, out = run()
    ck("a required column it doesn't fill: stops before adding anything", code == 2 and "person_identity.must_have" in out and count()["p"] == 1, out)
    fresh(); code, out = run(SB_TOKEN="nope")
    ck("no token: nothing runs", code == 2 and count()["p"] == 1, out)
finally:
    subprocess.run(["git", "worktree", "remove", "--force", W], cwd=HERE); shutil.rmtree(T, ignore_errors=True); H.shutdown()
for n, okk, d_ in res: print(("PASS" if okk else "FAIL"), "·", n, d_)
print(f"{sum(1 for x in res if x[1])} passed, {sum(1 for x in res if not x[1])} failed")
raise SystemExit(0 if all(x[1] for x in res) else 1)
