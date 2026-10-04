#!/usr/bin/env python3
# Rehearsal of 440 against a FAKE Supabase, a fake Hub site and a fake supabase CLI. Never touches a real project.
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); REF = "zngsgedlsxinbygwmxwn"; HUBDIR = os.path.join(HERE, "..", "cc-hub-live")
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
git = lambda *a: subprocess.run(["git", *a], cwd=HERE, capture_output=True, text=True).stdout.strip()
BASE = git("merge-base", "HEAD", "origin/main")
SHAS = {"caregiver-connect": sha(os.path.join(HERE, "supabase/functions/caregiver-connect/index.ts")), "_shared/cg-connect": sha(os.path.join(HERE, "supabase/functions/_shared/cg-connect.ts"))}
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
ANONK, SVCK = "eyJanon" + REF, "eyJsvc" + REF
M = {}
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj, raw=None):
        b = raw if raw is not None else json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        for f in ("caregiver-connect-rules.js", "eligibility-rules.js"):
            if p.startswith("/hub/" + f): return self._send(200, None, raw=open(os.path.join(HUBDIR, f), "rb").read())
        if re.match(r"/v1/projects/\w+/functions/caregiver-connect$", p): return self._send(200, {"verify_jwt": True, "version": 1})
        if re.match(r"/v1/projects/\w+/api-keys", p): return self._send(200, [{"name": "anon", "api_key": ANONK}, {"name": "service_role", "api_key": SVCK}])
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); raw = self.rfile.read(n) or b"{}"; p = self.path
        if p.endswith("/database/query"):
            q = json.loads(raw)["query"]
            if "rules_approved" in q: return self._send(201, [{"n": 0 if (M.get("unapproved") and "eligibility" in q) else 1}])
            return self._send(201, [])
        if p.startswith("/fn/functions/v1/caregiver-connect"):
            if self.headers.get("Authorization") == "Bearer " + SVCK and "dry=1" in p:
                return self._send(200, {"ok": True, "dry": True, "mode": "live", "census_active": 50, "linked": 0, "moved": 0, "created": 0, "review": 0})
            return self._send(401, {"error": "not allowed"})
        self._send(404, {})
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
tmp = tempfile.mkdtemp(prefix="t440-"); LOG = os.path.join(tmp, "log"); STATE = os.path.join(tmp, "state"); CLI = os.path.join(tmp, "supabase")
open(CLI, "w").write(f"""#!/bin/sh
cmd="$2"; fn="$3"; root="{HERE}"; base="{BASE}"
if [ "$cmd" = "download" ]; then
  mkdir -p "supabase/functions/$fn" "supabase/functions/_shared"
  if grep -qx new "{STATE}" 2>/dev/null; then cp "$root/supabase/functions/$fn/index.ts" "supabase/functions/$fn/index.ts"; cp "$root"/supabase/functions/_shared/*.ts supabase/functions/_shared/
  else git -C "$root" show "$base:supabase/functions/$fn/index.ts" > "supabase/functions/$fn/index.ts"
    for f in $(git -C "$root" ls-tree --name-only "$base" supabase/functions/_shared/); do git -C "$root" show "$base:$f" > "$f"; done
    if [ "$BAD_LIVE" = "1" ]; then echo "// hand edit" >> "supabase/functions/$fn/index.ts"; fi
  fi; exit 0
fi
if [ "$cmd" = "deploy" ]; then echo "$fn" >> "{LOG}"; echo new > "{STATE}"; exit 0; fi
exit 1
""")
os.chmod(CLI, 0o755)
def run(keep=False, mode=None, **over):
    M.clear(); M.update(mode or {}); open(LOG, "w").close()
    if not keep: open(STATE, "w").close()
    rep = os.path.join(tmp, "r.txt")
    if os.path.exists(rep): os.unlink(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_SUPA_CLI=CLI, SB_API_BASE=URL, SB_REPO=HERE, SB_BASE=BASE, SB_SHAS=json.dumps(SHAS), SB_FN_BASE=URL + "/fn", SB_HUB_BASE=URL + "/hub/", SB_SETTLE="0")
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(HERE, "cg_snapshot_440.py")], env=env, capture_output=True, text=True)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), open(LOG).read().split()
rc, r, d = run(); print(r)
ck("DONE: 438's live build replaced by this one, both rules approved, tests run, counts-only look ok", rc == 0 and "RESULT: DONE" in r and d == ["caregiver-connect"] and "exactly 438's build" in r
   and "eligibility-rules.js on cc.mo-care.com is an approved version" in r and "cg_connect_test.mjs:" in r and "loads both rules files" in r and "✗" not in r, r)
ck("no email, key or token in the report", not re.search(r"eyJ|sbp_|@", r), r)
rc, r, d = run(keep=True); ck("run again: already had it, not redeployed", rc == 0 and "already this build" in r and "already had it" in r and not d, r)
rc, r, d = run(BAD_LIVE="1"); ck("a live copy that is neither 438's nor this build is NOT replaced", rc != 0 and "NOT changed" in r and not d, r)
rc, r, d = run(mode={"unapproved": True}); ck("eligibility-rules.js not approved: stops before changing anything", rc != 0 and "is not an approved version" in r and not d, r)
rc, r, d = run(SB_SHAS=json.dumps({"caregiver-connect": "0" * 64, "_shared/cg-connect": SHAS["_shared/cg-connect"]})); ck("not the reviewed build: stops", rc != 0 and "not the reviewed build" in r and not d, r)
H.shutdown(); shutil.rmtree(tmp, ignore_errors=True)
for n, ok, note in res: print(("PASS " if ok else "FAIL ") + n + ("" if ok else "\n      " + note))
print("ALL %d CHECKS PASS" % len(res) if all(x[1] for x in res) else "FAILED"); sys.exit(0 if all(x[1] for x in res) else 1)
