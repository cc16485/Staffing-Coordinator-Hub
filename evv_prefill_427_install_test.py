#!/usr/bin/env python3
# Rehearsal of 427 against a FAKE Supabase (management API, REST, functions) and a FAKE supabase CLI. Never touches a
# real project and sends nothing. Run from the branch with the 427 commit:  python3 evv_prefill_427_install_test.py
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
FNS = ["evv-axiscare-check", "clockin-alert", "timekeeper-watch"]
pin = lambda k: os.path.join(HERE, f"supabase/functions/{k}.ts" if k.startswith("_shared/") else f"supabase/functions/{k}/index.ts")
SHAS = {k: sha(pin(k)) for k in FNS + ["_shared/evv-prefill"]}
PREVTXT = {fn: open(pin(fn)).read() + "\n// the build before 427\n" for fn in FNS}
PREV = {fn: hashlib.sha256(PREVTXT[fn].encode()).hexdigest() for fn in FNS}
SQL_SHA, PROOF_SHA = sha(os.path.join(HERE, "evv_prefill_427.sql")), sha(os.path.join(HERE, "evv_prefill_427_proof.sql"))
SQLTEXT, PROOFTEXT = open(os.path.join(HERE, "evv_prefill_427.sql")).read(), open(os.path.join(HERE, "evv_prefill_427_proof.sql")).read()
GOODPROOF = {"anon_read_table": "refused", "anon_insert_table": "refused",
  "get": {"status": "ok", "caregiver_name": "Proof427 Caregiver", "client_display": "Proof C."},
  "get_keys": ["actual_in", "actual_out", "caregiver_name", "client_display", "scheduled_in", "scheduled_out", "status", "visit_date", "which_missing"],
  "nosig": {"ok": False, "error": "invalid", "field": "sig_consumer"}, "submit": {"ok": True, "id": "x"}, "again": {"ok": False, "error": "used"},
  "get_used": {"status": "used"}, "get_expired": {"status": "expired"}, "submit_expired": {"ok": False, "error": "expired"}, "get_unknown": {"status": "not_found"},
  "saved": {"found": True, "cg": "proof427-cg", "cl": "proof427-cl", "visit": "proof427-visit", "linked_by": "axiscare-visit", "processed": False, "outcome": None, "attendant": "Proof427 Caregiver"},
  "link_used": True, "link_points_to_form": True, "plain_wiped": True}
SW = {"timekeeper_watch_live": True, "timekeeper_text_live": True, "timekeeper_admin_loop_live": False, "evv_chase_live": False, "missed_clockin_after_hours": None,
      "office_quiet_start": None, "office_quiet_end": None, "timekeeper_clockout_grace_min": None, "msg_out": None}
