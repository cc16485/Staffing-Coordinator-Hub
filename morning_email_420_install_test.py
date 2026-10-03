#!/usr/bin/env python3
# Rehearsal of 420 against a FAKE Supabase (management API + the function) and a FAKE supabase CLI. Never touches a real
# project. Run from the branch with the 420 commit:  python3 morning_email_420_install_test.py
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib
HERE = os.path.dirname(os.path.abspath(__file__))
REF = "zngsgedlsxinbygwmxwn"
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
git = lambda *a: subprocess.run(["git", *a], cwd=HERE, capture_output=True, text=True).stdout.strip()
BASE = git("merge-base", "HEAD", "origin/main")
SHAS = {"lead-digest": sha(os.path.join(HERE, "supabase/functions/lead-digest/index.ts"))}
SQL_SHA = sha(os.path.join(HERE, "morning_email_420.sql"))
SQLTEXT = open(os.path.join(HERE, "morning_email_420.sql")).read()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
OLD = {"daily-lead-digest": "45 11 * * 1-5", "daily-lead-digest-winter": "45 12 * * 1-5"}
S = {}
MODE = {}
def reset():
    S.clear(); S.update(sql=[], fncalls=[], keyq=[], seq=[], jobs={k: {"jobname": k, "schedule": v, "active": True, "cmd": "md5-" + k} for k, v in OLD.items()})
    if MODE.get("extra_job"): S["jobs"]["lead-digest-test"] = {"jobname": "lead-digest-test", "schedule": "* * * * *", "active": True, "cmd": "x"}
    if MODE.get("odd_time"): S["jobs"]["daily-lead-digest"]["schedule"] = "0 12 * * *"
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if m := re.match(r"/v1/projects/(\w+)/functions/([\w-]+)$", p): return self._send(200, {"verify_jwt": True, "version": 50})
        if m := re.match(r"/v1/projects/(\w+)/api-keys(\?reveal=true)?$", p):
            S["keyq"].append(p)
            return self._send(200, [{"name": "anon", "api_key": "eyJanon" + m.group(1)}, {"name": "service_role", "api_key": "eyJsvc" + m.group(1)}])
        if p.startswith("/fn/functions/v1/lead-digest"):
            auth = self.headers.get("Authorization", ""); S["fncalls"].append((p, auth))
            if "auth_check=1" in p and auth == "Bearer eyJsvc" + REF: return self._send(200, {"ok": True, "caller": "owner"})
            return self._send(401, {"error": "not allowed"})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if re.match(r"/v1/projects/(\w+)/database/query", p):
            q = body["query"]; S["sql"].append(q)
            if q == SQLTEXT:
                S["seq"].append("schedule")
                if MODE.get("sqlfail"): return self._send(400, {"message": "boom"})
                S["jobs"]["daily-lead-digest"]["schedule"] = "0 13 * * 1-5"; S["jobs"]["daily-lead-digest-winter"]["schedule"] = "0 14 * * 1-5"
                if MODE.get("cmd_changed"): S["jobs"]["daily-lead-digest"]["cmd"] = "different"
                return self._send(201, [])
            if q.startswith("select jobname, schedule, active, md5(command)"): return self._send(200, sorted(S["jobs"].values(), key=lambda j: j["jobname"]))
            if "information_schema.columns" in q: return self._send(200, [{"table_name": "interview_bookings", "c": "applicant_id,id,starts_at,status"}, {"table_name": "job_applicants", "c": "first_name,id,last_name"}])
            if q.startswith("select count(*) filter (where status in"): return self._send(200, [{"today": 3, "pm": 2}])
            return self._send(400, {"message": "unexpected query " + q[:80]})
        self._send(404, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
tmp = tempfile.mkdtemp(prefix="t420-"); LOG = os.path.join(tmp, "cli.log"); STATE = os.path.join(tmp, "deployed")
CLI = os.path.join(tmp, "supabase")
open(CLI, "w").write(f"""#!/bin/sh
# fake CLI: download gives the reviewed starting point's copy until a deploy, then the local build. BAD_LIVE=1: unknown code.
cmd="$2"; fn="$3"; root="{HERE}"; base="{BASE}"
if [ "$cmd" = "download" ]; then
  mkdir -p "supabase/functions/$fn" "supabase/functions/_shared"
  if grep -qx "$fn" "{STATE}" 2>/dev/null; then
    cp "$root/supabase/functions/$fn/index.ts" "supabase/functions/$fn/index.ts"; cp "$root"/supabase/functions/_shared/*.ts supabase/functions/_shared/
  else
    git -C "$root" show "$base:supabase/functions/$fn/index.ts" > "supabase/functions/$fn/index.ts"
    for f in $(git -C "$root" ls-tree --name-only "$base" supabase/functions/_shared/); do git -C "$root" show "$base:$f" > "$f"; done
    if [ -n "$BAD_LIVE" ]; then echo "// hand edit" >> "supabase/functions/$fn/index.ts"; fi
  fi
  exit 0
fi
if [ "$cmd" = "deploy" ]; then echo "$fn $*" >> "{LOG}"; echo "$fn" >> "{STATE}"; echo deploy >> "{tmp}/seq"; exit 0; fi
exit 1
""")
os.chmod(CLI, 0o755)

def run(**over):
    reset(); open(LOG, "w").close(); open(STATE, "w").close(); open(os.path.join(tmp, "seq"), "w").close(); rep = os.path.join(tmp, "report.txt")
    if os.path.exists(rep): os.unlink(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_SUPA_CLI=CLI, SB_API_BASE=URL, SB_REPO=HERE, SB_BASE=BASE,
               SB_SHAS=json.dumps(SHAS), SB_SQL_SHA=SQL_SHA, SB_FN_BASE=URL + "/fn")
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(HERE, "morning_email_420.py")], env=env, capture_output=True, text=True)
    deps = [l.split()[0] for l in open(LOG).read().splitlines()]
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), deps

