#!/usr/bin/env python3
# Change 7a · the Desktop 253 report script against fake Supabase services whose database is a real
# disposable Postgres (cron + pg_net record tables), queried as a role that can only SELECT. Never touches production.
import os, json, threading, subprocess, hashlib, copy
from http.server import BaseHTTPRequestHandler, HTTPServer
from decimal import Decimal
H = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(H, "journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
FNROOT = os.path.join(H, "supabase", "functions")
SHA = hashlib.sha256(open(os.path.join(FNROOT, "axiscare-read-probe", "index.ts"), "rb").read()).hexdigest()
SAMPLE = os.path.join(H, "_probe_sample.json")
p = subprocess.run(["node", "axiscare_read_probe_harness.mjs", "supabase/functions/axiscare-read-probe/index.ts"], cwd=H,
                   env=dict(os.environ, PROBE_SAMPLE=SAMPLE), capture_output=True, text=True)
assert "ALL" in p.stdout and "CHECKS PASS" in p.stdout, p.stdout[-600:]
BASE = json.load(open(SAMPLE)); LIMITED = json.load(open(SAMPLE.replace(".json", "_429.json")))
os.remove(SAMPLE); os.remove(SAMPLE.replace(".json", "_429.json"))

c = Cluster("probe"); s = c.su
s.run("create schema cron"); s.run("create schema net")
s.run("create table cron.job (jobid bigint primary key, schedule text, command text, active boolean default true, jobname text)")
s.run("create table cron.job_run_details (runid bigserial primary key, jobid bigint, status text, return_message text, start_time timestamptz, end_time timestamptz)")
s.run("create table net._http_response (id bigserial primary key, status_code int, content_type text, headers jsonb, content text, timed_out boolean, error_msg text, created timestamptz default now())")
s.run("""insert into cron.job values (1,'*/5 * * * *','x',true,'coverage-watch'),(2,'*/2 * * * *','x',true,'timekeeper-watch'),
         (3,'*/3 * * * *','x',true,'coverage-run'),(4,'*/30 * * * *','x',false,'launch-evidence'),(5,'0 3 * * *','x',true,'nightly-other')""")
s.run("""insert into cron.job_run_details(jobid,status,start_time) values (1,'succeeded',now()-interval '1 hour'),(1,'failed',now()-interval '2 hours'),
         (2,'succeeded',now()-interval '1 hour'),(3,'succeeded',now()-interval '30 hours')""")
s.run("""insert into net._http_response(status_code,content) values (502,'{"error":"AxisCare responded 429"}'),(200,'{"ok":true}'),
         (502,'{"error":"visits window 429"}'),(502,'{"error":"AxisCare responded 500"}')""")
s.run("create role reader nologin"); s.run("grant usage on schema cron, net to reader"); s.run("grant select on all tables in schema cron, net to reader")

S = {"probe": BASE, "probe_status": 200, "calls": [], "queries": []}
def J(v): return int(v) if isinstance(v, Decimal) else (v if isinstance(v, (int, float, bool, str, dict, list, type(None))) else str(v))
class Hd(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        S["calls"].append(("GET", self.path))
        if self.path.endswith("/api-keys"): return self.send(200, [{"name": "anon", "api_key": "anon-key"}, {"name": "service_role", "api_key": "svc-secret-key"}])
        self.send(404, {})
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        S["calls"].append(("POST", self.path))
        if self.path.endswith("/database/query"):
            S["queries"].append(body["query"]); cc = c.conn("reader")
            try:
                rows = cc.run(body["query"]); cols = [d["name"] for d in (cc.columns or [])]
                return self.send(200, [{k: J(v) for k, v in zip(cols, r)} for r in (rows or [])])
            except Exception as e: return self.send(400, {"message": str(e)[:300]})
            finally: cc.close()
        if self.path.startswith("/functions/v1/axiscare-read-probe"):
            S["auth"] = self.headers.get("Authorization")
            return self.send(S["probe_status"], S["probe"] if S["probe_status"] == 200 else {"error": "boom"})
        self.send(404, {})
srv = HTTPServer(("127.0.0.1", 0), Hd); port = srv.server_address[1]; threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{port}"
res = []
def ck(n, c_, note=""): res.append((n, bool(c_), "" if c_ else str(note)[-900:]))
def run(sha=SHA):
    rep = os.path.join(H, "_probe_report.txt")
    if os.path.exists(rep): os.remove(rep)
    S["calls"].clear(); S["queries"].clear()
    p = subprocess.run(["python3", os.path.join(H, "axiscare_read_probe_report.py")], capture_output=True, text=True, env=dict(os.environ,
        SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps({"axiscare-read-probe": sha}), SB_REPORT=rep, SB_TOKEN="sbp_test", SB_REF="testref",
        SB_SKIP_FUNCTION="1", SB_API_BASE=base, SB_FN_BASE=base))
    txt = open(rep).read() if os.path.exists(rep) else ""
    if os.path.exists(rep): os.remove(rep)
    return p.returncode, txt

rc, t = run("0" * 64)
ck("a changed probe source stops before anything is called (no deploy, no probe, no queries)", rc == 2 and "STOP. Nothing was run." in t and not S["calls"], t[-300:])
rc, t = run()
ck("runs end to end: report written, RESULT line, exit 0", rc == 0 and "RESULT: PROBE COMPLETE · read only" in t, t[-500:])
ck("the probe was called with the service key; the key never appears in the report", S.get("auth") == "Bearer svc-secret-key" and "svc-secret-key" not in t)
ck("sizes: each window listed; the 72-hour read shows 258 visits over 3 pages; the hourly load line is worked out",
   "next 72 hours (coverage-watch, every 5 min): 258 visits, 3 page(s)" in t and "about 66 visit reads an hour (30 × today + 12 × next 72 hours)" in t, t[:1500])
ck("changed-since: the missed clock-in is flagged ✗ with its visit id; the same-slot match is shown",
   "✗ A. clock-ins in the last 24 hours: 3 checked · returned 1 (+1 as the same slot under another id) · missing 1 · v=3:s=3:d=2026-09-27" in t, t)
ck("call-offs: the open call-off AxisCare didn't return is flagged ✗ with its id; the closed one passes",
   "✗ B. call-offs Cara opened this week, still open: 3 checked" in t and "1 last changed before this period (not a miss)" in t and "s=52:d=2026-09-28" in t and "✓ B. call-offs Cara opened this week, since closed" in t, t)
ck("D: the visit AxisCare marks as changed but the filter dropped is flagged ✗ with its id", "✗ D. every visit AxisCare itself marks as changed in the last 24 hours: 4 checked" in t and "v=5:s=5:d=2026-09-27" in t, t)
ck("verdict: with a miss, it says the timed reads stay as they are", "can't be trusted for call-offs or clock-ins; the timed reads stay as they are" in t)
ck("slow-down history from the database: 2 AxisCare 429s passed on, 1 other AxisCare error; only the timed AxisCare jobs listed, with the switched-off one marked",
   "✗ AxisCare \"slow down\" (429) passed on by a timed job: 2" in t and "other AxisCare errors passed on: 1" in t
   and "launch-evidence: */30 * * * * (switched off)" in t and "nightly-other" not in t, t[-1500:])
ck("run history: last 24 hours only (coverage-run's 30-hour-old run is left out), failures counted",
   "✗ coverage-watch: 2 runs in 24 hours, 1 failed to start" in t and "✓ timekeeper-watch: 1 runs" in t and "coverage-run:" not in t.split("3. HAS AXISCARE")[1].split("WHAT IT MEANS")[0].replace("• coverage-run", ""), t[-1200:])
ck("read only: every database query was a SELECT, run as a role that can only read (a write would have failed)",
   len(S["queries"]) == 3 and all(q.lstrip().lower().startswith("select") for q in S["queries"]), S["queries"])

good = copy.deepcopy(BASE)
for k, v in good["tests"].items():
    if isinstance(v, dict) and "missing" in v and k != "combined_filter": v["missing"] = 0; v["missing_ids"] = []
S["probe"] = good; rc, t = run()
ck("verdict: when nothing is missed, it says step 7b can be designed on it", rc == 0 and "Step 7b can be designed on it." in t and "✗ A." not in t, t[-600:])
none = copy.deepcopy(good)
for k, v in none["tests"].items():
    if isinstance(v, dict) and "checked" in v: v["checked"] = 0
S["probe"] = none; rc, t = run()
ck("verdict: with nothing to test, it says to run again after a working day (never a false pass)", "There were no clock-ins or call-offs to test against." in t and "Step 7b can be designed" not in t, t[-600:])
S["probe"] = LIMITED; rc, t = run()
ck("verdict: when AxisCare said slow down during the probe, the report says the answers are partial", "AxisCare asked us to slow down during the probe itself" in t and "stopped early" in t, t[-600:])
S["probe"] = BASE; S["probe_status"] = 500; rc, t = run()
ck("a probe that fails is reported, and nothing else is claimed", rc == 5 and "✗ the probe did not complete: HTTP 500" in t and "RESULT" not in t, t[-300:])

srv.shutdown(); c.close()
print("\nCHANGE 7a · DESKTOP 253 REPORT SCRIPT · PROOF\n" + "=" * 60)
ok = True
for nm, g, note in res:
    ok &= g; print(("PASS  " if g else "FAIL  ") + nm + (("\n   └─ " + note) if note else ""))
print("=" * 60); print(("ALL %d PROOFS PASS" % len(res)) if ok else "%d FAILED" % sum(1 for r in res if not r[1]))
print("axiscare-read-probe sha256:", SHA)
