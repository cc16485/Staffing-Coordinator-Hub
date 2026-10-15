#!/usr/bin/env python3
# Rehearsal of 744 (contact_from_calls_744.py) against a FAKE Supabase management API, from a fresh worktree of this commit.
# Never touches a real project.  python3 contact_from_calls_744_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
S = {}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); q = json.loads(self.rfile.read(n) or b"{}")["query"]; S["sql"].append(q)
        if q.lstrip().startswith("with x as"): return self._send(200, [{"todo": 0 if S["fixed"] else S["todo"], "total": 40, "new_leads": 5 if S["fixed"] else 9}])
        if "update public.app_data" in q:
            if S["fail"]: return self._send(400, {"message": "boom"})
            S["fixed"] = True; return self._send(200, [])
        return self._send(400, {"message": "unexpected " + q[:80]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t744-"); WT = os.path.join(TMP, "wt")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WT, "HEAD"], check=True)
SQL_SHA = hashlib.sha256(open(os.path.join(WT, "contact_from_calls_744.sql"), "rb").read()).hexdigest()
def run(todo=4, fail=False, sha=SQL_SHA):
    S.clear(); S.update(sql=[], todo=todo, fixed=False, fail=fail); rep = os.path.join(TMP, "r.txt"); os.path.exists(rep) and os.remove(rep)
    env = dict(os.environ, SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_REPO=WT, SB_SQL_SHA=sha, SB_SHAS="{}", SB_SUPA_CLI="/bin/false")
    p = subprocess.run(["python3", os.path.join(WT, "contact_from_calls_744.py")], env=env, capture_output=True, text=True, timeout=300)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
try:
    c, out = run()
    ck("clean run from a fresh copy: exit 0, DONE", c == 0 and "RESULT: DONE" in out, out[-1500:])
    ck("the real correction is tested on a test database first", "contact_from_calls_744_test.mjs" in out and "7/7 passed" in out, out[:900])
    ck("says how many leads it corrects, runs the correction once, then finds none left", "4 lead(s) were made from an answered call" in out and sum("update public.app_data" in q for q in S["sql"]) == 1
       and "now shows the conversation (0 left)" in out and "New now (was 9)" in out, out)
    c, out = run(todo=0)
    ck("nothing to correct: it changes nothing", c == 0 and "nothing to correct" in out and not any("update public.app_data" in q for q in S["sql"]), out[-600:])
    c, out = run(fail=True)
    ck("the correction refused: says nothing was changed, and stops", c == 5 and "did not run" in out, out[-500:])
    c, out = run(sha="0" * 64)
    ck("not the reviewed build: nothing runs", c == 2 and not S["sql"], out[-300:])
    ck("no key or token in the report", not re.search(r"eyJ\w|sbp_\w", out))
finally:
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", WT]); shutil.rmtree(TMP, ignore_errors=True)
for n, o, d in res: print(("PASS" if o else "FAIL") + " · " + n + ("" if o else "\n     " + d))
print(f"{sum(1 for r in res if r[1])}/{len(res)}")
raise SystemExit(0 if all(r[1] for r in res) else 1)
