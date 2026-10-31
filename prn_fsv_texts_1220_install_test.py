#!/usr/bin/env python3
# Rehearsal of 1220 (prn_fsv_texts_1220.py, Field Support Visits text the PRN CNAs it fits) against a FAKE Supabase and a FAKE supabase CLI,
# from a fresh worktree of this commit (as the Desktop step runs it). Never touches a real project.
#   python3 prn_fsv_texts_1220_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
BASE_SHA = subprocess.run(["git", "-C", HERE, "rev-parse", "0bb8f1daab3c9780d5e93c43fbd336cb23a54397"], capture_output=True, text=True).stdout.strip()   # main after 1216 (#724), as live
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
S = {}; M = {}
def reset(**m):
    S.clear(); S.update(sql=[], deployed=set()); M.clear()
    M.update(dict(switch=None, readfail=None, sqlfail=False, gate=401, forged=401, table=False), **m)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if "/api-keys" in p: return self._send(200, [{"name": "anon", "api_key": "eyJanonKEY"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
        m = re.match(r"/v1/projects/\w+/functions/([\w-]+)$", p)
        if m:
            fn = m.group(1)
            return self._send(200, {"version": 7, "verify_jwt": fn not in ("oncall-page", "prn-page")})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/functions/v1/oncall-page") or p.startswith("/functions/v1/prn-page"): return self._send(M["forged"], {"expired": True})
        if p.startswith("/functions/v1/"): return self._send(M["gate"], {"error": "not allowed"})
        q = body["query"]; S["sql"].append(q)
        if q.startswith("select data->'prn_mentor_text_live'"):
            if M["readfail"]: return self._send(*M["readfail"])
            return self._send(200, [{"v": M["switch"]}])
        if q.startswith("begin;") and "prn_mentor_texts" in q:
            if M["sqlfail"]: return self._send(400, {"message": "boom"})
            M["table"] = True; return self._send(201, [])
        if "table_name='prn_mentor_texts'" in q: return self._send(200, [{"t": 1 if M["table"] else 0, "g": 1 if M["table"] else 0, "n": 0}])
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t1220-"); WT = os.path.join(TMP, "wt"); BASEWT = os.path.join(TMP, "base")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WT, "HEAD"], check=True)
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", BASEWT, BASE_SHA], check=True)
FAKEBIN = os.path.join(TMP, "bin"); os.makedirs(FAKEBIN); LOG = os.path.join(TMP, "cli.log")
open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil
a = sys.argv[1:]; open({LOG!r}, 'a').write(' '.join(a) + '\\n')
if a[:2] == ['functions', 'deploy']: open(os.path.join({TMP!r}, 'deployed-' + a[2]), 'w').write('x'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    fn = a[2]
    src = {WT!r} if (os.path.exists(os.path.join({TMP!r}, 'deployed-' + fn)) or os.path.exists(os.path.join({TMP!r}, 'already'))) else {BASEWT!r}
    shutil.copytree(os.path.join(src, 'supabase', 'functions'), os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True)
    if os.path.exists(os.path.join({TMP!r}, 'drift')) and fn == 'prn-week' and not os.path.exists(os.path.join({TMP!r}, 'deployed-' + fn)):
        open(os.path.join(os.getcwd(), 'supabase', 'functions', 'prn-week', 'index.ts'), 'a').write('// someone else')
    sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
PIN = {k: sha(os.path.join(WT, "supabase/functions", k)) for k in ("prn-week/index.ts", "_shared/prn-mentor.ts", "_shared/outreach.ts", "_shared/send-problems.ts")}
def run(env_over=None, already=False, drift=False, **mode):
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    for f in [LOG, rep] + [os.path.join(TMP, x) for x in os.listdir(TMP) if x.startswith("deployed-")]: os.path.exists(f) and os.remove(f)
    for flag, on in (("already", already), ("drift", drift)):
        fp = os.path.join(TMP, flag); (open(fp, "w").write("x") if on else (os.path.exists(fp) and os.remove(fp)))
    env = dict(os.environ, PATH=FAKEBIN + ":/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", SB_STEP="1220", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL,
               SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_FNROOT=os.path.join(WT, "supabase/functions"), SB_SHAS=json.dumps(PIN), SB_BASE=BASE_SHA, SB_SETTLE="0", SB_MAIN_REF="HEAD", SB_RETRY_SCALE="0")
    env.update(env_over or {})
    p = subprocess.run(["python3", os.path.join(WT, "prn_fsv_texts_1220.py")], cwd=WT, env=env, capture_output=True, text=True, timeout=900)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
cli = lambda: open(LOG).read() if os.path.exists(LOG) else ""
deploys = lambda: re.findall(r"functions deploy ([\w-]+)", cli())
writes = lambda: [q for q in S["sql"] if not q.lstrip().lower().startswith("select")]
try:
    c, out = run()
    ck("clean run from a fresh copy: exit 0, DONE, texting switch off", c == 0 and "1220: DONE" in out and "Field Support Visit texting: OFF" in out, out[-1800:])
    ck("Part 1: the reviewed build, the tests ran, gateway setting read, prn-week live = GitHub's main", "the reviewed build is what is on GitHub's main" in out and "office line tests pass" in out
       and "prn-week on" in out and "prn-week live is GitHub's main" in out, out[:3200])
    ck("Part 2: the record in one transaction, then prn-week deployed keeping its gateway setting", len(writes()) == 1 and writes()[0].startswith("begin;") and writes()[0].rstrip().endswith("commit;")
       and deploys() == ["prn-week"] and "--no-verify-jwt" not in cli(), [writes(), cli()])
    ck("Part 3: refuses outsiders; the record is there and kept; the switch still off", "prn-week mentor_list refuses anyone" in out and "prn-week mentor_text refuses anyone" in out
       and "the texts' record is there and kept as sent" in out and "the texting switch is still off" in out, out[-1500:])
    ck("no key, token or email in the report; no em dash", not re.search(r"eyJ\w|sbp_\w|@mo-care", out) and "\u2014" not in out, out)
    c, out = run(already=True)
    ck("run again: live is already this build, still DONE", c == 0 and "already this build (an earlier run)" in out and "1220: DONE" in out, out[-900:])
    c, out = run(drift=True)
    ck("prn-week live with code never on GitHub's main: STOPS before any change", c == 3 and not deploys() and not writes() and "never on GitHub's main (prn-week/index.ts)" in out, out[-600:])
    c, out = run(switch=True)
    ck("texting already on: STOPS before any change", c == 2 and not deploys() and not writes() and "already on" in out, out[-600:])
    c, out = run(readfail=(401, {"message": "Unauthorized"}))
    ck("a token Supabase won't accept: says so, nothing changed", c == 3 and "didn't accept the access token" in out and not deploys(), out[-500:])
    c, out = run(env_over={"SB_SHAS": json.dumps({"prn-week/index.ts": "0" * 64})})
    ck("not the reviewed build: nothing runs", c == 2 and not deploys() and not S["sql"], out[-400:])
    c, out = run(sqlfail=True)
    ck("the record change fails: undone as a whole, nothing deployed", c == 6 and not deploys() and "undone as a whole" in out, out[-600:])
    c, out = run(gate=200)
    ck("a function answering the public key is caught", c == 1 and "✗ prn-week mentor_list refuses" in out and "NOT COMPLETE" in out, out[-700:])
finally:
    for w in (WT, BASEWT): subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", w])
    shutil.rmtree(TMP, ignore_errors=True)
for n, o, d in res: print(("PASS" if o else "FAIL") + " · " + n + ("" if o else "\n     " + d))
print(f"{sum(1 for r in res if r[1])}/{len(res)}")
raise SystemExit(0 if all(r[1] for r in res) else 1)
