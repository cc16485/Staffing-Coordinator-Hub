#!/usr/bin/env python3
# Rehearsal of 740 (call_to_lead_740.py) against a FAKE Supabase (management API, functions) and a FAKE supabase CLI, from a
# fresh worktree of this commit (as the Desktop step runs it). Never touches a real project.  python3 call_to_lead_740_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
BASE_SHA = "d0e18801a90fd012b34b7b14c5594912bb6f0b82"   # origin/main before 740
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
S = {}; M = {}
def reset(**m):
    S.clear(); S.update(sql=[], posts=[]); M.clear()
    M.update(dict(marks=0, secrets=["GHL_TOKEN", "GHL_LOCATION_ID", "ANTHROPIC_API_KEY", "HUB_JOB_SECRET"], gate=401, ai_leads=0, vj={"call-pull": True, "call-followup": False}), **m)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if "/api-keys" in p: return self._send(200, [{"name": "anon", "api_key": "eyJanonKEY"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
        if p.endswith("/secrets"): return self._send(200, [{"name": n} for n in M["secrets"]])
        if m := re.match(r"/v1/projects/\w+/functions/([\w-]+)$", p):
            fn = m.group(1)
            if fn == "call-to-lead" and not os.path.exists(os.path.join(TMP, "deployed", fn)) and not os.path.exists(os.path.join(TMP, "already")): return self._send(404, {})
            return self._send(200, {"version": 9, "verify_jwt": True if fn == "call-to-lead" else M["vj"].get(fn, True)})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/functions/v1/"):
            S["posts"].append((p, self.headers.get("Authorization"), body))
            if p.startswith("/functions/v1/call-to-lead"): return self._send(M["gate"], {"error": "Sign in first."})
            if p.startswith("/functions/v1/call-followup"): return self._send(401, {"error": "unauthorized"})
            return self._send(404, {})
        q = body["query"]; S["sql"].append(q)
        if "count(*)::int as n from app_data where key = 'call_lead_marks'" in q: return self._send(200, [{"n": M["marks"]}])
        if q.startswith("insert into public.app_data"): M["marks"] = 1; return self._send(200, [])
        if "jsonb_typeof(data) as t from app_data where key = 'call_lead_marks'" in q: return self._send(200, [{"t": "array"}] if M["marks"] else [])
        if "e->>'source' = 'Inbound Call'" in q: return self._send(200, [{"n": M["ai_leads"]}])
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t740-")
WT = os.path.join(TMP, "wt")   # a fresh copy of this commit, as the Desktop step makes one
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WT, "HEAD"], check=True)
BASE = os.path.join(TMP, "base"); os.makedirs(BASE)
subprocess.run(f"git -C {HERE} archive {BASE_SHA} supabase/functions | tar -x -C {BASE}", shell=True, check=True)
FAKEBIN = os.path.join(TMP, "bin"); os.makedirs(FAKEBIN); LOG = os.path.join(TMP, "cli.log"); os.makedirs(os.path.join(TMP, "deployed"))
open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil
a = sys.argv[1:]; open({LOG!r}, 'a').write(' '.join(a) + '\\n')
if a[:2] == ['functions', 'deploy']: open(os.path.join({TMP!r}, 'deployed', a[2]), 'w').write('x'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    src = os.path.join({WT!r}, 'supabase', 'functions') if os.path.exists(os.path.join({TMP!r}, 'deployed', a[2])) or os.path.exists(os.path.join({TMP!r}, 'already')) else os.path.join({BASE!r}, 'supabase', 'functions')
    shutil.copytree(src, os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True)
    if os.path.exists(os.path.join({TMP!r}, 'drift')) and a[2] == 'call-pull' and not os.path.exists(os.path.join({TMP!r}, 'deployed', a[2])):
        open(os.path.join(os.getcwd(), 'supabase', 'functions', 'call-pull', 'index.ts'), 'a').write('// someone else')
    sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
PIN = {k: sha(os.path.join(WT, "supabase/functions", f)) for k, f in [("call-to-lead", "call-to-lead/index.ts"), ("_shared/call-lead", "_shared/call-lead.ts"),
       ("call-pull", "call-pull/index.ts"), ("call-followup", "call-followup/index.ts")]}
def run(env_over=None, drift=False, already=False, **mode):
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    os.path.exists(LOG) and os.remove(LOG); os.path.exists(rep) and os.remove(rep)
    shutil.rmtree(os.path.join(TMP, "deployed")); os.makedirs(os.path.join(TMP, "deployed"))
    for flag, on in (("drift", drift), ("already", already)):
        fp = os.path.join(TMP, flag); (open(fp, "w").write("x") if on else (os.path.exists(fp) and os.remove(fp)))
    env = dict(os.environ, PATH=FAKEBIN + ":/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL,
               SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_REPO=WT, SB_BASE=BASE_SHA, SB_SHAS=json.dumps(PIN), SB_SETTLE="0")
    env.update(env_over or {})
    p = subprocess.run(["python3", os.path.join(WT, "call_to_lead_740.py")], env=env, capture_output=True, text=True, timeout=600)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
cli = lambda: open(LOG).read() if os.path.exists(LOG) else ""
deploys = lambda: re.findall(r"functions deploy ([\w-]+)", cli())
try:
    c, out = run()
    ck("clean run from a fresh copy: exit 0, RESULT: DONE", c == 0 and "RESULT: DONE" in out, out[-1800:])
    ck("the tests run in Part 1 (from the fresh copy)", "call_to_lead_test.mjs: 21/21 passed" in out and "call_followup_guard_test.mjs" in out, out[:1500])
    ck("deploys the three functions; call-to-lead and call-pull keep the gateway check, call-followup keeps it off", sorted(deploys()) == ["call-followup", "call-pull", "call-to-lead"]
       and "functions deploy call-to-lead --project-ref zngsgedlsxinbygwmxwn --use-api\n" in cli() and "functions deploy call-pull --project-ref zngsgedlsxinbygwmxwn --use-api\n" in cli()
       and "functions deploy call-followup --project-ref zngsgedlsxinbygwmxwn --use-api --no-verify-jwt" in cli(), cli())
    ck("the Not a lead list is made", any(q.startswith("insert into public.app_data") and "call_lead_marks" in q for q in S["sql"]), S["sql"])
    ck("proof: call-to-lead refuses no sign-in and the public key", "refuses a page that is not signed in (401)" in out and "refuses the public key (401)" in out, out[-900:])
    ck("no key or token in the report", not re.search(r"eyJ\w|sbp_\w", out), out)
    c, out = run(already=True, marks=1)
    ck("run again after it is live: nothing deployed again, still DONE", c == 0 and not deploys() and "already this build" in out and "RESULT: DONE" in out, out[-900:])
    c, out = run(drift=True)
    ck("call-pull live with a change not from GitHub: STOPS before any change", c == 3 and not deploys() and not any(q.startswith("insert") for q in S["sql"]), out[-600:])
    c, out = run(secrets=["GHL_TOKEN", "GHL_LOCATION_ID"])
    ck("the AI key missing on the server: STOPS, nothing changed", c == 3 and "ANTHROPIC_API_KEY" in out and not deploys(), out[-400:])
    c, out = run(env_over={"SB_SHAS": json.dumps(dict(PIN, **{"call-to-lead": "0" * 64}))})
    ck("not the reviewed build: nothing runs", c == 2 and not deploys(), out[-400:])
    c, out = run(gate=200)
    ck("call-to-lead answering without a sign-in is caught", c == 8 and "PARTLY DONE" in out, out[-600:])
finally:
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", WT]); shutil.rmtree(TMP, ignore_errors=True)
for n, o, d in res: print(("PASS" if o else "FAIL") + " · " + n + ("" if o else "\n     " + d))
print(f"{sum(1 for r in res if r[1])}/{len(res)}")
raise SystemExit(0 if all(r[1] for r in res) else 1)
