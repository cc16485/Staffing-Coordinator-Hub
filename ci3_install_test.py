#!/usr/bin/env python3
# Rehearsal of 436 (CI3) against a FAKE Supabase and a fake supabase CLI. Never touches a real project.
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib, glob, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); REF = "zngsgedlsxinbygwmxwn"
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
git = lambda *a: subprocess.run(["git", *a], cwd=HERE, capture_output=True, text=True).stdout.strip()
BASE = git("merge-base", "HEAD", "origin/main")
CHANGED = [x for x in git("diff", "--name-only", BASE, "HEAD", "--", "supabase/functions").split() if x.endswith(".ts")]
key = lambda rel: rel.split("supabase/functions/", 1)[1][:-3] if "/_shared/" in rel else rel.split("/")[2]
SHAS = {key(r): sha(os.path.join(HERE, r)) for r in CHANGED}
res = []; ck = lambda n, cnd, note="": res.append((n, bool(cnd), "" if cnd else str(note)[:1500]))
ANONK, SVCK = "eyJanon" + REF, "eyJsvc" + REF
S = {"deployed": set()}
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj, default=str).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        m = re.match(r"/v1/projects/\w+/functions/([\w-]+)$", p)
        if m:
            pass
            return self._send(200, {"verify_jwt": True, "version": 7})
        if re.match(r"/v1/projects/\w+/api-keys", p): return self._send(200, [{"name": "anon", "api_key": ANONK}, {"name": "service_role", "api_key": SVCK}])
        if re.match(r"/v1/projects/\w+/secrets", p): return self._send(200, [{"name": n} for n in MODE.get("secrets", ["HUB_JOB_SECRET", "GHL_TOKEN"])])
        if p.startswith("/fn/functions/v1/callin-alert"): return self._send(405, {"error": "not allowed"})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); raw = self.rfile.read(n) or b"{}"; p = self.path
        if p.endswith("/database/query"): return self._send(201, [{"open": 3, "live": ""}])
        if p.startswith("/fn/functions/v1/"): return self._send(401, {"error": "not allowed"})
        self._send(404, {})
MODE = {}
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
tmp = tempfile.mkdtemp(prefix="t436-"); LOG = os.path.join(tmp, "cli.log"); STATE = os.path.join(tmp, "deployed")
CLI = os.path.join(tmp, "supabase")
open(CLI, "w").write(f"""#!/bin/sh
cmd="$2"; fn="$3"; root="{HERE}"; base="{BASE}"
if [ "$cmd" = "download" ]; then
  mkdir -p "supabase/functions/$fn" "supabase/functions/_shared"
  if grep -qx "$fn" "{STATE}" 2>/dev/null; then
    cp "$root/supabase/functions/$fn/index.ts" "supabase/functions/$fn/index.ts"; cp "$root"/supabase/functions/_shared/*.ts supabase/functions/_shared/; rm -f supabase/functions/_shared/_*.ts
  else
    git -C "$root" show "$base:supabase/functions/$fn/index.ts" > "supabase/functions/$fn/index.ts"
    for f in $(git -C "$root" ls-tree --name-only "$base" supabase/functions/_shared/); do git -C "$root" show "$base:$f" > "$f"; done
    rm -f supabase/functions/_shared/job-auth.ts.x
    if [ "$BAD_LIVE" = "$fn" ]; then echo "// hand edit" >> "supabase/functions/$fn/index.ts"; fi
  fi
  exit 0
fi
if [ "$cmd" = "deploy" ]; then echo "$fn" >> "{LOG}"; echo "$fn" >> "{STATE}"; exit 0; fi
exit 1
""")
os.chmod(CLI, 0o755)
FAKEBIN = os.path.join(tmp, "bin"); os.makedirs(FAKEBIN)
open(os.path.join(FAKEBIN, "node"), "w").write("#!/bin/sh\necho 'PASS · fake'\necho '1/1'\n"); os.chmod(os.path.join(FAKEBIN, "node"), 0o755)
def run(keep=False, **over):
    open(LOG, "w").close()
    if not keep: open(STATE, "w").close()
    rep = os.path.join(tmp, "report.txt")
    if os.path.exists(rep): os.unlink(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_SUPA_CLI=CLI, SB_API_BASE=URL, SB_REPO=HERE, SB_BASE=BASE, SB_SHAS=json.dumps(SHAS),
               SB_FN_BASE=URL + "/fn", SB_SETTLE="0", SB_SKIP_PAGE="1", PATH=FAKEBIN + ":" + os.environ.get("PATH", ""))
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(HERE, "ci3_install.py")], env=env, capture_output=True, text=True)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), open(LOG).read().split()
ck("the changed files are the CI3 ones", sorted(SHAS) == ["_shared/callin-notify", "_shared/callin-reminder", "coverage-run"], SHAS)
rc, r, d = run(); print(r)
ck("DONE: coverage-run and the three functions that share the helper updated; nothing created", rc == 0 and "RESULT: DONE" in r and sorted(d) == ["callin-alert", "coverage-assign", "coverage-reply", "coverage-run"] and "created" not in r, r)
ck("every proof line passed, and the switch is reported OFF", "✗" not in r and "call-in reminders are OFF (practice)" in r and "coverage-run refuses the public key (401)" in r, r)
rc, r, d = run(keep=True); ck("run again: all already had it", rc == 0 and r.count("already had it") == 4 and not d, r)
rc, r, d = run(BAD_LIVE="coverage-run"); ck("a hand-edited live coverage-run is not replaced", "coverage-run: its live code is not today's GitHub main" in r and "coverage-run" not in d, r)
H.shutdown()
for n, ok, note in res: print(("PASS " if ok else "FAIL ") + n + ("" if ok else "\n      " + note))
print("ALL %d CHECKS PASS" % len(res) if all(x[1] for x in res) else "FAILED")
