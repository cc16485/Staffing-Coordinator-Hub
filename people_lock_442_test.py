#!/usr/bin/env python3
# Rehearsal of 442 against a FAKE Supabase, run from a FRESH copy of this commit (as the Desktop step runs).
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); REF = "zngsgedlsxinbygwmxwn"
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
M = {}; SEEN = []
GOOD = {"whole_upsert": "refused", "update": "refused", "delete": "refused", "old_item_save": "refused", "one_person_save": {"ok": True, "version": 3}, "other_list": "allowed", "candidates_same": True, "caregivers_same": True}
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); q = json.loads(self.rfile.read(n))["query"]; SEEN.append(q)
        if "relrowsecurity as rls" in q:
            own = "postgres"; fns = "app_data_items_apply=postgres,caregiver_connect_apply=" + ("supabase_admin" if M.get("badowner") else "postgres") + ",caregiver_sweep_patch=postgres"
            return self._send(201, [{"rls": True, "forced": bool(M.get("forced")), "owner": own, "fns": fns, "already": 0}])
        if "PROBE_RESULT" in q:
            r = dict(GOOD); r.update(M.get("probe", {}))
            return self._send(400, {"message": "ERROR:  P0001: PROBE_RESULT: " + json.dumps(r)})
        return self._send(201, [])
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
tmp = tempfile.mkdtemp(prefix="t442-"); WT = os.path.join(tmp, "wt", "hub")
subprocess.run(["git", "worktree", "add", "-q", "--detach", WT, "HEAD"], cwd=HERE, check=True)
SH = {k: sha(os.path.join(HERE, f)) for k, f in (("SB_SQL_SHA", "people_lock.sql"), ("SB_PROOF_SHA", "people_lock_proof.sql"), ("SB_ROLLBACK_SHA", "people_lock_rollback.sql"))}
def run(mode=None, **over):
    M.clear(); M.update(mode or {}); SEEN.clear()
    rep = os.path.join(tmp, "r.txt")
    if os.path.exists(rep): os.unlink(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_API_BASE=URL, SB_REPO=WT, SB_REHEARSAL_SKIP_SQL_TEST="1", **SH); env.update(over)
    p = subprocess.run([sys.executable, os.path.join(WT, "people_lock_442.py")], env=env, capture_output=True, text=True)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
rolled = lambda: any("drop policy if exists app_data_people_lock_ins" in q and "create policy" not in q for q in SEEN)
rc, r = run(); print(r)
ck("DONE: the lock goes on, the proof is exactly right, nothing taken back off", rc == 0 and "RESULT: DONE" in r and any("create policy app_data_people_lock_ins" in q for q in SEEN) and not rolled() and "✗" not in r, r)
ck("no key or token in the report", not re.search(r"eyJ|sbp_", r), r)
rc, r = run(mode={"probe": {"update": "went in"}}); ck("a whole save that went through in the proof: the lock comes straight back off, NOT DONE", rc != 0 and rolled() and "NOT DONE" in r and "taken back off" in r, r)
rc, r = run(mode={"probe": {"one_person_save": {"ok": False, "error": "permission denied"}}}); ck("the one-person save locked out in the proof: the lock comes back off", rc != 0 and rolled() and "NOT DONE" in r, r)
rc, r = run(mode={"badowner": True}); ck("a safe-save function not owned by the table owner: stops before the lock", rc != 0 and "could shut them out" in r and not any("create policy" in q for q in SEEN), r)
rc, r = run(mode={"forced": True}); ck("row security forced: stops before the lock", rc != 0 and "expected state" in r and not any("create policy" in q for q in SEEN), r)
rc, r = run(SB_SQL_SHA="0" * 64); ck("not the reviewed SQL: stops", rc != 0 and "not the reviewed build" in r and not SEEN, r)
H.shutdown(); subprocess.run(["git", "worktree", "remove", "--force", WT], cwd=HERE); shutil.rmtree(tmp, ignore_errors=True)
for n, ok, note in res: print(("PASS " if ok else "FAIL ") + n + ("" if ok else "\n      " + note))
print("ALL %d CHECKS PASS" % len(res) if all(x[1] for x in res) else "FAILED"); sys.exit(0 if all(x[1] for x in res) else 1)
