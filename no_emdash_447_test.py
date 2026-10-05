#!/usr/bin/env python3
# Rehearsal of 447 against FAKE Supabase projects (Hub + Training) and a fake supabase CLI, run from FRESH copies of both
# repositories (as the Desktop step runs). Never touches a real project. CG_INTAKE: the start form rules file.
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); TRAIN = os.environ.get("TRAIN_REPO", os.path.join(HERE, "..", "training-wt"))
HUB_REF, TR_REF = "zngsgedlsxinbygwmxwn", "rdqujxiycycwhskyvrwa"
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
HUB_BASE = os.environ.get("HUB_BASE") or "7b3243acfab29714f9a124a02720fcf63425134a"   # the base 447 pins
TR_BASE = "d42071b7547292f01bd1cf9e1c2e426753431c36"
HUBDIR = os.environ.get("HUB_DIR", os.path.join(HERE, "..", "cc-hub-live"))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
ANONK, SVCK = "eyJanon" + HUB_REF, "eyJsvc" + HUB_REF
M = {}; SEEN = []
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj, raw=None):
        b = raw if raw is not None else json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if p.startswith("/hub/"):
            name = p[5:].split("?")[0]; fp = os.path.join(HUBDIR, name)
            if M.get("nohub") or not os.path.exists(fp): return self._send(404, {})
            return self._send(200, None, raw=open(fp, "rb").read())
        m = re.match(r"/v1/projects/(\w+)/functions/([\w-]+)$", p)
        if m:
            fn = m.group(2); dep = open(STATE).read().split()
            if fn == "lead-nurture" and fn not in dep: return self._send(404, {})
            return self._send(200, {"verify_jwt": fn != "job-offer" or True, "version": 3})
        if re.match(r"/v1/projects/\w+/api-keys", p): return self._send(200, [{"name": "anon", "api_key": ANONK}, {"name": "service_role", "api_key": SVCK}])
        if re.match(r"/v1/projects/(\w+)/secrets", p):
            ref = p.split("/")[3]
            names = ["X"]
            if M.get("nosecret") and ref == HUB_REF: names = names[:1]
            return self._send(200, [{"name": n} for n in names])
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_OPTIONS(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); raw = self.rfile.read(n) or b"{}"; p = self.path
        if p.endswith("/database/query"): SEEN.append(json.loads(raw)["query"]); return self._send(201, [])
        SEEN.append("POST " + p)
        self._send(404, {})
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
tmp = tempfile.mkdtemp(prefix="t447-"); LOG = os.path.join(tmp, "log"); STATE = os.path.join(tmp, "state"); CLI = os.path.join(tmp, "supabase")
WH = os.path.join(tmp, "wt", "hub"); WT = os.path.join(tmp, "wt", "train")
subprocess.run(["git", "worktree", "add", "-q", "--detach", WH, "HEAD"], cwd=HERE, check=True)
subprocess.run(["git", "worktree", "add", "-q", "--detach", WT, os.environ.get("TRAIN_REF", "HEAD")], cwd=TRAIN, check=True)
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
HS = {k: sha(os.path.join(HERE, f"supabase/functions/{k}/index.ts")) for k in ("interview-messages", "lead-nurture", "coverage-reply", "coverage-run")}
TS = {k: sha(os.path.join(TRAIN, f"supabase/functions/{k}/index.ts")) for k in ("send-invite", "send-reminder", "send-certificate")}
def run(keep=False, mode=None, **over):
    M.clear(); M.update(mode or {}); SEEN.clear(); open(LOG, "w").close()
    if not keep: open(STATE, "w").close()
    rep = os.path.join(tmp, "r.txt")
    if os.path.exists(rep): os.unlink(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_SUPA_CLI=CLI, SB_API_BASE=URL, SB_REPO=WH, SB_TRAINING_REPO=WT, SB_BASE=HUB_BASE, SB_TRAINING_BASE=TR_BASE,
               SB_SHAS=json.dumps(HS), SB_TRAINING_SHAS=json.dumps(TS), SB_FN_BASE=URL, SB_TRAINING_FN_BASE=URL,
               SB_HUB_BASE=URL + "/hub/", SB_SETTLE="0")
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(WH, "no_emdash_447.py")], env=env, capture_output=True, text=True)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), open(LOG).read().split()
rc, r, d = run(); print(r)
ck("DONE: the six live senders redeployed over GitHub's copies; lead-nurture (not on the server) skipped", rc == 0 and "RESULT: DONE" in r and sorted(d) == sorted(["interview-messages", "coverage-reply", "coverage-run", "send-invite", "send-reminder", "send-certificate"]) and "lead-nurture: is not on the server" in r and "✗" not in r, r)
ck("the tests and the journey check ran here, from fresh copies", "training_texts_test.mjs:" in r and "bg_review_test.mjs:" in r and "the journey check: 4/4 passed" in r, r)
ck("nothing is sent: no function was called and no database change", not any(q.startswith("POST") for q in SEEN) and not any("begin" in q.lower() for q in SEEN if not q.startswith("POST")), SEEN)
ck("no key or token in the report", not re.search(r"eyJ|sbp_", r), r)
rc, r, d = run(keep=True); ck("run again: all already have it, nothing redeployed", rc == 0 and r.count("already had it") == 6 and not d, r)
rc, r, d = run(BAD_LIVE="coverage-run"); ck("a hand-edited live coverage-run: NOTHING is changed", rc != 0 and "NOTHING was changed" in r and not d, r)
rc, r, d = run(mode={"nohub": True}); ck("the Hub change not merged yet (the check can't be downloaded): stops, nothing changed", rc != 0 and "Claude merges the Hub change first" in r and not d, r)
H.shutdown()
for w, root in ((WH, HERE), (WT, TRAIN)): subprocess.run(["git", "worktree", "remove", "--force", w], cwd=root)
shutil.rmtree(tmp, ignore_errors=True)
for n, ok, note in res: print(("PASS " if ok else "FAIL ") + n + ("" if ok else "\n      " + note))
print("ALL %d CHECKS PASS" % len(res) if all(x[1] for x in res) else "FAILED"); sys.exit(0 if all(x[1] for x in res) else 1)
