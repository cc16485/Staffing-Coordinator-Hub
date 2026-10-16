#!/usr/bin/env python3
# Rehearsal of Desktop 806/807 (ok_companion_806.py) from a fresh worktree of this commit, as the Desktop step runs it, against
# a FAKE Supabase (management API + functions), a FAKE supabase CLI, and a throwaway local Postgres holding the live rules
# (ok_companion_806_fixture.py). Never touches a real project.
#   HUB=<care-coordinator-hub checkout at origin/main> python3 ok_companion_806_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil, sys
HERE = os.path.dirname(os.path.abspath(__file__)); HUBROOT = os.environ.get("HUB", os.path.join(HERE, "..", "cc-hub-live"))
sys.path.insert(0, HERE)
from ok_companion_806_fixture import make
BASE_SHA = subprocess.run(["git", "-C", HERE, "merge-base", "HEAD", "origin/main"], capture_output=True, text=True).stdout.strip()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[-1500:]))
s, sock = make(HUBROOT)
as_rows = lambda q: s.run(q)
# made-up data already there before 806: a Missouri applicant and the opening list
s.run("""insert into job_applicants (first_name, last_name, phone, email, zip, position, status, completed_at, age_ok, work_auth, has_transport, one_year)
         values ('Mo', 'Before', '417-555-0101', 'mo.before@practice.invalid', '65714', 'caregiver', 'new', now(), true, true, true, 'yes')""")
s.run("insert into early_interest (site, kind, name, phone, email, zip, interests, timing, experience, may_contact) values "
      "('oklahoma','caregiver','Okla Listone','405-555-0181','l1@practice.invalid','73099',array['weekdays-all','drives'],'Early 2027','1 to 3 years',true),"
      "('oklahoma','caregiver','Okla Listtwo',null,'l2@practice.invalid','73064',null,'Spring 2027','Less than 1 year',true),"
      "('oklahoma','family','Fam Ily','405-555-0183',null,'73064',null,null,null,true)")
FNS = ["interview-messages", "applicant-text", "applicant-invite", "applicant-decision-msg", "applicant-noshow", "applicant-reengage",
       "reference-chase", "reference-send", "step2-handoff", "outreach-check", "bg-review", "caregiver-journey", "welcome-call",
       "send-candidate-message", "orientation-remind"]
