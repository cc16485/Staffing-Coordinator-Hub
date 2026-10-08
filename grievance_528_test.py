#!/usr/bin/env python3
# Rehearsal of 528 (grievance as a client issue kind) from a FRESH copy at the commit being tested, against a throwaway local
# Postgres behind a fake Management API. Never touches a real project. (REHEARSE_COMMIT pins a commit)
import json, os, re, subprocess, sys, tempfile, threading, http.server, shutil, hashlib
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "my_desk_463_sql_test.py")).read()
exec(src[:src.index("c = conn(); setup(c)")])
from pg8000.native import DatabaseError
REF = "zngsgedlsxinbygwmxwn"; COMMIT = os.environ.get("REHEARSE_COMMIT") or subprocess.run(["git", "rev-parse", "HEAD"], cwd=HERE, capture_output=True, text=True).stdout.strip()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body):
        b = json.dumps(body, default=str).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
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
T = tempfile.mkdtemp(prefix="reh528-"); W = os.path.join(T, "hub")
subprocess.run(["git", "worktree", "add", "-q", "--detach", W, COMMIT], cwd=HERE, check=True)
sha = lambda p_: hashlib.sha256(open(p_, "rb").read()).hexdigest()
PINS = {"client-issues/grievance.sql": sha(os.path.join(W, "client-issues", "grievance.sql"))}
def fresh():
    c = conn(); setup(c)
    c.run("drop table if exists public.issue_category cascade")
    c.run("""create table public.issue_category (code text primary key, label text not null, default_domain text not null,
      default_urgency text not null check (default_urgency in ('critical','high','normal','low')), target_hours int not null,
      follow_up_required boolean not null default false, follow_up_days int, notify_beyond_owner text, owner_authority boolean not null default false,
      requires_policy_lookup boolean not null default false, resolution_means text not null, required_info text, sort int not null default 100)""")
    c.run("insert into public.issue_category (code, label, default_domain, default_urgency, target_hours, resolution_means) values ('family_complaint', 'Family complaint about a caregiver', 'field_quality', 'high', 8, 'x'), ('suspected_abuse', 'Possible abuse', 'client_care', 'critical', 1, 'y')")
    c.close()
def run(**over):
    rep = os.path.join(T, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_API_BASE=URL, SB_ROOT=W, SB_FN_SHAS=json.dumps(PINS)); env.update(over)
    p = subprocess.run([sys.executable, os.path.join(W, "grievance_528.py")], env=env, capture_output=True, text=True, timeout=120)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
def q1(s):
    c = conn()
    try: return c.run(s)
    finally: c.close()
try:
    fresh(); code, out = run()
    ck("DONE: the Grievance kind added, nothing else changed", code == 0 and "RESULT: DONE" in out and "✗" not in out and q1("select count(*) from public.issue_category") == [[3]], out)
    g = q1("select default_domain, default_urgency, target_hours, follow_up_required, follow_up_days, notify_beyond_owner, requires_policy_lookup, resolution_means, required_info from public.issue_category where code = 'grievance'")[0]
    ck("...client care, high, first response in a day, follow-up 14 days, Samantha sees it, policy governs it", g[:7] == ["client_care", "high", 24, True, 14, "samantha", True], g)
    ck("...resolved means: answered in writing, told about DSDS (portal or 866-835-3505), nothing changed because they complained", "in writing" in g[7] and "866-835-3505" in g[7] and "because they complained" in g[7], g[7])
    ck("...abuse, neglect or exploitation is not a grievance: the hotline", "1-800-392-0210" in g[8] and "Possible abuse" in g[8], g[8])
    ck("...no em dashes in the wording", "—" not in g[7] + g[8])
    code, out = run()
    ck("run again: safe, still one Grievance kind", code == 0 and "already there" in out and q1("select count(*) from public.issue_category where code = 'grievance'") == [[1]], out)
    fresh(); code, out = run(SB_FN_SHAS=json.dumps({"client-issues/grievance.sql": "0" * 64}))
    ck("a changed file is refused before anything runs", code == 2 and q1("select count(*) from public.issue_category") == [[2]], out)
    fresh(); code, out = run(SB_TOKEN="nope")
    ck("no token: nothing runs", code == 2 and q1("select count(*) from public.issue_category") == [[2]], out)
finally:
    subprocess.run(["git", "worktree", "remove", "--force", W], cwd=HERE); shutil.rmtree(T, ignore_errors=True); H.shutdown()
for n, okk, d_ in res: print(("PASS" if okk else "FAIL"), "·", n, d_)
print(f"{sum(1 for x in res if x[1])} passed, {sum(1 for x in res if not x[1])} failed")
raise SystemExit(0 if all(x[1] for x in res) else 1)
