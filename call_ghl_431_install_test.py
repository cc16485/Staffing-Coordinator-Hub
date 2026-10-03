#!/usr/bin/env python3
# Rehearsal of 431 against a FAKE Supabase (management API + the three functions) and a FAKE supabase CLI. Never
# touches a real project. Run from the branch with the 431 commit:  python3 call_ghl_431_install_test.py
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
            if fn == "ghl-call-link" and fn not in open(STATE).read().split(): return self._send(404, {"message": "not found"})
            return self._send(200, {"verify_jwt": MODE.get("vj_new", True) if fn == "ghl-call-link" else True, "version": 7})
        if m := re.match(r"/v1/projects/(\w+)/api-keys(\?reveal=true)?$", p):
            S["keyq"].append(p); return self._send(200, [{"name": "anon", "api_key": "eyJanon" + m.group(1)}, {"name": "service_role", "api_key": "eyJsvc" + m.group(1)}])
        if re.match(r"/v1/projects/(\w+)/secrets$", p):
            if MODE.get("no_loc"): return self._send(200, [{"name": "GHL_TOKEN", "value": "abc"}])
            return self._send(200, [{"name": "GHL_TOKEN", "value": "abc"}, {"name": "GHL_LOCATION_ID", "value": MODE.get("loc", hashlib.sha256(b"Recp0AhyMh8lrtKJ9kaj").hexdigest())}, {"name": "HUB_JOB_SECRET", "value": "x"}])
        self._send(404, {})
    def do_PATCH(self):
        S["patches"].append(self.path); MODE["vj_new"] = True; self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); raw = self.rfile.read(n) or b"{}"; p = self.path
        if p.startswith("/fn/functions/v1/"):
            S["fncalls"].append((p, self.headers.get("Authorization", ""), json.loads(raw)))
            return self._send(401, {"error": "not allowed"})
        if re.match(r"/v1/projects/(\w+)/database/query", p): S["sql"].append(json.loads(raw)["query"]); return self._send(400, {"message": "unexpected"})
        self._send(404, {})
