#!/usr/bin/env python3
# Rehearsal of 422 against a FAKE Supabase (management API, REST, the function) and a FAKE supabase CLI. Never touches a
# real project. Run from the branch with the 422 commit:  python3 evv_forms_422_install_test.py
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib
HERE = os.path.dirname(os.path.abspath(__file__))
REF = "zngsgedlsxinbygwmxwn"
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
FNP = os.path.join(HERE, "supabase/functions/evv-axiscare-check/index.ts"); SAP = os.path.join(HERE, "supabase/functions/_shared/staff-auth.ts")
SHAS = {"evv-axiscare-check": sha(FNP), "_shared/staff-auth": sha(SAP)}
SQL_SHA, PROOF_SHA = sha(os.path.join(HERE, "evv_forms_422.sql")), sha(os.path.join(HERE, "evv_forms_422_proof.sql"))
SQLTEXT, PROOFTEXT = open(os.path.join(HERE, "evv_forms_422.sql")).read(), open(os.path.join(HERE, "evv_forms_422_proof.sql")).read()
GOODPROOF = {"anon_insert": "sent", "anon_read": "refused", "wiped": True, "staff_read": 1, "staff_update": 1, "after": True,
             "anon_can": {"insert": True, "select": False, "update": False, "delete": False}, "staff_can": {"select": True, "update": True, "truncate": False}}
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1200]))
S = {}; MODE = {}
def reset():
    S.clear(); S.update(sql=[], deployed=False, patched=[], applied=False)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if m := re.match(r"/v1/projects/\w+/functions/([\w-]+)$", p):
            fn = m.group(1)
            if fn == "care-notes": return self._send(200, {"verify_jwt": MODE.get("vj", False), "version": 7})
            if fn == "evv-axiscare-check":
                if S["deployed"] or MODE.get("predeployed"): return self._send(200, {"verify_jwt": MODE.get("vj", False), "version": 1})
                return self._send(404, {"message": "not found"})
        if re.match(r"/v1/projects/\w+/api-keys", p): return self._send(200, [{"name": "anon", "api_key": "eyJanonKEY"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
        if re.match(r"/v1/projects/\w+/config/auth", p): return self._send(200, {"disable_signup": not MODE.get("signup_on")})
        if re.match(r"/v1/projects/\w+/secrets", p): return self._send(200, [{"name": "AXISCARE_API_KEY", "value": "x"}, {"name": "AXISCARE_SITE", "value": "x"}])
        if p.startswith("/fn/rest/v1/evv_submissions"): return self._send(200 if MODE.get("anon_reads") else 401, [{"id": "x"}] if MODE.get("anon_reads") else {"code": "42501", "message": "permission denied"})
        if p.startswith("/hub/evv-form.html"):
            if MODE.get("hub_live"): self.send_response(200); self.end_headers(); self.wfile.write(b"<script>root.EVVPAGE = {}</script>"); return
            return self._send(404, {})
        self._send(404, {})
    def do_PATCH(self): S["patched"].append(self.path); self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/fn/functions/v1/evv-axiscare-check"):
            return self._send(200 if MODE.get("fn_open") else 401, {"error": "Sign in first."})
        if re.match(r"/v1/projects/\w+/database/query", p):
            q = body["query"]; S["sql"].append(q)
            if q == SQLTEXT:
                if MODE.get("sqlfail"): return self._send(400, {"message": "boom"})
                S["applied"] = True; return self._send(201, [])
            if q == PROOFTEXT:
                J = dict(GOODPROOF, **MODE.get("proof", {}))
                return self._send(400, {"message": "ERROR: P0001: PROBE_RESULT: " + json.dumps(J)})
            if "information_schema.columns" in q: return self._send(200, [{"c": "attendant,consumer,id,processed,sig_attendant,sig_consumer" + (",client_axiscare_id" if S["applied"] else "")}])
            if "count(*) filter (where not processed)" in q: return self._send(200, [{"total": 41, "waiting": 3, "processed": 38, "both_sigs": 30, "caregiver_only": 11, "first": "2026-07-01 10:00", "last": "2026-10-02 09:00"}])
            if q.startswith("select policyname"): return self._send(200, [{"policyname": "anon_insert_evv_submissions", "cmd": "INSERT", "roles": "{anon}", "q": ""}])
            if "has_table_privilege(r.rolname" in q:
                if S["applied"]: return self._send(200, [{"role": "anon", "privs": "INSERT"}, {"role": "authenticated", "privs": "DELETE, SELECT, UPDATE"}])
                return self._send(200, [{"role": "anon", "privs": "INSERT"}, {"role": "authenticated", "privs": "DELETE, INSERT, SELECT, TRUNCATE, UPDATE"}])
            if q.startswith("select t.tgname"): return self._send(200, [{"tgname": "hook", "proname": "x", "calls_out": True}] if MODE.get("webhook") else [])
            if "to_regclass('cron.job')" in q: return self._send(200, [{"has_cron": True}])
            if q.startswith("select jobname"): return self._send(200, [])
            if "from cron.job where command ilike" in q: return self._send(200, [{"n": 1 if MODE.get("purge_job") else 0}])
            if q.startswith("select p.proname"): return self._send(200, [])
            if "storage.objects" in q: return self._send(200, [{"n": 9}])
            if q.startswith("select count(*)::int as n, coalesce(md5"): return self._send(200, [{"n": 41, "m": "abc"}])
            if "attendant like 'Proof422%'" in q: return self._send(200, [{"n": 0}])
            return self._send(400, {"message": "unexpected query " + q[:90]})
        self._send(404, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
tmp = tempfile.mkdtemp(prefix="t422-"); LOG = os.path.join(tmp, "cli.log"); STATE = os.path.join(tmp, "deployed")
CLI = os.path.join(tmp, "supabase")
open(CLI, "w").write(f"""#!/bin/sh
# fake CLI. download: the deployed build is the local one (OLD_LIVE=1: something else); deploy: logs + marks deployed.
cmd="$2"; fn="$3"; root="{HERE}"
if [ "$cmd" = "download" ]; then
  if [ ! -f "{STATE}" ] && [ -z "$PREDEPLOYED" ]; then exit 1; fi
  mkdir -p "supabase/functions/$fn" "supabase/functions/_shared"
  cp "$root/supabase/functions/$fn/index.ts" "supabase/functions/$fn/index.ts"; cp "$root/supabase/functions/_shared/staff-auth.ts" supabase/functions/_shared/
  if [ -n "$OLD_LIVE" ] && [ ! -f "{STATE}" ]; then echo "// older" >> "supabase/functions/$fn/index.ts"; fi
  exit 0
fi
if [ "$cmd" = "deploy" ]; then echo "$fn $*" >> "{LOG}"; touch "{STATE}"; curl -s -o /dev/null -X POST "{URL}/mark-deployed" || true; exit 0; fi
exit 1
""")
os.chmod(CLI, 0o755)
_orig_post = H.do_POST
def _post(self):
    if self.path == "/mark-deployed": S["deployed"] = True; return self._send(200, {})
    return _orig_post(self)
H.do_POST = _post

def run(**over):
    reset(); open(LOG, "w").close()
    if os.path.exists(STATE): os.unlink(STATE)
    rep = os.path.join(tmp, "report.txt")
    if os.path.exists(rep): os.unlink(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_faketoken123", SB_SUPA_CLI=CLI, SB_API_BASE=URL, SB_REPO=HERE, SB_SHAS=json.dumps(SHAS),
               SB_SQL_SHA=SQL_SHA, SB_PROOF_SHA=PROOF_SHA, SB_FN_BASE=URL + "/fn", SB_HUB_URL=URL + "/hub/", SB_SKIP_TESTS="1")
    if MODE.get("predeployed"): env["PREDEPLOYED"] = "1"
    if MODE.get("old_live"): env["OLD_LIVE"] = "1"
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(HERE, "evv_forms_422.py")], env=env, capture_output=True, text=True)
    report = open(rep).read() if os.path.exists(rep) else ""
    return p.returncode, report, open(LOG).read(), p.stdout + p.stderr

MODE.clear(); MODE.update(hub_live=True)
code, rep, cli, out = run()
ck("happy path: DONE, exit 0", code == 0 and "RESULT: DONE" in rep, out[-1500:])
ck("happy path: the SQL ran once, then the proof", S["sql"].count(SQLTEXT) == 1 and S["sql"].count(PROOFTEXT) == 1 and S["sql"].index(SQLTEXT) < S["sql"].index(PROOFTEXT))
ck("happy path: the new function deployed once, sign-in check copied from care-notes (off -> --no-verify-jwt)", len(cli.strip().splitlines()) == 1 and "--no-verify-jwt" in cli, cli)
ck("happy path: counts, retention, sign-up and secrets are reported", "forms on file: 41 (3 waiting, 38 processed); with BOTH signatures: 30" in rep and "nothing in the database deletes forms" in rep
   and "new sign-ups are OFF" in rep and "AxisCare key and site number are set" in rep, rep)
ck("happy path: proof lines all pass, public key refused over the web, function refuses without staff sign-in, hub page live",
   "arrives waiting and unlinked" in rep and "public key cannot read forms (401)" in rep and "refuses without a staff sign-in (no sign-in: 401" in rep and "evv-form.html is live" in rep, rep)
ck("no secret is ever printed (token, keys)", not re.search(r"sbp_faketoken123|eyJanonKEY|eyJsvcKEY", rep + out), re.findall(r"(sbp_\w+|eyJ\w+)", rep + out))

MODE.clear(); MODE.update(vj=True)
code, rep, cli, out = run()
ck("care-notes with the gateway sign-in check ON: the new function is deployed with it on too", code == 0 and "--no-verify-jwt" not in cli and len(cli.strip().splitlines()) == 1, cli)
ck("hub branch not merged yet: said, not a failure", "not live yet" in rep and "RESULT: DONE" in rep, rep)

MODE.clear()
code, rep, cli, out = run(SB_SQL_SHA="0" * 64)
ck("a changed SQL file: STOP before anything, nothing run or deployed", code == 2 and SQLTEXT not in S["sql"] and not cli and "not the reviewed version" in rep, rep)
code, rep, cli, out = run(SB_SHAS=json.dumps(dict(SHAS, **{"evv-axiscare-check": "0" * 64})))
ck("a changed function: STOP before anything", code == 2 and not S["sql"] and not cli, rep)

MODE.clear(); MODE.update(sqlfail=True)
code, rep, cli, out = run()
ck("the SQL fails: STOP (code 4), the function is not deployed, no proof", code == 4 and not cli and PROOFTEXT not in S["sql"], rep)

MODE.clear(); MODE.update(predeployed=True)
code, rep, cli, out = run()
ck("already the reviewed build live: not deployed again", code == 0 and not cli and "already had the reviewed build" in rep, rep + cli)
MODE.clear(); MODE.update(predeployed=True, old_live=True)
code, rep, cli, out = run()
ck("an older build live: replaced by the reviewed one", code == 0 and len(cli.strip().splitlines()) == 1, rep + cli)

MODE.clear(); MODE.update(signup_on=True, purge_job=True)
code, rep, cli, out = run()
ck("sign-ups ON and a purge job: both reported as ATTENTION, nothing about them changed", "new sign-ups are ON" in rep and "something may delete forms" in rep and code == 0, rep)

MODE.clear(); MODE.update(proof={"wiped": False})
code, rep, cli, out = run()
ck("a proof line failing: PARTLY DONE, exit 1", code == 1 and "PARTLY DONE" in rep and "arrives waiting and unlinked" in rep, rep)
MODE.clear(); MODE.update(anon_reads=True, fn_open=True)
code, rep, cli, out = run()
ck("the public able to read, or the function open: each a ✗", code == 1 and "✗ over the web, the public key cannot read" in rep and "✗ the AxisCare check refuses" in rep, rep)
MODE.clear(); MODE.update(webhook=True)
code, rep, cli, out = run()
ck("a trigger on the table that calls out: the in-database proof is skipped and said", PROOFTEXT not in S["sql"] and "was NOT run" in rep, rep)
code, rep, cli, out = run(SB_TOKEN="nope")
ck("no token: stops, report still written", code == 2 and "no Supabase access token" in rep)

failed = [r for r in res if not r[1]]
for n, ok, note in res: print(("PASS  " if ok else "FAIL  ") + n + ("" if ok else "\n      " + note))
print(f"\n{len(res) - len(failed)}/{len(res)} passed" + (" · FAIL" if failed else ""))
sys.exit(1 if failed else 0)
