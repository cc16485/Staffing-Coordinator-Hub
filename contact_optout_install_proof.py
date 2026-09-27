#!/usr/bin/env python3
# Desktop 273 (0b-1 install) against a fake Management API whose database is a real disposable Postgres. Never touches production.
import os, json, threading, subprocess, hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
from decimal import Decimal
H = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(H, "journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
MIGFILE = os.path.join(H, "contact-optout.sql"); SHA = hashlib.sha256(open(MIGFILE, "rb").read()).hexdigest()
c = Cluster("coi"); P = setup_supabase_like(c); s = c.su
OPS = {"inquiry_ack_live": False, "inquiry_followups_live": False, "timekeeper_text_live": False, "timekeeper_watch_live": True, "levels": [1]}
for q in ["alter table app_data add column if not exists updated_at timestamptz not null default now()",
          "create table circle_contacts (id bigserial primary key, phone text, stopped_at timestamptz)",
          "insert into circle_contacts(phone, stopped_at) values ('4175550101', now()), ('4175550202', null)"]:
    s.run(q)
for k, v in (("ops_settings", OPS), ("leads", [{"id": "L1", "do_not_contact": True}, {"id": "L2"}, {"id": "L3", "do_not_contact": False}]),
             ("phone_suppress", ["+14175559999"])):
    s.run("insert into app_data(key,data) values (:k, cast(:v as jsonb)) on conflict (key) do update set data = excluded.data", k=k, v=json.dumps(v))
NO_STAMP = """create or replace function public.upsert_app_data_item(target_key text, item jsonb) returns void language plpgsql security definer as $f$
begin update public.app_data set data = data || jsonb_build_array(item) where key = target_key; end $f$"""
STAMP = NO_STAMP.replace("where key = target_key", ", updated_at = now() where key = target_key").replace("set data = data || jsonb_build_array(item) ,", "set data = data || jsonb_build_array(item),")
s.run(NO_STAMP)
def J(v): return int(v) if isinstance(v, Decimal) else (v if isinstance(v, (int, float, bool, str, dict, list, type(None))) else str(v))
class Hd(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        q = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)))["query"]
        if q.lstrip().lower().startswith("begin") or "\nbegin;" in q:   # a migration: run it as one script, the way the API does
            rc, out = c.psql(q)
            if rc == 0: b = b"[]"; self.send_response(201)
            else: b = json.dumps({"message": out[-300:]}).encode(); self.send_response(400)
            self.end_headers(); self.wfile.write(b); return
        cc = c.conn()
        try:
            rows = cc.run(q); cols = [d["name"] for d in (cc.columns or [])]
            b = json.dumps([{k: J(v) for k, v in zip(cols, r)} for r in (rows or [])]).encode(); self.send_response(201)
        except Exception as e: b = json.dumps({"message": str(e)[:300]}).encode(); self.send_response(400)
        finally: cc.close()
        self.end_headers(); self.wfile.write(b)
srv = HTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=srv.serve_forever, daemon=True).start()
res = []
def ck(n, g, note=""): res.append((n, bool(g), "" if g else str(note)[-900:]))
def run(token="sbp_x", sha=SHA):
    rep = os.path.join(H, "_coi.txt")
    p = subprocess.run(["python3", "contact_optout_install.py"], cwd=H, capture_output=True, text=True,
                       env=dict(os.environ, SB_TOKEN=token, SB_REF="r", SB_REPORT=rep, SB_API_BASE=f"http://127.0.0.1:{srv.server_address[1]}",
                                SB_MIGFILE=MIGFILE, SB_EXPECTED_SHA=sha))
    t = open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr
    if os.path.exists(rep): os.remove(rep)
    return p.returncode, t
installed = lambda: s.run("select to_regclass('public.contact_optout') is not null")[0][0]
fp = lambda: s.run("select md5(string_agg(key || data::text || updated_at::text, ',' order by key)) || (select md5(string_agg(phone || coalesce(stopped_at::text,''), ',' order by id)) from circle_contacts) from app_data")[0][0]

