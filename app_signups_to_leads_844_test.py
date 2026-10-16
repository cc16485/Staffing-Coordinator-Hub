#!/usr/bin/env python3
# Rehearsal of 844 against a FAKE Supabase and supabase CLI. Never touches a real project.
import json, os, subprocess, tempfile, threading, http.server, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900])); S = {}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self): return self._send(200, {"slug": "lead-intake", "verify_jwt": S["vj"]})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); q = json.loads(self.rfile.read(n))["query"]; S["sql"].append(q)
        if q.startswith("select count(*)::int as n from public.early_interest where site"): return self._send(200, [{"n": 2}])
        if "begin;" in q: S["moved"] = not S["sqlfail"]; return self._send(400 if S["sqlfail"] else 201, [] if not S["sqlfail"] else {"message": "boom"})
        if "lead_id is not null" in q: return self._send(200, [{"n": 2 if S["moved"] else 0}])
        if "intent_tags" in q: return self._send(200, [{"n": 2 if S["moved"] else 0}])
        self._send(400, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"; TMP = tempfile.mkdtemp(); BIN = os.path.join(TMP, "supabase")
FILES = ["supabase/functions/lead-intake/index.ts", "app_signups_to_leads.sql"]; PINS = {f: sha(os.path.join(HERE, f)) for f in FILES}
def run(deploy_fail=False, vj=False, sqlfail=False, pins=PINS):
    S.clear(); S.update(sql=[], moved=False, vj=vj, sqlfail=sqlfail); rep = os.path.join(TMP, "r.txt")
    open(BIN, "w").write("#!/bin/sh\necho \"$@\" >> %s/log\nexit %d\n" % (TMP, 1 if deploy_fail else 0)); os.chmod(BIN, 0o755)
    if os.path.exists(f"{TMP}/log"): os.remove(f"{TMP}/log")
    p = subprocess.run(["python3", os.path.join(HERE, "app_signups_to_leads_844.py")], env=dict(os.environ, SB_TOKEN="sbp_t", SB_REPORT=rep, SB_API_BASE=URL, SB_SUPA_CLI=BIN,
        SB_REPO=HERE, SB_PINS=json.dumps(pins)), capture_output=True, text=True, timeout=60)
    log = open(f"{TMP}/log").read() if os.path.exists(f"{TMP}/log") else ""
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), log
c, out, log = run()
ck("1 good run: lead-intake deployed with no sign-in check, 2 earlier sign-ups moved", c == 0 and "--no-verify-jwt" in log and "2 earlier sign-ups moved" in out and "844: DONE" in out, out)
c, out, log = run(deploy_fail=True)
ck("2 deploy fails: stops before moving anyone", c == 1 and not S["moved"], out)
c, out, log = run(vj=True)
ck("3 lead-intake came back WITH a sign-in check (forms would break): stops before moving anyone", c == 1 and not S["moved"], out)
c, out, log = run(sqlfail=True)
ck("4 the move is refused: reported, nothing moved", c == 1 and "nothing moved" in out, out)
c, out, log = run(pins={FILES[0]: "0" * 64, FILES[1]: PINS[FILES[1]]})
ck("5 not the reviewed build: nothing done", c == 2 and not S["sql"] and not log, out)
for n, okk, note in res: print(("  ✓ " if okk else "  ✗ ") + n + ("" if okk else "\n" + note))
print(f"\n  844 rehearsal: {sum(1 for r in res if r[1])}/{len(res)} passed"); raise SystemExit(0 if all(r[1] for r in res) else 1)
