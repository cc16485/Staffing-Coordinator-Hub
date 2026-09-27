#!/usr/bin/env python3
# Desktop 269 (0a) against fake Supabase services whose database is a real disposable Postgres. Never touches production.
import os, json, threading, subprocess, hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
from decimal import Decimal
H = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(H, "journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
FNROOT = os.path.join(H, "supabase", "functions")
def sha(p): return hashlib.sha256(open(os.path.join(FNROOT, p), "rb").read()).hexdigest()
SHAS = {"lead-followup": sha("lead-followup/index.ts"), "lead-intake": sha("lead-intake/index.ts"), "_shared/inquiry-switches.ts": sha("_shared/inquiry-switches.ts")}
c = Cluster("iqp"); P = setup_supabase_like(c); s = c.su
s.run("alter table app_data add column if not exists updated_at timestamptz not null default now()")
s.run("""insert into app_data(key,data) values ('ops_settings','{"promises_live": true}'::jsonb) on conflict (key) do update set data=excluded.data""")
S = {"vj": {"lead-followup": True, "lead-intake": False}, "flip": None, "reads": {}, "dry": None}
def J(v): return int(v) if isinstance(v, Decimal) else (v if isinstance(v, (int, float, bool, str, dict, list, type(None))) else str(v))
def live_dry():
    st = s.run("select data from app_data where key='ops_settings'")[0][0]; st = st if isinstance(st, dict) else json.loads(st)
    ack, fu = st.get("inquiry_ack_live") is True, st.get("inquiry_followups_live") is True
    return {"ok": True, "dry": True, "switches": {"inquiry_ack_live": ack, "inquiry_followups_live": fu, "settings_read": True},
            "would": {"acknowledge": ["Fay"] if ack else [], "nudge": ["Dee"] if fu else [], "office": ["Old lead"],
                      "paused_ack": [] if ack else ["Fay"], "paused_followups": [] if fu else ["Dee", "Tia"]}}
class Hd(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if "/functions/" in self.path and "/v1/projects/" in self.path:
            fn = self.path.rsplit("/", 1)[1]; S["reads"][fn] = S["reads"].get(fn, 0) + 1
            v = S["vj"][fn]
            if S["flip"] == fn and S["reads"][fn] > 1: v = not v
            return self.send(200, {"verify_jwt": v})
        if self.path.endswith("/api-keys"): return self.send(200, [{"name": "service_role", "api_key": "SVC"}])
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
        if self.path.startswith("/functions/v1/lead-followup?dry=1"):
            return self.send(200, S["dry"] or live_dry()) if self.headers.get("apikey") == "SVC" else self.send(401, {})
        self.send(404, {})
srv = HTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{srv.server_address[1]}"
res = []
def ck(n, g, note=""): res.append((n, bool(g), "" if g else str(note)[-600:]))
def run(shas=SHAS):
    rep = os.path.join(H, "_iqp.txt"); S["reads"] = {}
    p = subprocess.run(["python3", "inquiry_pause_install.py"], cwd=H, capture_output=True, text=True,
        env=dict(os.environ, SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(shas), SB_REPORT=rep, SB_TOKEN="sbp_x", SB_REF="r", SB_SKIP_FUNCTION="1", SB_API_BASE=base, SB_FN_BASE=base))
    t = open(rep).read() if os.path.exists(rep) else ""
    if os.path.exists(rep): os.remove(rep)
    return p.returncode, t
settings = lambda: (lambda d: d if isinstance(d, dict) else json.loads(d))(s.run("select data from app_data where key='ops_settings'")[0][0])
rc, t = run(dict(SHAS, **{"lead-intake": "0" * 64}))
ck("a changed function stops before anything runs (switches untouched)", rc == 2 and "inquiry_ack_live" not in settings(), t[-200:])
rc, t = run()
st = settings()
ck("installs: both switches recorded OFF with the decision noted; other settings kept", rc == 0 and st["inquiry_ack_live"] is False and st["inquiry_followups_live"] is False
   and st["inquiry_paused"]["recorded_by"] == "Desktop 269" and st["promises_live"] is True, (t, st))
ck("each function deployed exactly as it checks callers today (the web form stays without sign-in checking)", "would deploy lead-intake --no-verify-jwt" in t and "would deploy lead-followup\n" in t + "\n", t)
ck("the live dry run proves 0 greetings and 0 follow-ups, shows what is held back, and the office alert still planned",
   "would greet 0 and follow up 0" in t and "1 greeting(s), 2 follow-up(s)" in t and "office \"lead waiting\" alerts still planned: 1" in t and "RESULT: PAUSED" in t, t)
S["dry"] = {"ok": True, "switches": {"inquiry_ack_live": False, "inquiry_followups_live": False, "settings_read": True}, "would": {"acknowledge": ["Fay"], "nudge": []}}
rc, t = run(); S["dry"] = None
ck("if the live function would still greet a family, it stops and says so", rc == 8 and "would still message families" in t, t[-300:])
S["dry"] = {"ok": True, "switches": {"inquiry_ack_live": True, "inquiry_followups_live": False, "settings_read": True}, "would": {}}
rc, t = run(); S["dry"] = None
ck("if the live function still reads the greeting as on, it stops", rc == 8 and "does not show the pause" in t, t[-300:])
S["flip"] = "lead-intake"; rc, t = run(); S["flip"] = None
ck("if a deploy changed how the web form checks callers, it says so loudly", rc == 6 and "Tell Claude today" in t, t[-300:])
srv.shutdown(); c.close()
print("\nDESKTOP 269 · 0a PAUSE INQUIRY MESSAGES · INSTALL PROOF\n" + "=" * 60); ok = True
for n, g, note in res: ok &= g; print(("PASS  " if g else "FAIL  ") + n + (("\n   └─ " + note) if note else ""))
print("=" * 60); print(f"ALL {len(res)} PROOFS PASS" if ok else "FAILED"); print("shas:", json.dumps(SHAS))
