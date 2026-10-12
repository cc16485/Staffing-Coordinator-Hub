#!/usr/bin/env python3
# Rehearsal of 671 (reference_land_671.py) against a FAKE Supabase (management API, the function), a FAKE cc.mo-care.com
# and a FAKE supabase CLI. Never touches a real project.   python3 reference_land_671_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
FP = "a0d4d5e47ac82f08e35028b10db68a4d21f73902ce28908f7b2fa3d3b94fc671"
S = {}; M = {}
REPORT = {"ok": True, "mode": "report", "wrote_nothing": True, "counts": {"seen": 3, "would_land": 2, "waiting_for_next_run": 0, "skipped": 1, "negatives": 1, "alerts_would_open": 1, "alerts_held_too_old": 0, "would_replace_a_status": 0},
          "would_land": [{"request_id": "q1", "candidate_id": "c1", "name": "Ann Able", "slot": 1, "current_status": "Pending", "score": "Positive", "responded_at": "2026-10-11T10:00:00Z", "negative": False, "alert": "none", "replaces_status": False},
                         {"request_id": "q2", "candidate_id": "c2", "name": "Bo Bright", "slot": 2, "current_status": "(blank)", "score": "Negative", "responded_at": "2026-10-10T10:00:00Z", "negative": True, "alert": "opens", "replaces_status": False}],
          "skipped": [{"request_id": "q3aaaaaaaa", "candidate_id": "c9", "slot": 1, "reason": "not_hired", "why": "the person is marked not hired"}], "limits": {"batch": 50, "negative_alert_max_age_days": 14}}
