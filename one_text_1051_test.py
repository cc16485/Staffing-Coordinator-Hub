#!/usr/bin/env python3
# Rehearsal of 1051 (one_text_1051.py) against a FAKE Supabase (management API, functions) and a FAKE supabase CLI, from a
# fresh worktree of this commit (as the Desktop step runs it). Never touches a real project.  python3 one_text_1051_test.py
import json, os, subprocess, tempfile, threading, http.server, hashlib, re, shutil, datetime as dt
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
BASE = "ff97721aa2a1c999e580ed89f7a6874683b979c5"     # main before this change: what is live
M = {}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        m = re.match(r"/v1/projects/\w+/functions/(lead-watch|lead-digest)$", self.path)
        if m: return self._send(200, {"version": 18 if m.group(1) == "lead-watch" else 81, "verify_jwt": m.group(1) == "lead-digest"})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/functions/v1/"): return self._send(401, {"error": "not allowed"})
        q = body["query"]
        if "lead_rungs_live" in q and q.startswith("select"): return self._send(200, [{"rungs": True, "one_text": bool(M.get("one_text"))}])
        if q.startswith("update public.app_data"): M["one_text"] = True; M["updates"] = M.get("updates", 0) + 1; return self._send(200, [{"v": "true"}])
        if q.startswith("insert into public.op_events"): M["events"] = M.get("events", 0) + 1; return self._send(200, [])
        if "hb_lead-watch" in q:
            at = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=30)).strftime("%Y-%m-%dT%H:%M:%S.000Z") if M.get("deployed") and not M.get("never_runs") else "2026-10-22T10:00:00.000Z"
            return self._send(200, [{"at": at, "note": "rungs 1/0/0 filled:0 moved:0"}])
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t1051-"); WT = os.path.join(TMP, "wt"); LIVE = os.path.join(TMP, "live")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WT, "HEAD"], check=True)
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", LIVE, BASE], check=True)
FAKEBIN = os.path.join(TMP, "bin"); os.makedirs(FAKEBIN); FLAG = os.path.join(TMP, "deployed"); SRCF = os.path.join(TMP, "livesrc")
open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil
a = sys.argv[1:]
if a[:2] == ['functions', 'deploy']: open({FLAG!r}, 'w').write('x'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    src = {WT!r} if os.path.exists({FLAG!r}) else open({SRCF!r}).read()
    shutil.copytree(os.path.join(src, 'supabase', 'functions'), os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True); sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
HEADSHA = subprocess.run(["git", "-C", WT, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
SHAS = {k: sha(os.path.join(WT, "supabase/functions", k)) for k in ("lead-watch/index.ts", "lead-digest/index.ts", "_shared/lead-rules.js")}
def go(**m):
    M.clear(); M.update(m)
    if os.path.exists(FLAG): os.remove(FLAG)
    open(SRCF, "w").write(m.get("live_src", WT))
    rep = os.path.join(TMP, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    class W(threading.Thread):
        def run(self_):
            while not getattr(self_, "stop", False):
                if os.path.exists(FLAG): M["deployed"] = True
                threading.Event().wait(0.1)
    w = W(daemon=True); w.start()
    env = dict(os.environ, SB_STEP="1051", SB_TOKEN="sbp_fake", SB_REPORT=rep, SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_API_BASE=URL, SB_FN_BASE=URL,
               SB_FNROOT=os.path.join(WT, "supabase/functions"), SB_SHAS=json.dumps(m.get("shas", SHAS)), SB_MAIN_REF="HEAD", SB_BASE=HEADSHA, SB_WAIT_S="20", SB_FAST="1")
    p = subprocess.run(["python3", os.path.join(WT, "one_text_1051.py")], cwd=WT, env=env, capture_output=True, text=True)
    w.stop = True
    return p.returncode, open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr
try:
    c, o = go()
    ck("clean run: DONE, exit 0", c == 0 and "1051: DONE" in o, o)
    ck("clean run: the live functions hold nothing that is not on main", "the live lead-watch holds nothing that is not already on GitHub" in o and "the live lead-digest holds nothing that is not already on GitHub" in o, o)
    ck("clean run: tests ran", "tests pass: one text per family" in o, o)
    ck("clean run: gateway settings kept (lead-watch off, lead-digest on)", "lead-watch deployed: version 18, gateway sign-in check off" in o and "lead-digest deployed: version 81, gateway sign-in check on" in o, o)
    ck("clean run: the switch is turned on once and recorded", M.get("updates") == 1 and M.get("events") == 1 and "one text per family is ON" in o, [M, o])
    ck("clean run: a stranger is refused and lead-watch ran the new build", "a caller with no key gets nothing (401)" in o and "lead-watch ran with the new build" in o, o)
    c, o = go(one_text=True)
    ck("run again: the switch is left as it is", c == 0 and not M.get("updates") and "already on" in o, o)
    # live has the OLDER verbs.js from main's history (what 1051 met on 2026-10-22): go ahead, and say so
    OLD = os.path.join(TMP, "old"); shutil.copytree(LIVE, OLD, ignore=shutil.ignore_patterns(".git"))
    open(os.path.join(OLD, "supabase/functions/_shared/verbs.js"), "w").write(subprocess.run(["git", "-C", HERE, "show", "368d170:supabase/functions/_shared/verbs.js"], capture_output=True, text=True).stdout)
    c, o = go(live_src=OLD)
    ck("live has an older verbs.js from main's history: goes ahead and says it brings it up to date", c == 0 and "1051: DONE" in o and "older copies of: supabase/functions/_shared/verbs.js" in o, o)
    # live has a verbs.js that is nowhere in main's history: someone's unknown work, stop
    UNK = os.path.join(TMP, "unk"); shutil.copytree(WT, UNK, ignore=shutil.ignore_patterns(".git"))
    with open(os.path.join(UNK, "supabase/functions/_shared/verbs.js"), "a") as f: f.write("\n// a change nobody merged\n")
    c, o = go(live_src=UNK)
    ck("live has a verbs.js that is not on main: stops before anything changes", c == 2 and not os.path.exists(FLAG) and "has something that is not on GitHub's main" in o and "verbs.js" in o, o)
    UNK2 = os.path.join(TMP, "unk2"); shutil.copytree(WT, UNK2, ignore=shutil.ignore_patterns(".git"))
    with open(os.path.join(UNK2, "supabase/functions/lead-digest/index.ts"), "a") as f: f.write("\n// someone deployed this without merging\n")
    c, o = go(live_src=UNK2)
    ck("someone deployed an unmerged lead-digest: stops before anything changes", c == 2 and not os.path.exists(FLAG) and "has something that is not on GitHub's main" in o and not M.get("updates"), o)
    c, o = go(shas={"lead-watch/index.ts": "0" * 64})
    ck("not the reviewed build: stops before anything changes", c == 2 and not os.path.exists(FLAG) and "not the reviewed build" in o, o)
    c, o = go(never_runs=True)
    ck("lead-watch has not run yet: says so, NOT COMPLETE", c == 1 and "has not run since the change" in o and "NOT COMPLETE" in o, o)
finally:
    for d in (WT, LIVE): subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", d])
    shutil.rmtree(TMP, ignore_errors=True); srv.shutdown()
ok = sum(1 for r in res if r[1])
for n, g, note in res: print(("  ✓ " if g else "  ✗ ") + n + ("" if g else "\n      " + note))
print(f"\n{ok}/{len(res)} passed"); raise SystemExit(0 if ok == len(res) else 1)
