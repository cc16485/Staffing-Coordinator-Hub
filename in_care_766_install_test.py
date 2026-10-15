#!/usr/bin/env python3
# Rehearsal of 766 (in_care_766.py) against a FAKE Supabase (management API, database, functions) and a FAKE supabase CLI,
# from a fresh worktree of this commit (as the Desktop step runs it). Never touches a real project.
#   python3 in_care_766_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
BASE_SHA = os.environ.get("BASE_766", "dffeab9")   # origin/main before 766
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
S = {}; M = {}
J = [("11111111-1111-1111-1111-111111111111", "Dan Probstfield", "297"), ("22222222-2222-2222-2222-222222222222", "Edward Anderson", "296"),
     ("33333333-3333-3333-3333-333333333333", "Peggy Thomason", "295")]
def reset(**m):
    S.clear(); S.update(sql=[], posts=[]); M.clear(); M.update(dict(sweep=200, gate=401, swept=False, in_care=["297", "296", "295"]), **m)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if "/api-keys" in p: return self._send(200, [{"name": "anon", "api_key": "eyJanonKEY"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
        if re.match(r"/v1/projects/\w+/functions/([\w-]+)$", p): return self._send(200, {"version": 28, "verify_jwt": True})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); b = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/functions/v1/"):
            auth = self.headers.get("Authorization", ""); S["posts"].append((p, auth))
            if "svcKEY" not in auth: return self._send(M["gate"] if M["gate"] != 401 else 403, {"error": "not allowed"})
            if M["sweep"] != 200: return self._send(M["sweep"], {"error": "boom"})
            M["swept"] = True; return self._send(200, {"ok": True, "journeys": 7, "in_care": len(M["in_care"]), "in_care_unknown": 0})
        q = b["query"]; S["sql"].append(q)
        if "person_role r" in q: return self._send(200, [{"journey_id": a, "client_name": nm, "axiscare_client_id": ax, "status": "open", "created_at": "2026-10-07"} for a, nm, ax in J])
        if "from public.client_journey where journey_id in" in q:
            return self._send(200, [{"journey_id": a, "client_name": nm, "axiscare_client_id": ax, "status": "active" if M["swept"] and ax in M["in_care"] else "open"} for a, nm, ax in J])
        if "already_in_care" in q: return self._send(200, [{"journey_id": a, "reason": "Already receiving care in AxisCare (a shift on 2026-10-13) while the journey was still at Intake"} for a, nm, ax in J if M["swept"] and ax in M["in_care"]])
        if "key = 'ops_items'" in q: return self._send(200, [{"data": [{"id": "c" + ax, "journey_id": a, "status": "done" if M["swept"] and ax in M["in_care"] else "open"} for a, nm, ax in J]}])
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t766-")
WT = os.path.join(TMP, "wt")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WT, "HEAD"], check=True)
BASE = os.path.join(TMP, "base"); os.makedirs(BASE)
subprocess.run(f"git -C {HERE} archive {BASE_SHA} supabase/functions | tar -x -C {BASE}", shell=True, check=True)
FAKEBIN = os.path.join(TMP, "bin"); os.makedirs(FAKEBIN); LOG = os.path.join(TMP, "cli.log"); os.makedirs(os.path.join(TMP, "deployed"))
open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil
a = sys.argv[1:]; open({LOG!r}, 'a').write(' '.join(a) + '\\n')
if a[:2] == ['functions', 'deploy']:
    if os.path.exists(os.path.join({TMP!r}, 'nodeploy')): sys.exit(1)
    open(os.path.join({TMP!r}, 'deployed', a[2]), 'w').write('x'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    mine = os.path.exists(os.path.join({TMP!r}, 'deployed', a[2])) or os.path.exists(os.path.join({TMP!r}, 'already'))
    shutil.copytree(os.path.join({WT!r} if mine else {BASE!r}, 'supabase', 'functions'), os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True)
    if not mine and os.path.exists(os.path.join({TMP!r}, 'drift')):
        open(os.path.join(os.getcwd(), 'supabase', 'functions', 'client-journey', 'index.ts'), 'a').write('// someone else')
    sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
PIN = sha(os.path.join(WT, "supabase/functions/client-journey/index.ts"))
def run(pin=None, **mode):
    flags = {k: mode.pop(k, False) for k in ("drift", "already", "nodeploy")}
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    os.path.exists(LOG) and os.remove(LOG); os.path.exists(rep) and os.remove(rep)
    shutil.rmtree(os.path.join(TMP, "deployed")); os.makedirs(os.path.join(TMP, "deployed"))
    for flag, on in flags.items():
        fp = os.path.join(TMP, flag); (open(fp, "w").write("x") if on else (os.path.exists(fp) and os.remove(fp)))
    env = dict(os.environ, SB_TOKEN="sbp_" + "a" * 40, SB_REPORT=rep, SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_REPO=WT, SB_BASE=BASE_SHA,
               SB_FN_SHA=pin or PIN, SB_API_BASE=URL, SB_FN_BASE=URL)
    p = subprocess.run(["python3", os.path.join(WT, "in_care_766.py")], env=env, capture_output=True, text=True, timeout=600)
    txt = open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr
    cli = open(LOG).read() if os.path.exists(LOG) else ""
    return p.returncode, txt, cli
try:
    rc, txt, cli = run()
    ck("clean run: exit 0, RESULT: DONE", rc == 0 and "RESULT: DONE" in txt, txt)
    ck("...the tests ran from the fresh copy", "client_journey_test.mjs: " in txt and "care_test.mjs: " in txt, txt)
    ck("...lists the open journeys of active clients before changing anything", "open journeys whose AxisCare client is active: 3 (Dan Probstfield #297, Edward Anderson #296, Peggy Thomason #295)" in txt, txt)
    ck("...deploys client-journey only, keeping the gateway check on", cli.count("functions deploy") == 1 and "functions deploy client-journey" in cli and "--no-verify-jwt" not in cli, cli)
    ck("...runs the sweep once with the server key", sum(1 for p, a in S["posts"] if "svcKEY" in a) == 1, S["posts"])
    ck("...each of the three: receiving care, no open card, with the reason", all(f"{n} #{ax}: receiving care, 0 open card(s). Already receiving care" in txt for _, n, ax in J), txt)
    ck("...the public key is still refused", "still refuses the sweep from a public key (403)" in txt, txt)
    ck("...every database query is a read", S["sql"] and all(re.match(r"^\s*(select|with)\b", q, re.I) for q in S["sql"]), S["sql"])
    ck("...no key in the report", "svcKEY" not in txt and "anonKEY" not in txt and "sbp_" not in txt, txt)
    rc, txt, cli = run(in_care=["297", "296"])
    ck("one with no recent shift: said plainly, not a failure", rc == 0 and "Peggy Thomason #295: left as it was (open)" in txt and "RESULT: DONE" in txt, txt)
    rc, txt, cli = run(already=True)
    ck("already deployed: nothing deployed, proof still runs", rc == 0 and "functions deploy" not in cli and "already deployed" in txt and "RESULT: DONE" in txt, [txt, cli])
    rc, txt, cli = run(drift=True)
    ck("live client-journey is someone else's: STOP before any change", rc == 2 and "not what 766 expects (other)" in txt and "functions deploy" not in cli and not S["posts"], [txt, cli])
    rc, txt, cli = run(pin="0" * 64)
    ck("not the reviewed build: STOP, nothing run", rc == 2 and "not the reviewed build" in txt and not cli and not S["sql"], [txt, cli])
    rc, txt, cli = run(nodeploy=True)
    ck("deploy fails: says the old one is still live, no sweep", rc == 1 and "didn't deploy" in txt and "old client-journey is still live" in txt and not S["posts"], txt)
    rc, txt, cli = run(sweep=500)
    ck("the sweep fails: reported as a problem", rc == 1 and "the sweep did not run: HTTP 500" in txt and "FINISHED WITH PROBLEMS" in txt, txt)
finally:
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", WT]); shutil.rmtree(TMP, ignore_errors=True); srv.shutdown()
ok = sum(1 for _, c, _ in res if c)
for n, c, note in res: print(("  ✓ " if c else "  ✗ ") + n + ("" if c else "\n      " + note))
print(f"{ok}/{len(res)} passed"); raise SystemExit(0 if ok == len(res) else 1)
