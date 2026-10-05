#!/usr/bin/env python3
# Rehearsal of 455 against a FAKE Supabase project and a fake supabase CLI, run from a FRESH copy of this repository (as
# the Desktop step runs). "Live" starts as the GitHub version 452 was built on. Never touches a real project.
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); REF = "zngsgedlsxinbygwmxwn"
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
BASE = os.environ.get("HUB_BASE") or "176ad5e88d418c301993de0e3eb0f96834b01088"   # the base 455 pins
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
ANONK, SVCK = "eyJanon" + REF, "eyJsvc" + REF
VJ = {"caregiver-profile": False, "caregiver-card": False}
M = {}; SEEN = []; CALLS = []
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if p.startswith("/functions/v1/caregiver-card"): CALLS.append((p, self.headers.get("Authorization", ""), {"action": "card"})); return self._send(404, {"error": "not_found"})
        m = re.match(r"/v1/projects/(\w+)/functions/([\w-]+)$", p)
        if m: return self._send(200, {"verify_jwt": VJ.get(m.group(2), True), "version": 5})
        if re.match(r"/v1/projects/\w+/api-keys", p): return self._send(200, [{"name": "anon", "api_key": ANONK}, {"name": "service_role", "api_key": SVCK}])
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); raw = self.rfile.read(n) or b"{}"; p = self.path; auth = self.headers.get("Authorization", "")
        if p.endswith("/database/query"):
            q = json.loads(raw)["query"]; SEEN.append(q)
            if "add column if not exists photo_hidden" in q:
                if M.get("sqlfail"): return self._send(400, {"message": "permission denied"})
                M["col"] = True; return self._send(201, [])
            if "information_schema.columns" in q: return self._send(201, [{"n": 2 if M.get("col") else 0}])
            if "filter (where photo_hidden or video_hidden)" in q: return self._send(201, [{"hidden": 0, "n": 12}])
            if "filter (where published)" in q: return self._send(201, [{"n": 12, "pub": 3}])
            return self._send(201, [])
        body = json.loads(raw or b"{}"); CALLS.append((p, auth, body))
        if "/caregiver-card" in p: return self._send(404, {"error": "not_found"})
        if p.endswith("/caregiver-profile"):
            if body.get("action") == "mine": return self._send(404, {"error": "We could not find your profile."})
            return self._send(401, {"error": "Please sign in."})
        if p.endswith("/profile-polish"): return self._send(400, {"error": "Nothing to check."})
        self._send(404, {})
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
tmp = tempfile.mkdtemp(prefix="t455-"); LOG = os.path.join(tmp, "log"); STATE = os.path.join(tmp, "state"); CLI = os.path.join(tmp, "supabase")
WH = os.path.join(tmp, "wt", "hub"); WB = os.path.join(tmp, "wt", "base"); WO = os.path.join(tmp, "wt", "old")
subprocess.run(["git", "worktree", "add", "-q", "--detach", WH, "HEAD"], cwd=HERE, check=True)
subprocess.run(["git", "worktree", "add", "-q", "--detach", WB, BASE], cwd=HERE, check=True)
subprocess.run(["git", "worktree", "add", "-q", "--detach", WO, "1f03a11"], cwd=HERE, check=True)   # profile-polish's first version
open(CLI, "w").write(f"""#!/bin/sh
cmd="$2"; fn="$3"
echo "$*" >> "{LOG}.args"
if [ "$cmd" = "download" ]; then
  SRC="{WB}"; [ "$OLD_LIVE" = "$fn" ] && SRC="{WO}"; grep -qx "$fn" "{STATE}" 2>/dev/null && SRC="{WH}"
  [ -f "$SRC/supabase/functions/$fn/index.ts" ] || exit 1
  mkdir -p "supabase/functions/$fn" "supabase/functions/_shared"
  cp "$SRC/supabase/functions/$fn/index.ts" "supabase/functions/$fn/index.ts"; cp "$SRC"/supabase/functions/_shared/*.ts supabase/functions/_shared/
  if [ "$BAD_LIVE" = "$fn" ] && [ "$SRC" != "{WH}" ]; then echo "// hand edit" >> "supabase/functions/$fn/index.ts"; fi
  exit 0
fi
if [ "$cmd" = "deploy" ]; then echo "$fn" >> "{LOG}"; echo "$fn" >> "{STATE}"; exit 0; fi
exit 1
""")
os.chmod(CLI, 0o755)
HS = {"caregiver-profile": sha(os.path.join(HERE, "supabase/functions/caregiver-profile/index.ts")),
      "caregiver-card": sha(os.path.join(HERE, "supabase/functions/caregiver-card/index.ts"))}
