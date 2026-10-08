#!/usr/bin/env python3
# Rehearsal of 501a / 501 (past clients from AxisCare) from a FRESH copy at the commit being tested, against a FAKE Supabase:
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
LOOK = {"mode": "look", "today": "2026-10-08", "axiscare_total": 293, "by_label": {"Active": 60, "Inactive": 180, "Deceased": 40, "Lead": 13}, "active": 60, "not_clients": 13,
        "already_in_hub": 70, "to_import": 2, "to_import_past": 1, "to_import_deceased": 1, "with_axiscare_end_date": 1, "on_or_before": 1, "twins_in_axiscare": [],
        "not_imported": {"no_start_date": [{"ax": "40", "name": "Nora Nodate", "label": "Inactive"}], "same_name_as_someone_in_hub": [{"ax": "41", "name": "Ruth Same", "label": "Inactive", "hub_name": "Ruth Same"}],
                         "on_hold_in_axiscare": [], "no_name": 0}, "older_backfill_same_day_end": 3, "imported": 0, "imported_ax": [], "errors": []}
def q1(sql_, **kw):
    c = conn()
    try: rows = c.run(sql_, **kw); cols = [x["name"] for x in (c.columns or [])]; return [dict(zip(cols, r)) for r in (rows or [])]
    finally: c.close()
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body):
        b = json.dumps(body, default=str).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path == f"/v1/projects/{REF}/functions/client-history-import": return self._send(200 if S["exists"] else 404, {"verify_jwt": False} if S["exists"] else {})
        if self.path.startswith(f"/v1/projects/{REF}/api-keys?reveal=true") and self.headers.get("Authorization") == "Bearer sbp_fake":
            return self._send(200, [{"name": "anon", "api_key": "eyJanon"}, {"name": "service_role", "api_key": "eyJsvc"}])
        if self.path.startswith("/functions/v1/client-history-import"):
            S["calls"].append(self.path)
            if not S["exists"]: return self._send(404, {})
            if self.headers.get("Authorization") != "Bearer eyJsvc": return self._send(401, {"error": "owner only"})
            if S["fn_status"] != 200: return self._send(S["fn_status"], {"error": "AxisCare answered 503; nothing was imported"})
            if "commit=1" not in self.path: return self._send(200, LOOK)
            c = conn()
            for ax, name, reason, end, basis in (("30", "Ivan Past", None, "2024-02-10", "exact"), ("31", "Dora Gone", "deceased", "2026-10-08", "on_or_before")):
                if q1("select 1 from person_source_id where source_id = :a", a=ax): continue
                pid = c.run("insert into person_identity (display_name) values (:n) returning id", n=name)[0][0]
                c.run("insert into person_source_id (person_id, system, entity_type, source_id, evidence) values (:p, 'axiscare', 'client', :a, 'historical import (Desktop 501, 2026-10-08): AxisCare status x')", p=pid, a=ax)
                c.run("insert into person_role (person_id, role, status, started_at, ended_at, ended_date_basis, end_reason) values (:p, 'client', 'former', '2023-01-01', :e, :b, :r)", p=pid, e=end, b=basis, r=reason)
            c.close()
            return self._send(200, dict(LOOK, mode="import", imported=2, imported_ax=["30", "31"]))
        self._send(404, {})
    def do_DELETE(self):
        if self.path == f"/v1/projects/{REF}/functions/client-history-import":
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
PINS = {"client-history-import/index.ts": sha(os.path.join(FNROOT, "client-history-import", "index.ts")), "_shared/audience-guard.ts": sha(os.path.join(FNROOT, "_shared", "audience-guard.ts")),
        "_shared/job-auth.ts": sha(os.path.join(FNROOT, "_shared", "job-auth.ts"))}
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
    p = subprocess.run([sys.executable, os.path.join(W, "history_import_501.py")], env=env, capture_output=True, text=True, timeout=300)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
people = lambda: q1("select count(*)::int as n from person_identity")[0]["n"]
log = lambda: open(LOG).read() if os.path.exists(LOG) else ""
try:
    fresh(); code, out = run("look")
    ck("501a look: done, nothing written", code == 0 and "LOOK DONE" in out and people() == 0 and all("commit=1" not in c for c in S["calls"]), out)
    ck("...the function was deployed for the run (gateway off; it checks the server key itself) and deleted again", "--no-verify-jwt" in log() and S["deleted"] == 1 and not S["exists"] and "deleted again" in out, out)
    ck("...the report says who would come in and who stays out, with names and why", "would come in as past clients: 2 (1 past, 1 deceased)" in out and "Nora Nodate (Inactive)" in out and "Ruth Same (Inactive)" in out
       and "no sympathy-card task" in out and "end date equal to their start date" in out, out)
    ck("...no key or token in the report", not re.search(r"eyJ|sbp_", out), out)
    fresh(); code, out = run("import")
    ck("501 import: done, 2 past clients in, proven", code == 0 and "RESULT: DONE · 2 past clients" in out and people() == 2 and "✗" not in out, out)
    ck("...every one ended, none active, no phone, no journey; all on the shift jobs' skip list", "every one an ended client role" in out and "none is active, none has a phone, none has a journey" in out and "every one is on the list the shift jobs skip" in out, out)
    ck("...and the function is gone again", S["deleted"] == 1 and not S["exists"], S)
    code, out = run("import")
    ck("run again: nothing doubled", code == 0 and people() == 2 and "already imported by 501: 2" in out, out)
    fresh(basis=False); code, out = run("look")
    ck("without the 499 mark: nothing runs (no deploy)", code == 2 and "499" in out and "deploy" not in log(), out)
    fresh(); S["fn_status"] = 502; code, out = run("import")
    ck("AxisCare unreadable: stops, nothing written, the function is deleted", code == 6 and people() == 0 and S["deleted"] == 1 and not S["exists"], out)
    fresh(); open(os.path.join(T, "fail"), "w").write("1"); code, out = run("import")
    ck("the function fails to deploy: stops, nothing written", code == 5 and people() == 0, out)
    fresh(); S["no_delete"] = True; code, out = run("look")
    ck("if the function can't be deleted, the report says so (✗)", code == 9 and "could not be deleted" in out, out)
    fresh(); code, out = run("look", SB_FN_SHAS=json.dumps(dict(PINS, **{"_shared/job-auth.ts": "0" * 64})))
    ck("a changed build is refused before anything runs", code == 2 and "not the reviewed build" in out and "deploy" not in log(), out)
    fresh(); code, out = run("import", SB_TOKEN="nope")
    ck("no token: nothing runs", code == 2 and people() == 0, out)
finally:
    subprocess.run(["git", "worktree", "remove", "--force", W], cwd=HERE); shutil.rmtree(T, ignore_errors=True); H.shutdown()
for n, okk, d_ in res: print(("PASS" if okk else "FAIL"), "·", n, d_)
print(f"{sum(1 for x in res if x[1])} passed, {sum(1 for x in res if not x[1])} failed")
raise SystemExit(0 if all(x[1] for x in res) else 1)