def reset(**m):
    S.clear(); S.update(sql=[], posts=[]); M.clear()
    M.update(dict(vault=1, sw=None, elig=2, cols=4, install="ok", door_ssn_refused=True, anon_ok=False, old_rules=False, changed=False, fnlive=404), **m)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = (obj if isinstance(obj, bytes) else json.dumps(obj).encode()); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if p.startswith("/eligibility-rules.js"): return self._send(200, b"/* the older rules file */")
        if "/api-keys" in p: return self._send(200, [{"name": "anon", "api_key": "eyJanonKEY"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
        if re.match(r"/v1/projects/\w+/functions/reference-land$", p):
            S["fn_gets"] = S.get("fn_gets", 0) + 1
            if M["fnlive"] == 404 and S["fn_gets"] == 1: return self._send(404, {})
            return self._send(200, {"version": 1, "verify_jwt": True})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/functions/v1/reference-land"):
            auth = self.headers.get("Authorization"); S["posts"].append((p, auth, body))
            if auth != "Bearer eyJsvcKEY" and not M["anon_ok"]: return self._send(401, {"error": "not allowed"})
            if body.get("mode") == "apply": return self._send(200, {"ok": True, "off": True})
            if M["old_rules"]: return self._send(200, {"ok": True, "mode": "report", "wrote_nothing": True, "rules_missing_landing": True, "message": "the Hub's rules file does not have the reference landing yet; merge the Hub pull request and run the report again"})
            return self._send(200, REPORT)
        q = body["query"]; S["sql"].append(q)
        if "671 · REFERENCE ANSWERS LAND BY THEMSELVES" in q and "create or replace function" in q:
            return self._send(400, {"message": "ERROR: refused"}) if M["install"] == "fail" else self._send(201, [])
        if "from public.rules_approved where file = 'eligibility-rules.js') as elig" in q:
            return self._send(200, [{"elig": M["elig"], "mine": 0, "vault": M["vault"], "job": 0, "sw": "not set" if M["sw"] is None else M["sw"], "cols": M["cols"]}])
        if q.startswith("select (select jsonb_array_length(data) from app_data where key = 'candidates') as cands"):
            S["counts"] = S.get("counts", 0) + 1
            row = {"cands": 12, "upd": "2026-10-12 10:00:00+00", "hist": 40, "waiting": 3, "landed": 5, "sw": "not set"}
            if M["changed"] and S["counts"] > 1: row["landed"] = 6
            return self._send(200, [row])
        if q.startswith("insert into public.rules_approved"): return self._send(200, [])
        if "cron.unschedule" in q: return self._send(200, [])
        if "cron.schedule(" in q: return self._send(200, [{"id": 9}])
        if "reference_land_apply('671-proof-nobody', 1, 0, '{\"ssn\"" in q: return self._send(400, {"message": "not a field"}) if M["door_ssn_refused"] else self._send(200, [{"r": {"ok": True}}])
        if "reference_land_apply('671-proof-nobody'" in q: return self._send(200, [{"r": {"ok": False, "reason": "no_candidate"}}])
        if "has_function_privilege" in q: return self._send(200, [{"a": False, "b": False}])
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
tmp = tempfile.mkdtemp(prefix="t671-")
FAKEBIN = os.path.join(tmp, "bin"); os.makedirs(FAKEBIN); LOG = os.path.join(tmp, "cli.log")
open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil
a = sys.argv[1:]; open({LOG!r}, 'a').write(' '.join(a) + '\\n')
if a[:2] == ['functions', 'deploy']: sys.exit(0)
if a[:2] == ['functions', 'download']:
    shutil.copytree(os.path.join({HERE!r}, 'supabase', 'functions'), os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True); sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
FN = ["reference-land/index.ts", "_shared/reference-land.ts", "_shared/job-auth.ts", "_shared/staff-auth.ts", "_shared/approved-rules.ts"]
FNSHAS = {f: sha(os.path.join(HERE, "supabase/functions", f)) for f in FN}
def run(env_over=None, **mode):
    reset(**mode); rep = os.path.join(tmp, "r.txt")
    if os.path.exists(LOG): os.remove(LOG)
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, PATH=FAKEBIN + ":/usr/bin:/bin", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_HUB_BASE=URL, SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"),
               SB_FNROOT=os.path.join(HERE, "supabase/functions"), SB_FN_SHAS=json.dumps(FNSHAS), SB_SQL_SHA=sha(os.path.join(HERE, "supabase/reference-land-671.sql")), SB_RULES_FP=FP, PYTHONPATH=HERE)
    env.update(env_over or {})
    p = subprocess.run(["python3", os.path.join(HERE, "reference_land_671.py")], env=env, capture_output=True, text=True, timeout=180)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
installed = lambda: any("671 · REFERENCE ANSWERS LAND BY THEMSELVES" in q and "create or replace function" in q for q in S["sql"])
cli = lambda: open(LOG).read() if os.path.exists(LOG) else ""
c, out = run()
ck("happy path: exit 0, ends RESULT: DONE then the next step", c == 0 and "RESULT: DONE" in out and out.strip().splitlines()[-1].startswith("NEXT: merge the Hub pull request") and "Reference answers land by themselves" in out.strip().splitlines()[-1], out)
order = [i for i, q in enumerate(S["sql"]) if "create or replace function public.reference_land_apply" in q] + [i for i, q in enumerate(S["sql"]) if q.startswith("insert into public.rules_approved")] + [i for i, q in enumerate(S["sql"]) if "cron.schedule(" in q]
ck("order: the door, then the fingerprint approval, then deploy, then the schedule", len(order) == 3 and order == sorted(order) and "functions deploy reference-land" in cli() and "--no-verify-jwt" not in cli(), [order, cli()])
ap = [q for q in S["sql"] if q.startswith("insert into public.rules_approved")]
ck("the new fingerprint is approved by insert, the older ones untouched (no delete, no update of other rows)", len(ap) == 1 and FP in ap[0] and "'eligibility-rules.js'" in ap[0] and not any(re.search(r"delete from public\.rules_approved|update public\.rules_approved", q) for q in S["sql"]), ap)
sc = [q for q in S["sql"] if "cron.schedule(" in q]
ck("the schedule: every 15 minutes, apply mode, the vault secret, never the server key", len(sc) == 1 and "*/15 * * * *" in sc[0] and '\\"mode\\": \\"apply\\"' in json.dumps(sc[0]) and "hub_job_secret" in sc[0] and "eyJsvcKEY" not in sc[0], sc)
ck("the switch is never set by the step", not any("ref_land_live" in q and re.search(r"update public\.app_data|jsonb_set|\|\|", q) for q in S["sql"]), [q for q in S["sql"] if "ref_land_live" in q])
ck("the report is printed with names, scores, the card it would open, and the skipped reason", "Ann Able · reference 1 · now Pending → Positive" in out and "Bo Bright · reference 2 · now (blank) → Negative" in out and "opens a card for today" in out and "the person is marked not hired" in out, out)
ck("proofs pass: refuses a stranger, switch-off run changes nothing, door refuses ssn, server only, nothing changed", "refuses a caller with neither" in out and "a run changes nothing" in out and "refuses a field" in out and "only the server may call the door" in out and "is unchanged" in out and "still off" in out, out)
ck("the report and the switch-off check run as the owner's server key; no key is printed", all(a == "Bearer eyJsvcKEY" for p_, a, b in S["posts"] if b.get("mode") and a != "Bearer ") and "eyJsvcKEY" not in out and "eyJanonKEY" not in out and "sbp_test" not in out, out)
c, out = run(old_rules=True)
ck("the Hub still serves the old rules file: the report says so in her words, still DONE", c == 0 and "does not have the reference landing yet; merge the Hub pull request and run the report again" in out, out)
c, out = run(sw="true")
ck("the switch already on: STOP before anything changes", c == 3 and "already ON" in out and not installed() and "deploy" not in cli(), out)
c, out = run(vault=0)
ck("the jobs' vault secret missing: STOP before anything changes", c == 3 and not installed(), out)
c, out = run(elig=0)
ck("no approved eligibility rules at all: STOP before anything changes", c == 3 and not installed(), out)
c, out = run(cols=3)
ck("reference_requests missing a column: STOP before anything changes", c == 3 and not installed(), out)
c, out = run(env_over={"SB_FN_SHAS": json.dumps(dict(FNSHAS, **{"_shared/reference-land.ts": "0" * 64}))})
ck("a file that is not the reviewed build: STOP, no query at all", c == 2 and not S["sql"], out)
c, out = run(env_over={"SB_SQL_SHA": "0" * 64})
ck("the door SQL not the reviewed build: STOP before anything changes", c == 3 and not installed(), out)
c, out = run(install="fail")
ck("the door refused: STOP, nothing approved, nothing deployed, no schedule", c == 5 and "deploy" not in cli() and not any(q.startswith("insert into public.rules_approved") or "cron.schedule(" in q for q in S["sql"]), out)
c, out = run(door_ssn_refused=False)
ck("the door letting an ssn through: reported", c == 9 and "ssn was not refused" in out, out)
c, out = run(anon_ok=True)
ck("a stranger getting in: reported", c == 9 and "a caller with no key got 200" in out, out)
c, out = run(changed=True)
ck("a reference answer marked landed during the step: reported", c == 9 and "something changed" in out, out)
shutil.rmtree(tmp, ignore_errors=True)
failed = [r for r in res if not r[1]]
for n, ok, note in res: print(("PASS  " if ok else "FAIL  ") + n + ("" if ok else "\n      " + note))
print(f"\n{len(res) - len(failed)}/{len(res)} passed" + (" · FAIL" if failed else ""))
raise SystemExit(1 if failed else 0)
