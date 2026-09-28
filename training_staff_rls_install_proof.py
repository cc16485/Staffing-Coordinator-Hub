#!/usr/bin/env python3
# Desktop 282 against a fake Supabase: Management API + REST + Auth over a disposable Postgres shaped like the Training
# Platform (auth.users, auth.uid, the auth_all rules). REST counts are computed AS the signed-in user. Never touches production.
import os, json, threading, subprocess, hashlib, uuid, re
from http.server import BaseHTTPRequestHandler, HTTPServer
from decimal import Decimal
from urllib.parse import urlparse
H = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(H, "journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
MIGF = os.path.expanduser("~/Claude/Projects/Caring Companions Training Platform/supabase/training-staff-rls.sql"); SHA = hashlib.sha256(open(MIGF, "rb").read()).hexdigest()
c = Cluster("tri"); P = setup_supabase_like(c); s = c.su
for q in ["create schema if not exists auth", "create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, deleted_at timestamptz, banned_until timestamptz)",
          "create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$",
          "grant usage on schema auth to anon, authenticated", "grant execute on function auth.uid() to anon, authenticated",
          "create table caregivers (id uuid primary key default gen_random_uuid(), name text)", "alter table caregivers enable row level security",
          "grant all on caregivers to authenticated, anon", "create schema if not exists storage", "grant usage on schema storage to authenticated"]: s.run(q)
S = {}
def setup(signup_off=True, users=(("samantha@mo-care.com", True), ("krystal@mo-care.com", False))):
    s.run("drop policy if exists auth_all_caregivers on caregivers"); s.run("drop table if exists training_policy_backup"); s.run("drop function if exists public.is_training_staff()")
    s.run('create policy auth_all_caregivers on caregivers for all to authenticated using (true) with check (true)')
    s.run("delete from auth.users"); s.run("delete from caregivers"); s.run("insert into caregivers(name) values ('A'), ('B'), ('C')")
    S.clear(); S.update(signup_off=signup_off, ids={})
    for e, conf in users:
        i = str(uuid.uuid4()); S["ids"][e] = i
        s.run("insert into auth.users(id, email, email_confirmed_at) values (cast(:i as uuid), :e, case when :c then now() end)", i=i, e=e, c=conf)
def J(v): return int(v) if isinstance(v, Decimal) else (v if isinstance(v, (int, float, bool, str, dict, list, type(None))) else str(v))
class Hd(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def reply(self, code, obj, headers=None):
        b = json.dumps(obj).encode(); self.send_response(code)
        for k, v in (headers or {}).items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        u = urlparse(self.path)
        if u.path.endswith("/config/auth"): return self.reply(200, {"disable_signup": S["signup_off"]})
        if u.path.endswith("/api-keys"): return self.reply(200, [{"name": "anon", "api_key": "eyJanon"}, {"name": "service_role", "api_key": "eyJsvc"}])
        if u.path == "/rest/v1/caregivers":
            tok = self.headers.get("Authorization", "").replace("Bearer ", ""); uid = S.get("sessions", {}).get(tok, "")
            cc = c.conn(); cc.run("select set_config('request.jwt.claim.sub', :u, false)", u=uid); cc.run("set role " + ("authenticated" if uid else "anon"))
            n = cc.run("select count(*) from caregivers")[0][0]; cc.close()
            return self.reply(200, [], {"Content-Range": f"0-0/{n}"})
        self.reply(404, {})
    def do_POST(self):
        u = urlparse(self.path); body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        if u.path.endswith("/database/query"):
            q = body["query"]
            if q.lstrip().lower().startswith("-- ="):   # the migration: run as one script
                rc, out = c.psql(q); return self.reply(201 if rc == 0 else 400, [] if rc == 0 else {"message": out[-200:]})
            cc = c.conn()
            try:
                rows = cc.run(q); cols = [d["name"] for d in (cc.columns or [])]; return self.reply(201, [{k: J(v) for k, v in zip(cols, r)} for r in (rows or [])])
            except Exception as e: return self.reply(400, {"message": str(e)[:300]})
            finally: cc.close()
        if u.path == "/auth/v1/admin/generate_link": S["pending"] = body["email"]; return self.reply(200, {"hashed_token": "th"})
        if u.path == "/auth/v1/verify": S.setdefault("sessions", {})["eyJsess"] = S["ids"].get(S["pending"], ""); return self.reply(200, {"access_token": "eyJsess"})
        if u.path.startswith("/auth/v1/logout"): S["sessions"].pop("eyJsess", None); return self.reply(204, {})
        self.reply(404, {})
srv = HTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_address[1]}"; res = []
def ck(n, g, note=""): res.append((n, bool(g), "" if g else str(note)[-900:]))
def run(sha=SHA):
    rep = os.path.join(H, "_tri.txt")
    p = subprocess.run(["python3", "training_staff_rls_install.py"], cwd=H, capture_output=True, text=True, env=dict(os.environ, SB_TOKEN="sbp_x", SB_REPORT=rep,
        SB_API_BASE=BASE, SB_FN_BASE=BASE, SB_MIGFILE=MIGF, SB_EXPECTED_SHA=sha, SB_PROOF_EMAIL="samantha@mo-care.com"))
    t = open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr
    if os.path.exists(rep): os.remove(rep)
    return p.returncode, t
setup(); rc, t = run()
ck("happy path: DONE; staff still see data (count), the public key sees none; the sign-in is signed out", rc == 0 and "RESULT: DONE" in t and "you still see Training data (3 caregiver records)" in t
   and "public key sees no caregivers: 0" in t and "signed out" in t and not S["sessions"], t)
ck("Part 1 names who keeps access and who will not (an unconfirmed staff email), before anything changes", "✓ samantha@mo-care.com" in t and "○ krystal@mo-care.com · no access after this: email not confirmed" in t, t)
ck("nothing secret is printed", "eyJ" not in t, t)
setup(signup_off=False); rc, t = run()
ck("sign-up still on: STOP, nothing changed", rc == 2 and "not OFF" in t and s.run("select qual from pg_policies where policyname='auth_all_caregivers'")[0][0] == "true", t)
setup(users=(("samantha@mo-care.com", False),)); rc, t = run()
ck("if your own account would not qualify (unconfirmed): STOP so you are never locked out", rc == 2 and "lock you out" in t and s.run("select qual from pg_policies where policyname='auth_all_caregivers'")[0][0] == "true", t)
setup(); rc, t = run(sha="0" * 64)
ck("not the proven build: STOP, nothing changed", rc == 3 and s.run("select qual from pg_policies where policyname='auth_all_caregivers'")[0][0] == "true", t)
srv.shutdown(); c.close()
print("\nDESKTOP 282 · TRAINING STAFF-ONLY ACCESS · INSTALL PROOF\n" + "=" * 60); ok = True
for n, g, note in res: ok &= g; print(("PASS  " if g else "FAIL  ") + n + (("\n   └─ " + note) if note else ""))
print("=" * 60); print(f"ALL {len(res)} PROOFS PASS" if ok else "FAILED")
