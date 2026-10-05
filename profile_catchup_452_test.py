#!/usr/bin/env python3
# Rehearsal of 452 against a FAKE Supabase project and a fake supabase CLI, run from a FRESH copy of this repository (as
# the Desktop step runs). "Live" starts as the GitHub version 452 was built on. Never touches a real project.
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); REF = "zngsgedlsxinbygwmxwn"
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
BASE = os.environ.get("HUB_BASE") or "0128d4f25f1cfb72f811ae0b14e13cf9d4ca5056"   # the base 452 pins
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
ANONK, SVCK = "eyJanon" + REF, "eyJsvc" + REF
VJ = {"caregiver-profile": False, "profile-polish": False}
M = {}; SEEN = []; CALLS = []
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        m = re.match(r"/v1/projects/(\w+)/functions/([\w-]+)$", p)
        if m: return self._send(200, {"verify_jwt": VJ.get(m.group(2), True), "version": 5})
        if re.match(r"/v1/projects/\w+/api-keys", p): return self._send(200, [{"name": "anon", "api_key": ANONK}, {"name": "service_role", "api_key": SVCK}])
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); raw = self.rfile.read(n) or b"{}"; p = self.path; auth = self.headers.get("Authorization", "")
        if p.endswith("/database/query"):
            q = json.loads(raw)["query"]; SEEN.append(q)
            if "alter table public.caregiver_profiles" in q:
                if M.get("sqlfail"): return self._send(400, {"message": "permission denied"})
                M["col"] = True; return self._send(201, [])
            if "information_schema.columns" in q: return self._send(201, [{"data_type": "boolean", "is_nullable": "NO", "column_default": "false"}] if M.get("col") else [])
            if "filter (where self_complete)" in q: return self._send(201, [{"marked": 0, "n": 12}])
            if "filter (where published)" in q: return self._send(201, [{"n": 12, "pub": 3}])
            return self._send(201, [])
        body = json.loads(raw or b"{}"); CALLS.append((p, auth, body))
        if p.endswith("/caregiver-profile"):
            if body.get("action") == "mine": return self._send(404, {"error": "We could not find your profile."})
            return self._send(401, {"error": "Please sign in."})
        if p.endswith("/profile-polish"): return self._send(400, {"error": "Nothing to check."})
        self._send(404, {})
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
tmp = tempfile.mkdtemp(prefix="t452-"); LOG = os.path.join(tmp, "log"); STATE = os.path.join(tmp, "state"); CLI = os.path.join(tmp, "supabase")
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
      "profile-polish": sha(os.path.join(HERE, "supabase/functions/profile-polish/index.ts"))}