SQLSHA = sha(os.path.join(HERE, "caregiver_profile_hide_455.sql"))
def run(keep=False, mode=None, **over):
    M.clear(); M.update(mode or {}); SEEN.clear(); CALLS.clear(); open(LOG, "w").close(); open(LOG + ".args", "w").close()
    if not keep: open(STATE, "w").close()
    rep = os.path.join(tmp, "r.txt")
    if os.path.exists(rep): os.unlink(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_SUPA_CLI=CLI, SB_API_BASE=URL, SB_REPO=WH, SB_BASE=BASE,
               SB_SHAS=json.dumps(HS), SB_SQL_SHA=SQLSHA, SB_FN_BASE=URL, SB_SETTLE="0", SB_POLL="0.01")
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(WH, "hide_media_455.py")], env=env, capture_output=True, text=True)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), open(LOG).read().split(), open(LOG + ".args").read()
rc, r, d, args = run(); print(r)
ck("DONE: the two fields, then both helpers deployed, from a fresh copy", rc == 0 and "RESULT: DONE" in r and d == ["caregiver-profile", "caregiver-card"] and "✗" not in r, r)
ck("the fields go in before either helper is deployed", any("add column if not exists photo_hidden" in q for q in SEEN))
ck("both keep their gateway setting (off: families and caregivers have no sign-in)", re.search(r"deploy caregiver-profile .*--no-verify-jwt", args) and re.search(r"deploy caregiver-card .*--no-verify-jwt", args), args)
ck("the tests ran here, from a fresh copy (fake data only)", all(t_ in r for t_ in ("hide_455_test.mjs: ALL 10 CHECKS PASS", "profile_catchup_452_test.mjs: ALL 33", "caregiver_profile_test.mjs: ALL 57", "caregiver_profile_2b_test.mjs: ALL ")), r)
ck("the proof only asks for a card and a caregiver page that match nobody", [c_[2].get("action") for c_ in CALLS] == ["card", "mine"], CALLS)
ck("no profile is changed by the step (only the two new fields)", not any(re.search(r"\bupdate |insert |delete ", q, re.I) for q in SEEN if "add column" not in q), [q for q in SEEN if re.search(r"update |insert |delete ", q, re.I)])
ck("...and no keys or tokens in the report", not re.search(r"eyJ|sbp_|@", r), r)
rc, r, d, _ = run(keep=True); ck("run again: already has it, nothing redeployed, still DONE", rc == 0 and r.count("already had it") == 2 and not d and "RESULT: DONE" in r, r)
rc, r, d, _ = run(BAD_LIVE="caregiver-card"); ck("a live card that isn't on GitHub: nothing is changed at all", rc != 0 and "isn't what this was built on" in r and not d and not any("add column" in q for q in SEEN), r)
rc, r, d, _ = run(mode={"sqlfail": True}); ck("if the fields can't be added: stops, neither helper is deployed", rc != 0 and not d, r)
bad = dict(HS); bad["caregiver-card"] = "0" * 64
rc, r, d, _ = run(SB_SHAS=json.dumps(bad)); ck("a helper that isn't the reviewed one: stops before anything", rc != 0 and "not the reviewed build" in r and not d, r)
H.shutdown()
for w in (WH, WB, WO): subprocess.run(["git", "worktree", "remove", "--force", w], cwd=HERE)
shutil.rmtree(tmp, ignore_errors=True)
for n, ok, note in res: print(("PASS " if ok else "FAIL ") + n + ("" if ok else "\n      " + note))
print("ALL %d CHECKS PASS" % len(res) if all(x[1] for x in res) else "FAILED"); sys.exit(0 if all(x[1] for x in res) else 1)
