#!/usr/bin/env python3
# Desktop 270 (two safety switches) against a fake Management API whose database is a real disposable Postgres.
# A simulated scheduled watcher answers after the switch change. Never touches production.
import os, json, threading, subprocess, time
from http.server import BaseHTTPRequestHandler, HTTPServer
from decimal import Decimal
H = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(H, "journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
c = Cluster("ssw"); P = setup_supabase_like(c); s = c.su
for q in ["alter table app_data add column if not exists updated_at timestamptz not null default now()",
          "create schema if not exists cron", "create table cron.job (jobid serial, jobname text, schedule text, active boolean, command text)",
          "create schema if not exists net", "create table net._http_response (id bigserial, status_code int, content text, created timestamptz default now())"]:
    s.run(q)
OPS = {"timekeeper_text_live": True, "timekeeper_watch_live": True, "coverage_send_live": True, "levels": [{"after_min": 15, "to": "owner"}], "fallback_phone": "+14175552789"}
CAMP = [{"id": "settings", "enabled": True, "aud_monthly": True, "aud_clients": False, "aud_client_contacts": False, "aud_caregivers": True, "monthly_day": 1}, {"id": "other", "x": 1}]
def setup(ops=OPS, camp=CAMP, cron_active=True):
    s.run("delete from app_data"); s.run("delete from cron.job"); s.run("delete from net._http_response")
    for k, v in (("ops_settings", ops), ("campaign_settings", camp), ("leads", [{"id": "L1"}])):
        s.run("insert into app_data(key,data) values (:k, cast(:v as jsonb))", k=k, v=json.dumps(v))
    s.run("insert into cron.job(jobname,schedule,active,command) values ('timekeeper-watch','*/2 * * * *',:a,'x')", a=cron_active)
W = {"answer": "watch_only"}
def watcher():   # a scheduled run shortly after the change, answering from the live setting
    time.sleep(1.2)
    st = s.run("select data from app_data where key='ops_settings'")[0][0]; st = st if isinstance(st, dict) else json.loads(st)
    tl, wl = st.get("timekeeper_text_live") is True, st.get("timekeeper_watch_live") is True
    if W["answer"] == "none": return
    mode = "DRY RUN" if not wl else ("LIVE (watch + text)" if tl else "LIVE (watch only — texting off)")
    body = {"mode": mode, "visits_seen": 12, "texts_sent": 0, "clockout_texts_sent": 0, "ladders_opened": 1,
            "settings_in_effect": {"switches": {"timekeeper_watch_live": wl, "timekeeper_text_live": tl}}}
    s.run("insert into net._http_response(status_code, content) values (200, :c)", c=json.dumps(body))
def J(v): return int(v) if isinstance(v, Decimal) else (v if isinstance(v, (int, float, bool, str, dict, list, type(None))) else str(v))
class Hd(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        q = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)))["query"]
        cc = c.conn()
        try:
            rows = cc.run(q); cols = [d["name"] for d in (cc.columns or [])]
            b = json.dumps([{k: J(v) for k, v in zip(cols, r)} for r in (rows or [])]).encode(); self.send_response(200)
            if q.lstrip().lower().startswith("update") and "timekeeper_text_live" in q: threading.Thread(target=watcher, daemon=True).start()
        except Exception as e: b = json.dumps({"message": str(e)[:300]}).encode(); self.send_response(400)
        finally: cc.close()
        self.end_headers(); self.wfile.write(b)
srv = HTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=srv.serve_forever, daemon=True).start()
res = []
def ck(n, g, note=""): res.append((n, bool(g), "" if g else str(note)[-700:]))
def run():
    rep = os.path.join(H, "_ssw.txt")
    p = subprocess.run(["python3", "safety_switches.py"], cwd=H, capture_output=True, text=True,
                       env=dict(os.environ, SB_TOKEN="sbp_x", SB_REF="r", SB_REPORT=rep, SB_API_BASE=f"http://127.0.0.1:{srv.server_address[1]}", SB_POLL_SEC="0.5", SB_POLL_MAX="6"))
    t = open(rep).read() if os.path.exists(rep) else ""
    if os.path.exists(rep): os.remove(rep)
    return p.returncode, t
def get(k):
    v = s.run("select data from app_data where key=:k", k=k)[0][0]; return v if isinstance(v, dict) or isinstance(v, list) else json.loads(v)

setup(); rc, t = run(); o = get("ops_settings"); cs = get("campaign_settings")
ck("A: only timekeeper_text_live changed to false; the watcher switch and every other setting are exactly as before",
   rc == 0 and o["timekeeper_text_live"] is False and o["timekeeper_watch_live"] is True and {k: v for k, v in o.items() if k != "timekeeper_text_live"} == {k: v for k, v in OPS.items() if k != "timekeeper_text_live"}, (t, o))
ck("A: proof lines 1 to 6 all pass, including the watcher's own scheduled answer (watch only, 0 texts)",
   all(x in t for x in ("✓ 1-3. read back", "✓ 4. timekeeper_watch_live is still true", "✓ 5. the scheduled watcher", "✓ 6. the watcher's own scheduled answer", "texts sent 0")), t)
ck("B: only open leads changed to false; master, caregivers, clients, contacts, other fields and other rows untouched",
   cs[0]["aud_monthly"] is False and {k: v for k, v in cs[0].items() if k != "aud_monthly"} == {k: v for k, v in CAMP[0].items() if k != "aud_monthly"} and cs[1] == CAMP[1], cs)
ck("no other production data changed, and the result says DONE", "✓ no other production data changed" in t and "RESULT: DONE" in t and get("leads") == [{"id": "L1"}], t)
rc, t = run()
ck("rerun: both already off, so nothing is changed (reported, not forced)", "A not changed: the current value is not true" in t and "B not changed: open leads is already off" in t, t)
setup(ops=dict(OPS, timekeeper_watch_live=False)); rc, t = run()
ck("if the watcher itself is off, it says so loudly (the text switch still goes off, the safe state)", rc == 9 and "The watcher is not running" in t and get("ops_settings")["timekeeper_text_live"] is False, t)
setup(cron_active=False); rc, t = run()
ck("if the scheduled watcher is paused, it says so", rc == 9 and "the scheduled watcher is not active" in t, t)
setup(); W["answer"] = "none"; rc, t = run(); W["answer"] = "watch_only"
ck("if the watcher doesn't answer in time, it says so and the switch stays off", rc == 9 and "no answer from the watcher's scheduled run yet" in t and get("ops_settings")["timekeeper_text_live"] is False, t)
setup(camp=[dict(CAMP[0], aud_clients=True), CAMP[1]]); rc, t = run()
ck("if active-client campaigns are on, it flags them and does not touch them", rc == 9 and "active-client or client-contact campaigns are ON" in t and get("campaign_settings")[0]["aud_clients"] is True, t)
srv.shutdown(); c.close()
print("\nDESKTOP 270 · TWO SAFETY SWITCHES · PROOF\n" + "=" * 60); ok = True
for n, g, note in res: ok &= g; print(("PASS  " if g else "FAIL  ") + n + (("\n   └─ " + note) if note else ""))
print("=" * 60); print(f"ALL {len(res)} PROOFS PASS" if ok else "FAILED")
