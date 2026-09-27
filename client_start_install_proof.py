#!/usr/bin/env python3
# Desktop 259/260 against fake Supabase services whose database is a real disposable Postgres. Never touches production.
import os, json, threading, subprocess, hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
from decimal import Decimal
H = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(H, "journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
FNROOT = os.path.join(H, "supabase", "functions")
SHAS = {"client-start-run": hashlib.sha256(open(os.path.join(FNROOT, "client-start-run", "index.ts"), "rb").read()).hexdigest()}
ENGINE = open(os.path.join(H, "..", "cc-hub-live", "client-start.js"), "rb").read(); ENGINE_SHA = hashlib.sha256(ENGINE).hexdigest()
c = Cluster("csi"); s = c.su
s.run("create table app_data (key text primary key, data jsonb, updated_at timestamptz)")
s.run("create schema cron"); s.run("create table cron.job (jobname text primary key, schedule text, command text, active boolean default true)")
s.run("create function cron.schedule(n text, sc text, cmd text) returns bigint language sql as $$ insert into cron.job values (n, sc, cmd, true) returning 1::bigint $$")
s.run("create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n returning true $$")
def flag(): return s.run("select data->>'client_start_live', data->'client_start_approved', data->>'other' from app_data where key='ops_settings'")[0]
S = {"calls": [], "engine": ENGINE, "fail": False}
def J(v): return int(v) if isinstance(v, Decimal) else (v if isinstance(v, (int, float, bool, str, dict, list, type(None))) else str(v))
PREVIEW = {"ok": True, "leads_with_a_start": 12, "in_scope": 10, "stuck_now": 2, "held_too_old": 1, "deferred": 0, "max_per_run": 10,
  "create_preview": [{"about": "Mary Smith", "waited_days": 15, "step": "Signed Care Agreement received", "role": "family", "window": 14, "owner": "krystal@mo-care.com", "urgency": "normal", "escalate_on": "2026-09-15"}],
  "update_preview": [], "held_preview": [{"about": "Old Lead", "step": "In-home assessment", "waited_days": 200}], "close_preview": [{"about": "Ann Lee", "why": "Moving again, now on: Billing setup"}],
  "unrouted_preview": [{"pathway": "PP", "step": "zz9", "label": "mystery", "who": "Bo"}]}
class Hd(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj, raw=None):
        b = raw if raw is not None else json.dumps(obj).encode(); self.send_response(code); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path.endswith("/api-keys"): return self.send(200, [{"name": "anon", "api_key": "anon-key"}, {"name": "service_role", "api_key": "svc-key"}])
        if self.path.startswith("/client-start.js"): return self.send(200, None, S["engine"])
        self.send(404, {})
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        if self.path.endswith("/database/query"):
            cc = c.conn()
            try:
                rows = cc.run(body["query"]); cols = [d["name"] for d in (cc.columns or [])]
                return self.send(200, [{k: J(v) for k, v in zip(cols, r)} for r in (rows or [])])
            except Exception as e: return self.send(400, {"message": str(e)[:300]})
            finally: cc.close()
        if self.path.startswith("/functions/v1/client-start-run"):
            on = flag()[0] == "true"; dry = "dry=1" in self.path
            S["calls"].append({"dry": dry, "on": on, "auth": self.headers.get("Authorization")})
            if S["fail"]: return self.send(500, {"error": "boom"})
            return self.send(200, dict(PREVIEW, dry=dry or not on, created=(1 if on and not dry else 0), updated=0, closed=(1 if on and not dry else 0), write_errors=[]))
        self.send(404, {})
srv = HTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{srv.server_address[1]}"
res = []
def ck(n, g, note=""): res.append((n, bool(g), "" if g else str(note)[-900:]))
def reset(on=False):
    s.run("delete from app_data"); s.run("delete from cron.job")
    s.run("insert into app_data values ('ops_settings', cast(:d as jsonb), now())", d=json.dumps({"client_start_live": on, "other": "kept"}))
    S["calls"].clear(); S["fail"] = False; S["engine"] = ENGINE
def go(answer, shas=SHAS, mode="install"):
    rep = os.path.join(H, "_csi.txt")
    p = subprocess.run(["python3", "client_start_install.py"], cwd=H, input=answer, capture_output=True, text=True, env=dict(os.environ, SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(shas),
        SB_ENGINE_SHA=ENGINE_SHA, SB_REPORT=rep, SB_TOKEN="sbp_x", SB_REF="r", SB_SKIP_FUNCTION="1", SB_API_BASE=base, SB_FN_BASE=base, SB_ENGINE_URL=base + "/client-start.js", SB_MODE=mode))
    t = open(rep).read() if os.path.exists(rep) else ""
    if os.path.exists(rep): os.remove(rep)
    return p.returncode, t
jobs = lambda: s.run("select jobname, schedule, command from cron.job")
reset(); rc, t = go("yes\n", shas={"client-start-run": "0" * 64})
ck("a changed function stops before anything runs", rc == 2 and not S["calls"] and not jobs())
reset(); S["engine"] = b"old file"; rc, t = go("yes\n")
ck("a live hub still serving an older client-start.js stops it (merge first); nothing scheduled or run", rc == 3 and "not the reviewed version" in t and not jobs() and not S["calls"], t[-300:])
reset(); rc, t = go("no\n")
ck("answer not 'yes': installed, scheduled hourly, LEFT OFF; only the preview ran", rc == 0 and "LEFT OFF" in t and flag()[0] == "false" and [x["dry"] for x in S["calls"]] == [True]
   and jobs()[0][0] == "client-start-run" and jobs()[0][1] == "35 * * * *" and "Bearer anon-key" in jobs()[0][2] and "svc-key" not in jobs()[0][2], (t[-500:], jobs()))
ck("the preview names each stuck start, the step, who owns the wait, the window, whose list, and the escalation date",
   '• Mary Smith · waiting 15 days on "Signed Care Agreement received" (the family, window 14 days)' in t and "goes to: krystal@mo-care.com · normal · a supervisor is pulled in 2026-09-15" in t, t)
ck("the preview lists the too-old start for a decision, what closes, and the step with no owner (never guessed)",
   "held, stuck 200 days" in t and "decide on the lead" in t and "✓ closes: Ann Lee" in t and "✗ no owner for step PP:zz9" in t, t)
reset(); rc, t = go("yes\n")
ck("a typed yes switches it on, records the approval, keeps other settings, and runs once live", rc == 0 and flag()[0] == "true" and flag()[1]["confirmed_at_install"] == "yes" and flag()[2] == "kept"
   and [(x["dry"], x["on"]) for x in S["calls"]] == [(True, False), (False, True)] and "FIRST LIVE RUN: 1 added to My Work" in t and "RESULT: INSTALLED AND ON" in t, (S["calls"], t[-400:]))
ck("the service key is used for the runs and never printed", S["calls"][0]["auth"] == "Bearer svc-key" and "svc-key" not in t)
reset(on=True); rc, t = go("")
ck("if it was already on, it is paused for the preview and stays off without a yes", S["calls"][0]["on"] is False and flag()[0] == "false" and "LEFT OFF" in t)
reset(); S["fail"] = True; rc, t = go("yes\n")
ck("a failed preview stops it; it stays off; nothing is asked", rc == 7 and flag()[0] == "false" and "answer:" not in t, t[-300:])
reset(on=True); rc, t = go("", mode="off")
ck("Desktop 260 switches it off and keeps everything else", rc == 0 and flag()[0] == "false" and flag()[2] == "kept" and "switched off" in t)
srv.shutdown(); c.close()
print("\nDESKTOP 259/260 · STALLED STARTS · PROOF\n" + "=" * 60); ok = True
for n, g, note in res: ok &= g; print(("PASS  " if g else "FAIL  ") + n + (("\n   └─ " + note) if note else ""))
print("=" * 60); print(f"ALL {len(res)} PROOFS PASS" if ok else "FAILED"); print("shas:", json.dumps(SHAS), "engine:", ENGINE_SHA)
