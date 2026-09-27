#!/usr/bin/env python3
# Desktop 276 (0b-2 install) against a fake Supabase: Management API over a real disposable Postgres, fake functions
# (the lead-followup GHL check and dry run, and the two security-slice refusals). Never touches production.
import os, json, threading, subprocess, hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
from decimal import Decimal
from urllib.parse import urlparse, parse_qs
H = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(H, "journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
c = Cluster("o2i"); P = setup_supabase_like(c); s = c.su
for q in ["create table if not exists contact_optout (id bigserial primary key)", "create table if not exists contact_send_refusal (id bigserial primary key)"]: s.run(q)
SVC, ANON = "eyJsvc.x", "eyJanon.x"
ALL = ["lead-followup", "lead-intake", "lead-nurture", "campaign-auto", "campaign-send", "cc-booking", "cc-memories", "cc-corner", "circle-send", "caregiver-intro", "coverage-run"]
S = {}
def setup(probe=None, ops=None, leads=None):
    s.run("delete from app_data")
    for k, v in (("ops_settings", ops or {"inquiry_ack_live": False, "inquiry_followups_live": False, "family_caregiver_change_text_approved": {"by": "S"}}),
                 ("campaign_settings", [{"id": "settings", "enabled": True, "aud_monthly": False, "aud_caregivers": True}]),
                 ("leads", leads or [{"id": "a", "nurture_started_at": "2026-09-01"}, {"id": "b"}])):
        s.run("insert into app_data(key,data) values (:k, cast(:v as jsonb))", k=k, v=json.dumps(v))
    S.clear(); S.update(verify={f: f in ("coverage-run", "circle-send", "lead-followup") for f in ALL}, calls=[],
                        probe=probe or {"probe": "dnd", "staff_contact": True, "contact_found": True, "upsert_has_dnd": True, "get_has_dnd": True, "check_reads_ok": True})
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
        auth = self.headers.get("Authorization", ""); qs = parse_qs(u.query)
        if u.path == "/v1/projects/r/database/query":
            cc = c.conn()
            try:
                rows = cc.run(body["query"]); cols = [d["name"] for d in (cc.columns or [])]
                return self.reply(201, [{k: J(v) for k, v in zip(cols, r)} for r in (rows or [])])
            except Exception as e: return self.reply(400, {"message": str(e)[:300]})
            finally: cc.close()
        fn = u.path.rsplit("/", 1)[1]; S["calls"].append((fn, u.query))
        if fn == "lead-followup" and qs.get("probe_dnd"):
            if S.get("probe_401"): return self.reply(401, {"error": "server only"})
            return self.reply(200, S["probe"]) if auth == "Bearer " + SVC else self.reply(401, {})
        if fn == "lead-followup" and qs.get("dry"):
            ops = json.loads(s.run("select data::text from app_data where key='ops_settings'")[0][0])
            return self.reply(200, {"ok": True, "dry": True, "switches": {"inquiry_ack_live": ops.get("inquiry_ack_live") is True, "inquiry_followups_live": ops.get("inquiry_followups_live") is True, "settings_read": True},
                                    "would": {"acknowledge": [], "nudge": [], "office": []}})
        if fn in ("campaign-send", "circle-send"): return self.reply(401, {"error": "Sign in first."})
        self.reply(404, {})
srv = HTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_address[1]}"
FNROOT = os.path.join(H, "supabase", "functions")
FILES = ALL + ["_shared/optout.ts", "_shared/outreach.ts", "_shared/family-change-text.ts", "_shared/staff-auth.ts"]
def sha(f): return hashlib.sha256(open(os.path.join(FNROOT, f) if f.endswith(".ts") else os.path.join(FNROOT, f, "index.ts"), "rb").read()).hexdigest()
res = []
def ck(n, g, note=""): res.append((n, bool(g), "" if g else str(note)[-900:]))
def run(shas=None):
    rep = os.path.join(H, "_o2i.txt")
    p = subprocess.run(["python3", "optout_0b2_install.py"], cwd=H, capture_output=True, text=True, env=dict(os.environ,
        SB_TOKEN="sbp_x", SB_REF="r", SB_REPORT=rep, SB_API_BASE=BASE, SB_FN_BASE=BASE, SB_SKIP_FUNCTION="1", SB_FNROOT=FNROOT,
        SB_FN_SHAS=json.dumps(shas or {f: sha(f) for f in FILES})))
    t = open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr
    if os.path.exists(rep): os.remove(rep)
    return p.returncode, t
