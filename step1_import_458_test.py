#!/usr/bin/env python3
# Rehearsal of 458 against a FAKE Supabase project and a fake supabase CLI, run from a FRESH copy of this repository (as
# the Desktop step runs). "Live" starts as the GitHub version 452 was built on. Never touches a real project.
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); REF = "zngsgedlsxinbygwmxwn"
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
BASE = os.environ.get("HUB_BASE") or "8191cd7c17781c17c0909f6b6e45eb660f1e7e9c"   # the base 455 pins
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
ANONK, SVCK = "eyJanon" + REF, "eyJsvc" + REF
VJ = {"caregiver-profile": False, "step1-import": True}
M = {}; SEEN = []; CALLS = []
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if p.startswith("/functions/v1/caregiver-card"): CALLS.append((p, self.headers.get("Authorization", ""), {"action": "card"})); return self._send(404, {"error": "not_found"})
        m = re.match(r"/v1/projects/(\w+)/functions/([\w-]+)$", p)
        if m:
            if m.group(2) == "step1-import" and "step1-import" not in open(STATE).read().split(): return self._send(404, {})
            return self._send(200, {"verify_jwt": VJ.get(m.group(2), True), "version": 5})
        if re.match(r"/v1/projects/\w+/secrets", p): return self._send(200, [] if M.get("nokeys") else [{"name": "GHL_TOKEN"}, {"name": "GHL_LOCATION_ID"}, {"name": "ANTHROPIC_API_KEY"}])
        if re.match(r"/v1/projects/\w+/api-keys", p): return self._send(200, [{"name": "anon", "api_key": ANONK}, {"name": "service_role", "api_key": SVCK}])
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); raw = self.rfile.read(n) or b"{}"; p = self.path; auth = self.headers.get("Authorization", "")
        if p.endswith("/database/query"):
            q = json.loads(raw)["query"]; SEEN.append(q)
            if "create table if not exists public.caregiver_application_facts" in q:
                if M.get("sqlfail"): return self._send(400, {"message": "permission denied"})
                M["col"] = True; return self._send(201, [])
            if "role_table_grants" in q: return self._send(201, [{"grantee": "authenticated", "p": "SELECT"}] if M.get("col") else [])
            if "count(*)::int as n from public.caregiver_application_facts" in q: return self._send(201, [{"n": 3}])
            if "filter (where photo_hidden or video_hidden)" in q: return self._send(201, [{"hidden": 0, "n": 12}])
            if "filter (where published)" in q: return self._send(201, [{"n": 12, "pub": 3}])
            return self._send(201, [])
        body = json.loads(raw or b"{}"); CALLS.append((p, auth, body))
        if p.endswith("/step1-import"):
            if auth != "Bearer " + SVCK: return self._send(401, {"error": "not allowed"})
            mode, off = body.get("mode"), int(body.get("offset") or 0)
            if M.get("broken"): return self._send(500, {"error": "boom"})
            sh = {"stop": "end_turn", "blocks": "text", "chars": 1800, "out_tokens": 700, "parsed": True, "keys": "own_words,experience"}
            if M.get("empty"):
                people = [{"who": "Joyce K.", "state": "read, but nothing came out (see shape)", "found": {"own_words": 0, "jobs": 0, "matching": 0, "availability": 0, "favorites": 0}, "shape": dict(sh, parsed=False, keys="")},
                          {"who": "Nora N.", "state": "no Step 1 PDF in GoHighLevel"}, {"who": "Ann O.", "state": "read, but nothing came out (see shape)", "shape": dict(sh, parsed=False)}, {"who": "Ed N.", "state": "no phone or email in the Hub"}]
                return self._send(200, {"ok": True, "live": mode == "live", "total": 4, "offset": off, "next": off + 1 if off + 1 < 4 else None, "people": [people[off]]})
            people = [{"who": "Joyce K.", "state": "would save" if mode == "practice" else "saved", "found": {"own_words": 5, "jobs": 2, "matching": 9, "availability": 6, "favorites": 4}, "shape": sh},
                      {"who": "Nora N.", "state": "no Step 1 PDF in GoHighLevel"}, {"who": "Ann O.", "state": "would save" if mode == "practice" else "saved", "found": {"own_words": 3, "jobs": 1, "matching": 5, "availability": 4, "favorites": 0}, "shape": sh},
                      {"who": "Ed N.", "state": "no phone or email in the Hub"}]
            return self._send(200, {"ok": True, "live": mode == "live", "total": 4, "offset": off, "next": off + 1 if off + 1 < 4 else None, "people": [people[off]]})
        if p.endswith("/caregiver-profile"):
            if body.get("action") == "mine": return self._send(404, {"error": "We could not find your profile."})
            return self._send(401, {"error": "Please sign in."})
        if p.endswith("/profile-polish"): return self._send(400, {"error": "Nothing to check."})
        self._send(404, {})
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
tmp = tempfile.mkdtemp(prefix="t458-"); LOG = os.path.join(tmp, "log"); STATE = os.path.join(tmp, "state"); CLI = os.path.join(tmp, "supabase")
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
      "step1-import": sha(os.path.join(HERE, "supabase/functions/step1-import/index.ts"))}
