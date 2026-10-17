#!/usr/bin/env python3
# Rehearsal of 893 (people_roles_893.py) against a FAKE management API. Runs from a fresh copy of the committed build.
#   python3 people_roles_893_test.py
import json, os, subprocess, tempfile, threading, http.server, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1200]))
TMP = tempfile.mkdtemp(prefix="t893-"); COPY = os.path.join(TMP, "hub")
subprocess.run(["git", "clone", "-q", HERE, COPY], check=True)
subprocess.run(["git", "-C", COPY, "checkout", "-q", subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()], check=True)
S = {}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); q = json.loads(self.rfile.read(n))["query"]; S.setdefault("sql", []).append(q)
        if "begin;" in q:
            if S.get("fail"): return self._send(400, {"message": "people_on_journey_record does not look as expected. Nothing was changed."})
            S["done"] = True; return self._send(201, [])
        return self._send(200, [{"tbl": bool(S.get("done")), "door": bool(S.get("done"))}])
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
def run(main_ref="HEAD", **m):
    S.clear(); S.update(m); rep = os.path.join(TMP, "r.txt")
    env = dict(os.environ, SB_STEP="893", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FNROOT=os.path.join(COPY, "supabase", "functions"), SB_MAIN_REF=main_ref)
    p = subprocess.run(["python3", os.path.join(COPY, "people_roles_893.py")], cwd=COPY, env=env, capture_output=True, text=True, timeout=120)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), [q for q in S.get("sql", []) if "begin;" in q]
c, out, w = run()
ck("1 good run: the database change once, both proofs, DONE", c == 0 and "893: DONE" in out and len(w) == 1 and "✗" not in out, out)
c, out, w = run(main_ref="HEAD~1")
ck("2 not merged yet: stops before anything", c == 2 and "merge the Staffing pull request first" in out and not w, out)
c, out, w = run(fail=True)
ck("3 the live door looks different: refused, nothing kept, says so", c == 4 and "does not look as expected" in out, out)
for n, okk, note in res: print(("  ✓ " if okk else "  ✗ ") + n + ("" if okk else "\n" + note))
print(f"\n  893 rehearsal: {sum(1 for r in res if r[1])}/{len(res)} passed")
shutil.rmtree(TMP, ignore_errors=True)
raise SystemExit(0 if all(r[1] for r in res) else 1)
