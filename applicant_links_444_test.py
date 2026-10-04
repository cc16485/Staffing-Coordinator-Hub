#!/usr/bin/env python3
# Rehearsal of 444 against FAKE Supabase projects (Hub + Training) and a fake supabase CLI, run from FRESH copies of both
# repositories (as the Desktop step runs). Never touches a real project. CG_INTAKE: the start form rules file.
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); TRAIN = os.environ.get("TRAIN_REPO", os.path.join(HERE, "..", "training-wt"))
HUB_REF, TR_REF = "zngsgedlsxinbygwmxwn", "rdqujxiycycwhskyvrwa"
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
HUB_BASE = os.environ.get("HUB_BASE") or "8fcc43f9ccab66bdc4fd0507f933464a3fa27583"   # the base 444 pins
TR_BASE = "1209eeff812eff0dc4dc33e19bdb255ac5b1c3cb"
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
ANONK, SVCK = "eyJanon" + HUB_REF, "eyJsvc" + HUB_REF
M = {}; SEEN = []
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj, raw=None):
        b = raw if raw is not None else json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if p.startswith("/hub/intake-import-rules.js"): return self._send(200, None, raw=open(os.environ["CG_INTAKE"], "rb").read())
        m = re.match(r"/v1/projects/(\w+)/functions/([\w-]+)$", p)
        if m:
            fn = m.group(2); dep = open(STATE).read().split()
            if fn == "applicant-link" and fn not in dep: return self._send(404, {})
            return self._send(200, {"verify_jwt": fn != "job-offer" or True, "version": 3})
        if re.match(r"/v1/projects/\w+/api-keys", p): return self._send(200, [{"name": "anon", "api_key": ANONK}, {"name": "service_role", "api_key": SVCK}])
        if re.match(r"/v1/projects/(\w+)/secrets", p):
            ref = p.split("/")[3]
            names = (["HUB_JOB_SECRET", "OFFERS_PROJECT_URL", "OFFERS_SERVICE_ROLE_KEY"] if ref == HUB_REF else ["HUB_ANON_KEY"])
            if M.get("nosecret") and ref == HUB_REF: names = names[:1]
            return self._send(200, [{"name": n} for n in names])
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_OPTIONS(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); raw = self.rfile.read(n) or b"{}"; p = self.path
        if p.endswith("/database/query"): SEEN.append(json.loads(raw)["query"]); return self._send(201, [])
        if "/applicant-link" in p: return self._send(401, {"ok": False})
        if "/job-offer" in p: return self._send(401, {"error": "Sign in to the Hub first."})
        if "/intake-import" in p: return self._send(200, {"ok": True, "dry": True, "seen": 0})
        self._send(404, {})
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
tmp = tempfile.mkdtemp(prefix="t444-"); LOG = os.path.join(tmp, "log"); STATE = os.path.join(tmp, "state"); CLI = os.path.join(tmp, "supabase")
WH = os.path.join(tmp, "wt", "hub"); WT = os.path.join(tmp, "wt", "train")
subprocess.run(["git", "worktree", "add", "-q", "--detach", WH, "HEAD"], cwd=HERE, check=True)
subprocess.run(["git", "worktree", "add", "-q", "--detach", WT, "HEAD"], cwd=TRAIN, check=True)
open(CLI, "w").write(f"""#!/bin/sh
cmd="$2"; fn="$3"; ref="$5"
if [ "$ref" = "{TR_REF}" ]; then root="{WT}"; base="{TR_BASE}"; else root="{WH}"; base="{HUB_BASE}"; fi
if [ "$cmd" = "download" ]; then
  mkdir -p "supabase/functions/$fn" "supabase/functions/_shared"
  if grep -qx "$fn" "{STATE}" 2>/dev/null; then cp "$root/supabase/functions/$fn/index.ts" "supabase/functions/$fn/index.ts"; cp "$root"/supabase/functions/_shared/*.ts supabase/functions/_shared/
  else git -C "$root" show "$base:supabase/functions/$fn/index.ts" > "supabase/functions/$fn/index.ts" 2>/dev/null || exit 1
    for f in $(git -C "$root" ls-tree --name-only "$base" supabase/functions/_shared/); do git -C "$root" show "$base:$f" > "$f"; done
    if [ "$BAD_LIVE" = "$fn" ]; then echo "// hand edit" >> "supabase/functions/$fn/index.ts"; fi
  fi; exit 0
fi
if [ "$cmd" = "deploy" ]; then echo "$fn" >> "{LOG}"; echo "$fn" >> "{STATE}"; exit 0; fi
exit 1
""")
os.chmod(CLI, 0o755)
HS = {"applicant-link": sha(os.path.join(HERE, "supabase/functions/applicant-link/index.ts")), "_shared/applicant-links": sha(os.path.join(HERE, "supabase/functions/_shared/applicant-links.ts")),
      "intake-import": sha(os.path.join(HERE, "supabase/functions/intake-import/index.ts")), "_shared/intake-import": sha(os.path.join(HERE, "supabase/functions/_shared/intake-import.ts"))}
