#!/usr/bin/env python3
# Rehearsal of 521a (look only) from a FRESH copy at the commit being tested, against a FAKE Management API and a FAKE supabase
# CLI that serves a "live" tree we control. Never touches a real project. (python3 look_498a_test.py; REHEARSE_COMMIT pins a commit)
import json, os, re, subprocess, sys, tempfile, threading, http.server, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
REF = "zngsgedlsxinbygwmxwn"; COMMIT = os.environ.get("REHEARSE_COMMIT") or subprocess.run(["git", "rev-parse", "HEAD"], cwd=HERE, capture_output=True, text=True).stdout.strip()
FNS = ["ghe-reminders"]
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
S = {"flaky": {}}
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body):
        b = json.dumps(body).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.headers.get("Authorization") != "Bearer sbp_fake": return self._send(401, {})
        mm = re.match(f"/v1/projects/{REF}/functions/([\\w-]+)$", self.path)
        if not mm or mm.group(1) not in FNS: return self._send(404, {})
        if S["flaky"].get(mm.group(1), 0) > 0: S["flaky"][mm.group(1)] -= 1; return self._send(500, {})
        return self._send(200, {"version": 12, "verify_jwt": mm.group(1) == "client-journey"})
    def do_POST(self): self._send(404, {})
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
T = tempfile.mkdtemp(prefix="reh498a-"); W = os.path.join(T, "hub")
subprocess.run(["git", "worktree", "add", "-q", "--detach", W, COMMIT], cwd=HERE, check=True)
FNROOT = os.path.join(W, "supabase", "functions"); LIVE = os.path.join(T, "live"); LOG = os.path.join(T, "cli.txt"); CLI = os.path.join(T, "supabase")
open(CLI, "w").write(f"""#!/bin/sh
echo "$@" >> {LOG}
if [ "$2" = "download" ]; then mkdir -p supabase/functions/$3 supabase/functions/_shared
  cp {LIVE}/$3/index.ts supabase/functions/$3/index.ts
  for f in $(grep -o "_shared/[A-Za-z0-9_.-]*" {LIVE}/$3/index.ts | sort -u); do cp {LIVE}/$f supabase/functions/$f 2>/dev/null; done
  exit 0
fi
exit 1
"""); os.chmod(CLI, 0o755)
def fresh():
    shutil.rmtree(LIVE, ignore_errors=True); shutil.copytree(FNROOT, LIVE); S["flaky"] = {}
    if os.path.exists(LOG): os.remove(LOG)
def run():
    rep = os.path.join(T, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_API_BASE=URL, SB_SUPA_CLI=CLI, SB_FNROOT=FNROOT)
    p = subprocess.run([sys.executable, os.path.join(W, "look_521a.py")], env=env, capture_output=True, text=True, timeout=600)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
OLD = subprocess.run(["git", "log", "--format=%H", "-2", COMMIT, "--", "supabase/functions/_shared/outreach.ts"], cwd=HERE, capture_output=True, text=True).stdout.split()[1]
try:
    fresh(); code, out = run()
    ck("live = main: every function same, nothing unreleased", code == 0 and "Nothing unreleased is live" in out and out.count("same as the reviewed main, nothing else") == 1, out)
    ck("...the LIVE SHAS block is there for pinning", "LIVE SHAS" in out and json.loads(out.strip().split("\n")[-1]).get("supabase/functions/_shared/outreach.ts"), out[-400:])
    ck("...only downloads ran, nothing was deployed", "deploy" not in open(LOG).read(), open(LOG).read())
    fresh(); open(os.path.join(LIVE, "_shared", "outreach.ts"), "wb").write(subprocess.run(["git", "show", f"{OLD}:supabase/functions/_shared/outreach.ts"], cwd=HERE, capture_output=True).stdout)
    code, out = run()
    ck("an older merged outreach.ts is named as older merged code, with its date and change", "outreach.ts: an OLDER merged version, from" in out and OLD[:7] in out and "Nothing unreleased is live" in out, out)
    fresh(); open(os.path.join(LIVE, "_shared", "outreach.ts"), "a").write("\n// a hand edit nobody merged\n"); code, out = run()
    ck("a never-merged outreach.ts is flagged and 521 stays stopped", "outreach.ts: NOT any version ever merged" in out and "521 stays stopped" in out, out)
    fresh(); S["flaky"] = {"ghe-reminders": 2}; code, out = run()
    ck("a server hiccup on ghe-reminders is retried and read", "ghe-reminders (version 12" in out and "could not be read" not in out and "Nothing unreleased is live" in out, out)
    fresh(); S["flaky"] = {"ghe-reminders": 9}; code, out = run()
    ck("a server that never answers is reported with its answer, look stays stopped", "ghe-reminders: could not be read (the Management API answered 500, after 4 tries)" in out and "521 stays stopped" in out, out)
finally:
    subprocess.run(["git", "worktree", "remove", "--force", W], cwd=HERE); shutil.rmtree(T, ignore_errors=True); H.shutdown()
for n, okk, d_ in res: print(("PASS" if okk else "FAIL"), "·", n, d_)
print(f"{sum(1 for x in res if x[1])} passed, {sum(1 for x in res if not x[1])} failed")
raise SystemExit(0 if all(x[1] for x in res) else 1)
