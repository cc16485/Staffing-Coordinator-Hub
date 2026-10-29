#!/usr/bin/env python3
# Rehearsal of 1177 (visit_parts_1177.py) against a FAKE Supabase management API. Never touches a real project.
#   python3 visit_parts_1177_install_test.py
import json, os, subprocess, tempfile, threading, http.server, hashlib
HERE = os.path.dirname(os.path.abspath(__file__))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
S = {}
def reset(**m): S.clear(); S.update(dict(sql=[], table=True, cols=0, idx=False, priv=True, rls=True, fail_change=False), **m)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); q = json.loads(self.rfile.read(n) or b"{}")["query"]; S["sql"].append(q)
        if q.startswith("select to_regclass('public.recordings') is not null"):
            return self._send(200, [{"t": S["table"], "n": 41, "a": 6, "have": S["cols"]}])
        if "alter table public.recordings add column if not exists session_id" in q:
            if S["fail_change"]: return self._send(400, {"message": "permission denied"})
            S["cols"] = 3; S["idx"] = True; return self._send(200, [])
        if q.startswith("select column_name as c"):
            return self._send(200, [{"c": c, "t": t} for c, t in [("session_id", "text"), ("part", "integer"), ("offset_seconds", "integer")][:S["cols"]]])
        if q.startswith("select to_regclass('public.recordings_session_idx')"):
            return self._send(200, [{"i": S["idx"], "ins": S["priv"], "sel": S["priv"], "rls": S["rls"], "n": 41}])
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t1177-")
SQLSHA = {"visit_parts_1177.sql": sha(os.path.join(HERE, "visit_parts_1177.sql"))}
def run(shas=None, **mode):
    reset(**mode); rep = os.path.join(TMP, "r.txt"); os.path.exists(rep) and os.remove(rep)
    env = dict(os.environ, SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FNROOT=os.path.join(HERE, "supabase/functions"),
               SB_SQL_SHAS=json.dumps(shas or SQLSHA), PYTHONPATH=HERE)
    p = subprocess.run(["python3", os.path.join(HERE, "visit_parts_1177.py")], env=env, capture_output=True, text=True, timeout=120)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
changed = lambda: any("alter table" in q for q in S["sql"])

code, out = run()
ck("fresh: exit 0, DONE, the three columns go in", code == 0 and "RESULT: DONE" in out and changed() and "session_id, part and offset_seconds are on recordings" in out, out)
ck("fresh: reports counts only (41 recordings, 6 home visits)", "41 recordings, 6 of them home visits" in out and "@" not in out, out)
ck("the SQL file it ran is the reviewed one", "visit_parts_1177.sql is the reviewed build" in out, out)
ck("proof: index, the signed-in Hub can use the columns, row security still on", all(s in out for s in ["the index is there", "can write and read the new columns", "row security is still on"]), out)
code, out = run(cols=3, idx=True)
ck("run again: says it was run before, still DONE (safe to re-run)", code == 0 and "this step was run before" in out and "RESULT: DONE" in out, out)
code, out = run(table=False)
ck("no recordings table: stops before changing anything", code == 3 and not changed() and "STOPPED before anything changed" in out, out)
code, out = run(shas={"visit_parts_1177.sql": "0" * 64})
ck("not the reviewed SQL: stops before changing anything", code == 3 and not changed() and "not the reviewed build" in out, out)
code, out = run(fail_change=True)
ck("the change is refused: says nothing changed, exit 6", code == 6 and "did not go in (nothing changed)" in out, out)
code, out = run(priv=False)
ck("the Hub cannot use the columns: a ✗ line, not DONE", code == 9 and "cannot use the new columns" in out and "RESULT: DONE" not in out, out)
code, out = run(rls=False)
ck("row security off: a ✗ line, not DONE", code == 9 and "row security is OFF" in out, out)
sqltxt = open(os.path.join(HERE, "visit_parts_1177.sql")).read().lower()
ck("the SQL only adds (no drop, delete, update or truncate)", not any(w in sqltxt for w in ["drop ", "delete ", "update ", "truncate"]) and sqltxt.count("add column if not exists") == 3 and "create index if not exists" in sqltxt)
srv.shutdown()
for n, c, note in res: print(("PASS" if c else "FAIL") + " · " + n + ("" if c else "\n     " + note))
print(sum(c for _, c, _ in res), "/", len(res)); raise SystemExit(0 if all(c for _, c, _ in res) else 1)