SQLSHA = sha(os.path.join(HERE, "caregiver_profile_catchup_452.sql"))
def run(keep=False, mode=None, **over):
    M.clear(); M.update(mode or {}); SEEN.clear(); CALLS.clear(); open(LOG, "w").close(); open(LOG + ".args", "w").close()
    if not keep: open(STATE, "w").close()
    rep = os.path.join(tmp, "r.txt")
    if os.path.exists(rep): os.unlink(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_SUPA_CLI=CLI, SB_API_BASE=URL, SB_REPO=WH, SB_BASE=BASE,
               SB_SHAS=json.dumps(HS), SB_SQL_SHA=SQLSHA, SB_FN_BASE=URL, SB_SETTLE="0", SB_POLL="0.01")
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(WH, "profile_catchup_452.py")], env=env, capture_output=True, text=True)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), open(LOG).read().split(), open(LOG + ".args").read()
rc, r, d, args = run(); print(r)
ck("DONE: the new field, then both helpers deployed, from a fresh copy", rc == 0 and "RESULT: DONE" in r and d == ["caregiver-profile", "profile-polish"] and "✗" not in r, r)
ck("the field is added before either helper is deployed", any("alter table public.caregiver_profiles" in q for q in SEEN), SEEN)
ck("both keep their gateway setting (off: the caregiver's page calls them without signing in)", re.search(r"deploy caregiver-profile .*--no-verify-jwt", args) and re.search(r"deploy profile-polish .*--no-verify-jwt", args), args)
ck("the tests ran here, from a fresh copy (fake data only)", all(t_ in r for t_ in ("profile_catchup_452_test.mjs: ALL 33 CHECKS PASS", "caregiver_profile_test.mjs: ALL 57 CHECKS PASS", "caregiver_profile_2b_test.mjs: ALL ")), r)
ck("the proof only knocks on the public doors: a link that matches nobody, an unsigned office call, an empty Help me say it", [(c_[2].get("action"), c_[2].get("mode")) for c_ in CALLS] == [("mine", None), ("catchup", None), (None, "say")] and all(c_[1] == "Bearer " + ANONK for c_ in CALLS), CALLS)
ck("no profile is changed by the step (only the one new field)", not any(re.search(r"\bupdate |insert |delete ", q, re.I) for q in SEEN if "alter table" not in q), [q for q in SEEN if re.search(r"update |insert |delete ", q, re.I)])
ck("...and no names, emails, keys or tokens in the report", not re.search(r"eyJ|sbp_|@", r), r)
rc, r, d, _ = run(keep=True); ck("run again: helpers already have it, nothing redeployed, still DONE (the field is safe twice)", rc == 0 and r.count("already had it") == 2 and not d and "RESULT: DONE" in r, r)
rc, r, d, _ = run(BAD_LIVE="caregiver-profile"); ck("a live helper that isn't the GitHub version: nothing is changed at all", rc != 0 and "isn't what this was built on" in r and not d and not any("alter table" in q for q in SEEN), r)
rc, r, d, _ = run(OLD_LIVE="profile-polish"); ck("live profile-polish is an OLDER GitHub version (the first run's stop): accepted, named, replaced, DONE", rc == 0 and "older GitHub version (commit 1f03a11)" in r and d == ["caregiver-profile", "profile-polish"] and "RESULT: DONE" in r, r)
# 452b: a hand-edited live copy is accepted ONLY with its exact fingerprint
import tempfile as _tf
def handsha(fn):
    open(STATE, "w").close()   # "live" = the GitHub base plus the hand edit, as at the start of a run
    tdir = _tf.mkdtemp(); os.makedirs(os.path.join(tdir, "supabase"), exist_ok=True)
    subprocess.run([CLI, "functions", "download", fn], cwd=tdir, env=dict(os.environ, BAD_LIVE=fn), capture_output=True)
    return sha(os.path.join(tdir, "supabase/functions", fn, "index.ts"))
FP = handsha("profile-polish")[:12]
rc, r, d, _ = run(BAD_LIVE="profile-polish", SB_LIVE_OK=json.dumps({"profile-polish": FP})); ck("the exact copy she looked at (by fingerprint): accepted, named, replaced, DONE", rc == 0 and f"you looked at in 452b (fingerprint {FP}" in r and d == ["caregiver-profile", "profile-polish"] and "RESULT: DONE" in r, r)
rc, r, d, _ = run(BAD_LIVE="profile-polish", SB_LIVE_OK=json.dumps({"profile-polish": "0" * 12})); ck("a different unknown copy: still stops, nothing changed", rc != 0 and "isn't what this was built on" in r and not d, r)
rc, r, d, _ = run(BAD_LIVE="caregiver-profile", SB_LIVE_OK=json.dumps({"profile-polish": FP})); ck("the fingerprint never excuses the OTHER helper", rc != 0 and not d, r)
rc, r, d, _ = run(mode={"sqlfail": True}); ck("if the field can't be added: stops, neither helper is deployed", rc != 0 and not d and "Nothing else was changed" in r, r)
bad = dict(HS); bad["profile-polish"] = "0" * 64
rc, r, d, _ = run(SB_SHAS=json.dumps(bad)); ck("a helper that isn't the reviewed one: stops before anything", rc != 0 and "not the reviewed build" in r and not d, r)
rc, r, d, _ = run(SB_SQL_SHA="0" * 64); ck("a field file that isn't the reviewed one: stops before anything", rc != 0 and "not the reviewed build" in r and not d, r)
H.shutdown()
for w in (WH, WB, WO): subprocess.run(["git", "worktree", "remove", "--force", w], cwd=HERE)
shutil.rmtree(tmp, ignore_errors=True)
for n, ok, note in res: print(("PASS " if ok else "FAIL ") + n + ("" if ok else "\n      " + note))
print("ALL %d CHECKS PASS" % len(res) if all(x[1] for x in res) else "FAILED"); sys.exit(0 if all(x[1] for x in res) else 1)
