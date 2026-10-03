#!/usr/bin/env python3
# Rehearsal of 433b (the rerun after #175) against a FAKE Supabase (management API + the three functions) and a FAKE supabase CLI. Never
# touches a real project. Run from the branch with the 433 commit:  python3 call_bridge_433_install_test.py
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib
HERE = os.path.dirname(os.path.abspath(__file__))
REF = "zngsgedlsxinbygwmxwn"
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
git = lambda *a: subprocess.run(["git", *a], cwd=HERE, capture_output=True, text=True).stdout.strip()
BASE = "6180b9e5e6c44cb522ffbc48933520ab491512f5"   # what 433 put live
CHANGED = [x for x in git("diff", "--name-only", BASE, "HEAD", "--", "supabase/functions").split() if x.endswith(".ts")]
key = lambda rel: rel.split("supabase/functions/", 1)[1][:-3] if "/_shared/" in rel else rel.split("/")[2]
SHAS = {key(r): sha(os.path.join(HERE, r)) for r in CHANGED}
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
S = {}; MODE = {}
def reset(): S.clear(); S.update(sql=[], fncalls=[], keyq=[], patches=[])
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if m := re.match(r"/v1/projects/(\w+)/functions/([\w-]+)$", p):
            fn = m.group(2)
            return self._send(200, {"verify_jwt": MODE.get("vj", {}).get(fn, True), "version": 7})
        if m := re.match(r"/v1/projects/(\w+)/api-keys(\?reveal=true)?$", p):
            S["keyq"].append(p); return self._send(200, [{"name": "anon", "api_key": "eyJanon" + m.group(1)}, {"name": "service_role", "api_key": "eyJsvc" + m.group(1)}])
        if re.match(r"/v1/projects/(\w+)/secrets$", p):
            if MODE.get("no_loc"): return self._send(200, [{"name": "GHL_TOKEN", "value": "abc"}])
            return self._send(200, [{"name": "GHL_TOKEN", "value": "abc"}, {"name": "GHL_LOCATION_ID", "value": MODE.get("loc", hashlib.sha256(b"Recp0AhyMh8lrtKJ9kaj").hexdigest())}, {"name": "HUB_JOB_SECRET", "value": "x"}])
        self._send(404, {})
    def do_PATCH(self):
        S["patches"].append(self.path); self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); raw = self.rfile.read(n) or b"{}"; p = self.path
        if p.startswith("/fn/functions/v1/"):
            body = json.loads(raw); auth = self.headers.get("Authorization", "")
            S["fncalls"].append((p, auth, body))
            if p.endswith("/ghl-call-link") and auth == "Bearer eyJsvc" + REF:
                if body.get("action") == "setup": return self._send(200, MODE.get("setup", {"ok": True, "configured": True, "workflow": "missing", "users_api": "ok", "users_count": 5, "staff_linked": 3, "staff_total": 4}))
                return self._send(403, {"error": "A call only starts from a person tapping Call in the Hub."})
            return self._send(401, {"error": "not allowed"})
        if re.match(r"/v1/projects/(\w+)/database/query", p): S["sql"].append(json.loads(raw)["query"]); return self._send(400, {"message": "unexpected"})
        self._send(404, {})
tmp = tempfile.mkdtemp(prefix="t433-"); LOG = os.path.join(tmp, "cli.log"); STATE = os.path.join(tmp, "deployed")
open(STATE, "w").close()
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
CLI = os.path.join(tmp, "supabase")
open(CLI, "w").write(f"""#!/bin/sh
# fake CLI: download gives the reviewed starting point's copy until a deploy, then the local build.
# BAD_LIVE=<fn>: that function's live code is unknown.
cmd="$2"; fn="$3"; root="{HERE}"; base="{BASE}"
if [ "$cmd" = "download" ]; then
  if grep -qx "$fn" "{STATE}" 2>/dev/null; then
    mkdir -p "supabase/functions/$fn" "supabase/functions/_shared"
    cp "$root/supabase/functions/$fn/index.ts" "supabase/functions/$fn/index.ts"; cp "$root"/supabase/functions/_shared/*.ts supabase/functions/_shared/
    rm -f supabase/functions/_shared/_*.ts
  else
    mkdir -p "supabase/functions/$fn" "supabase/functions/_shared"
    git -C "$root" show "$base:supabase/functions/$fn/index.ts" > "supabase/functions/$fn/index.ts"
    for f in $(git -C "$root" ls-tree --name-only "$base" supabase/functions/_shared/); do git -C "$root" show "$base:$f" > "$f"; done
    # the real live download holds only the files the function imports: at 6180b9e ghl-call-link did not import job-auth.ts
    if [ -n "$DROP_SHARED" ]; then rm -f "supabase/functions/_shared/$DROP_SHARED"; fi
    if [ -n "$ODD_SHARED" ]; then echo "// changed" >> "supabase/functions/_shared/$ODD_SHARED"; fi
    if [ "$BAD_LIVE" = "$fn" ]; then echo "// hand edit" >> "supabase/functions/$fn/index.ts"; fi
  fi
  exit 0
fi
if [ "$cmd" = "deploy" ]; then echo "$fn $*" >> "{LOG}"; echo "$fn" >> "{STATE}"; exit 0; fi
exit 1
""")
os.chmod(CLI, 0o755)
FAKEBIN = os.path.join(tmp, "bin"); os.makedirs(FAKEBIN)
open(os.path.join(FAKEBIN, "node"), "w").write("#!/bin/sh\necho 'PASS · fake'\necho '1/1'\n"); os.chmod(os.path.join(FAKEBIN, "node"), 0o755)


def run(**over):
    reset(); open(LOG, "w").close(); open(STATE, "w").close(); rep = os.path.join(tmp, "report.txt")
    if os.path.exists(rep): os.unlink(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_SUPA_CLI=CLI, SB_API_BASE=URL, SB_REPO=HERE, SB_BASE=BASE,
               SB_SHAS=json.dumps(SHAS), SB_FN_BASE=URL + "/fn", PATH=FAKEBIN + ":" + os.environ.get("PATH", ""))
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(HERE, "call_bridge_433.py")], env=env, capture_output=True, text=True)
    deps = [l.split()[0] for l in open(LOG).read().splitlines()]
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), deps
ck("the rerun's changed files are only ghl-call-link", CHANGED == ["supabase/functions/ghl-call-link/index.ts"], CHANGED)
rc, r, d = run(DROP_SHARED="job-auth.ts")
ck("433b: the live copy lacks job-auth.ts (newly imported, unchanged GitHub code): ghl-call-link IS updated, nothing else", d == ["ghl-call-link"] and "ghl-call-link deployed" in r and "differs from GitHub" not in r, r)
ck("433b: the proofs pass, including the server key refused a call (403) and the GoHighLevel setup check answering", "✗" not in r and "refuses a bridge from the server key" in r and "workflow" in r.lower(), r)
rc, r, d = run(DROP_SHARED="job-auth.ts", ODD_SHARED="staff-auth.ts")
ck("a shared file that IS live but different still stops it, nothing deployed", d == [] and "live shared code differs from GitHub (_shared/staff-auth.ts)" in r, r)
rc, r, d = run(DROP_SHARED="job-auth.ts", BAD_LIVE="ghl-call-link")
ck("a hand-edited live ghl-call-link still stops it, nothing deployed", d == [] and "NOT changed" in r, r)
srv.shutdown()
for n, ok, note in res: print(("PASS " if ok else "FAIL ") + " " + n + ("" if ok else "\n      " + note))
print("ALL %d CHECKS PASS" % len(res) if all(x[1] for x in res) else "FAILED")
