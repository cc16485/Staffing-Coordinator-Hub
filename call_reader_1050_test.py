#!/usr/bin/env python3
# Rehearsal of 1050 (call_reader_1050.py) against a FAKE Supabase (management API, functions) and a FAKE supabase CLI, from a
# fresh worktree of this commit (as the Desktop step runs it). Never touches a real project.  python3 call_reader_1050_test.py
import json, os, subprocess, tempfile, threading, http.server, hashlib, re, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
M = {}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if re.match(r"/v1/projects/\w+/functions/call-tasks$", self.path): return self._send(200, {"version": 7, "verify_jwt": False})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/functions/v1/"): return self._send(401, {"error": "not allowed"})
        q = body["query"]
        if "hb_call-tasks" in q:
            if not M.get("deployed") or M.get("never_runs"): return self._send(200, [{"at": "2026-10-22T10:00:00Z", "ok": "true", "note": json.dumps({"calls": 80, "read": 0})}])
            if M.get("reads_nothing"): return self._send(200, [{"at": "2026-10-22T10:05:00Z", "ok": "false", "note": ("BEHIND: 97 call(s) unread more than 2 hours (oldest 2026-10-16T14:40:00Z) " + json.dumps({"calls": 178, "read": 0, "cards": 0, "no_cards": 0, "no_transcript": 0, "errors": 6, "could_not_read": 0, "failed": 0, "unread": 97, "behind": 97, "behind_since": "2026-10-16T14:40:00Z", "texts_read": 0}))[:300]}])
            note = ("BEHIND: 91 call(s) unread more than 2 hours (oldest 2026-10-16T15:10:00Z) " + json.dumps({"calls": 178, "read": 6, "cards": 2, "no_cards": 4, "no_transcript": 0, "errors": 0, "could_not_read": 0, "failed": 0, "unread": 91, "behind": 91, "behind_since": "2026-10-16T15:10:00Z", "texts_read": 2, "text_cards": 0}))[:300]
            return self._send(200, [{"at": "2026-10-22T10:05:00Z", "ok": "false", "note": note}])
        if "from call_pull_seen s" in q: return self._send(200, [{"n": 97}] if not M.get("deployed") else [{"n": 91}])
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t1050-"); WT = os.path.join(TMP, "wt")
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
SHAS = {"call-tasks/index.ts": sha(os.path.join(WT, "supabase/functions/call-tasks/index.ts")), "_shared/call-tasks.ts": sha(os.path.join(WT, "supabase/functions/_shared/call-tasks.ts"))}
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
    env = dict(os.environ, SB_STEP="1050", SB_TOKEN="sbp_fake", SB_REPORT=rep, SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_API_BASE=URL, SB_FN_BASE=URL,
               SB_FNROOT=os.path.join(WT, "supabase/functions"), SB_SHAS=json.dumps(m.get("shas", SHAS)), SB_MAIN_REF="HEAD", SB_WAIT_S=str(m.get("wait", 25)))
    p = subprocess.run(["python3", os.path.join(WT, "call_reader_1050.py")], cwd=WT, env=env, capture_output=True, text=True)
    w.stop = True
    return p.returncode, open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr
try:
    c, o = go()
    ck("clean run: DONE, exit 0", c == 0 and "1050: DONE" in o, o)
    ck("clean run: tests ran (the stuck case too) and the stranger was refused", "including 80 old calls already read" in o and "a caller with no key gets nothing (401)" in o, o)
    ck("clean run: counts before and after", "not read yet (before): 97" in o and "not read yet (after): 91" in o, o)
    ck("clean run: reads the cut-off run note: read 6, 91 still to read, BEHIND explained", "read 6 call(s); 91 still to read" in o and "catching up: 91 call(s)" in o and "the new alarm working" in o, o)
    ck("clean run: gateway setting kept off", "gateway sign-in check off" in o, o)
    c, o = go(shas={"call-tasks/index.ts": "0" * 64})
    ck("not the reviewed build: stops before anything changes", c == 2 and not os.path.exists(FLAG) and "not the reviewed build" in o, o)
    c, o = go(never_runs=True, wait=25)
    ck("the reader has not run yet: says so, NOT COMPLETE", c == 1 and "has not run the new build yet" in o and "NOT COMPLETE" in o, o)
    c, o = go(reads_nothing=True)
    ck("it ran but read nothing while calls wait: NOT COMPLETE (never DONE with 0 read)", c == 1 and "read nothing while 97 call(s) wait" in o and "NOT COMPLETE" in o, o)
finally:
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", WT]); shutil.rmtree(TMP, ignore_errors=True); srv.shutdown()
ok = sum(1 for r in res if r[1])
for n, g, note in res: print(("  ✓ " if g else "  ✗ ") + n + ("" if g else "\n      " + note))
print(f"\n{ok}/{len(res)} passed"); raise SystemExit(0 if ok == len(res) else 1)