VJ = {"applicant-invite": True, "applicant-text": True, "outreach-check": False, "interview-messages": False, "send-candidate-message": False}
M = {}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if m := re.match(r"/v1/projects/\w+/functions/([\w-]+)$", self.path):
            return self._send(200, {"version": 7, "verify_jwt": M.get("vj", {}).get(m.group(1), VJ.get(m.group(1), True))})
        self._send(404, {})
    def do_PATCH(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}")
        if m := re.match(r"/v1/projects/\w+/functions/([\w-]+)$", self.path): M.setdefault("vj", {})[m.group(1)] = body.get("verify_jwt")
        self._send(200, {})
    def do_POST(self): self._send(404, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t806-"); WT = os.path.join(TMP, "wt")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WT, "HEAD"], check=True)
BASE = os.path.join(TMP, "base"); os.makedirs(BASE)
subprocess.run(f"git -C {HERE} archive {BASE_SHA} supabase/functions | tar -x -C {BASE}", shell=True, check=True)
FAKEBIN = os.path.join(TMP, "bin"); os.makedirs(FAKEBIN); LOG = os.path.join(TMP, "cli.log"); os.makedirs(os.path.join(TMP, "deployed"))
open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil
a = sys.argv[1:]; open({LOG!r}, 'a').write(' '.join(a) + '\\n')
if a[:2] == ['functions', 'deploy']:
    if os.path.exists(os.path.join({TMP!r}, 'deployfail')) and a[2] == 'reference-chase': sys.exit(1)
    open(os.path.join({TMP!r}, 'deployed', a[2]), 'w').write('x'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    mine = os.path.exists(os.path.join({TMP!r}, 'deployed', a[2])) and not (os.path.exists(os.path.join({TMP!r}, 'deployfail')) and a[2] == 'reference-chase')
    src = os.path.join({WT!r} if mine else {BASE!r}, 'supabase', 'functions')
    shutil.copytree(src, os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True)
    if os.path.exists(os.path.join({TMP!r}, 'drift')) and a[2] == 'applicant-text' and not mine:
        open(os.path.join(os.getcwd(), 'supabase', 'functions', 'applicant-text', 'index.ts'), 'a').write('// someone else')
    sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
PIN = {"_shared/optout": sha(os.path.join(WT, "supabase/functions/_shared/optout.ts")),
       "interview-messages": sha(os.path.join(WT, "supabase/functions/interview-messages/index.ts")),
       "ok_companion_806.sql": sha(os.path.join(WT, "ok_companion_806.sql")),
       "ok_companion_806_rollback.sql": sha(os.path.join(WT, "ok_companion_806_rollback.sql"))}
SAVE = tempfile.mkdtemp(prefix="save806_")
def run(mode="install", env_over=None, keep_deployed=False, drift=False, deployfail=False):
    rep = os.path.join(TMP, "r.txt")
    os.path.exists(LOG) and os.remove(LOG); os.path.exists(rep) and os.remove(rep)
    if not keep_deployed: shutil.rmtree(os.path.join(TMP, "deployed")); os.makedirs(os.path.join(TMP, "deployed"))
    for flag, on in (("drift", drift), ("deployfail", deployfail)):
        fp = os.path.join(TMP, flag); (open(fp, "w").write("x") if on else (os.path.exists(fp) and os.remove(fp)))
    env = dict(os.environ, PATH=FAKEBIN + ":/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL,
               SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_REPO=WT, SB_BASE=BASE_SHA, SB_SHAS=json.dumps(PIN), SB_SETTLE="0", SB_RETRY="0",
               SB_LOCAL_SOCK=sock, SB_SAVE=SAVE, SB_MODE=mode)
    env.update(env_over or {})
    p = subprocess.run([sys.executable, os.path.join(WT, "ok_companion_806.py")], env=env, capture_output=True, text=True, timeout=900)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
cli = lambda: open(LOG).read() if os.path.exists(LOG) else ""
deploys = lambda: re.findall(r"functions deploy ([\w-]+)", cli())
rules = lambda: s.run("select md5(pg_get_functiondef('public.applicant_screen(uuid)'::regprocedure))")[0][0]
try:
    before = rules()
    c, out = run(env_over={"SB_SHAS": json.dumps(dict(PIN, **{"_shared/optout": "0" * 64}))})
    ck("not the reviewed build: stops before anything", c == 2 and not deploys() and "PART 2" not in out and rules() == before, out[-500:])
    c, out = run(drift=True)
    ck("a sender live with a change not from GitHub: stops, database untouched", c == 3 and not deploys() and "applicant-text" in out and rules() == before
       and s.run("select count(*) from information_schema.columns where table_name = 'job_applicants' and column_name = 'office'")[0][0] == 0, out[-700:])
    c, out = run("move")
    ck("807 before 806: refuses, moves nothing", c == 3 and "isn't in yet" in out, out[-400:])
    c, out = run()
    ck("clean run from a fresh copy: exit 0, 806 COMPLETE, nothing sent", c == 0 and "806 COMPLETE. Nothing was sent." in out, out[-2500:])
    ck("the send-door test runs in Part 1", re.search(r"optout_check_test\.mjs: ALL \d+ CHECKS PASS", out), out[:1500])
    ck("counts only: 1 applicant record, 2 caregivers on the list (not moved)", "1 applicant record(s)" in out and "2 caregiver(s) on the Oklahoma opening list (they are NOT moved" in out, out[:2500])
    ck("all 15 senders redeployed, each keeping its gateway setting", sorted(deploys()) == sorted(FNS)
       and all(("--no-verify-jwt" in l) == (VJ.get(l.split()[2], True) is False) for l in cli().splitlines() if l.startswith("functions deploy")), cli())
    for line in ["Companion is an Oklahoma position", "even when the form says otherwise", "measured from Mustang", "nothing more to ask before an interview",
                 "no automatic follow-ups for an Oklahoma applicant", "the send door holds their phone", "a Missouri applicant is exactly as before",
                 "can't use the hold or the move", "Oklahoma applicant messages are OFF", "nothing made-up was left behind", "with the Oklahoma hold"]:
        ck("proves: " + line, ("✓ " in out and line in out) and ("✗ " + line) not in out, out[-2500:])
    ck("tells her 2 are ready to move (807)", "2 caregiver(s) from the opening list are ready to move into the Hub" in out, out[-600:])
    ck("the existing Missouri applicant reads MO and kept its grade", s.run("select office from job_applicants where first_name = 'Mo'")[0][0] == "MO")
    ck("a copy of the live rules was saved for the undo", any(f == "live_functions.sql" for _, _, fs in os.walk(SAVE) for f in fs))
    ck("no names, numbers, emails or keys in the report", not re.search(r"Proof|Okla|405-555|@practice|sbp_", out), out)
    c, out = run(keep_deployed=True)
    ck("run again: recognises it is in, deploys nothing, proves again", c == 0 and not deploys() and "already 806" in out and "806 COMPLETE" in out, out[-900:])
    c, out = run("move")
    ck("807: moves the 2 caregivers, nobody contacted", c == 0 and "2 moved in as Oklahoma Companion applicants" in out and "MOVE COMPLETE. Nobody was texted or emailed." in out, out[-900:])
    ck("807: they are Oklahoma Companions in the Hub, call only", s.run("select count(*) from job_applicants where source = 'ok-opening-list' and office = 'OK' and position = 'companion' and sms_consent = false")[0][0] == 2)
    c, out = run("move")
    ck("807 again: nothing more to move", c == 0 and "0 caregiver(s) on the Oklahoma opening list to move in" in out and "0 moved in" in out, out[-600:])
    c, out = run("undo")
    ck("undo: the rules are back exactly as before 806", c == 0 and "back exactly as before 806" in out and rules() == before, out[-700:])
    ck("undo: the moved applicants stay (they are real applicants)", s.run("select count(*) from job_applicants where source = 'ok-opening-list'")[0][0] == 2)
    c, out = run(deployfail=True)
    ck("a sender that won't deploy: stops and says the database part is safe on its own", c == 6 and "didn't deploy" in out and "safe on its own" in out, out[-700:])
finally:
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", WT]); shutil.rmtree(TMP, ignore_errors=True)
for n, o, d in res: print(("PASS" if o else "FAIL") + " · " + n + ("" if o else "\n     " + d))
print(f"{sum(1 for r in res if r[1])}/{len(res)}")
raise SystemExit(0 if all(r[1] for r in res) else 1)
