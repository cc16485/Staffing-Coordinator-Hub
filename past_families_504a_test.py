#!/usr/bin/env python3
# Rehearsal of 504a (past families look) from a FRESH copy at the commit being tested, against a FAKE Supabase:
# a throwaway local Postgres, a fake Management API, a fake supabase CLI and a fake import function (its own logic is tested by
# history_import_test.mjs). Never touches a real project. (REHEARSE_COMMIT pins a commit)
import json, os, re, subprocess, sys, tempfile, threading, http.server, shutil, hashlib
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "my_desk_463_sql_test.py")).read()
exec(src[:src.index("c = conn(); setup(c)")])
from pg8000.native import DatabaseError
REF = "zngsgedlsxinbygwmxwn"; COMMIT = os.environ.get("REHEARSE_COMMIT") or subprocess.run(["git", "rev-parse", "HEAD"], cwd=HERE, capture_output=True, text=True).stdout.strip()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
S = {"exists": False, "deleted": 0, "calls": [], "fn_status": 200, "no_delete": False}
LOOK = {"mode": "look", "today": "2026-10-08", "past_total": 225, "deceased": 33, "ended_last_30_days": 25, "ended_over_3_years": 40, "no_end_date": 0, "eligible": 127,
        "reachable": 2, "by_text": 1, "by_email": 2, "unreachable": 125, "family_contact_only_self": 1, "axiscare_errors": 0,
        "list": [{"name": "Pam Past", "ended_at": "2026-03-01", "basis": "exact", "end_reason": None, "family": 1, "family_mobile": 1, "family_email": 1, "own_mobile": False, "own_email": False, "reachable": True},
                 {"name": "Nell Nofam", "ended_at": "2025-12-01", "basis": "exact", "end_reason": None, "family": 0, "family_mobile": 0, "family_email": 0, "own_mobile": False, "own_email": False, "reachable": False}]}
def q1(sql_, **kw):
    c = conn()
    try: rows = c.run(sql_, **kw); cols = [x["name"] for x in (c.columns or [])]; return [dict(zip(cols, r)) for r in (rows or [])]
    finally: c.close()
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body):
        b = json.dumps(body, default=str).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path == f"/v1/projects/{REF}/functions/past-families-look": return self._send(200 if S["exists"] else 404, {"verify_jwt": False} if S["exists"] else {})
        if self.path.startswith(f"/v1/projects/{REF}/api-keys?reveal=true") and self.headers.get("Authorization") == "Bearer sbp_fake":
            return self._send(200, [{"name": "anon", "api_key": "eyJanon"}, {"name": "service_role", "api_key": "eyJsvc"}])
        if self.path.startswith("/functions/v1/past-families-look"):
            S["calls"].append(self.path)
            if not S["exists"]: return self._send(404, {})
            if self.headers.get("Authorization") != "Bearer eyJsvc": return self._send(401, {"error": "owner only"})
            if S["fn_status"] != 200: return self._send(S["fn_status"], {"error": "AxisCare answered 503; nothing was imported"})
            return self._send(200, LOOK)
        self._send(404, {})
    def do_DELETE(self):
        if self.path == f"/v1/projects/{REF}/functions/past-families-look":
            if not S["no_delete"]: S["exists"] = False
            S["deleted"] += 1; return self._send(200, {})
        self._send(404, {})
    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
        if self.path == "/deployed": S["exists"] = True; return self._send(200, {})
        if not self.path.endswith(f"/v1/projects/{REF}/database/query"): return self._send(404, {})
        if self.headers.get("Authorization") != "Bearer sbp_fake": return self._send(401, {"message": "bad token"})
        cc = conn()
        try:
            rows = cc.run(json.loads(raw)["query"]); cols = [c["name"] for c in (cc.columns or [])]
            return self._send(201, [dict(zip(cols, r)) for r in (rows or [])])
        except DatabaseError as e:
            try: cc.run("rollback")
            except Exception: pass
            return self._send(400, {"message": str(e)[:200]})
        finally: cc.close()
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
T = tempfile.mkdtemp(prefix="reh501-"); W = os.path.join(T, "hub")
subprocess.run(["git", "worktree", "add", "-q", "--detach", W, COMMIT], cwd=HERE, check=True)
FNROOT = os.path.join(W, "supabase", "functions"); sha = lambda p_: hashlib.sha256(open(p_, "rb").read()).hexdigest()
PINS = {"past-families-look/index.ts": sha(os.path.join(FNROOT, "past-families-look", "index.ts")), "_shared/job-auth.ts": sha(os.path.join(FNROOT, "_shared", "job-auth.ts"))}
LOG = os.path.join(T, "cli.txt"); CLI = os.path.join(T, "supabase")
open(CLI, "w").write(f"""#!/bin/sh
echo "$@" >> {LOG}
[ -f {T}/fail ] && [ "$2" = "deploy" ] && {{ echo boom >&2; exit 1; }}
if [ "$2" = "deploy" ]; then curl -s -o /dev/null -X POST "{URL}/deployed"; exit 0; fi
exit 0
"""); os.chmod(CLI, 0o755)
def fresh(basis=True):
    c = conn(); setup(c)
    for t in ("client_journey", "person_role", "person_source_id", "person_identity"): c.run(f"drop table if exists public.{t} cascade")
    c.run("create table public.person_identity (id uuid primary key default gen_random_uuid(), display_name text not null, first_name text, last_name text, primary_phone text)")
    c.run("create table public.person_source_id (id bigserial primary key, person_id uuid not null references public.person_identity(id), system text not null, entity_type text not null, source_id text not null, confidence text not null default 'confirmed', needs_review boolean not null default false, evidence text)")
    c.run("create table public.person_role (id bigserial primary key, person_id uuid not null references public.person_identity(id), role text not null, status text not null, started_at date, ended_at date, end_reason text, check (status <> 'former' or ended_at is not null))")
    if basis: c.run("alter table public.person_role add column ended_date_basis text")
    c.run("create table public.client_journey (journey_id uuid primary key default gen_random_uuid(), axiscare_client_id text)")
    c.close(); S.update({"exists": False, "deleted": 0, "calls": [], "fn_status": 200, "no_delete": False})
    for f in (LOG, os.path.join(T, "fail")):
        if os.path.exists(f): os.remove(f)
