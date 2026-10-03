#!/usr/bin/env python3
# Rehearsal of 433 against a FAKE Supabase (management API + the three functions) and a FAKE supabase CLI. Never
# touches a real project. Run from the branch with the 433 commit:  python3 call_bridge_433_install_test.py
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib
HERE = os.path.dirname(os.path.abspath(__file__))
REF = "zngsgedlsxinbygwmxwn"
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
git = lambda *a: subprocess.run(["git", *a], cwd=HERE, capture_output=True, text=True).stdout.strip()
BASE = git("merge-base", "HEAD", "origin/main")
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

def run(real_node=False, **over):
    reset(); open(LOG, "w").close(); open(STATE, "w").close(); rep = os.path.join(tmp, "report.txt")
    if os.path.exists(rep): os.unlink(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_SUPA_CLI=CLI, SB_API_BASE=URL, SB_REPO=HERE, SB_BASE=BASE,
               SB_SHAS=json.dumps(SHAS), SB_FN_BASE=URL + "/fn")
    if not real_node: env["PATH"] = FAKEBIN + ":" + env.get("PATH", "")
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(HERE, "call_bridge_433.py")], env=env, capture_output=True, text=True)
    deps = [l.split()[0] for l in open(LOG).read().splitlines()]
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), deps, open(LOG).read().splitlines()

ck("the reviewed files are the four 433 files", set(SHAS) == {"_shared/ghl-call-bridge", "ghl-call-link", "clockin-alert", "late-alert"}, SHAS)
code, rep, dep, L = run(real_node=True)
open(os.environ.get("REHEARSAL_OUT", "/dev/null"), "w").write(rep)
ck("rehearsal: DONE, exit 0", code == 0 and "RESULT: DONE" in rep, rep[-2500:])
ck("the 9 test files ran for real and passed inside the installer", rep.count("(run here, against fakes; nothing sent)") == 9, rep[:3000])
ck("exactly the three functions are deployed: ghl-call-link, clockin-alert, late-alert", dep == ["ghl-call-link", "clockin-alert", "late-alert"], dep)
ck("every deploy keeps the gateway sign-in check on (no --no-verify-jwt)", all("--no-verify-jwt" not in l for l in L), L)
ck("NO SQL at all (no database change)", not S["sql"], S["sql"])
calls = S["fncalls"]
names = [c[0].split("/")[-1] for c in calls]
ck("proof calls: ghl-call-link bridge with the public key, a made-up sign-in and the server key; clockin-alert and late-alert bridge with no link and a made-up link; then setup",
   names == ["ghl-call-link"] * 3 + ["clockin-alert"] * 2 + ["late-alert"] * 2 + ["ghl-call-link"]
   and calls[0][1].startswith("Bearer eyJanon") and calls[1][1] == "Bearer not-a-real-sign-in" and calls[2][1] == "Bearer eyJsvc" + REF
   and all(c[2].get("action") == "bridge" for c in calls[:7]) and calls[7][2] == {"action": "setup"}, [(n, c[1][:20], c[2]) for n, c in zip(names, calls)])
ck("the only call that is not refused is the setup check (GET only on GoHighLevel's side)", "is refused" in rep and "nothing automatic can start a call (403)" in rep, rep[-2500:])
ck("proof: every live copy is exactly the reviewed build", rep.count(": the live copy is exactly the reviewed build") == 3 and "✗" not in rep, rep[-1500:])
ck("the setup check is reported: workflow missing, users can be listed, 3 of 4 linked", "NO workflow named \"Hub call bridge\"" in rep and "token CAN list users (5 users)" in rep and "3 of 4 office staff" in rep, rep[-1500:])
ck("workflow missing: the result says to finish the GoHighLevel setup BEFORE merging the Hub branch", "BEFORE merging the Hub branch, finish the GoHighLevel setup" in rep, rep[-900:])
ck("the report hides keys and says nothing was sent or called", not re.search(r"eyJ\w|sbp_\w", rep) and "Nothing was texted, emailed or called by this installer" in rep, rep[-600:])
MODE["setup"] = {"ok": True, "configured": True, "workflow": "published", "users_api": "no_scope", "users_count": 0, "staff_linked": 0, "staff_total": 4}
code, rep, dep, L = run(); MODE.clear()
ck("workflow published but the token can't list users: says link by hand, still not 'ready' (nobody linked)", code == 0 and "is published" in rep and "can NOT list users" in rep and "0 of 4" in rep and "BEFORE merging" in rep, rep[-1200:])
MODE["setup"] = {"ok": True, "configured": True, "workflow": "published", "users_api": "ok", "users_count": 5, "staff_linked": 4, "staff_total": 4}
code, rep, dep, L = run(); MODE.clear()
ck("all set: 'GoHighLevel looks ready', then merge the Hub branch", code == 0 and "GoHighLevel looks ready" in rep and "merge the Hub branch ghl-call-bridge" in rep, rep[-900:])

code, rep, dep, L = run(BAD_LIVE="late-alert")
ck("a live copy that is not today's GitHub main: that one NOT deployed and named, the rest go, PARTLY DONE",
   code == 1 and "late-alert" not in dep and dep == ["ghl-call-link", "clockin-alert"] and "late-alert: its live code is not today's GitHub main" in rep and "PARTLY DONE" in rep, [code, dep, rep[-800:]])
MODE["vj"] = {"clockin-alert": False}; code, rep, dep, L = run(); MODE.clear()
ck("a function whose gateway check is off keeps it off (deployed with --no-verify-jwt)", code == 0 and any(l.startswith("clockin-alert") and "--no-verify-jwt" in l for l in L) and not any(l.startswith("late-alert") and "--no-verify-jwt" in l for l in L), L)
MODE["no_loc"] = True; code, rep, dep, L = run(); MODE.clear()
ck("no GHL location set: STOP before anything changes", code == 3 and not dep, [code, rep[-300:]])
code, rep, dep, L = run(SB_SHAS=json.dumps({**SHAS, "clockin-alert": "0" * 64}))
ck("a file that isn't the reviewed build: STOP before anything changes", code == 2 and not dep, [code, rep[-300:]])
code, rep, dep, L = run(SB_BASE="")
ck("no reviewed starting point: STOP", code == 2 and not dep, [code, dep])
code, rep, dep, L = run(SB_TOKEN="nope")
ck("no token: STOP", code == 2 and not dep, [code, dep])
src = open(os.path.join(HERE, "call_bridge_433.py")).read()
ck("no em dash in the installer's words", "\u2014" not in src)
ck("the installer never runs SQL that writes, never writes a setting, never talks to GoHighLevel itself", not re.search(r"(?i)\b(update|upsert|insert)\b[^\n]*app_data|leadconnectorhq\.com", src))

srv.shutdown()
allok = True; print("\n433 · INSTALLER REHEARSAL (fake Supabase, fake CLI)\n" + "=" * 50)
for n, g, note in res: allok &= g; print(("PASS  " if g else "FAIL  ") + n + ("" if g else "\n   └─ " + note))
print(f"ALL {len(res)} CHECKS PASS" if allok else "FAILED"); sys.exit(0 if allok else 1)
