#!/usr/bin/env python3
# Desktop 277 (0b-3 install) against a fake Supabase over a real disposable Postgres; the watcher and coverage
# "scheduled runs" are simulated after the deploy. Never touches production.
import os, json, threading, subprocess, hashlib, time
from http.server import BaseHTTPRequestHandler, HTTPServer
from decimal import Decimal
from urllib.parse import urlparse, parse_qs
H = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(H, "journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
c = Cluster("o3i"); P = setup_supabase_like(c); s = c.su
for q in ["create table if not exists contact_optout (id bigserial primary key)", "create table if not exists contact_send_refusal (id bigserial primary key)",
          "alter table app_data add column if not exists updated_at timestamptz not null default now()",
          "create schema if not exists net", "create table net._http_response (id bigserial, status_code int, content text, created timestamptz default now())"]: s.run(q)
SVC, ANON = "eyJsvc.x", "eyJanon.x"
DEPLOY = ["applicant-reengage", "interview-messages", "reference-chase", "caregiver-availability", "carematch-watch", "shift-confirm",
          "coverage-reply", "ht-local", "ht-support", "stripe-webhook", "resend-relay", "timekeeper-watch", "coverage-run"]
OPS = {"coverage_send_live": True, "confirm_live": True, "carematch_live": True, "timekeeper_watch_live": True, "timekeeper_text_live": False, "inquiry_ack_live": False}
S = {}
def setup(runs=("tk", "cov"), reengage=401, probe_ok=True):
    s.run("delete from app_data"); s.run("delete from net._http_response")
    s.run("insert into app_data(key,data) values ('ops_settings', cast(:v as jsonb))", v=json.dumps(OPS))
    s.run("insert into app_data(key,data) values ('automation_heartbeats', cast(:v as jsonb))", v=json.dumps([{"id": "hb_coverage-run", "at": "2026-01-01T00:00:00Z", "ok": True}]))
    S.clear(); S.update(runs=runs, reengage=reengage, probe_ok=probe_ok, verify={f: f in ("coverage-run", "timekeeper-watch", "interview-messages") for f in DEPLOY})
def scheduled_runs():   # what the crons do a moment after the deploy
    time.sleep(0.6)
    if "tk" in S["runs"]: s.run("insert into net._http_response(status_code, content) values (200, :c)", c=json.dumps({"mode": "LIVE (watch only)", "settings_in_effect": {"switches": {"timekeeper_watch_live": True}}}))
    if "cov" in S["runs"]:
        from datetime import datetime, timezone
        s.run("update app_data set data = cast(:v as jsonb) where key = 'automation_heartbeats'", v=json.dumps([{"id": "hb_coverage-run", "at": datetime.now(timezone.utc).isoformat(), "ok": True}]))
def J(v): return int(v) if isinstance(v, Decimal) else (v if isinstance(v, (int, float, bool, str, dict, list, type(None))) else str(v))
class Hd(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def reply(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        u = urlparse(self.path)
        if u.path.startswith("/v1/projects/r/functions/"): return self.reply(200, {"verify_jwt": S["verify"][u.path.rsplit("/", 1)[1]]})
        if u.path == "/v1/projects/r/api-keys": return self.reply(200, [{"name": "anon", "api_key": ANON}, {"name": "service_role", "api_key": SVC}])
        self.reply(404, {})
    def do_POST(self):
        u = urlparse(self.path); body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        if u.path == "/v1/projects/r/database/query":
            cc = c.conn()
            try:
                rows = cc.run(body["query"]); cols = [d["name"] for d in (cc.columns or [])]
                return self.reply(201, [{k: J(v) for k, v in zip(cols, r)} for r in (rows or [])])
            except Exception as e: return self.reply(400, {"message": str(e)[:300]})
            finally: cc.close()
        fn = u.path.rsplit("/", 1)[1]
        if fn == "lead-followup": return self.reply(200, {"probe": "dnd", "staff_contact": True, "contact_found": True, "upsert_has_dnd": True, "get_has_dnd": S["probe_ok"], "check_reads_ok": True})
        if fn == "applicant-reengage": return self.reply(S["reengage"], {})
        if fn in ("campaign-send", "circle-send"): return self.reply(401, {})
        self.reply(404, {})
srv = HTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_address[1]}"
FNROOT = os.path.join(H, "supabase", "functions")
FILES = DEPLOY + ["_shared/optout.ts", "_shared/outreach.ts", "_shared/staff-auth.ts"]
def sha(f): return hashlib.sha256(open(os.path.join(FNROOT, f) if f.endswith(".ts") else os.path.join(FNROOT, f, "index.ts"), "rb").read()).hexdigest()
res = []
def ck(n, g, note=""): res.append((n, bool(g), "" if g else str(note)[-900:]))
def run(shas=None):
    rep = os.path.join(H, "_o3i.txt")
    threading.Thread(target=scheduled_runs, daemon=True).start()
    p = subprocess.run(["python3", "optout_0b3_install.py"], cwd=H, capture_output=True, text=True, env=dict(os.environ,
        SB_TOKEN="sbp_x", SB_REF="r", SB_REPORT=rep, SB_API_BASE=BASE, SB_FN_BASE=BASE, SB_SKIP_FUNCTION="1", SB_FNROOT=FNROOT,
        SB_POLL_SEC="0.3", SB_POLL_MAX="4", SB_FN_SHAS=json.dumps(shas or {f: sha(f) for f in FILES})))
    t = open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr
    if os.path.exists(rep): os.remove(rep)
    return p.returncode, t
deployed = lambda t: [l.split("would deploy ")[1].split()[0] for l in t.splitlines() if "would deploy" in l]

setup(); rc, t = run()
ck("happy path: DONE; all 13 deploy with the two tight-schedule functions (watcher, coverage) last", rc == 0 and "RESULT: DONE" in t and deployed(t) == DEPLOY, t)
ck("each keeps how it checks callers (watcher, coverage and interview messages ON; the rest off)",
   "would deploy coverage-run\n" in t + "\n" and "would deploy timekeeper-watch\n" in t and "would deploy ht-local --no-verify-jwt" in t, t)
ck("live proof: GHL still carries Do Not Disturb, applicant re-engage now refuses strangers, the security slice holds, no switch moved",
   "GoHighLevel still answers with Do Not Disturb" in t and "applicant re-engage (new) refuses a caller who is not signed in: 401" in t and t.count("refuses a caller who is not signed in: 401") == 3 and "no switch moved" in t, t)
ck("live proof: the watcher and coverage each complete a scheduled run on the new code", "clock-in watcher completed a scheduled run" in t and "coverage completed a scheduled run" in t, t)
ck("nothing secret reaches the report", SVC not in t and ANON not in t, t)
setup(runs=("tk",)); rc, t = run()
ck("if coverage does not run after the deploy, it says so loudly (coverage is critical)", rc == 9 and "no coverage heartbeat since the deploy" in t, t)
setup(runs=("cov",)); rc, t = run()
ck("if the watcher does not run after the deploy, it says so", rc == 9 and "no completed watcher run seen yet" in t, t)
setup(reengage=200); rc, t = run()
ck("if applicant re-engage let a stranger through, the proof fails", rc == 9 and "applicant re-engage (new) answered 200" in t, t)
setup(probe_ok=False); rc, t = run()
ck("if GHL's direct look-up stopped carrying Do Not Disturb (the saved-contact door needs it), the proof fails", rc == 9 and "the GoHighLevel check did not pass" in t, t)
setup(); bad = {f: sha(f) for f in FILES}; bad["coverage-run"] = "0" * 64; rc, t = run(bad)
ck("a source that is not the reviewed build: STOP before anything deploys", rc == 4 and deployed(t) == [], t)
srv.shutdown(); c.close()
print("\nDESKTOP 277 · 0b-3 INSTALL · PROOF\n" + "=" * 60); ok = True
for n, g, note in res: ok &= g; print(("PASS  " if g else "FAIL  ") + n + (("\n   └─ " + note) if note else ""))
print("=" * 60); print(f"ALL {len(res)} PROOFS PASS" if ok else "FAILED")
