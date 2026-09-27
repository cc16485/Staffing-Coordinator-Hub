#!/usr/bin/env python3
# Desktop 262 against fake Supabase services whose database is a real disposable Postgres. Never touches production.
import os, json, threading, subprocess, hashlib, urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer
from decimal import Decimal
H = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(H, "journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
MIGF = os.path.join(H, "identity-former-clients.sql"); MIG_SHA = hashlib.sha256(open(MIGF, "rb").read()).hexdigest()
FNROOT = os.path.join(H, "supabase", "functions")
SHAS = {"identity-backfill": hashlib.sha256(open(os.path.join(FNROOT, "identity-backfill", "index.ts"), "rb").read()).hexdigest()}
c = Cluster("ifc"); s = c.su
for r in ["anon", "authenticated"]: s.run(f"do $$ begin create role {r} nologin; exception when duplicate_object then null; end $$;")
s.run("do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;")
s.run("grant usage on schema public to anon, authenticated, service_role")
for f in ("identity-layer.sql", "identity-provenance.sql", "fix-phone-provenance.sql"):
    rc, out = c.psql(open(os.path.join(H, f)).read())
    assert rc == 0, (f, out[-600:])
# numbers on file today: one confirmed, one probable only, one rejected
s.run("insert into person_identity(id, display_name) values ('00000000-0000-0000-0000-000000000001','Someone Else'),('00000000-0000-0000-0000-000000000002','Other One')")
s.run("""insert into phone_index(phone, person_id, confidence) values ('+14175550400','00000000-0000-0000-0000-000000000002','confirmed'),
         ('+14175550300','00000000-0000-0000-0000-000000000001','probable')""")
S = {"verify_jwt": True, "anon_open": set(), "circles": {"mode": "DRY RUN", "clients": 290, "circles_created": 0, "errors": 0, "sample": 0},
     "commit_sql": [], "calls": [], "preview": None}
PREVIEW = {"mode": "DRY RUN", "axiscare_clients_total": 293, "former_total": 269, "former_already_in_hub": 1, "former_added": 268, "with_phone": 250,
           "with_birth_date": 260, "birth_dates_filled": 24, "phones_indexed": 0, "phones_shared": 2, "phones_left_probable": 1, "roles_added": 0,
           "deceased": 90, "skipped_no_name": 0, "end_date_from_axiscare": 200, "end_date_unknown": 68, "status_labels": {"Discharged": 170, "Deceased": 90, "Inactive": 8},
           "skipped_not_a_person": [{"name": "Office Staff", "axiscare_id": "293"}], "active_without_person": [{"name": "Peggy Thomason", "axiscare_id": "295"}],
           "name_coincidences": [{"name": "Carol Gray", "axiscare_id": "18"}], "errors": []}
def J(v): return int(v) if isinstance(v, Decimal) else (v if isinstance(v, (int, float, bool, str, dict, list, type(None))) else str(v))
def dbq(q):
    cc = c.conn()
    try: rows = cc.run(q); cols = [d["name"] for d in (cc.columns or [])]; return [{k: J(v) for k, v in zip(cols, r)} for r in (rows or [])]
    finally: cc.close()
class Hd(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path.endswith("/api-keys"): return self.send(200, [{"name": "anon", "api_key": "ANON"}, {"name": "service_role", "api_key": "SVC"}])
        if self.path.endswith("/functions/identity-backfill"): return self.send(200, {"slug": "identity-backfill", "verify_jwt": S["verify_jwt"]})
        if self.path.startswith("/functions/v1/identity-backfill"):
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query); key = self.headers.get("apikey")
            S["calls"].append((key, self.path))
            if qs.get("circles") == ["1"]: return self.send(200, S["circles"])
            if key != "SVC":
                mode = next(iter(qs), "")
                return self.send(200, {"mode": "DRY RUN", "names": ["x"]}) if mode in S["anon_open"] else self.send(403, {"error": "service_role required"})
            if qs.get("former_clients") == ["1"] and qs.get("commit") == ["1"]:
                try:
                    for q in S["commit_sql"]: dbq(q)
                except Exception as e: return self.send(500, {"error": str(e)[:300]})
                return self.send(200, dict(PREVIEW, mode="COMMIT", roles_added=268, phones_indexed=300))
            if qs.get("former_clients") == ["1"]: return self.send(200, S["preview"] or PREVIEW)
        self.send(404, {})
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        if self.path.endswith("/database/query"):
            q = body["query"]
            if q.lstrip().startswith("-- ===="):
                rc, out = c.psql(q); return self.send(200, []) if rc == 0 else self.send(400, {"message": out[-400:]})
            try: return self.send(200, dbq(q))
            except Exception as e: return self.send(400, {"message": str(e)[:300]})
        self.send(404, {})
srv = HTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{srv.server_address[1]}"
res = []
def ck(n, g, note=""): res.append((n, bool(g), "" if g else str(note)[-300:]))
def run(answer="", shas=SHAS, mig_sha=MIG_SHA):
    rep = os.path.join(H, "_ifc.txt"); S["calls"] = []
    p = subprocess.run(["python3", "identity_former_clients_install.py"], cwd=H, capture_output=True, text=True, input=answer + "\n",
        env=dict(os.environ, SB_MIGFILE=MIGF, SB_MIG_SHA=mig_sha, SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(shas), SB_REPORT=rep,
                 SB_TOKEN="sbp_x", SB_REF="r", SB_SKIP_FUNCTION="1", SB_API_BASE=base, SB_FN_BASE=base))
    t = open(rep).read() if os.path.exists(rep) else ""
    if os.path.exists(rep): os.remove(rep)
    return p.returncode, t
col = lambda: s.run("select count(*) from information_schema.columns where table_name = 'person_identity' and column_name = 'birth_date'")[0][0] == 1
committed = lambda: any(k == "SVC" and "commit=1" in p for k, p in S["calls"])

rc, t = run("yes", mig_sha="0" * 64)
ck("a changed migration stops before anything runs", rc == 2 and not col(), t[-200:])
rc, t = run("yes", {"identity-backfill": "0" * 64})
ck("a changed function stops before anything runs", rc == 2 and not col(), t[-200:])
S["verify_jwt"] = False; rc, t = run("yes")
ck("a function that doesn't check keys are genuine stops it before any preview or write", rc == 5 and "not checking sign-ins" in t and not committed(), t[-300:])
S["verify_jwt"] = True; S["anon_open"] = {"clients"}; rc, t = run("yes")
ck("if the public key still reaches a mode, it stops and writes nothing", rc == 7 and "?clients=1 → HTTP 200" in t and not committed(), t[-300:])
S["anon_open"] = set(); S["circles"] = {"mode": "DRY RUN", "clients": 290, "waiting": [{"name": "Ruth"}]}; rc, t = run("yes")
ck("if the nightly circles sync would show names, it stops", rc == 7 and "show names" in t and not committed(), t[-300:])
S["circles"] = {"error": "boom"}; rc, t = run("yes")
ck("if the nightly circles sync would break, it stops", rc == 7 and not committed(), t[-300:])
S["circles"] = {"mode": "DRY RUN", "clients": 290, "circles_created": 0, "errors": 0, "sample": 0}
rc, t = run("no")
ck("preview shows the counts, reasons, same-name people, the active one missing and Office Staff; 'no' writes nothing",
   rc == 0 and "former clients not yet in the hub: 268" in t and "Discharged 170, Deceased 90, Inactive 8" in t and "Carol Gray (AxisCare #18)" in t
   and "Peggy Thomason (AxisCare #295)" in t and "Office Staff (AxisCare #293)" in t and "end dates: 200 from AxisCare · 68 not in AxisCare" in t and "unconfirmed for everyone on them" in t
   and "RESULT: INSTALLED, NOTHING ADDED" in t and not committed() and col(), t)
ck("the lock was proven on 6 modes with the public key", "refused for every mode that writes or shows names (tried 6)" in t and sum(1 for k, p in S["calls"] if k == "ANON") == 7, S["calls"])
# a commit that would make a blocked number textable is caught
S["commit_sql"] = ["insert into person_identity(id, display_name) values ('00000000-0000-0000-0000-000000000009','Mary Evans')",
                   "insert into phone_index(phone, person_id, confidence) values ('+14175550300','00000000-0000-0000-0000-000000000009','confirmed')"]
rc, t = run("yes")
ck("if adding them would make a blocked number textable, it says so loudly", rc == 12 and "WHO CAN BE TEXTED CHANGED for 1 numbers" in t, t[-300:])
s.run("delete from person_identity where id = '00000000-0000-0000-0000-000000000009'")
# the real shape: a new number confirmed, the probable-only one stays probable
S["commit_sql"] = ["insert into person_identity(id, display_name, birth_date) values ('00000000-0000-0000-0000-000000000010','Ruth Adams','1938-04-02'),('00000000-0000-0000-0000-000000000011','Mary Evans',null)",
                   "insert into person_role(person_id, role, status, end_reason, ended_at) values ('00000000-0000-0000-0000-000000000010','client','former','Discharged','2026-03-15'),('00000000-0000-0000-0000-000000000011','client','former','Discharged','2026-09-27')",
                   "insert into phone_index(phone, person_id, confidence, source_system) values ('+14175550101','00000000-0000-0000-0000-000000000010','confirmed','axiscare'),('+14175550300','00000000-0000-0000-0000-000000000011','probable','axiscare')"]
rc, t = run("yes")
ck("'yes' adds them, proves texting unchanged for every number, and reports the new totals",
   rc == 0 and "✓ added 268 former clients" in t and "✓ who can be texted is unchanged for all 3 numbers on file" in t and "identity list now: 2 former clients" in t
   and "RESULT: DONE" in t and committed(), t)
S["preview"] = dict(PREVIEW, former_added=0, birth_dates_filled=0, name_coincidences=[], active_without_person=[], skipped_not_a_person=[]); rc, t = run("yes")
ck("a rerun with nothing left to add stops before asking", rc == 0 and "nothing to add" in t and not committed(), t[-300:])
ck("the birth-date migration is rerunnable", c.psql(open(MIGF).read())[0] == 0 and col())
srv.shutdown(); c.close()
print("\nDESKTOP 262 · FORMER CLIENTS INSTALL · PROOF\n" + "=" * 60); ok = True
for n, g, note in res: ok &= g; print(("PASS  " if g else "FAIL  ") + n + (("\n   └─ " + note) if note else ""))
print("=" * 60); print(f"ALL {len(res)} PROOFS PASS" if ok else "FAILED"); print("migration:", MIG_SHA); print("shas:", json.dumps(SHAS))