TS = {"job-offer": sha(os.path.join(TRAIN, "supabase/functions/job-offer/index.ts")), "_shared/hub-gate": sha(os.path.join(TRAIN, "supabase/functions/_shared/hub-gate.ts"))}
def run(keep=False, mode=None, **over):
    M.clear(); M.update(mode or {}); SEEN.clear(); open(LOG, "w").close()
    if not keep: open(STATE, "w").close()
    rep = os.path.join(tmp, "r.txt")
    if os.path.exists(rep): os.unlink(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_SUPA_CLI=CLI, SB_API_BASE=URL, SB_REPO=WH, SB_TRAINING_REPO=WT, SB_BASE=HUB_BASE, SB_TRAINING_BASE=TR_BASE,
               SB_SHAS=json.dumps(HS), SB_TRAINING_SHAS=json.dumps(TS), SB_SQL_SHA=sha(os.path.join(HERE, "applicant_links.sql")), SB_FN_BASE=URL, SB_TRAINING_FN_BASE=URL,
               SB_HUB_BASE=URL + "/hub/", SB_SETTLE="0")
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(WH, "applicant_links_444.py")], env=env, capture_output=True, text=True)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), open(LOG).read().split()
rc, r, d = run(); print(r)
ck("DONE: the column change, applicant-link created, intake-import and the Training job-offer redeployed over GitHub's copies", rc == 0 and "RESULT: DONE" in r and sorted(d) == ["applicant-link", "intake-import", "job-offer"]
   and any("start_offer_id" in q for q in SEEN) and "✗" not in r, r)
ck("the tests of both repositories ran here, from fresh copies", "applicant_links_test.mjs:" in r and "intake_import_test.mjs:" in r and "training_texts_test.mjs:" in r, r)
ck("no key or token in the report", not re.search(r"eyJ|sbp_", r), r)
rc, r, d = run(keep=True); ck("run again: all already have it, nothing redeployed", rc == 0 and r.count("already had it") == 3 and not d, r)
rc, r, d = run(BAD_LIVE="job-offer"); ck("a Training job-offer that is not GitHub's copy: NOTHING is changed", rc != 0 and "NOTHING was changed" in r and not d and not SEEN, r)
rc, r, d = run(BAD_LIVE="intake-import"); ck("a hand-edited live intake-import: nothing changed", rc != 0 and not d, r)
rc, r, d = run(mode={"nosecret": True}); ck("a missing secret: stops before changing anything", rc != 0 and "missing a secret" in r and not d, r)
rc, r, d = run(SB_SQL_SHA="0" * 64); ck("a database change that isn't the reviewed one: stops", rc != 0 and "not the reviewed build" in r and not d, r)
H.shutdown()
for w, root in ((WH, HERE), (WT, TRAIN)): subprocess.run(["git", "worktree", "remove", "--force", w], cwd=root)
shutil.rmtree(tmp, ignore_errors=True)
for n, ok, note in res: print(("PASS " if ok else "FAIL ") + n + ("" if ok else "\n      " + note))
print("ALL %d CHECKS PASS" % len(res) if all(x[1] for x in res) else "FAILED"); sys.exit(0 if all(x[1] for x in res) else 1)