code, rep, dep = run()
open(os.environ.get("REHEARSAL_OUT", "/dev/null"), "w").write(rep)
ck("rehearsal: DONE, exit 0", code == 0 and "RESULT: DONE" in rep, rep[-2000:])
ck("the four test files ran and passed inside the installer", rep.count("(run here, against fakes; nothing sent)") == 4, rep[:2500])
seq = S["seq"] + open(os.path.join(tmp, "seq")).read().split()
ck("order: the schedule times FIRST, then lead-digest", seq == ["schedule", "deploy"] and dep == ["lead-digest"], seq)
L = open(LOG).read().splitlines()
ck("lead-digest keeps its gateway sign-in check (on): deployed without --no-verify-jwt", len(L) == 1 and "--no-verify-jwt" not in L[0], L)
writes = [q for q in S["sql"] if re.search(r"\b(insert|update|delete|alter|create|drop|grant|truncate|alter_job)\b", q, re.I)]
ck("the only writing SQL is the reviewed morning_email_420.sql, once", len(writes) == 1 and writes[0] == SQLTEXT, [w[:60] for w in writes])
ck("the report shows the schedules before and after, commands unchanged", "daily-lead-digest: now '45 11 * * 1-5' (on)" in rep and "daily-lead-digest: '0 13 * * 1-5', command unchanged, still on" in rep
   and "daily-lead-digest-winter: '0 14 * * 1-5', command unchanged, still on" in rep, rep)
ck("the report shows today's interview count and when the next brief goes", "interviews on today's list (Chicago): 3, of them 2pm or later (Samantha's): 2" in rep and "8:00am Central" in rep, rep)
calls = S["fncalls"]
ck("proof calls only: the public key twice (refused) and the server key on auth_check (returns before reading or sending)",
   len(calls) == 3 and calls[0][1].startswith("Bearer eyJanon") and "force=1" in calls[1][0] and "auth_check=1" in calls[2][0] and all("to=" not in c[0] for c in calls), calls)
ck("proof: the live copy is exactly the reviewed build", "lead-digest: the live copy is now exactly the reviewed build" in rep and "✗" not in rep, rep[-1500:])
ck("the report hides keys and says nothing was sent", not re.search(r"eyJ\w|sbp_\w", rep) and "Nothing was texted or emailed by this installer." in rep)
ck("keys asked with ?reveal=true first", S["keyq"] and S["keyq"][0].endswith("?reveal=true"), S["keyq"])

MODE["sqlfail"] = True; code, rep, dep = run(); MODE.clear()
ck("the schedule change fails: STOP, lead-digest NOT deployed", code == 4 and not dep, [code, dep, rep[-400:]])
MODE["extra_job"] = True; code, rep, dep = run(); MODE.clear()
ck("a third lead-digest schedule nobody expected: STOP before anything changes", code == 3 and not dep and "schedule" not in S["seq"], [code, rep[-400:]])
MODE["odd_time"] = True; code, rep, dep = run(); MODE.clear()
ck("a schedule at an unexpected time: STOP before anything changes", code == 3 and not dep and "schedule" not in S["seq"], [code, rep[-400:]])
MODE["cmd_changed"] = True; code, rep, dep = run(); MODE.clear()
ck("a schedule command that changed under us: PARTLY DONE, named", code == 1 and "PARTLY DONE" in rep and "daily-lead-digest: '0 13 * * 1-5', command unchanged" in rep and "✗" in rep, rep[-900:])
code, rep, dep = run(BAD_LIVE="1")
ck("a live copy that is not today's GitHub main: NOT deployed, said (schedules already at 8am; old code still sends 6-9am)", code == 4 and not dep and "is not today's GitHub main" in rep and "arrives at 8am Central" in rep, [code, dep, rep[-600:]])
code, rep, dep = run(SB_SQL_SHA="0" * 64)
ck("an SQL file that isn't the reviewed one: STOP before anything changes", code == 2 and not dep and not S["seq"], [code, rep[-300:]])
code, rep, dep = run(SB_SHAS=json.dumps({"lead-digest": "0" * 64}))
ck("a function file that isn't the reviewed build: STOP before anything changes", code == 2 and not dep and not S["seq"], [code, rep[-300:]])
code, rep, dep = run(SB_SHAS=json.dumps({}))
ck("an unpinned changed file: STOP", code == 2 and not dep and "isn't the reviewed list" in rep, [code, rep[-300:]])
code, rep, dep = run(SB_BASE="")
ck("no reviewed starting point: STOP", code == 2 and not dep, [code, dep])
src = open(os.path.join(HERE, "morning_email_420.py")).read() + SQLTEXT
ck("no em dash in the installer's or the SQL's words", "—" not in src, re.findall(r".{30}—.{30}", src)[:3])

srv.shutdown()
allok = True; print("\n420 · INSTALLER REHEARSAL (fake Supabase, fake CLI)\n" + "=" * 50)
for n, g, note in res: allok &= g; print(("PASS  " if g else "FAIL  ") + n + ("" if g else "\n   └─ " + note))
print(f"ALL {len(res)} CHECKS PASS" if allok else "FAILED"); sys.exit(0 if allok else 1)
