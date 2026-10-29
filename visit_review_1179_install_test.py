#!/usr/bin/env python3
# Rehearsal of 1179 (visit_review_1179.py) against a FAKE Supabase management API, a fake supabase tool and a fake function
# address. Never touches a real project.   python3 visit_review_1179_install_test.py
import json, os, subprocess, tempfile, threading, http.server, hashlib
HERE = os.path.dirname(os.path.abspath(__file__))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
S = {}
def reset(**m): S.clear(); S.update(dict(sql=[], cols=3, secret=True, fn_exists=False, deployed=False, public=401, cors=200, verify=True, posts=[]), **m)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if "/api-keys" in p: return self._send(200, [{"name": "anon", "api_key": "eyJfake.anon.key"}])
        if p.endswith("/secrets"): return self._send(200, [{"name": "ANTHROPIC_API_KEY"}] if S["secret"] else [{"name": "OTHER"}])
        if "/functions/visit-review" in p:
            dep = os.path.exists(STATE) and "visit-review" in open(STATE).read()
            if not (S["fn_exists"] or dep): return self._send(404, {})
            return self._send(200, {"version": 3 if dep else 2, "verify_jwt": S["verify"]})
        return self._send(404, {})
    def do_PATCH(self): S["verify"] = True; return self._send(200, {})
    def do_OPTIONS(self): self.send_response(S["cors"]); self.end_headers()
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); raw = self.rfile.read(n) or b"{}"
        if self.path.startswith("/fn/"): S["posts"].append(self.path); return self._send(S["public"], {"error": "Sign in first."})
        q = json.loads(raw)["query"]; S["sql"].append(q)
        if "information_schema.columns" in q: return self._send(200, [{"cols": S["cols"]}])
        if "from public.recordings where kind='assessment'" in q: return self._send(200, [{"n": 7, "done": 6}])
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
tmp = tempfile.mkdtemp(prefix="t1179-"); LOG = os.path.join(tmp, "cli.log"); STATE = os.path.join(tmp, "deployed")
CLI = os.path.join(tmp, "supabase")
open(CLI, "w").write(f"""#!/bin/sh
# fake tool: download gives the local build once deployed (BAD_DEPLOY=1: a hand-edited copy); deploy records it.
cmd="$2"; fn="$3"; root="{HERE}"
if [ "$cmd" = "download" ]; then
  [ -s "{STATE}" ] || exit 1
  mkdir -p "supabase/functions/$fn" "supabase/functions/_shared"
  cp "$root/supabase/functions/$fn/index.ts" "supabase/functions/$fn/index.ts"
  for f in staff-auth.ts visit-review.ts; do cp "$root/supabase/functions/_shared/$f" "supabase/functions/_shared/$f"; done
  if [ "$BAD_DEPLOY" = "1" ]; then echo "// hand edit" >> "supabase/functions/$fn/index.ts"; fi
  exit 0
fi
if [ "$cmd" = "deploy" ]; then echo "$fn $*" >> "{LOG}"; echo "$fn" >> "{STATE}"; exit 0; fi
exit 1
""")
os.chmod(CLI, 0o755)
SHAS = {"visit-review/index.ts": sha(os.path.join(HERE, "supabase/functions/visit-review/index.ts")),
        "_shared/visit-review.ts": sha(os.path.join(HERE, "supabase/functions/_shared/visit-review.ts"))}
def run(shas=None, env_extra=None, **mode):
    reset(**mode); open(LOG, "w").close(); open(STATE, "w").close(); rep = os.path.join(tmp, "r.txt"); os.path.exists(rep) and os.remove(rep)
    env = dict(os.environ, SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_SUPA_CLI=CLI, SB_FNROOT=os.path.join(HERE, "supabase/functions"),
               SB_FN_SHAS=json.dumps(shas or SHAS), SB_FN_BASE=URL + "/fn", SB_SETTLE="0", PYTHONPATH=HERE, **(env_extra or {}))
    p = subprocess.run(["python3", os.path.join(HERE, "visit_review_1179.py")], env=env, capture_output=True, text=True, timeout=180)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
deployed = lambda: "visit-review" in open(LOG).read()

code, out = run()
ck("fresh: exit 0, DONE, visit-review deployed with the sign-in check on", code == 0 and "RESULT: DONE" in out and deployed() and "gateway sign-in check on" in out and "--no-verify-jwt" not in open(LOG).read(), out)
ck("checks first: the reviewed build, the reader's key, the 1177 columns, a count of home visit parts", all(s in out for s in ["visit-review/index.ts is the reviewed build", "ANTHROPIC_API_KEY", "part columns (from 1177)", "7 parts, 6 written out"]), out)
ck("proof: the live copy is this build, the public key is refused, the Hub can reach it", all(s in out for s in ["the live copy is exactly this build", "refuses anyone not signed in", "the Hub can reach it"]), out)
ck("no database change at all (only reads)", all(q.lstrip().lower().startswith("select") for q in S["sql"]), S["sql"])
ck("prints no key or secret", "eyJfake" not in out and "sbp_test" not in out, out)
code, out = run(fn_exists=True)
ck("run again: it was already there, still DONE (safe to re-run)", code == 0 and "visit-review is live at version 2" in out and "RESULT: DONE" in out, out)
code, out = run(shas={"visit-review/index.ts": "0" * 64})
ck("not the reviewed build: stops before changing anything", code == 2 and not deployed() and "not the reviewed build" in out, out)
code, out = run(cols=0)
ck("1177 not run yet: stops before changing anything and says run 1177 first", code == 3 and not deployed() and "run 1177 first" in out, out)
code, out = run(secret=False)
ck("the reader's key is missing: stops before changing anything", code == 3 and not deployed() and "ANTHROPIC_API_KEY is not set" in out, out)
code, out = run(env_extra={"BAD_DEPLOY": "1"})
ck("the live copy does not match after deploying: says so, not DONE", code == 6 and "did not deploy cleanly" in out and "RESULT: DONE" not in out, out)
code, out = run(public=200)
ck("it answers the public key: a ✗ line, not DONE", code == 9 and "answered the public key" in out, out)
code, out = run(cors=500)
ck("the Hub cannot reach it: a ✗ line, not DONE", code == 9 and "the Hub cannot reach it" in out, out)
srv.shutdown()
for n, c, note in res: print(("PASS" if c else "FAIL") + " · " + n + ("" if c else "\n     " + note))
print(sum(c for _, c, _ in res), "/", len(res)); raise SystemExit(0 if all(c for _, c, _ in res) else 1)