SQLSHA = sha(os.path.join(HERE, "caregiver_application_facts_458.sql"))
def run(keep=False, mode=None, stdin="yes\n", **over):
    M.clear(); M.update(mode or {}); SEEN.clear(); CALLS.clear(); open(LOG, "w").close(); open(LOG + ".args", "w").close()
    if not keep: open(STATE, "w").close()
    rep = os.path.join(tmp, "r.txt")
    if os.path.exists(rep): os.unlink(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_SUPA_CLI=CLI, SB_API_BASE=URL, SB_REPO=WH, SB_BASE=BASE,
               SB_SHAS=json.dumps(HS), SB_SQL_SHA=SQLSHA, SB_FN_BASE=URL, SB_SETTLE="0", SB_POLL="0.01")
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(WH, "step1_import_458.py")], env=env, input=stdin, capture_output=True, text=True)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), open(LOG).read().split(), open(LOG + ".args").read()
rc, r, d, args = run(); print(r)
ck("DONE: the table, both helpers, a practice read, your yes, then everyone read", rc == 0 and "RESULT: DONE" in r and d == ["caregiver-profile", "step1-import"] and "✗" not in r, r)
ck("the profile helper keeps its gateway setting; the new importer gets the sign-in gate (owner key only)", re.search(r"deploy caregiver-profile .*--no-verify-jwt", args) and not re.search(r"deploy step1-import .*--no-verify-jwt", args), args)
ck("the tests ran here (fake data only)", all(t_ in r for t_ in ("step1_import_458_test.mjs: ALL 18", "beef_457_test.mjs: ALL 11", "hide_455_test.mjs: ALL 10")), r)
ck("the practice read stops after 2 PDFs and shows counts and the reply's shape only", r.count("would save") == 2 and "Joyce K.: would save (their words 5/5 · jobs 2" in r and "[reply: text · 1800 characters" in r, r)
ck("then everyone, one at a time, with a summary", "Summary: saved 2" in r and "3 caregivers now have their Step 1 application" in r, r)
ck("the only calls to the importer: one refused public call, practice batches, live batches", [c_[2].get("mode") for c_ in CALLS if "/step1-import" in c_[0]].count("live") == 5, CALLS)
ck("no keys or tokens in the report", not re.search(r"eyJ|sbp_|@", r), r)
rc, r, d, _ = run(stdin="no\n"); ck("anything but yes after the practice: nothing saved", rc == 0 and "nothing was saved" in r and not any(c_[2].get("mode") == "live" and "Bearer " + SVCK == c_[1] for c_ in CALLS), r)
rc, r, d, _ = run(keep=True); ck("run again: helpers already have it, nothing redeployed, still DONE", rc == 0 and r.count("already had it") == 2 and not d and "RESULT: DONE" in r, r)
rc, r, d, _ = run(mode={"nokeys": True}); ck("no GoHighLevel or AI key: stops before changing anything", rc != 0 and "missing its GoHighLevel or AI key" in r and not d, r)
rc, r, d, _ = run(BAD_LIVE="caregiver-profile"); ck("a live profile helper that isn't on GitHub: nothing is changed", rc != 0 and not d, r)
rc, r, d, _ = run(mode={"sqlfail": True}); ck("if the table can't go in: stops, neither helper is deployed", rc != 0 and not d, r)
rc, r, d, _ = run(mode={"empty": True}); ck("458b: the practice reads PDFs but finds no details: STOPS before your yes, nothing saved, the reply's shape shown", rc != 0 and "found no details" in r and "JSON: no" in r and not any(c_[2].get("mode") == "live" and "Bearer " + SVCK == c_[1] for c_ in CALLS), r)
rc, r, d, _ = run(mode={"broken": True}); ck("if the practice read fails: nothing is saved, it says so", rc != 0 and "practice read didn't answer" in r and "STOP before saving" in r, r)
H.shutdown()
for w in (WH, WB, WO): subprocess.run(["git", "worktree", "remove", "--force", w], cwd=HERE)
shutil.rmtree(tmp, ignore_errors=True)
for n, ok, note in res: print(("PASS " if ok else "FAIL ") + n + ("" if ok else "\n      " + note))
print("ALL %d CHECKS PASS" % len(res) if all(x[1] for x in res) else "FAILED"); sys.exit(0 if all(x[1] for x in res) else 1)
