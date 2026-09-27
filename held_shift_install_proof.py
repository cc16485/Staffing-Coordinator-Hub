#!/usr/bin/env python3
# Change 7b · Desktop 255/256 against fake Supabase services whose database is a real disposable Postgres. Never touches production.
import os, json, threading, subprocess, hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
from decimal import Decimal
H = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(H, "journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
FNROOT = os.path.join(H, "supabase", "functions")
SHAS = {"coverage-watch": hashlib.sha256(open(os.path.join(FNROOT, "coverage-watch", "index.ts"), "rb").read()).hexdigest(),
        "_shared/held-shift.ts": hashlib.sha256(open(os.path.join(FNROOT, "_shared", "held-shift.ts"), "rb").read()).hexdigest()}
c = Cluster("hsi"); s = c.su
s.run("create table app_data (key text primary key, data jsonb, updated_at timestamptz)")
def flag():
    r = s.run("select data->>'coverage_watch_7b_live', data->'coverage_watch_7b_approved', data->>'coverage_watch_live', data->>'other' from app_data where key='ops_settings'")[0]
    return r
S = {"calls": [], "watch_fail": False}
def J(v): return int(v) if isinstance(v, Decimal) else (v if isinstance(v, (int, float, bool, str, dict, list, type(None))) else str(v))
SHIFT = {"client": "Joel & Carol Wolverton", "visit": "s=119:d=2026-09-27", "when": "2026-09-27T17:00:00", "closed_case": "cc1", "closed_how": "covered", "covered_by": "Grace Levering"}
class Hd(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path.endswith("/api-keys"): return self.send(200, [{"name": "service_role", "api_key": "svc-secret-key"}])
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
        if self.path.startswith("/functions/v1/coverage-watch"):
            on = flag()[0] == "true"; dry = "dry=1" in self.path
            S["calls"].append({"dry": dry, "on_at_call": on, "auth": self.headers.get("Authorization")})
            if S["watch_fail"]: return self.send(500, {"error": "boom"})
            decision = "ask_covered"
            return self.send(200, {"mode": "DRY RUN" if dry else "LIVE",
                "time_check": {"fix_live": on, "sample_start": "2026-09-27T17:00:00", "has_offset": False,
                               "differs": [{"client": "Ann Lee", "when": "2026-09-27T12:00:00", "old_reading": "already started", "correct_reading": "upcoming"}]},
                "held_checks": {"reopen_live": on, "checked": 1, "reopened": 0, "people_asked": 1 if (on and not dry) else 0,
                                "shifts": [dict(SHIFT, decision=decision, detail="no change since the close", acted=bool(on and not dry))]}})
        self.send(404, {})
srv = HTTPServer(("127.0.0.1", 0), Hd); port = srv.server_address[1]; threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{port}"
res = []
def ck(n, c_, note=""): res.append((n, bool(c_), "" if c_ else str(note)[-900:]))
def reset(on7b=False):
    s.run("delete from app_data")
    s.run("insert into app_data values ('ops_settings', cast(:d as jsonb), now())", d=json.dumps({"coverage_watch_live": True, "coverage_watch_7b_live": on7b, "other": "kept"}))
    S["calls"].clear(); S["watch_fail"] = False
def run(answer, shas=SHAS, mode="install"):
    rep = os.path.join(H, "_hsi_report.txt")
    if os.path.exists(rep): os.remove(rep)
    p = subprocess.run(["python3", os.path.join(H, "held_shift_install.py")], input=answer, capture_output=True, text=True, env=dict(os.environ,
        SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(shas), SB_REPORT=rep, SB_TOKEN="sbp_test", SB_REF="testref", SB_MODE=mode,
        SB_SKIP_FUNCTION="1", SB_API_BASE=base, SB_FN_BASE=base))
    t = open(rep).read() if os.path.exists(rep) else ""
    if os.path.exists(rep): os.remove(rep)
    return p.returncode, t

reset(); rc, t = run("yes\n", shas={"coverage-watch": "0" * 64, "_shared/held-shift.ts": SHAS["_shared/held-shift.ts"]})
ck("a changed watcher source stops before anything runs (no preview, setting untouched)", rc == 2 and "STOP. Nothing was run." in t and not S["calls"] and flag()[0] == "false", t[-300:])
reset(); rc, t = run("no\n")
ck("answer not 'yes': installed, LEFT OFF; only the preview ran (dry), nothing live", rc == 0 and "RESULT: INSTALLED, LEFT OFF" in t and flag()[0] == "false"
   and [x["dry"] for x in S["calls"]] == [True], (t[-400:], S["calls"]))
ck("the preview names the held shift, who was marked covering, and what 7b would do, in her words",
   "Joel & Carol Wolverton · 2026-09-27 17:00 · last case closed covered by Grace Levering" in t
   and "marked covered, but AxisCare shows no caregiver and nothing changed → a person is asked (My Work)" in t, t)
ck("the preview shows the time format and the shift the old reading gets wrong", "times from AxisCare have NO offset, e.g. 2026-09-27T17:00:00" in t
   and 'Ann Lee · 2026-09-27 12:00: old reading "already started", correct "upcoming"' in t, t)
reset(); rc, t = run("")
ck("no answer at all (window closed) leaves it off", rc == 0 and "LEFT OFF" in t and flag()[0] == "false")
reset(); rc, t = run("YES\n")
ck("a typed yes switches 7b on and records the approval; the other settings are kept", rc == 0 and flag()[0] == "true" and flag()[1]["confirmed_at_install"] == "yes"
   and flag()[1]["words"] == "yes, build 7b" and flag()[3] == "kept" and flag()[2] == "true", flag())
ck("order: the preview ran with 7b OFF, then Cara's check ran once LIVE with 7b ON, and its result is shown",
   [(x["dry"], x["on_at_call"]) for x in S["calls"]] == [(True, False), (False, True)] and "CARA'S CHECK, RUN NOW WITH 7b ON" in t and "✓ done" in t
   and "RESULT: INSTALLED AND ON" in t, (S["calls"], t[-500:]))
ck("the service key is used for the calls and never printed", S["calls"][0]["auth"] == "Bearer svc-secret-key" and "svc-secret-key" not in t)
reset(on7b=True); rc, t = run("no\n")
ck("if 7b was already on, it is paused for the preview (the preview never acts) and stays off without a yes",
   S["calls"][0]["on_at_call"] is False and flag()[0] == "false" and "LEFT OFF" in t, (S["calls"], flag()))
reset(); S["watch_fail"] = True; rc, t = run("yes\n")
ck("a preview that fails stops the install; 7b stays off; nothing is asked", rc == 5 and "the preview did not complete" in t and flag()[0] == "false" and "answer:" not in t, t[-300:])
reset(on7b=True); rc, t = run("", mode="off")
ck("Desktop 256 switches it off, keeping everything else", rc == 0 and "7b is off" in t and flag()[0] == "false" and flag()[3] == "kept", t)
srv.shutdown(); c.close()
print("\nCHANGE 7b · DESKTOP 255/256 · PROOF\n" + "=" * 60)
ok = True
for nm, g, note in res:
    ok &= g; print(("PASS  " if g else "FAIL  ") + nm + (("\n   └─ " + note) if note else ""))
print("=" * 60); print(("ALL %d PROOFS PASS" % len(res)) if ok else "%d FAILED" % sum(1 for r in res if not r[1]))
print("shas:", json.dumps(SHAS))
