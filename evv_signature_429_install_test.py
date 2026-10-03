#!/usr/bin/env python3
# Rehearsal of 429 against a FAKE Supabase (management API, REST, functions) and a FAKE supabase CLI. Never touches a
# real project and sends nothing. Run from the branch with the 429 commit:  python3 evv_signature_429_install_test.py
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
FNS = ["timekeeper-watch"]
pin = lambda k: os.path.join(HERE, f"supabase/functions/{k}.ts" if k.startswith("_shared/") else f"supabase/functions/{k}/index.ts")
SHAS = {k: sha(pin(k)) for k in FNS + ["_shared/evv-sign"]}
PREVTXT = {fn: open(pin(fn)).read() + "\n// the build before 429\n" for fn in FNS}
PREV = {fn: hashlib.sha256(PREVTXT[fn].encode()).hexdigest() for fn in FNS}
SQL_SHA, PROOF_SHA = sha(os.path.join(HERE, "evv_signature_429.sql")), sha(os.path.join(HERE, "evv_signature_429_proof.sql"))
SQLTEXT, PROOFTEXT = open(os.path.join(HERE, "evv_signature_429.sql")).read(), open(os.path.join(HERE, "evv_signature_429_proof.sql")).read()
GOODPROOF = {"nolater": {"ok": False, "error": "invalid", "field": "sig_consumer"}, "later": {"ok": True, "waiting": True}, "signed_now": {"ok": True, "waiting": False},
  "anon_read_sign": "refused", "get_keys": ["caregiver_name", "client_display", "new_in", "new_out", "notes", "orig_in", "orig_out", "reason", "sig_attendant", "status", "submitted_on", "tasks", "visit_date"],
  "noconf": {"ok": False, "error": "invalid", "field": "confirm"}, "sign": {"ok": True}, "again": {"ok": False, "error": "signed"}, "get_after": {"status": "signed"}, "unknown": {"status": "not_found"},
  "waiting_form": {"status_now": "signed", "via": "sign_link", "new_in": "09:00", "new_out": "13:00", "notes": "proof 429, never kept", "processed": False, "sig_attendant_kept": True},
  "signed_form": {"status": "signed", "via": "form"}, "plain_signed": "signed", "plain_waiting": "waiting", "plain_phone_wiped": True,
  "staff_direct": "refused,refused", "staff_accept_waiting": "refused", "phone": {"ok": True}, "accept_after_phone": 1, "dismiss": 1,
  "phone_row": {"by": "proof-429@invalid.test", "confirmed": True}, "anon_phone": "refused", "sign_link_done": True}
SW = {"timekeeper_watch_live": True, "timekeeper_text_live": True, "timekeeper_admin_loop_live": True, "evv_chase_live": False, "evv_next_visit_live": None, "missed_clockin_after_hours": None,
      "office_quiet_start": None, "office_quiet_end": None, "timekeeper_clockout_grace_min": None, "msg_out": None, "next_msg": None}
