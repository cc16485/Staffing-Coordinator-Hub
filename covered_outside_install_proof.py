#!/usr/bin/env python3
# Desktop 257 against fake Supabase services whose database is a real disposable Postgres. Never touches production.
import os, json, threading, subprocess, hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
from decimal import Decimal
H = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(H, "journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
FNROOT = os.path.join(H, "supabase", "functions")
def sha(p): return hashlib.sha256(open(os.path.join(FNROOT, p), "rb").read()).hexdigest()
SHAS = {"coverage-watch": sha("coverage-watch/index.ts"), "coverage-run": sha("coverage-run/index.ts"), "_shared/covered-outside.ts": sha("_shared/covered-outside.ts"),
        "_shared/family-change-text.ts": sha("_shared/family-change-text.ts"), "_shared/held-shift.ts": sha("_shared/held-shift.ts")}
c = Cluster("coi"); s = c.su
s.run("create table app_data (key text primary key, data jsonb)")
cases = [
  {"id": "k", "client": "Elizabeth Kurtz", "shift_date": "2026-09-27", "shift_time": "10:00-14:00", "calling_off": "Ashley Lloyd", "covered_by": "Ashley Lloyd", "resolved_at": "2026-09-27T14:00:00Z",
   "note": "x\nCovered in AxisCare directly (assigned to Ashley Lloyd) — closed by the watcher.", "family_notified_count": 2, "family_circle": "Elizabeth Kurtz", "closure_courtesy_count": 1},
  {"id": "w", "client": "Joel & Carol Wolverton", "shift_date": "2026-09-27", "calling_off": "", "covered_by": "Grace Levering", "resolved_at": "2026-09-27T02:40:00Z",
   "note": "Covered in AxisCare directly (assigned to Grace Levering) — closed by the watcher.", "family_notified_count": 0, "family_skip_reason": "no_consenting_member"},
  {"id": "a", "client": "Ann O'Neil", "calling_off": "Beth", "covered_by": "Beth Cole", "resolved_at": "2026-09-20T02:40:00Z", "note": "closed by the watcher."},
  {"id": "g", "client": "Good", "calling_off": "Ashley Lloyd", "covered_by": "Beth Cole", "resolved_at": "2026-09-19T02:40:00Z", "note": "closed by the watcher."},
  {"id": "b", "client": "Board", "calling_off": "Ashley Lloyd", "covered_by": "Ashley Lloyd", "resolved_at": "2026-09-19T02:40:00Z", "note": "Confirmed on the board."}]
s.run("insert into app_data values ('coverage_cases', cast(:d as jsonb))", d=json.dumps(cases))
s.run("create role reader nologin"); s.run("grant select on app_data to reader")
S = {"q": [], "calls": [], "fail": False}
def J(v): return int(v) if isinstance(v, Decimal) else (v if isinstance(v, (int, float, bool, str, dict, list, type(None))) else str(v))
class Hd(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path.endswith("/api-keys"): return self.send(200, [{"name": "service_role", "api_key": "svc-secret-key"}])
        self.send(404, {})
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        if self.path.endswith("/database/query"):
            S["q"].append(body["query"]); cc = c.conn("reader")
            try:
                rows = cc.run(body["query"]); cols = [d["name"] for d in (cc.columns or [])]
                return self.send(200, [{k: J(v) for k, v in zip(cols, r)} for r in (rows or [])])
            except Exception as e: return self.send(400, {"message": str(e)[:300]})
            finally: cc.close()
        if self.path.startswith("/functions/v1/coverage-watch"):
            S["calls"].append(self.path)
            if S["fail"]: return self.send(500, {})
            return self.send(200, {"covered_outside_left_open": [{"case": "k2", "caregiver_on_shift": "Ashley Lloyd", "calling_off": "Ashley Lloyd", "verdict": "caller_still_on", "dry": True}]})
        self.send(404, {})
srv = HTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{srv.server_address[1]}"
res = []
def ck(n, g, note=""): res.append((n, bool(g), "" if g else str(note)[-900:]))
def run(shas=SHAS):
    rep = os.path.join(H, "_coi.txt"); S["q"].clear(); S["calls"].clear()
    p = subprocess.run(["python3", "covered_outside_install.py"], cwd=H, capture_output=True, text=True, env=dict(os.environ, SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(shas),
        SB_REPORT=rep, SB_TOKEN="sbp_x", SB_REF="r", SB_SKIP_FUNCTION="1", SB_API_BASE=base, SB_FN_BASE=base))
    t = open(rep).read() if os.path.exists(rep) else ""
    if os.path.exists(rep): os.remove(rep)
    return p.returncode, t
rc, t = run(dict(SHAS, **{"coverage-run": "0" * 64}))
ck("a changed source stops before anything is read or deployed", rc == 2 and not S["q"] and not S["calls"], t[-300:])
rc, t = run()
ck("audit: the Kurtz case is flagged SAME PERSON with its 2 family texts and 1 caregiver text", rc == 0 and "✗ SAME PERSON · Elizabeth Kurtz" in t and "family texts 2 (Elizabeth Kurtz), caregiver texts 1" in t, t)
ck("audit: a case with no caller recorded, and one with only a first name, are marked can't-check; a real cover is ✓; a board-confirmed case is not listed",
   "? caller not recorded · Joel & Carol Wolverton" in t and "[not sent: no_consenting_member]" in t and "? first name only · Ann O'Neil" in t and "✓ different caregiver · Good" in t and "· Board ·" not in t, t)
ck("audit total", "→ 4 case(s): 1 marked a caregiver as covering their own call-off, 2 can't be checked from the record" in t, t)
ck("preview runs as ?dry=1 AFTER the audit, and explains each open case", S["calls"] == ["/functions/v1/coverage-watch?dry=1"] and "stays open until they're taken off" in t, (S["calls"], t[-400:]))
ck("read only: the audit is one SELECT, run as a role that can only read", len(S["q"]) == 1 and S["q"][0].lstrip().lower().startswith("select"), S["q"])
ck("result line names the past wrong text; the key is never printed", "RESULT: FIX INSTALLED" in t and "1 past case(s) above texted the family wrongly" in t and "svc-secret-key" not in t)
S["fail"] = True; rc, t = run()
ck("a failed preview is reported (exit 5), after the audit was still written", rc == 5 and "✗ the preview did not complete" in t and "SAME PERSON" in t, t[-300:])
srv.shutdown(); c.close()
print("\nDESKTOP 257 · COVERED-OUTSIDE FIX · PROOF\n" + "=" * 60); ok = True
for n, g, note in res: ok &= g; print(("PASS  " if g else "FAIL  ") + n + (("\n   └─ " + note) if note else ""))
print("=" * 60); print(f"ALL {len(res)} PROOFS PASS" if ok else "FAILED"); print("shas:", json.dumps(SHAS))