tmp = tempfile.mkdtemp(prefix="t431-"); LOG = os.path.join(tmp, "cli.log"); STATE = os.path.join(tmp, "deployed")
open(STATE, "w").close()
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
CLI = os.path.join(tmp, "supabase")
open(CLI, "w").write(f"""#!/bin/sh
# fake CLI: download gives the reviewed starting point's copy until a deploy, then the local build.
# BAD_LIVE=<fn>: that function's live code is unknown. ghl-call-link does not exist until deployed.
cmd="$2"; fn="$3"; root="{HERE}"; base="{BASE}"
if [ "$cmd" = "download" ]; then
  if grep -qx "$fn" "{STATE}" 2>/dev/null; then
    mkdir -p "supabase/functions/$fn" "supabase/functions/_shared"
    cp "$root/supabase/functions/$fn/index.ts" "supabase/functions/$fn/index.ts"; cp "$root"/supabase/functions/_shared/*.ts supabase/functions/_shared/
    rm -f supabase/functions/_shared/_*.ts
  else
    [ "$fn" = "ghl-call-link" ] && exit 1
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
    p = subprocess.run([sys.executable, os.path.join(HERE, "call_ghl_431.py")], env=env, capture_output=True, text=True)
    deps = [l.split()[0] for l in open(LOG).read().splitlines()]
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), deps, open(LOG).read().splitlines()

ck("the reviewed files are the four 431 files", set(SHAS) == {"_shared/ghl-contact-link", "clockin-alert", "late-alert", "ghl-call-link"}, SHAS)
code, rep, dep, L = run(real_node=True)
open(os.environ.get("REHEARSAL_OUT", "/dev/null"), "w").write(rep)
ck("rehearsal: DONE, exit 0", code == 0 and "RESULT: DONE" in rep, rep[-2500:])
ck("the 7 test files ran for real and passed inside the installer", rep.count("(run here, against fakes; nothing sent)") == 7, rep[:3000])
ck("exactly the three functions are deployed: clockin-alert, late-alert, then the new ghl-call-link", dep == ["clockin-alert", "late-alert", "ghl-call-link"], dep)
ck("every deploy keeps the gateway sign-in check on (no --no-verify-jwt)", all("--no-verify-jwt" not in l for l in L), L)
ck("ghl-call-link is reported created with the sign-in check on", "ghl-call-link created, version" in rep and "gateway sign-in check on" in rep, rep)
ck("the GHL location is confirmed as Caring Companions from its fingerprint", "the GoHighLevel location is Caring Companions (Recp0AhyMh8lrtKJ9kaj)" in rep, rep)
ck("NO SQL at all (no database change)", not S["sql"], S["sql"])
calls = S["fncalls"]
ck("proof calls only: ghl-call-link with the public key and a made-up sign-in, clockin-alert and late-alert with no link and a made-up link (6, all refused)",
   len(calls) == 6 and [c[0].split("/")[-1] for c in calls] == ["ghl-call-link", "ghl-call-link", "clockin-alert", "clockin-alert", "late-alert", "late-alert"]
   and calls[0][1].startswith("Bearer eyJanon") and calls[1][1] == "Bearer not-a-real-sign-in" and all(c[2].get("action", "view") == "view" for c in calls[2:]), calls)
ck("proof: every live copy is exactly the reviewed build", rep.count(": the live copy is exactly the reviewed build") == 3 and "✗" not in rep, rep[-1500:])
ck("the report hides keys and says nothing was sent, no contact created", not re.search(r"eyJ\w|sbp_\w", rep) and "no GoHighLevel contact was created" in rep, rep[-600:])
ck("the result says what to check on her phone", "on her phone, tap one" in rep and "app.leadconnectorhq.com" in rep, rep[-800:])

code, rep, dep, L = run(BAD_LIVE="late-alert")
ck("a live copy that is not today's GitHub main: that one NOT deployed and named, the rest go, PARTLY DONE",
   code == 1 and "late-alert" not in dep and dep == ["clockin-alert", "ghl-call-link"] and "late-alert: its live code is not today's GitHub main" in rep and "PARTLY DONE" in rep, [code, dep, rep[-800:]])
MODE["vj_new"] = False; code, rep, dep, L = run(); MODE.clear()
ck("a new function created with the sign-in check off is switched back on", code == 0 and S["patches"] and "ghl-call-link created" in rep, [code, S["patches"], rep[-600:]])
MODE["no_loc"] = True; code, rep, dep, L = run(); MODE.clear()
ck("no GHL location set: STOP before anything changes", code == 3 and not dep, [code, rep[-300:]])
MODE["loc"] = "someotherfingerprint"; code, rep, dep, L = run(); MODE.clear()
ck("a location that can't be confirmed: said plainly, still installs", code == 0 and "couldn't be confirmed here" in rep, rep[-1200:])
code, rep, dep, L = run(SB_SHAS=json.dumps({**SHAS, "clockin-alert": "0" * 64}))
ck("a file that isn't the reviewed build: STOP before anything changes", code == 2 and not dep, [code, rep[-300:]])
code, rep, dep, L = run(SB_BASE="")
ck("no reviewed starting point: STOP", code == 2 and not dep, [code, dep])
code, rep, dep, L = run(SB_TOKEN="nope")
ck("no token: STOP", code == 2 and not dep, [code, dep])
src = open(os.path.join(HERE, "call_ghl_431.py")).read()
ck("no em dash in the installer's words", "—" not in src)
ck("the installer never runs SQL that writes, never writes a setting, never posts to GHL", not re.search(r"(?i)\b(update|upsert|insert)\b[^\n]*app_data|upsert_app_data_item|leadconnectorhq\.com/(contacts|conversations)", src))

srv.shutdown()
allok = True; print("\n431 · INSTALLER REHEARSAL (fake Supabase, fake CLI)\n" + "=" * 50)
for n, g, note in res: allok &= g; print(("PASS  " if g else "FAIL  ") + n + ("" if g else "\n   └─ " + note))
print(f"ALL {len(res)} CHECKS PASS" if allok else "FAILED"); sys.exit(0 if allok else 1)