VJ = {"timekeeper-watch": False}
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1400]))
S = {}; MODE = {}
def reset(): S.clear(); S.update(sql=[], applied=False, patched=[], dry=0)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if m := re.match(r"/v1/projects/\w+/functions/([\w-]+)$", p): return self._send(200, {"verify_jwt": VJ.get(m.group(1), False), "version": 9})
        if re.match(r"/v1/projects/\w+/api-keys", p): return self._send(200, [{"name": "anon", "api_key": "eyJanonKEY"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
        if p.startswith("/fn/rest/v1/evv_sign"): return self._send(200 if MODE.get("anon_reads") else 401, [{"id": "x"}] if MODE.get("anon_reads") else {"code": "42501"})
        if p.startswith("/form"):
            self.send_response(200); self.end_headers(); self.wfile.write(b"<div class=\"later-box\"></div>" if MODE.get("pages_live") else b"<html>old form</html>"); return
        if p.startswith("/sign"):
            if MODE.get("pages_live"): self.send_response(200); self.end_headers(); self.wfile.write(b"<script>const EVVSIGN = 1</script>"); return
            return self._send(404, {})
        self._send(404, {})
    def do_PATCH(self): S["patched"].append(self.path); self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/fn/rest/v1/rpc/evv_sign_get"): return self._send(200, {"status": "not_found"})
        if p.startswith("/fn/rest/v1/rpc/evv_sign_submit"): return self._send(200, {"ok": False, "error": "not_found"})
        if p.startswith("/fn/rest/v1/rpc/evv_client_phone_record"): return self._send(200 if MODE.get("anon_phone") else 401, {"ok": False} if MODE.get("anon_phone") else {"code": "42501"})
        if p.startswith("/fn/functions/v1/timekeeper-watch"):
            if "eyJsvcKEY" in (self.headers.get("Authorization") or "") and "dry=1" in p:
                S["dry"] += 1; return self._send(200, {"mode": "DRY RUN", "evv_next_visit": {"live": False, "open": 0, "would_text": 0}, "evv_chase": {"ran": False, "why": "retired in 429: no morning text"}})
            return self._send(401, {"error": "not allowed"})
        if re.match(r"/v1/projects/\w+/database/query", p):
            q = body["query"]; S["sql"].append(q)
            if q == SQLTEXT:
                if MODE.get("sqlfail"): return self._send(400, {"message": "boom"})
                S["applied"] = True; return self._send(201, [])
            if q == PROOFTEXT: return self._send(400, {"message": "ERROR: P0001: PROBE_RESULT: " + json.dumps(dict(GOODPROOF, **MODE.get("proof", {})))})
            if "to_regclass('public.evv_prefill') is not null as pre" in q: return self._send(200, [{"pre": not MODE.get("no427"), "sign": S["applied"], "col": 0}])
            if "tableowner" in q: return self._send(200, [{"owner": MODE.get("owner", "postgres"), "me": "postgres", "bypass": False, "forced": False}])
            if q.startswith("select t.tgname"): return self._send(200, [{"tgname": "hook", "calls_out": True}] if MODE.get("webhook") else [])
            if "processed = false and coalesce(sig_consumer" in q: return self._send(200, [{"n": MODE.get("unsigned", 0)}])
            if "data->'timekeeper_watch_live'" in q:
                sw = dict(SW, **MODE.get("sw", {}))
                if MODE.get("sw_changes") and S["applied"]: sw["evv_next_visit_live"] = True
                return self._send(200, [sw])
            if "has_table_privilege('anon', 'public.evv_sign', 'SELECT') as a_sel" in q:
                return self._send(200, [{"a_sel": bool(MODE.get("anon_reads")), "a_ins": False, "s_sel": True, "s_upd": False, "a_get": True, "a_sub": True, "a_ph": bool(MODE.get("anon_phone")), "s_ph": True}])
            if "(select count(*) from public.evv_submissions)::int as n, (select count(*) from public.evv_sign)::int as s" in q: return self._send(200, [{"n": 41, "s": 0}])
            if "attendant like 'Proof429%'" in q: return self._send(200, [{"n": 0}])
            if "count(next_visit_practice_at)" in q: return self._send(200, [{"n": 2, "pr": 1, "tx": 0}])
            return self._send(400, {"message": "unexpected query " + q[:120]})
        self._send(404, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
tmp = tempfile.mkdtemp(prefix="t429-"); LOG = os.path.join(tmp, "cli.log"); STATE = os.path.join(tmp, "state"); PREVDIR = os.path.join(tmp, "prev")
for fn in FNS:
    os.makedirs(os.path.join(PREVDIR, fn), exist_ok=True); open(os.path.join(PREVDIR, fn, "index.ts"), "w").write(PREVTXT[fn])
CLI = os.path.join(tmp, "supabase")
open(CLI, "w").write(f"""#!/bin/sh
# fake CLI. download: before a deploy the live copy is the PREVIOUS build (427; LIVE=other: something else; LIVE=mine:
# already 429); after a deploy it is this build. deploy: logs it and marks it.
cmd="$2"; fn="$3"; root="{HERE}"
if [ "$cmd" = "download" ]; then
  mkdir -p "supabase/functions/$fn"; cp -R "$root/supabase/functions/_shared" supabase/functions/
  if [ -f "{STATE}/$fn" ] || [ "$LIVE" = "mine" ]; then cp "$root/supabase/functions/$fn/index.ts" "supabase/functions/$fn/index.ts"; exit 0; fi
  rm -f supabase/functions/_shared/evv-sign.ts
  cp "{PREVDIR}/$fn/index.ts" "supabase/functions/$fn/index.ts"
  if [ "$LIVE" = "other" ]; then echo "// something else" >> "supabase/functions/$fn/index.ts"; fi
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
               SB_SQL_SHA=SQL_SHA, SB_PROOF_SHA=PROOF_SHA, SB_FN_BASE=URL + "/fn", SB_FORM_URL=URL + "/form", SB_SIGN_URL=URL + "/sign", SB_SKIP_TESTS="1")
    for k in ("LIVE", "FAILFN"): env.pop(k, None)
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(HERE, "evv_signature_429.py")], env=env, capture_output=True, text=True)
    report = open(rep).read() if os.path.exists(rep) else ""
    return p.returncode, report, open(LOG).read(), p.stdout + p.stderr

MODE.clear(); MODE.update(pages_live=True)
code, rep, cli, out = run()
ck("happy path: DONE, exit 0", code == 0 and "RESULT: DONE" in rep, out[-1800:])
ck("happy path: the SQL ran once, then the proof", S["sql"].count(SQLTEXT) == 1 and S["sql"].count(PROOFTEXT) == 1 and S["sql"].index(SQLTEXT) < S["sql"].index(PROOFTEXT))
ck("happy path: only timekeeper-watch deployed, once, keeping its gateway setting (off)", [l.split()[0] for l in cli.strip().splitlines()] == FNS and "--no-verify-jwt" in cli and not S["patched"], cli)
ck("happy path: 427 confirmed first; the owner check; the built-in reminder wording; the switches reported",
   "427 is live" in rep and "can write it" in rep and "uses the built-in wording, so it now asks for the form before they leave" in rep and "This installer changes none of them" in rep, rep)
ck("happy path: every proof line passes; over the web; the dry run wrote nothing; switches unchanged (next-visit off); both pages live",
   "the caregiver can send her part" in rep and "only the caregiver's completed part" in rep and "could not be changed from the page" in rep and "the signed-in person as the caller" in rep
   and "cannot read the link table (401)" in rep and "'not found' only (200)" in rep and "saves nothing (200)" in rep and "cannot record a phone verification (401)" in rep
   and "morning chase retired" in rep and S["dry"] == 1 and "exactly as they were (evv_next_visit_live off, evv_chase_live off)" in rep and "is the new form" in rep and "client-signature page) is live" in rep, rep[-1800:])
ck("happy path: the live function is the reviewed build", "timekeeper-watch: the live copy is exactly the reviewed build" in rep, rep)
ck("happy path: says the next-visit text is OFF until she turns it on", "The next-visit text is OFF" in rep)
ck("no secret is ever printed (token, keys)", not re.search(r"sbp_faketoken123|eyJanonKEY|eyJsvcKEY", rep + out), re.findall(r"(sbp_\w+|eyJ\w+)", rep + out))
ck("nothing is ever texted: the only function calls are the refused one and one dry run", "conversations" not in rep and S["dry"] == 1)

MODE.clear(); MODE.update(sw={"msg_out": "Hi {first_name}, please clock out now."})
code, rep, cli, out = run()
ck("her own clock-out wording exists: reported, kept as it is", code == 0 and "she has her OWN clock-out wording" in rep and "Hi {first_name}, please clock out now." in rep, rep)
MODE.clear(); MODE.update(unsigned=3)
code, rep, cli, out = run()
ck("forms already waiting without a client signature: counted and explained", "3 form(s) waiting for the office have NO client signature" in rep, rep)
MODE.clear(); MODE.update(sw={"evv_chase_live": True})
code, rep, cli, out = run()
ck("evv_chase_live on: says it now only sends the Saturday office reminder", "only sends the Saturday office reminder" in rep, rep)
MODE.clear()
code, rep, cli, out = run()
ck("the pages not merged yet: said as ATTENTION, not a failure", "not the new form yet" in rep and "client-signature page is not live yet" in rep and "RESULT: DONE" in rep, rep)

MODE.clear()
code, rep, cli, out = run(LIVE="other")
ck("427 not live (timekeeper-watch is something else): STOP before any change", code == 3 and SQLTEXT not in S["sql"] and not cli and "Run Desktop 427 first" in rep, rep)
MODE.clear(); MODE.update(no427=True)
code, rep, cli, out = run()
ck("427's table missing: STOP before any change", code == 3 and SQLTEXT not in S["sql"] and not cli, rep)
MODE.clear()
code, rep, cli, out = run(LIVE="mine")
ck("already this build live: nothing redeployed, still proved", code == 0 and not cli and "already had it" in rep and PROOFTEXT in S["sql"], rep + cli)
MODE.clear(); MODE.update(owner="supabase_admin")
code, rep, cli, out = run()
ck("the forms table belongs to another role: STOP before any change", code == 3 and SQLTEXT not in S["sql"] and not cli and "could not save" in rep, rep)

MODE.clear()
code, rep, cli, out = run(SB_SQL_SHA="0" * 64)
ck("a changed SQL file: STOP before anything", code == 2 and not S["sql"] and not cli and "not the reviewed version" in rep, rep)
code, rep, cli, out = run(SB_SHAS=json.dumps(dict(SHAS, **{"_shared/evv-sign": "0" * 64})))
ck("a changed function file: STOP before anything", code == 2 and not S["sql"] and not cli, rep)
code, rep, cli, out = run(SB_PREV="{}")
ck("the expected live build not pinned: STOP before anything", code == 2 and not S["sql"] and not cli, rep)

MODE.clear(); MODE.update(sqlfail=True)
code, rep, cli, out = run()
ck("the SQL fails: STOP (code 4), no function deployed, no proof", code == 4 and not cli and PROOFTEXT not in S["sql"], rep)
MODE.clear()
code, rep, cli, out = run(FAILFN="timekeeper-watch")
ck("the deploy fails: PARTLY DONE, the proof still runs", code == 1 and "PARTLY DONE" in rep and PROOFTEXT in S["sql"], rep + cli)
MODE.clear(); MODE.update(proof={"staff_accept_waiting": "allowed"})
code, rep, cli, out = run()
ck("a proof line failing: PARTLY DONE, exit 1", code == 1 and "PARTLY DONE" in rep and "✗ staff cannot write a signature" in rep, rep)
MODE.clear(); MODE.update(anon_reads=True)
code, rep, cli, out = run()
ck("the public able to read the link table: a ✗", code == 1 and "✗ the database change is in" in rep and "✗ over the web, the public key cannot read the link table" in rep, rep)
MODE.clear(); MODE.update(anon_phone=True)
code, rep, cli, out = run()
ck("the public able to record a phone call: a ✗", code == 1 and "✗ over the web, the public key cannot record a phone verification" in rep, rep)
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
