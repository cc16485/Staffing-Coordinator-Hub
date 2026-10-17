#!/usr/bin/env python3
# Rehearsal of 881 (family_app_release2_881.py): FAKE Supabase (management API, SQL, the three doors) and a FAKE supabase CLI.
# Never touches GitHub, Supabase or a real site. Runs from a fresh copy of this folder's committed build (her rule).
#   python3 family_app_release2_881_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1600]))
TMP = tempfile.mkdtemp(prefix="t881-"); BIN = os.path.join(TMP, "bin"); os.makedirs(BIN); COPY = os.path.join(TMP, "hub")
subprocess.run(["git", "clone", "-q", HERE, COPY], check=True)
subprocess.run(["git", "-C", COPY, "checkout", "-q", subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()], check=True)
FNROOT = os.path.join(COPY, "supabase", "functions")
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
SHAS = {k: sha(os.path.join(FNROOT, k)) for k in ("_shared/family-sync.ts", "_shared/family-app.ts", "_shared/family-offer.ts", "_shared/family-offer-db.ts", "family-gateway/index.ts", "family-offer/index.ts")}
S = {}; M = {}
def reset(**m):
    S.clear(); S.update(calls=[], sql=[], settings={"family_app_live": True, "family_offer_live": True}, cols=0)
    M.clear(); M.update(dict(sql_fail=False, deploy_fail="", gw_401=True, offer_401=True, offer_403=True, sync_error=False, gates={"family-gateway": False, "family-offer": False}), **m)
    for f in ("deploys",):
        if os.path.exists(os.path.join(TMP, f)): os.remove(os.path.join(TMP, f))
    open(os.path.join(TMP, "mode.json"), "w").write(json.dumps(M))
