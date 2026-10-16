#!/usr/bin/env python3
# Rehearsal of Desktop 808/808b (ok_messages_808.py) from a fresh worktree of this commit, as the Desktop step runs it, against
# a FAKE Supabase (management API + functions), a FAKE supabase CLI, and a throwaway local Postgres holding the live rules
# (ok_companion_806_fixture.py). Never touches a real project.
#   HUB=<care-coordinator-hub checkout at origin/main> python3 ok_companion_806_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil, sys
HERE = os.path.dirname(os.path.abspath(__file__)); HUBROOT = os.environ.get("HUB", os.path.join(HERE, "..", "cc-hub-live"))
sys.path.insert(0, HERE)
from ok_companion_806_fixture import make
BASE_SHA = subprocess.run(["git", "-C", HERE, "merge-base", "HEAD", "origin/main"], capture_output=True, text=True).stdout.strip()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[-1500:]))
s, sock = make(HUBROOT)
import re as _re
s.execute_simple(_re.sub(r"^notify .*$", "", open(os.path.join(HERE, "ok_companion_806.sql")).read(), flags=_re.M))   # 806 is live
as_rows = lambda q: s.run(q)
s.run("insert into job_applicants (first_name, phone, position, status) values ('Mo', '417-555-0101', 'caregiver', 'new')")
FNS = ["interview-messages", "applicant-text", "applicant-decision-msg", "applicant-noshow"]
VJ = {"applicant-text": True, "interview-messages": False, "applicant-decision-msg": True, "applicant-noshow": True}
M = {}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if "/api-keys" in self.path: return self._send(200, [{"name": "anon", "api_key": "eyJanonKEY"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
        if m := re.match(r"/v1/projects/\w+/functions/([\w-]+)$", self.path):
            if m.group(1) == "ok-from-probe" and M.get("probe_deleted"): return self._send(404, {})
            return self._send(200, {"version": 7, "verify_jwt": M.get("vj", {}).get(m.group(1), VJ.get(m.group(1), True))})
        self._send(404, {})
    def do_PATCH(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}")
        if m := re.match(r"/v1/projects/\w+/functions/([\w-]+)$", self.path): M.setdefault("vj", {})[m.group(1)] = body.get("verify_jwt")
        self._send(200, {})
    def do_DELETE(self):
        if self.path.endswith("/functions/ok-from-probe"): M["probe_deleted"] = True
        self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}")
        if self.path.startswith("/functions/v1/ok-from-probe"):
            M.setdefault("probe_calls", []).append((self.headers.get("Authorization"), body))
            return self._send(200, {"ok": True, "sent": True, "from": "+14055001758"})
        self._send(404, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t808-"); WT = os.path.join(TMP, "wt")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WT, "HEAD"], check=True)
BASE = os.path.join(TMP, "base"); os.makedirs(BASE)
subprocess.run(f"git -C {HERE} archive {BASE_SHA} supabase/functions | tar -x -C {BASE}", shell=True, check=True)
FAKEBIN = os.path.join(TMP, "bin"); os.makedirs(FAKEBIN); LOG = os.path.join(TMP, "cli.log"); os.makedirs(os.path.join(TMP, "deployed"))
open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil
a = sys.argv[1:]; open({LOG!r}, 'a').write(' '.join(a) + '\\n')
if a[:2] == ['functions', 'deploy']:
    if os.path.exists(os.path.join({TMP!r}, 'deployfail')) and a[2] == 'applicant-noshow': sys.exit(1)
    open(os.path.join({TMP!r}, 'deployed', a[2]), 'w').write('x'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    mine = os.path.exists(os.path.join({TMP!r}, 'deployed', a[2])) and not (os.path.exists(os.path.join({TMP!r}, 'deployfail')) and a[2] == 'applicant-noshow')
    src = os.path.join({WT!r} if mine else {BASE!r}, 'supabase', 'functions')
    shutil.copytree(src, os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True)
    if os.path.exists(os.path.join({TMP!r}, 'drift')) and a[2] == 'applicant-text' and not mine:
        open(os.path.join(os.getcwd(), 'supabase', 'functions', 'applicant-text', 'index.ts'), 'a').write('// someone else')
    sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
PIN = {k: sha(os.path.join(WT, p)) for k, p in {
  "_shared/office-from": "supabase/functions/_shared/office-from.ts", "_shared/applicant-words": "supabase/functions/_shared/applicant-words.ts",
  "interview-messages": "supabase/functions/interview-messages/index.ts", "applicant-text": "supabase/functions/applicant-text/index.ts",
  "applicant-decision-msg": "supabase/functions/applicant-decision-msg/index.ts", "applicant-noshow": "supabase/functions/applicant-noshow/index.ts",
  "ok_messages_808.sql": "ok_messages_808.sql", "ok_messages_808_rollback.sql": "ok_messages_808_rollback.sql"}.items()}
SAVE = tempfile.mkdtemp(prefix="save808_")
def run(mode="install", env_over=None, keep_deployed=False, drift=False, deployfail=False):
    rep = os.path.join(TMP, "r.txt")
    os.path.exists(LOG) and os.remove(LOG); os.path.exists(rep) and os.remove(rep)
    if not keep_deployed: shutil.rmtree(os.path.join(TMP, "deployed")); os.makedirs(os.path.join(TMP, "deployed"))
    for flag, on in (("drift", drift), ("deployfail", deployfail)):
        fp = os.path.join(TMP, flag); (open(fp, "w").write("x") if on else (os.path.exists(fp) and os.remove(fp)))
    env = dict(os.environ, PATH=FAKEBIN + ":/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL,
               SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_REPO=WT, SB_BASE=BASE_SHA, SB_SHAS=json.dumps(PIN), SB_SETTLE="0", SB_RETRY="0",
               SB_LOCAL_SOCK=sock, SB_SAVE=SAVE, SB_MODE=mode, SB_FN_BASE=URL)
    env.update(env_over or {})
    p = subprocess.run([sys.executable, os.path.join(WT, "ok_messages_808.py")], env=env, capture_output=True, text=True, timeout=900)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
cli = lambda: open(LOG).read() if os.path.exists(LOG) else ""
deploys = lambda: re.findall(r"functions deploy ([\w-]+)", cli())
rules = lambda: s.run("select md5(pg_get_functiondef('public.ok_applicant_hold(text,text,text,text)'::regprocedure))")[0][0]
try:
    before = rules()
    c, out = run(env_over={"SB_SHAS": json.dumps(dict(PIN, **{"_shared/office-from": "0" * 64}))})
    ck("not the reviewed build: stops before anything", c == 2 and not deploys() and "PART 2" not in out and rules() == before, out[-500:])
    c, out = run(drift=True)
    ck("a sender live with a change not from GitHub: stops, database untouched", c == 3 and not deploys() and "applicant-text" in out and rules() == before, out[-700:])
    c, out = run("proof_text", env_over={"SB_PROOF_TO": "+14175550111"})
    ck("808b before 808: refuses, nothing sent", c == 3 and "isn't in yet" in out and not M.get("probe_calls"), out[-400:])
    c, out = run()
    ck("clean run from a fresh copy: exit 0, 808 COMPLETE, nothing sent", c == 0 and "808 COMPLETE. Nothing was sent." in out, out[-2500:])
    ck("both message tests run in Part 1", re.search(r"ok_messages_808_test\.mjs: ALL \d+ CHECKS PASS", out) and re.search(r"ok_office_msgs_808_test\.mjs: \d+/\d+ passed", out), out[:1500])
    ck("only the 4 senders redeployed, each keeping its gateway setting", sorted(deploys()) == sorted(FNS)
       and all(("--no-verify-jwt" in l) == (VJ.get(l.split()[2], True) is False) for l in cli().splitlines() if l.startswith("functions deploy")), cli())
    for line in ["the Oklahoma sending number is set (ending 1758)", "both Oklahoma switches are OFF", "references and the rest stay held",
                 "a Missouri applicant is never held", "no automatic follow-ups for Oklahoma", "the public can't use the hold", "nothing made-up was left behind",
                 "the switches are exactly as before the proof", "the live copy is exactly the reviewed build"]:
        ck("proves: " + line, ("✓ " in out and line in out) and ("✗ " + line) not in out, out[-2500:])
    ck("tells her the video link is not set yet", "No Oklahoma video interview link yet" in out, out[-500:])
    o = s.run("select data from app_data where key = 'ops_settings'")[0][0]; o = json.loads(o) if isinstance(o, str) else o
    ck("after install: both switches off, number set, other settings kept", o.get("ok_applicant_office_msgs_live") is False and o.get("ok_applicant_auto_msgs_live") is False
       and o.get("ok_from_number") == "+14055001758" and o.get("applicant_msgs_v2_live") is True, o)
    ck("no names, numbers, emails or keys in the report", not re.search(r"Proof|Eightoheight|405-555|417-555|@practice|sbp_|eyJ", out), out)
    c, out = run(keep_deployed=True)
    ck("run again: recognises it is in, deploys nothing, proves again", c == 0 and not deploys() and "already 808" in out and "808 COMPLETE" in out, out[-900:])
    c, out = run("proof_text", env_over={"SB_PROOF_TO": "nope"})
    ck("808b with no usable cell number: nothing sent", c == 2 and not M.get("probe_calls"), out[-400:])
    c, out = run("proof_text", env_over={"SB_PROOF_TO": "+14175550111"})
    calls = M.get("probe_calls") or []
    ck("808b: one call with the server key and the typed number; the probe is deleted again", c == 0 and len(calls) == 1 and calls[0][0] == "Bearer eyJsvcKEY" and calls[0][1] == {"to": "+14175550111"}
       and "the one-time sender is deleted again" in out and "PROOF TEXT DONE" in out and "functions deploy ok-from-probe" in cli(), [out[-900:], calls])
    ck("808b report hides the number and the key", "0111" in out and "+14175550111" not in out and "eyJsvc" not in out, out[-600:])
    c, out = run("undo")
    ck("undo: 806's hold is back", c == 0 and "806's hold is back" in out and rules() == before, out[-700:])
    c, out = run(deployfail=True)
    ck("a sender that won't deploy: stops and says the database part is safe on its own", c == 6 and "didn't deploy" in out and "safe on its own" in out, out[-700:])
finally:
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", WT]); shutil.rmtree(TMP, ignore_errors=True)
for n, o, d in res: print(("PASS" if o else "FAIL") + " · " + n + ("" if o else "\n     " + d))
print(f"{sum(1 for r in res if r[1])}/{len(res)}")
raise SystemExit(0 if all(r[1] for r in res) else 1)
