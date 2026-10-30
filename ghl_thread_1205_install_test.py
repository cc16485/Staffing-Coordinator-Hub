#!/usr/bin/env python3
# Rehearsal of 1205 (ghl_thread_1205.py, the GoHighLevel reader's real kinds and recordings) against a FAKE Supabase and a FAKE
# supabase CLI, from a fresh worktree of this commit (as the Desktop step runs it). Never touches a real project.
#   python3 ghl_thread_1205_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
S = {}; M = {}
def reset(**m): S.clear(); S.update(posts=[], patches=[]); M.clear(); M.update(dict(gate=401, vj=True), **m)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if re.match(r"/v1/projects/\w+/functions/ghl-thread$", self.path): return self._send(200, {"version": 7, "verify_jwt": M["vj"]})
        self._send(404, {})
    def do_PATCH(self): S["patches"].append(self.path); self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}")
        if self.path.startswith("/functions/v1/"): S["posts"].append((self.path, body)); return self._send(M["gate"], {"error": "not allowed"} if M["gate"] != 200 else {"ok": True})
        self._send(400, {"message": "unexpected"})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t1205-"); WT = os.path.join(TMP, "wt")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WT, "HEAD"], check=True)
HEAD = subprocess.run(["git", "-C", WT, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
FAKEBIN = os.path.join(TMP, "bin"); os.makedirs(FAKEBIN); LOG = os.path.join(TMP, "cli.log")
open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil
a = sys.argv[1:]; open({LOG!r}, 'a').write(' '.join(a) + '\\n')
if a[:2] == ['functions', 'deploy']: sys.exit(0)
if a[:2] == ['functions', 'download']:
    shutil.copytree(os.path.join({WT!r}, 'supabase', 'functions', 'ghl-thread'), os.path.join(os.getcwd(), 'supabase', 'functions', 'ghl-thread'), dirs_exist_ok=True)
    shutil.copytree(os.path.join({WT!r}, 'supabase', 'functions', '_shared'), os.path.join(os.getcwd(), 'supabase', 'functions', '_shared'), dirs_exist_ok=True)
    sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
PIN = {"ghl-thread/index.ts": sha(os.path.join(WT, "supabase/functions/ghl-thread/index.ts")), "_shared/staff-auth.ts": sha(os.path.join(WT, "supabase/functions/_shared/staff-auth.ts"))}
def run(env_over=None, **mode):
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    for f in (LOG, rep): os.path.exists(f) and os.remove(f)
    env = dict(os.environ, PATH=FAKEBIN + ":/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", SB_STEP="1205", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL,
               SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_FNROOT=os.path.join(WT, "supabase", "functions"), SB_SHAS=json.dumps(PIN), SB_SETTLE="0", SB_MAIN_REF=HEAD)
    env.update(env_over or {})
    p = subprocess.run(["python3", os.path.join(WT, "ghl_thread_1205.py")], env=env, capture_output=True, text=True, cwd=WT, timeout=600)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
cli = lambda: open(LOG).read() if os.path.exists(LOG) else ""
deploys = lambda: re.findall(r"functions deploy ([\w-]+)", cli())
try:
    c, out = run()
    ck("clean run from a fresh copy: exit 0 and DONE", c == 0 and "1205: DONE" in out, out[-1800:])
    ck("Part 1: reviewed build, the reader's test passes, gateway read", "the reviewed build is what is on GitHub's main" in out and "the reader's test passes" in out and "kept: on" in out, out[:1500])
    ck("deploys ghl-thread only, keeping the gateway check on", deploys() == ["ghl-thread"] and "--no-verify-jwt" not in cli(), cli())
    ck("proof: refuses outsiders for messages, recordings and words", out.count("it refuses anyone not signed in to the office") == 3 and len(S["posts"]) == 3, out[-900:])
    ck("no key, token or email in the report; no em dash", not re.search(r"eyJ\w|sbp_\w|@mo-care", out) and "—" not in out, out)
    c, out = run(vj=False)
    ck("a gateway that was off stays off", c == 0 and "--no-verify-jwt" in cli() and "kept: off" in out, out[-600:])
    c, out = run(gate=200)
    ck("the reader answering outsiders is caught", c == 1 and "NOT COMPLETE" in out, out[-600:])
    c, out = run(env_over={"SB_SHAS": json.dumps({"ghl-thread/index.ts": "0" * 64})})
    ck("not the reviewed build: nothing runs", c == 2 and not deploys() and not S["posts"], out[-400:])
    c, out = run(env_over={"SB_MAIN_REF": HEAD + "~1"})
    ck("not what GitHub's main has: stops before any change", c == 2 and not deploys() and "isn't the same as GitHub's main" in out, out[-400:])
finally:
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", WT])
    shutil.rmtree(TMP, ignore_errors=True)
for n, o, d in res: print(("PASS" if o else "FAIL") + " · " + n + ("" if o else "\n     " + d))
print(f"{sum(1 for r in res if r[1])}/{len(res)}")
raise SystemExit(0 if all(r[1] for r in res) else 1)
