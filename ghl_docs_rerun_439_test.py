#!/usr/bin/env python3
# Rehearsal of 439 against a FAKE Supabase and a fake supabase CLI. Never touches a real project.
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); REF = "zngsgedlsxinbygwmxwn"
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
SHAS = {"ghl-docs-import": sha(os.path.join(HERE, "supabase/functions/ghl-docs-import/index.ts")), "_shared/job-auth": sha(os.path.join(HERE, "supabase/functions/_shared/job-auth.ts"))}
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
ANONK, SVCK = "eyJanon" + REF, "eyJsvc" + REF
M = {}; S = {"up": False, "deleted": 0}
def person(who, kind, state, check="edl", result="✅ Clear"): return {"who": who, "kind": kind, "matched": True, "checks": [{"check": check, "hub_has_doc": False, "result": result, "state": state}]}
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if re.match(r"/v1/projects/\w+/functions/ghl-docs-import$", p): return self._send(200 if S["up"] else 404, {})
        if re.match(r"/v1/projects/\w+/api-keys", p): return self._send(200, [{"name": "anon", "api_key": ANONK}, {"name": "service_role", "api_key": SVCK}])
        self._send(404, {})
    def do_DELETE(self): S["up"] = False; S["deleted"] += 1; self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); raw = self.rfile.read(n) or b"{}"; p = self.path
        if p.endswith("/database/query"):
            q = json.loads(raw)["query"]
            if "from public.caregiver_connect_runs" in q and "mode = 'live'" in q:
                return self._send(201, [] if M.get("not_live") else [{"at": "2026-10-04T05:17:30Z", "ok": True, "linked": 0, "moved": 4, "created": 8, "review": 0, "refused": 0, "error": None}])
            if "from public.caregiver_connect_runs order by" in q: return self._send(201, [{"at": "2026-10-04T05:17:30Z", "mode": "practice", "ok": True}])
            if "group by 1, 2" in q: return self._send(201, [{"action": "create", "result": "done", "n": 8}, {"action": "move", "result": "done", "n": 4}])
            if "result = 'refused'" in q: return self._send(201, [])
            if "having count(*) > 1" in q: return self._send(201, [{"n": 0}])
            if "to_regclass('public.prehire_docs')" in q: return self._send(201, [{"t": True, "n": 254}])
            if "count(*)::int as n from public.prehire_docs" in q: return self._send(201, [{"n": 254 + (0 if M.get("nothing") else 9)}])
            return self._send(201, [])
        if p.startswith("/fn/functions/v1/ghl-docs-import"):
            if self.headers.get("Authorization") != "Bearer " + SVCK: return self._send(401, {"error": "not allowed"})
            mode = json.loads(raw).get("mode")
            if M.get("nothing"): ppl = [person("Jo P.", "caregiver", "already imported")]
            elif mode == "live": ppl = [person("Quinn A.", "caregiver", "imported"), person("Casey M.", "caregiver", "already imported (under their Background & References record)")]
            else: ppl = [person("Quinn A.", "caregiver", "would import"), person("Casey M.", "caregiver", "already imported (under their Background & References record)"), person("Jo P.", "caregiver", "already imported"),
                         {"who": "Lizzie H.", "kind": "caregiver", "matched": False, "why": "no phone or email in the Hub", "checks": []}]
            return self._send(200, {"ok": True, "total_people": len(ppl), "next": None, "fields_found": ["edl"], "people": ppl})
        self._send(404, {})
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
tmp = tempfile.mkdtemp(prefix="t439-"); CLI = os.path.join(tmp, "supabase"); LOG = os.path.join(tmp, "log")
open(CLI, "w").write(f'#!/bin/sh\necho "$2 $3" >> "{LOG}"\ncurl -s -o /dev/null -X POST "{URL}/mark-up" ; exit 0\n'); os.chmod(CLI, 0o755)
_orig = Hd.do_POST
def _post(self):
    if self.path == "/mark-up": S["up"] = True; return self._send(200, {})
    return _orig(self)
Hd.do_POST = _post
def run(mode=None, auto="y", **over):
    M.clear(); M.update(mode or {}); S.update(up=False, deleted=0); open(LOG, "w").close()
    rep = os.path.join(tmp, "r.txt")
    if os.path.exists(rep): os.unlink(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_SUPA_CLI=CLI, SB_API_BASE=URL, SB_REPO=HERE, SB_SHAS=json.dumps(SHAS), SB_FN_BASE=URL + "/fn", SB_SETTLE="0", SB_AUTO=auto)
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(HERE, "ghl_docs_rerun_439.py")], env=env, capture_output=True, text=True)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), open(LOG).read().split("\n")
rc, r, d = run(); print(r)
ck("the first live run: counts, no doubles", "05:17 UTC: ok · connected 0, moved over 4, new records 8, need a look 0, refused 0" in r and "no AxisCare caregiver has two Hub records" in r, r)
ck("practice then copy: the new person's document; the moved one not again; the not-found listed", "Quinn A. (caregiver): EDL [✅ Clear]" in r and "1 new file(s) would be copied · 1 already in the Hub · 1 already in under the Background & References record" in r
   and "Lizzie H. (no phone or email in the Hub)" in r and "1 file(s) copied" in r and "now holds 263 file(s) (was 254)" in r, r)
ck("the import step went up once and was taken down", any("deploy ghl-docs-import" in x for x in d) and S["deleted"] >= 1 and "taken down again" in r and "RESULT: DONE" in r and "✗" not in r, [d, r])
ck("no email, key or token in the report", not re.search(r"eyJ|sbp_|@", r), r)
rc, r, d = run(auto="n"); ck("you say no: nothing copied, taken down", "nothing was copied" in r and "PART 4" not in r and S["deleted"] >= 1, r)
rc, r, d = run(mode={"not_live": True}); ck("not live yet: stops before anything, says to run after :17", rc == 0 and "hasn't run live yet" in r and not any("deploy" in x for x in d) and "PART 2" not in r, r)
rc, r, d = run(mode={"nothing": True}); ck("nothing new: says so, taken down, no question", "nothing new to copy" in r and "PART 4" not in r and S["deleted"] >= 1, r)
rc, r, d = run(SB_SHAS=json.dumps({"ghl-docs-import": "0" * 64, "_shared/job-auth": SHAS["_shared/job-auth"]})); ck("not the reviewed build: stops before putting it up", rc != 0 and "not the reviewed build" in r and not any("deploy" in x for x in d), r)
H.shutdown(); shutil.rmtree(tmp, ignore_errors=True)
for n, ok, note in res: print(("PASS " if ok else "FAIL ") + n + ("" if ok else "\n      " + note))
print("ALL %d CHECKS PASS" % len(res) if all(x[1] for x in res) else "FAILED"); sys.exit(0 if all(x[1] for x in res) else 1)