rc, t = run(token="eyJ-not-a-management-token")
ck("a wrong kind of token: nothing is read or changed", rc == 1 and not installed(), t)
rc, t = run(sha="0" * 64)
ck("a migration file that is not the proven build: Part 1 still reports, then it stops before installing", rc == 3 and "NOT the proven build" in t and "1a." in t and not installed(), t)
s.run("alter table circle_contacts rename to circle_contacts_x")
rc, t = run(); s.run("alter table circle_contacts_x rename to circle_contacts")
ck("if an existing opt-out source can't be read, it stops before installing", rc == 2 and "STOP: Part 1 could not read everything" in t and not installed(), t)
f0 = fp(); rc, t = run()
ck("fresh install: DONE, tables and view present, both empty, guards and privileges exactly as designed",
   rc == 0 and installed() and s.run("select count(*) from contact_optout")[0][0] == 0 and all(x in t for x in (
       "✓ both tables, the current-word view, and all four functions exist", "✓ both are empty", "✓ append-only guards", "✓ who can do what", "RESULT: DONE")), t)
ck("Part 1 answers the updated_at question from the real function definition (here: it does NOT stamp it, and no trigger does)",
   "does NOT mention updated_at" in t and "runs as its owner (definer)" in t and "nothing stamps updated_at on a hub save" in t and "| create or replace function" in t.lower().replace("create or replace function", "create or replace function"), t)
ck("Part 1 counts today's signals: 1 of 3 inquiries do-not-contact, 1 of 2 circle contacts stopped, 1 suppressed spam number",
   "do-not-contact: 1 of 3" in t and "marked stopped: 1 of 2" in t and "(the spam/sales list, not a family opt-out; reported only): 1" in t, t)
ck("existing data is untouched (every app_data row, including updated_at, and every circle contact)", fp() == f0)
ck("no switch moved, and the report says so", "✓ no switch moved: inquiry_ack_live False · inquiry_followups_live False · timekeeper_text_live False · timekeeper_watch_live True" in t, t)
s.run(STAMP); s.run("insert into app_data(key,data) values ('_x','[]')"); s.run("delete from app_data where key = '_x'")
rc, t = run()
ck("rerun while still empty: allowed, reports 'already installed', and reads a function that DOES stamp updated_at correctly",
   rc == 0 and "already installed" in t and "✓ it sets updated_at itself" in t, t)
s.run(NO_STAMP); s.run("create function app_data_touch_fn() returns trigger language plpgsql as $f$ begin new.updated_at := now(); return new; end $f$")
s.run("create trigger app_data_touch before update on app_data for each row execute function app_data_touch_fn()")
rc, t = run(); s.run("drop trigger app_data_touch on app_data"); s.run("create trigger app_data_other before update on app_data for each row execute function public.contact_optout_guard()")
rc2, t2 = run(); s.run("drop trigger app_data_other on app_data")
ck("a trigger whose FUNCTION stamps updated_at is found by reading its body; one that doesn't is not mistaken for it",
   "a trigger stamps updated_at anyway: app_data_touch" in t and "app_data triggers: app_data_other" in t2 and "nothing stamps updated_at on a hub save" in t2, (t, t2))
svc = c.conn("service_role"); svc.run("select public.contact_optout_record('4175550101','sms','staff','Daughter asked us to stop texting','krystal@mo-care.com')"); svc.close()
rc, t = run()
ck("once a real opt-out is recorded, a reinstall refuses, and the opt-out is still there", rc == 4 and "STOPPED" in t and "refused" in t
   and s.run("select count(*) from contact_optout")[0][0] == 1, t)
srv.shutdown(); c.close()
print("\nDESKTOP 273 · 0b-1 OPT-OUT RECORD INSTALL · PROOF\n" + "=" * 60); ok = True
for n, g, note in res: ok &= g; print(("PASS  " if g else "FAIL  ") + n + (("\n   └─ " + note) if note else ""))
print("=" * 60); print(f"ALL {len(res)} PROOFS PASS" if ok else "FAILED")