VJ = {"evv-axiscare-check": True, "clockin-alert": False, "timekeeper-watch": False}
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1400]))
S = {}; MODE = {}
def reset(): S.clear(); S.update(sql=[], applied=False, patched=[], dry=0)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if m := re.match(r"/v1/projects/\w+/functions/([\w-]+)$", p): return self._send(200, {"verify_jwt": VJ.get(m.group(1), False), "version": 5})
        if re.match(r"/v1/projects/\w+/api-keys", p): return self._send(200, [{"name": "anon", "api_key": "eyJanonKEY"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
        if p.startswith("/fn/rest/v1/evv_prefill"): return self._send(200 if MODE.get("anon_reads") else 401, [{"id": "x"}] if MODE.get("anon_reads") else {"code": "42501"})
        if p.startswith("/form"):
            if MODE.get("form_live"): self.send_response(200); self.end_headers(); self.wfile.write(b"<script>const EVVPRE = 1</script>"); return
            self.send_response(200); self.end_headers(); self.wfile.write(b"<html>old form</html>"); return
        self._send(404, {})
    def do_PATCH(self): S["patched"].append(self.path); self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p == "/mark": return self._send(200, {})
        if p.startswith("/fn/rest/v1/rpc/evv_prefill_get"): return self._send(200, {"status": "not_found"})
        if p.startswith("/fn/rest/v1/rpc/evv_submit_prefilled"): return self._send(200, {"ok": False, "error": "not_found"})
        if p.startswith("/fn/functions/v1/clockin-alert"): return self._send(401, {"error": "This link is not valid or has expired."})
        if p.startswith("/fn/functions/v1/timekeeper-watch"):
            if "eyJsvcKEY" in (self.headers.get("Authorization") or "") and "dry=1" in p:
                S["dry"] += 1; return self._send(200, {"mode": "DRY RUN", "visits_seen": 4})
            return self._send(401, {"error": "not allowed"})
        if re.match(r"/v1/projects/\w+/database/query", p):
            q = body["query"]; S["sql"].append(q)
            if q == SQLTEXT:
                if MODE.get("sqlfail"): return self._send(400, {"message": "boom"})
                S["applied"] = True; return self._send(201, [])
            if q == PROOFTEXT: return self._send(400, {"message": "ERROR: P0001: PROBE_RESULT: " + json.dumps(dict(GOODPROOF, **MODE.get("proof", {})))})
            if "information_schema.columns" in q:
                cols = [{"c": "id", "t": "uuid"}, {"c": "visitdate", "t": "date"}, {"c": "new_in", "t": "text"}] + ([] if MODE.get("no422") else [{"c": "axiscare_visit_id", "t": "text"}])
                return self._send(200, cols)
            if "tableowner" in q: return self._send(200, [{"owner": MODE.get("owner", "postgres"), "me": "postgres", "bypass": False, "forced": False}])
            if "to_regclass('public.evv_prefill')" in q: return self._send(200, [{"t": S["applied"], "f": 0}])
            if q.startswith("select t.tgname"): return self._send(200, [{"tgname": "hook", "calls_out": True}] if MODE.get("webhook") else [])
            if "data->'timekeeper_watch_live'" in q:
                sw = dict(SW, **MODE.get("sw", {}))
                if MODE.get("sw_changes") and S["applied"]: sw["timekeeper_text_live"] = False
                return self._send(200, [sw])
            if "has_table_privilege('anon', 'public.evv_prefill', 'SELECT') as a_sel" in q:
                return self._send(200, [{"a_sel": bool(MODE.get("anon_reads")), "a_ins": False, "s_sel": True, "s_upd": False, "a_get": True, "a_sub": True}])
            if "(select count(*) from public.evv_submissions)::int as n, (select count(*) from public.evv_prefill)::int as p" in q: return self._send(200, [{"n": 41, "p": 0}])
            if "attendant like 'Proof427%'" in q: return self._send(200, [{"n": 0}])
            if q.strip() == "select count(*)::int as n from public.evv_prefill": return self._send(200, [{"n": 3}])
            return self._send(400, {"message": "unexpected query " + q[:120]})
        self._send(404, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
tmp = tempfile.mkdtemp(prefix="t427-"); LOG = os.path.join(tmp, "cli.log"); STATE = os.path.join(tmp, "state"); PREVDIR = os.path.join(tmp, "prev")
for fn in FNS:
    os.makedirs(os.path.join(PREVDIR, fn), exist_ok=True); open(os.path.join(PREVDIR, fn, "index.ts"), "w").write(PREVTXT[fn])
CLI = os.path.join(tmp, "supabase")
open(CLI, "w").write(f"""#!/bin/sh
# fake CLI. download: before a deploy the live copy is the PREVIOUS build (426/422; LIVE=other: something else; LIVE=mine:
# already 427); after a deploy it is this build. deploy: logs it and marks it.
cmd="$2"; fn="$3"; root="{HERE}"
if [ "$cmd" = "download" ]; then
  mkdir -p "supabase/functions/$fn"; cp -R "$root/supabase/functions/_shared" supabase/functions/
  if [ -f "{STATE}/$fn" ] || [ "$LIVE" = "mine" ]; then cp "$root/supabase/functions/$fn/index.ts" "supabase/functions/$fn/index.ts"; exit 0; fi
  rm -f supabase/functions/_shared/evv-prefill.ts
  cp "{PREVDIR}/$fn/index.ts" "supabase/functions/$fn/index.ts"
  if [ "$LIVE" = "other" ] && [ "$fn" = "${{OTHERFN:-timekeeper-watch}}" ]; then echo "// something else" >> "supabase/functions/$fn/index.ts"; fi
  exit 0
fi
if [ "$cmd" = "deploy" ]; then
  if [ -n "$FAILFN" ] && [ "$fn" = "$FAILFN" ]; then echo "boom" >&2; exit 1; fi
  echo "$fn $*" >> "{LOG}"; mkdir -p "{STATE}"; touch "{STATE}/$fn"; exit 0
fi
exit 1
""")
os.chmod(CLI, 0o755)

def run(**over):
    reset(); open(LOG, "w").close(); shutil.rmtree(STATE, ignore_errors=True)
    rep = os.path.join(tmp, "report.txt")
    if os.path.exists(rep): os.unlink(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_faketoken123", SB_SUPA_CLI=CLI, SB_API_BASE=URL, SB_REPO=HERE, SB_SHAS=json.dumps(SHAS), SB_PREV=json.dumps(PREV),
               SB_SQL_SHA=SQL_SHA, SB_PROOF_SHA=PROOF_SHA, SB_FN_BASE=URL + "/fn", SB_FORM_URL=URL + "/form", SB_SKIP_TESTS="1")
    for k in ("LIVE", "OTHERFN", "FAILFN"): env.pop(k, None)
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(HERE, "evv_prefill_427.py")], env=env, capture_output=True, text=True)
    report = open(rep).read() if os.path.exists(rep) else ""
    return p.returncode, report, open(LOG).read(), p.stdout + p.stderr

MODE.clear(); MODE.update(form_live=True)
code, rep, cli, out = run()
ck("happy path: DONE, exit 0", code == 0 and "RESULT: DONE" in rep, out[-1800:])
ck("happy path: the SQL ran once, then the proof", S["sql"].count(SQLTEXT) == 1 and S["sql"].count(PROOFTEXT) == 1 and S["sql"].index(SQLTEXT) < S["sql"].index(PROOFTEXT))
dl = [l.split()[0] for l in cli.strip().splitlines()]
ck("happy path: the three functions deployed once each, in order, each keeping its gateway setting", dl == FNS
   and all(("--no-verify-jwt" in l) == (not VJ[l.split()[0]]) for l in cli.strip().splitlines()) and not S["patched"], cli)
ck("happy path: 426 confirmed live first; the owner check; the clock-out wording; the switches reported", "426 is live" in rep and "can write it" in rep and "built-in wording" in rep and "This installer changes none of them" in rep, rep)
ck("happy path: every proof line passes; the public key over the web; the dry run made no link; switches unchanged; the new form live",
   "ONLY: caregiver name, client first name + last initial" in rep and "the made-up 'evil' claims were ignored" in rep and "one use only" in rep and "cannot read the link table (401)" in rep
   and "'not found' only (200)" in rep and "saves nothing (200)" in rep and "makes no link" in rep and S["dry"] == 1 and "exactly as they were" in rep and "is the new form" in rep, rep[-1400:])
ck("happy path: the live functions are the reviewed builds", all(f"{fn}: the live copy is exactly the reviewed build" in rep for fn in FNS), rep)
ck("no secret is ever printed (token, keys)", not re.search(r"sbp_faketoken123|eyJanonKEY|eyJsvcKEY", rep + out), re.findall(r"(sbp_\w+|eyJ\w+)", rep + out))
ck("nothing is ever texted: the only function calls are the refused ones and one dry run", "conversations" not in rep and S["dry"] == 1)

MODE.clear()
code, rep, cli, out = run(LIVE="other")
ck("426 not run (timekeeper-watch live is something else): STOP before any change", code == 3 and SQLTEXT not in S["sql"] and not cli and "Run Desktop 426 first" in rep, rep)
code, rep, cli, out = run(LIVE="other", OTHERFN="evv-axiscare-check")
ck("evv-axiscare-check not the 422 build: STOP before any change", code == 3 and SQLTEXT not in S["sql"] and not cli, rep)
code, rep, cli, out = run(LIVE="mine")
ck("already this build live: nothing redeployed, still proved", code == 0 and not cli and rep.count("already had it") == 3 and PROOFTEXT in S["sql"], rep + cli)
ck("the form not merged yet: said as ATTENTION, not a failure", "not the new form yet" in rep and "RESULT: DONE" in rep, rep)

MODE.clear(); MODE.update(no422=True)
code, rep, cli, out = run()
ck("422 not run: STOP before any change", code == 3 and SQLTEXT not in S["sql"] and not cli, rep)
MODE.clear(); MODE.update(owner="supabase_admin")
code, rep, cli, out = run()
ck("the forms table belongs to another role: STOP before any change (the save would fail)", code == 3 and SQLTEXT not in S["sql"] and not cli and "could not save" in rep, rep)
MODE.clear(); MODE.update(sw={"msg_out": "Hi {first_name}, clock out please."})
code, rep, cli, out = run()
ck("her own clock-out wording without the form link: said (nothing added)", "has no form link, so that reminder stays as it is" in rep and code == 0, rep)

MODE.clear()
code, rep, cli, out = run(SB_SQL_SHA="0" * 64)
ck("a changed SQL file: STOP before anything", code == 2 and not S["sql"] and not cli and "not the reviewed version" in rep, rep)
code, rep, cli, out = run(SB_SHAS=json.dumps(dict(SHAS, **{"_shared/evv-prefill": "0" * 64})))
ck("a changed function file: STOP before anything", code == 2 and not S["sql"] and not cli, rep)
code, rep, cli, out = run(SB_PREV="{}")
ck("the expected live builds not pinned: STOP before anything", code == 2 and not S["sql"] and not cli, rep)

MODE.clear(); MODE.update(sqlfail=True)
code, rep, cli, out = run()
ck("the SQL fails: STOP (code 4), no function deployed, no proof", code == 4 and not cli and PROOFTEXT not in S["sql"], rep)
MODE.clear()
code, rep, cli, out = run(FAILFN="clockin-alert")
ck("a deploy fails: the ones before it stay, the rest are not tried, PARTLY DONE", code == 1 and [l.split()[0] for l in cli.strip().splitlines()] == ["evv-axiscare-check"] and "PARTLY DONE" in rep, rep + cli)

MODE.clear(); MODE.update(proof={"plain_wiped": False})
code, rep, cli, out = run()
ck("a proof line failing: PARTLY DONE, exit 1", code == 1 and "PARTLY DONE" in rep and "✗ the plain public form still arrives unlinked" in rep, rep)
MODE.clear(); MODE.update(anon_reads=True)
code, rep, cli, out = run()
ck("the public able to read the link table: a ✗", code == 1 and "✗ the database change is in" in rep and "✗ over the web, the public key cannot read the link table" in rep, rep)
MODE.clear(); MODE.update(webhook=True)
code, rep, cli, out = run()
ck("a trigger on the forms table that calls out: the in-database proof is skipped and said", PROOFTEXT not in S["sql"] and "was NOT run" in rep, rep)
MODE.clear(); MODE.update(sw_changes=True)
code, rep, cli, out = run()
ck("a switch changing while it runs: reported as a ✗ (this installer never writes one)", code == 1 and "✗ every switch" in rep, rep)
code, rep, cli, out = run(SB_TOKEN="nope")
ck("no token: stops, report still written", code == 2 and "no Supabase access token" in rep)

failed = [r for r in res if not r[1]]
for n, ok, note in res: print(("PASS  " if ok else "FAIL  ") + n + ("" if ok else "\n      " + note))
print(f"\n{len(res) - len(failed)}/{len(res)} passed" + (" · FAIL" if failed else ""))
sys.exit(1 if failed else 0)
