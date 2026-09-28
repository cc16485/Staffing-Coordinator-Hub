#!/usr/bin/env python3
# Desktop 278 (open SMS relay) against a fake Supabase over a real disposable Postgres. Never touches production.
import os, json, threading, subprocess, hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
from decimal import Decimal
from urllib.parse import urlparse
H = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(H, "journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
c = Cluster("smi"); P = setup_supabase_like(c); s = c.su
for q in ["create table if not exists persons (person_id text primary key, full_name text, active boolean)",
          "create table if not exists staff_roles (person_id text, entity text, role text)",
          "create table orient_bookings (id uuid primary key default gen_random_uuid(), session_id text not null, first text not null, phone text, booked_at timestamptz not null default now())"]: s.run(q)
s.run("insert into persons values ('p1','Samantha Owner',true), ('p2','Krystal Coord',true)"); s.run("insert into staff_roles values ('p1','cc_ihs','owner_admin'), ('p2','cc_ihs','care_coordinator')")
SVC, ANON = "eyJsvc.x", "eyJanon.x"; S = {}
def setup(**k): S.clear(); S.update(dict(old_code=False, missing=False, page_old=False, vj=True), **k); s.run("alter table orient_bookings drop column if exists confirm_sms_at")
def J(v): return int(v) if isinstance(v, Decimal) else (v if isinstance(v, (int, float, bool, str, dict, list, type(None))) else str(v))
class Hd(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def reply(self, code, obj=None, text=None): b = (text if text is not None else json.dumps(obj)).encode(); self.send_response(code); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/v1/projects/r/functions/send-candidate-message": return self.reply(404, {}) if S["missing"] else self.reply(200, {"verify_jwt": S["vj"]})
        if u.path == "/v1/projects/r/api-keys": return self.reply(200, [{"name": "anon", "api_key": ANON}, {"name": "service_role", "api_key": SVC}])
        if u.path == "/page": return self.reply(200, text="sb.functions.invoke('send-candidate-message', { body: { first, phone, message: confMsg } })" if S["page_old"] else "body: { kind: 'orientation_confirmation', phone }")
        self.reply(404, {})
    def do_POST(self):
        u = urlparse(self.path); body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}"); auth = self.headers.get("Authorization", "")
        if u.path == "/v1/projects/r/database/query":
            cc = c.conn()
            try:
                rows = cc.run(body["query"]); cols = [d["name"] for d in (cc.columns or [])]
                return self.reply(201, [{k: J(v) for k, v in zip(cols, r)} for r in (rows or [])])
            except Exception as e: return self.reply(400, {"message": str(e)[:300]})
            finally: cc.close()
        if u.path == "/auth/v1/admin/generate_link": return self.reply(200, {"hashed_token": "th"})
        if u.path == "/auth/v1/verify": return self.reply(200, {"access_token": "eyJuser.samantha"})
        if u.path.startswith("/auth/v1/logout"): S["logged_out"] = True; return self.reply(204, {})
        if u.path == "/functions/v1/send-candidate-message":
            if S["old_code"]: return self.reply(400 if not body.get("message") else 200, {"success": True})
            if body.get("kind") == "orientation_confirmation": return self.reply(404, {"error": "no matching booking"})
            if auth == "Bearer eyJuser.samantha": return self.reply(200, {"ok": True, "authorized": True})
            return self.reply(401, {"error": "Sign in first."})
        self.reply(404, {})
srv = HTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_address[1]}"; FNROOT = os.path.join(H, "supabase", "functions")
FILES = ["send-candidate-message", "_shared/staff-auth.ts", "_shared/optout.ts"]
def sha(f): return hashlib.sha256(open(os.path.join(FNROOT, f) if f.endswith(".ts") else os.path.join(FNROOT, f, "index.ts"), "rb").read()).hexdigest()
res = []
def ck(n, g, note=""): res.append((n, bool(g), "" if g else str(note)[-900:]))
def run(shas=None):
    rep = os.path.join(H, "_smi.txt")
    p = subprocess.run(["python3", "security_sms_install.py"], cwd=H, capture_output=True, text=True, env=dict(os.environ, SB_TOKEN="sbp_x", SB_REF="r", SB_REPORT=rep,
        SB_API_BASE=BASE, SB_FN_BASE=BASE, SB_PAGE_URL=BASE + "/page", SB_SKIP_FUNCTION="1", SB_FNROOT=FNROOT, SB_PROOF_EMAIL="owner@example.test",
        SB_FN_SHAS=json.dumps(shas or {f: sha(f) for f in FILES})))
    t = open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr
    if os.path.exists(rep): os.remove(rep)
    return p.returncode, t
col = lambda: s.run("select exists (select 1 from information_schema.columns where table_name='orient_bookings' and column_name='confirm_sms_at')")[0][0]
setup(); rc, t = run()
ck("happy path: CLOSED; column added; every refusal proven; the staff check as the owner passes and is signed out; the live page is the new one",
   rc == 0 and "RESULT: CLOSED" in t and col() and t.count("refused, 401") == 2 and "refused, 404" in t and "staff permission check as you" in t and S.get("logged_out") and "asks for the fixed confirmation" in t, t)
ck("the report lists who can send staff texts by first name and role only, and hides every key", "Samantha (owner_admin)" in t and "Krystal (care_coordinator)" in t and SVC not in t and ANON not in t and "eyJuser" not in t, t)
setup(old_code=True); rc, t = run()
ck("if the old open relay were still answering, the proof fails loudly", rc == 9 and "relay may still be open" in t, t)
setup(page_old=True); rc, t = run()
ck("if the live page has not updated yet, it says so plainly and it is not a failure", rc == 0 and "still has the old call" in t, t)
setup(missing=True); rc, t = run()
ck("if the function is not deployed at all: STOP, nothing changed", rc == 2 and not col(), t)
setup(); bad = {f: sha(f) for f in FILES}; bad["send-candidate-message"] = "0" * 64; rc, t = run(bad)
ck("a source that is not the reviewed build: STOP before the column or the deploy", rc == 3 and not col() and "would deploy" not in t, t)
setup(vj=False); rc, t = run()
ck("keeps how it checks callers (here: off, so it deploys with --no-verify-jwt)", "would deploy send-candidate-message --no-verify-jwt" in t, t)
srv.shutdown(); c.close()
print("\nDESKTOP 278 · OPEN SMS RELAY · INSTALL PROOF\n" + "=" * 60); ok = True
for n, g, note in res: ok &= g; print(("PASS  " if g else "FAIL  ") + n + (("\n   └─ " + note) if note else ""))
print("=" * 60); print(f"ALL {len(res)} PROOFS PASS" if ok else "FAILED")
