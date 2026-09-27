#!/usr/bin/env python3
# Desktop 271 (combined check) against a fake API over a real disposable Postgres. Never touches production.
import os, json, threading, subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer
from decimal import Decimal
H = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(H, "journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
c = Cluster("s0c"); P = setup_supabase_like(c); s = c.su
for q in ["create schema if not exists cron", "create table cron.job (jobid serial, jobname text, schedule text, active boolean, command text)",
          "create schema if not exists net", "create table net._http_response (id bigserial, status_code int, content text, created timestamptz default now())",
          "create table if not exists applicant_alerts (name text, phone text, email text, alert_on text[], active boolean)"]: s.run(q)
PAUSE = "2026-09-27T23:00:00Z"
def setup(ops=None, camp=None, leads=None, watcher="watch_only", dry=None):
    s.run("delete from app_data"); s.run("delete from cron.job"); s.run("delete from net._http_response"); s.run("delete from applicant_alerts")
    ops = ops or {"timekeeper_text_live": False, "timekeeper_watch_live": True, "inquiry_ack_live": False, "inquiry_followups_live": False,
                  "inquiry_paused": {"at": PAUSE, "recorded_by": "Desktop 269"}}
    camp = camp or [{"id": "settings", "enabled": True, "aud_monthly": False, "aud_clients": False, "aud_client_contacts": False, "aud_caregivers": True}]
    leads = leads or [{"id": "L1", "ack_sent_at": "2026-09-26T10:00:00Z"}]
    for k, v in (("ops_settings", ops), ("campaign_settings", camp), ("leads", leads)):
        s.run("insert into app_data(key,data) values (:k, cast(:v as jsonb))", k=k, v=json.dumps(v))
    for j in ("timekeeper-watch", "lead-followup", "daily-campaign-auto"): s.run("insert into cron.job(jobname,schedule,active,command) values (:j,'x',true,'x')", j=j)
    s.run("insert into applicant_alerts values ('Krystal','1','k@x','{applicant,lead}',true),('Samantha','2','s@x','{applicant,lead}',true)")
    mode = {"watch_only": "LIVE (watch only — texting off)", "texting": "LIVE (watch + text)"}[watcher]
    s.run("insert into net._http_response(status_code,content) values (200, :c)", c=json.dumps({"mode": mode, "texts_sent": 0 if watcher == "watch_only" else 2, "clockout_texts_sent": 0,
          "settings_in_effect": {"switches": {"timekeeper_text_live": watcher != "watch_only", "timekeeper_watch_live": True}}}))
    D["dry"] = dry or {"ok": True, "dry": True, "would": {"acknowledge": [], "nudge": [], "office": ["Old lead"], "paused_ack": ["Fay"], "paused_followups": ["Dee", "Tia"]}}
D = {}
def J(v): return int(v) if isinstance(v, Decimal) else (v if isinstance(v, (int, float, bool, str, dict, list, type(None))) else str(v))
writes = []
class Hd(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path.endswith("/api-keys"): return self.send(200, [{"name": "service_role", "api_key": "SVC"}])
        self.send(404, {})
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        if self.path.endswith("/database/query"):
            q = body["query"]
            if not q.lstrip().lower().startswith(("select", "with")): writes.append(q)
            cc = c.conn()
            try:
                cc.run("set transaction read only"); rows = cc.run(q); cols = [d["name"] for d in (cc.columns or [])]
                return self.send(200, [{k: J(v) for k, v in zip(cols, r)} for r in (rows or [])])
            except Exception as e: return self.send(400, {"message": str(e)[:300]})
            finally: cc.close()
        if self.path.startswith("/functions/v1/lead-followup?dry=1"): return self.send(200, D["dry"])
        self.send(404, {})
srv = HTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{srv.server_address[1]}"
res = []
def ck(n, g, note=""): res.append((n, bool(g), "" if g else str(note)[-700:]))
def run():
    rep = os.path.join(H, "_s0c.txt")
    p = subprocess.run(["python3", "step0_combined_check.py"], cwd=H, capture_output=True, text=True,
                       env=dict(os.environ, SB_TOKEN="sbp_x", SB_REF="r", SB_REPORT=rep, SB_API_BASE=base, SB_FN_BASE=base))
    t = open(rep).read() if os.path.exists(rep) else ""
    if os.path.exists(rep): os.remove(rep)
    return p.returncode, t
setup(); rc, t = run()
ck("everything in place: every requested value shown and ALL CHECKS PASS", rc == 0 and "ALL CHECKS PASS" in t and "immediate acknowledgments being held: 1" in t and "follow-ups being held:   2" in t
   and "2 alert recipient(s)" in t and "caregiver texts sent by the watcher since it went watch-only: 0" in t and "Shared Admin = Samantha, Zach, Krystal, Angiel" in t and "UNASSIGNED" in t, t)
ck("it never writes anything", not writes, writes)
setup(ops={"timekeeper_text_live": True, "timekeeper_watch_live": True, "inquiry_ack_live": False, "inquiry_followups_live": False, "inquiry_paused": {"at": PAUSE}}, watcher="texting"); rc, t = run()
ck("if the caregiver text is still on, it fails loudly", rc == 9 and "✗ timekeeper_text_live = True" in t, t)
setup(camp=[{"id": "settings", "enabled": True, "aud_monthly": True}]); rc, t = run()
ck("if the open-lead campaign is still on (for example a stale Campaigns page re-saved it), it fails loudly", rc == 9 and "✗ open-lead campaign audience = True" in t, t)
setup(leads=[{"id": "L1", "ack_sent_at": "2026-09-28T01:00:00Z"}]); rc, t = run()
ck("a family greeting recorded after the pause is caught", rc == 9 and "(1 found)" in t, t)
setup(dry={"ok": True, "would": {"acknowledge": ["Fay"], "nudge": []}}); rc, t = run()
ck("if the live sweep would still greet a family, it fails", rc == 9 and "✗ live dry run: would greet 1" in t, t)
srv.shutdown(); c.close()
print("\nDESKTOP 271 · STEP 0 COMBINED CHECK · PROOF\n" + "=" * 60); ok = True
for n, g, note in res: ok &= g; print(("PASS  " if g else "FAIL  ") + n + (("\n   └─ " + note) if note else ""))
print("=" * 60); print(f"ALL {len(res)} PROOFS PASS" if ok else "FAILED")