def run(mode="look", **over):
    rep = os.path.join(T, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_API_BASE=URL, SB_FN_BASE=URL, SB_MODE=mode, SB_SUPA_CLI=CLI, SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(PINS)); env.update(over)
    p = subprocess.run([sys.executable, os.path.join(W, "past_families_504a.py")], env=env, capture_output=True, text=True, timeout=300)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
people = lambda: q1("select count(*)::int as n from person_identity")[0]["n"]
log = lambda: open(LOG).read() if os.path.exists(LOG) else ""
try:
    fresh(); code, out = run("look")
    ck("504a: done, nothing written", code == 0 and "LOOK DONE" in out and people() == 0, out)
    ck("...the function was deployed for the run (gateway off; it checks the server key itself) and deleted again", "--no-verify-jwt" in log() and S["deleted"] == 1 and not S["exists"] and "look function was deleted again" in out, out)
    ck("...the report: eligible, reachable, by text, by email, and every eligible family with who could be reached", "eligible (ended 1 month to 3 years ago): 127" in out and "reachable: 2 · by text (a mobile number): 1 · by email: 2" in out
       and "Pam Past · 2026-03-01 · 1 family contact(s): 1 mobile, 1 email" in out and "Nell Nofam · 2025-12-01 · nobody to reach" in out and "never: 33 deceased" in out, out)
    ck("...no key, token, phone number or email address in the report", not re.search(r"eyJ|sbp_|@|\d{3}-\d{4}", out), out)
    fresh(); S["fn_status"] = 500; code, out = run("look")
    ck("the look fails: stops, nothing written, the function is deleted", code == 6 and people() == 0 and S["deleted"] == 1 and not S["exists"], out)
    fresh(); open(os.path.join(T, "fail"), "w").write("1"); code, out = run("look")
    ck("the function fails to deploy: stops", code == 5, out)
    fresh(); S["no_delete"] = True; code, out = run("look")
    ck("if the function can't be deleted, the report says so (✗)", code == 9 and "could not be deleted" in out, out)
    fresh(); code, out = run("look", SB_FN_SHAS=json.dumps(dict(PINS, **{"_shared/job-auth.ts": "0" * 64})))
    ck("a changed build is refused before anything runs", code == 2 and "not the reviewed build" in out and "deploy" not in log(), out)
    fresh(); code, out = run("look", SB_TOKEN="nope")
    ck("no token: nothing runs", code == 2, out)
finally:
    subprocess.run(["git", "worktree", "remove", "--force", W], cwd=HERE); shutil.rmtree(T, ignore_errors=True); H.shutdown()
for n, okk, d_ in res: print(("PASS" if okk else "FAIL"), "·", n, d_)
print(f"{sum(1 for x in res if x[1])} passed, {sum(1 for x in res if not x[1])} failed")
raise SystemExit(0 if all(x[1] for x in res) else 1)