deployed = lambda t: [l.split("would deploy ")[1].split()[0] for l in t.splitlines() if "would deploy" in l]
ops = lambda: json.loads(s.run("select data::text from app_data where key='ops_settings'")[0][0])

setup(); rc, t = run()
ck("happy path: DONE; lead-followup deploys first, then the GHL check, then the other ten with coverage-run last",
   rc == 0 and "RESULT: DONE" in t and deployed(t) == ALL and t.index("would deploy lead-followup") < t.index("Live GoHighLevel check") < t.index("would deploy lead-intake"), t)
ck("each function keeps how it checks callers (lead-followup, circle-send and coverage-run ON, the rest off)",
   "would deploy lead-followup\n" in t and "would deploy circle-send\n" in t + "\n" and "would deploy coverage-run" in t and "would deploy lead-intake --no-verify-jwt" in t, t)
ck("the report shows the switches, drips in progress, the opt-out record, and the live GHL answers as yes/no",
   "inquiry greeting false" in t and "inquiries on a drip right now: 1" in t and "GHL answers with the Do Not Disturb flag: yes" in t and "every source the check reads is readable here: yes" in t, t)
ck("nothing secret reaches the report", SVC not in t and ANON not in t, t)
ck("no switch moved; the paused greeting and follow-ups are still paused (dry run: would greet 0)", "no switch moved" in t and "greeting paused, follow-ups paused; would greet 0, follow up 0" in t and ops()["inquiry_ack_live"] is False, t)
ck("the security slice's refusals still hold", t.count("still refuses a caller who is not signed in") == 2, t)
setup(probe={"probe": "dnd", "staff_contact": True, "contact_found": True, "upsert_has_dnd": False, "get_has_dnd": False, "check_reads_ok": True}); rc, t = run()
ck("if GHL does NOT carry the Do Not Disturb flag: STOP after lead-followup; the other ten are not deployed", rc == 6 and deployed(t) == ["lead-followup"] and "would refuse every family message" in t, t)
setup(probe={"probe": "dnd", "staff_contact": True, "contact_found": True, "upsert_has_dnd": False, "get_has_dnd": True, "check_reads_ok": True}); rc, t = run()
ck("GHL carrying the flag only on a direct look-up is enough (the check asks for it)", rc == 0 and len(deployed(t)) == 11, t)
setup(probe={"probe": "dnd", "staff_contact": True, "contact_found": True, "upsert_has_dnd": True, "get_has_dnd": True, "check_reads_ok": False}); rc, t = run()
ck("if a source the check reads cannot be read in production: STOP after lead-followup", rc == 6 and deployed(t) == ["lead-followup"], t)
setup(probe={"probe": "dnd", "staff_contact": False}); rc, t = run()
ck("with no staff contact to check against: STOP after lead-followup (nothing is assumed)", rc == 6 and deployed(t) == ["lead-followup"], t)
setup(); S["probe_401"] = True
rc, t = run()
ck("if the check is refused, the refusal message is shown (never the key) and it stops after lead-followup", rc == 6 and "HTTP 401: server only" in t and SVC not in t and deployed(t) == ["lead-followup"], t)
setup(); S["verify"]["lead-followup"] = False; rc, t = run()
ck("if lead-followup's platform sign-in check were off, it stops before relying on the server-role check", rc == 6 and "must have the platform's sign-in check ON" in t and deployed(t) == ["lead-followup"], t)
setup(); bad_sha = {f: sha(f) for f in FILES}; bad_sha["_shared/optout.ts"] = "0" * 64; rc, t = run(bad_sha)
ck("a source that is not the reviewed build: STOP before anything deploys", rc == 4 and deployed(t) == [], t)
setup(ops={"inquiry_ack_live": True, "inquiry_followups_live": False}); rc, t = run()
ck("if the greeting switch is ON it is reported as ON and left alone (never changed by this installer)", rc == 0 and "greeting ON" in t and ops()["inquiry_ack_live"] is True, t)
srv.shutdown(); c.close()
print("\nDESKTOP 276 · 0b-2 INSTALL · PROOF\n" + "=" * 60); ok = True
for n, g, note in res: ok &= g; print(("PASS  " if g else "FAIL  ") + n + (("\n   └─ " + note) if note else ""))
print("=" * 60); print(f"ALL {len(res)} PROOFS PASS" if ok else "FAILED")
