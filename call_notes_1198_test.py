#!/usr/bin/env python3
# Rehearsal of 1198 (call_notes_1198.py) against a FAKE Supabase (management API, functions) and a FAKE supabase CLI, from a
# fresh worktree of this commit (as the Desktop step runs it). Never touches a real project.  python3 call_lead_1062_test.py
import json, os, subprocess, tempfile, threading, http.server, hashlib, re, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
M = {}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if re.match(r"/v1/projects/\w+/functions/(call-learn|call-to-lead)$", self.path): return self._send(200, {"version": 7, "verify_jwt": False})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/functions/v1/"): return self._send(401, {"error": "not allowed"})
        q = body["query"]
        if "hb_call-learn" in q:
            if not M.get("deployed") or M.get("never_runs"): return self._send(200, [{"at": "2026-10-22T10:00:00Z", "note": json.dumps({"errors": 0})}])
            return self._send(200, [{"at": "2026-10-22T10:05:00Z", "note": json.dumps({"errors": 0, "looked_at": 3, "read": 2, "skipped": 1, "waiting": 0})}])
        if q.startswith("update"): M["wrote"] = True; return self._send(400, {"message": "no writes expected"})
        if "call_notes_live" in q: return self._send(200, [{"live": "not set"}])
        if "from public.call_learned" in q:
            return self._send(200, [{"id": "oNejP4", "status": "read", "seconds": 240, "has_note": True, "call_back": "2026-11-02", "read_at": "Thu Oct 29 03:05 pm"},
                                    {"id": "abc123", "status": "skipped", "seconds": 20, "has_note": False, "call_back": "", "read_at": "Thu Oct 29 03:05 pm"}] if not M.get("quiet") else [])
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t1198-"); WT = os.path.join(TMP, "wt")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WT, "HEAD"], check=True)
FAKEBIN = os.path.join(TMP, "bin"); os.makedirs(FAKEBIN); FLAG = os.path.join(TMP, "deployed")
open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil
a = sys.argv[1:]
if a[:2] == ['functions', 'deploy']: open({FLAG!r}, 'w').write('x'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    shutil.copytree(os.path.join({WT!r}, 'supabase', 'functions'), os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True); sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
SHAS = {k: sha(os.path.join(WT, "supabase/functions", k)) for k in ("call-learn/index.ts", "call-to-lead/index.ts", "_shared/call-lead.ts")}
def go(**m):
    M.clear(); M.update(m)
    if os.path.exists(FLAG): os.remove(FLAG)
    rep = os.path.join(TMP, "report.txt")
    class W(threading.Thread):
        def run(self_):
            while not getattr(self_, "stop", False):
                if os.path.exists(FLAG): M["deployed"] = True
                threading.Event().wait(0.2)
    w = W(daemon=True); w.start()
    env = dict(os.environ, SB_STEP="1198", SB_TOKEN="sbp_fake", SB_REPORT=rep, SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_API_BASE=URL, SB_FN_BASE=URL,
               SB_FNROOT=os.path.join(WT, "supabase/functions"), SB_SHAS=json.dumps(m.get("shas", SHAS)), SB_MAIN_REF="HEAD", SB_WAIT_S=str(m.get("wait", 25)))
    p = subprocess.run(["python3", os.path.join(WT, "call_notes_1198.py")], cwd=WT, env=env, capture_output=True, text=True)
    w.stop = True
    return p.returncode, open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr
try:
    c, o = go()
    ck("clean run: DONE, exit 0", c == 0 and "1198: DONE" in o, o)
    ck("clean run: tests ran; strangers refused, Listen too", "both functions' tests pass" in o and "call-to-lead: a caller with no key gets nothing (401)" in o and "Listen with no sign-in gets nothing (401)" in o, o)
    ck("clean run: says the switch is off, the run counts, and each call without its words", "switch is OFF" in o and "looked at 3 call(s), read 2" in o and "call oNejP4… read Thu Oct 29 03:05 pm (240 s): READ, has a note, call back 2026-11-02" in o and "SKIPPED, no note" in o, o)
    ck("clean run: nothing written to the database, gateway kept", not M.get("wrote") and "gateway sign-in check off" in o, o)
    c, o = go(quiet=True)
    ck("no new calls: says so, still DONE", c == 0 and "no answered call on a lead came in since" in o, o)
    c, o = go(shas={"call-learn/index.ts": "0" * 64})
    ck("not the reviewed build: stops before anything changes", c == 2 and not os.path.exists(FLAG) and "not the reviewed build" in o, o)
    c, o = go(never_runs=True, wait=25)
    ck("the job has not run yet: says so, NOT COMPLETE", c == 1 and "has not run since the deploy" in o and "NOT COMPLETE" in o, o)
finally:
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", WT]); shutil.rmtree(TMP, ignore_errors=True); srv.shutdown()
ok = sum(1 for r in res if r[1])
for n, g, note in res: print(("  ✓ " if g else "  ✗ ") + n + ("" if g else "\n      " + note))
print(f"\n{ok}/{len(res)} passed"); raise SystemExit(0 if ok == len(res) else 1)