def deployed():
    out = []; dp = os.path.join(TMP, "deploys")
    if os.path.exists(dp): out = [json.loads(ln) for ln in open(dp).read().splitlines()]
    return out
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def _body(self):
        n = int(self.headers.get("Content-Length") or 0); return json.loads(self.rfile.read(n) or b"null")
    def do_OPTIONS(self): S["calls"].append(("OPTIONS", self.path)); self._send(200, "ok")
    def do_GET(self):
        p = self.path; S["calls"].append(("GET", p))
        if "/api-keys" in p: return self._send(200, [{"name": "anon", "api_key": "eyJanonHUB"}, {"name": "service_role", "api_key": "eyJsvcHUB"}])
        if m := re.match(r"/v1/projects/zngsgedlsxinbygwmxwn/functions/([\w-]+)$", p):
            g = dict(M["gates"])
            for fn, vj in deployed(): g[fn] = vj
            return self._send(200, {"verify_jwt": g[m.group(1)], "version": 9}) if m.group(1) in g else self._send(404, {})
        self._send(404, {})
    def do_PATCH(self): S["calls"].append(("PATCH", self.path)); self._send(200, {})
    def do_POST(self):
        p = self.path; b = self._body(); S["calls"].append(("POST", p, b))
        if p.endswith("/database/query"):
            q = b["query"]; S["sql"].append(q)
            if "to_regclass('public.family_bookings') is not null as tbl" in q: return self._send(200, [{"tbl": True, "live": "true", "offers": "true"}])
            if "status = 'placed' and axiscare_visit_id is not null" in q: return self._send(200, [{"n": 3}])
            if "begin;" in q and "family_change_pending" in q:
                if M["sql_fail"]: return self._send(400, {"message": "syntax error"})
                S["cols"] = 9; S["settings"].update(family_cgchange_text_approved={"by": "Samantha"}, family_timechange_text_approved={"by": "Samantha"}); return self._send(201, [])
            if "information_schema.columns" in q:
                st = S["settings"]; return self._send(200, [{"cols": S["cols"], "cg": (st.get("family_cgchange_text_approved") or {}).get("by"), "tm": (st.get("family_timechange_text_approved") or {}).get("by")}])
            return self._send(201, [])
        if p.startswith("/functions/v1/family-gateway"): return self._send(401 if M["gw_401"] else 200, {"error": "Please sign in again."})
        if p.startswith("/functions/v1/family-offer"):
            if "o" in (b or {}): return self._send(403 if M["offer_403"] else 200, {"error": "This link has ended"})
            if (self.headers.get("Authorization") or "") == "Bearer eyJsvcHUB" and "dry=1" in p: return self._send(200, {"ok": True, "bookings": 2, "sync": {"error": "boom"} if M["sync_error"] else {"checked": 3, "same": 2, "unreadable": 1, "would": [{"booking": "x", "caregiver": True}]}})
            return self._send(401 if M["offer_401"] else 200, {"error": "not allowed"})
        self._send(404, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
open(os.path.join(BIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, json, os, shutil
a = sys.argv[1:]; M = json.load(open({os.path.join(TMP, 'mode.json')!r}))
if os.environ.get('SUPABASE_ACCESS_TOKEN') != 'sbp_test': sys.exit(1)
if a[:2] == ['functions', 'deploy']:
    if M['deploy_fail'] == a[2]: print('deploy failed'); sys.exit(1)
    open({os.path.join(TMP, 'deploys')!r}, 'a').write(json.dumps([a[2], '--no-verify-jwt' not in a]) + '\\n'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    shutil.copytree({FNROOT!r}, os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True); sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(BIN, "supabase"), 0o755)
def run(shas=SHAS, main_ref="HEAD", **mode):
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_STEP="881", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_SUPA_CLI=os.path.join(BIN, "supabase"),
               SB_FNROOT=FNROOT, SB_SHAS=json.dumps(shas), SB_MAIN_REF=main_ref, SB_NODE=shutil.which("node") or "")
    env.pop("SUPABASE_ACCESS_TOKEN", None)
    p = subprocess.run(["python3", os.path.join(COPY, "family_app_release2_881.py")], cwd=COPY, env=env, capture_output=True, text=True, timeout=600)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
writes = lambda: [q for q in S["sql"] if not re.match(r"\s*select ", q)]

c, out = run()
ck("1 good run: database, two doors, proofs", c == 0 and "881: DONE" in out and "✗" not in out, out)
ck("1b the door first, then the run, each keeping its live gateway setting; the office door untouched", deployed() == [["family-gateway", False], ["family-offer", False]], deployed())
ck("1c the database change ran once, before any door, with both approvals", len(writes()) == 1 and "family_cgchange_text_approved" in writes()[0] and "family_timechange_text_approved" in writes()[0], writes())
ck("1d says how many confirmed app visits are checked, and what the dry run read", "3 confirmed app visit(s) in the next 14 days" in out and "read 3 confirmed app visit(s), 2 unchanged, 1 it would update" in out and "didn't answer for 1 visit" in out, out)
ck("1e no key or token in the report", not re.search(r"eyJsvcHUB|eyJanon|sbp_test", out), out)
c, out = run(shas={**SHAS, "_shared/family-sync.ts": "0" * 64})
ck("2 not the reviewed build: stops before anything", c == 2 and not deployed() and not writes(), out)
c, out = run(main_ref="HEAD~1")
ck("3 not merged yet (or newer work since): stops before anything", c == 2 and "merge the pull request first" in out and not deployed() and not writes(), out)
c, out = run(sql_fail=True)
ck("4 database change refused: no door is touched", c == 4 and not deployed() and "refused" in out, out)
c, out = run(deploy_fail="family-offer")
ck("5 a door fails: it stops there (the app door is in, the run unchanged)", c == 5 and deployed() == [["family-gateway", False]], (deployed(), out))
c, out = run(gw_401=False)
ck("6 a door that answers a stranger is reported, not DONE", c == 1 and "NOT COMPLETE" in out and "family-gateway answered a stranger" in out, out)
c, out = run(sync_error=True)
ck("7 the check failing in the dry run is reported, not DONE", c == 1 and "NOT COMPLETE" in out, out)

for n, okk, note in res: print(("  ✓ " if okk else "  ✗ ") + n + ("" if okk else "\n" + note))
print(f"\n  881 rehearsal: {sum(1 for r in res if r[1])}/{len(res)} passed")
shutil.rmtree(TMP, ignore_errors=True)
raise SystemExit(0 if all(r[1] for r in res) else 1)
