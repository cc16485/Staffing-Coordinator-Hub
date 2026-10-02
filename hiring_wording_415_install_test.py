#!/usr/bin/env python3
# Rehearsal of 415 against a FAKE Supabase (management API, both projects' functions) and a FAKE supabase CLI.
# Never touches a real project. Needs the Training Platform checked out at the reviewed build (hiring-wording-3):
#   SB_TR_ROOT=/path/to/training python3 hiring_wording_415_install_test.py
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib, glob
HERE = os.path.dirname(os.path.abspath(__file__)); TR = os.path.abspath(os.environ["SB_TR_ROOT"]) if os.environ.get("SB_TR_ROOT") else ""
JO_SRC = os.path.join(TR, "supabase/functions/job-offer/index.ts") if TR else ""
if not JO_SRC or not os.path.exists(JO_SRC) or "Step 4: Paid Training From Home" not in open(JO_SRC).read():
    print("SKIP: set SB_TR_ROOT to the Training Platform at the reviewed build (hiring-wording-3)"); sys.exit(0)
HUB, TP = "zngsgedlsxinbygwmxwn", "rdqujxiycycwhskyvrwa"
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
git = lambda root, *a: subprocess.run(["git", *a], cwd=root, capture_output=True, text=True).stdout.strip()
HUB_BASE, TR_BASE = git(HERE, "merge-base", "HEAD", "origin/main"), git(TR, "merge-base", "HEAD", "origin/main")
HUB_SHAS = {"send-candidate-message": sha(os.path.join(HERE, "supabase/functions/send-candidate-message/index.ts"))}
TR_SHAS = {"job-offer": sha(os.path.join(TR, "supabase/functions/job-offer/index.ts"))}
SQL_SHA = sha(os.path.join(HERE, "hiring_wording_415.sql"))
LINE = "One 20-minute in-person interview at our office, then your paperwork, welcome call and 6 hours of paid training all from home on your phone or computer."
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:700]))

S = {}
def reset(): S.clear(); S.update(sql=[], fncalls=[], keyq=[], applied=False)
MODE = {"keys": "ok", "sqlfail": False, "dirty_after": False}
CLEAN = [{"slug": "caregiver-springfield", "status": "published", "summary": "x", "description": "Hello.\n\n" + LINE, "responsibilities": None, "qualifications": None, "benefits": "Paid orientation and dementia training"},
         {"slug": "prn-cna-springfield", "status": "draft", "summary": None, "description": "Apply in about 2 minutes.\n\n" + LINE, "responsibilities": None, "qualifications": None, "benefits": None}]
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if m := re.match(r"/v1/projects/(\w+)/functions/([\w-]+)$", p): return self._send(200, {"verify_jwt": m.group(2) not in ("send-candidate-message", "job-offer")})
        if m := re.match(r"/v1/projects/(\w+)/api-keys(\?reveal=true)?$", p):
            S["keyq"].append(p)
            if MODE["keys"] == "no-reveal" and m.group(2): return self._send(400, {"message": "unknown param"})
            return self._send(200, [{"name": "anon", "api_key": "eyJanon" + m.group(1)}, {"name": "service_role", "api_key": "eyJsvc" + m.group(1)}])
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if m := re.match(r"/v1/projects/(\w+)/database/query", p):
            q = body["query"]; S["sql"].append((m.group(1), q))
            if q.lstrip().startswith("-- ====") and "begin;" in q:
                if MODE["sqlfail"]: return self._send(400, {"message": "syntax error"})
                S["applied"] = True; return self._send(201, [])
            if "information_schema.columns" in q: return self._send(200, [{"table_name": "job_postings", "n": 5}, {"table_name": "job_templates", "n": 5}])
            if q.startswith("select count(*) filter") and "job_postings" in q: return self._send(200, [{"n": 6, "pub": 5, "total": 8}])
            if q.startswith("select count(*) filter") and "job_templates" in q: return self._send(200, [{"n": 2, "total": 3}])
            if q.startswith("select id, name"): return self._send(200, [{"id": "t1", "name": "Caregiver", "description": "Old"}])
            if q.startswith("select id, slug, status"): return self._send(200, [{"id": "p1", "slug": "caregiver-springfield", "status": "published", "description": "Old"}])
            if q.startswith("select slug, status"):
                rows = [dict(r) for r in CLEAN]
                if MODE["dirty_after"]: rows[0]["benefits"] = "Ongoing paid training, including dementia and Alzheimer's care"
                return self._send(200, rows)
            if q.startswith("select name,"): return self._send(200, [{"name": "Caregiver", "summary": None, "description": "A.\n\n" + LINE, "responsibilities": None, "qualifications": None, "benefits": None}])
            if q.startswith("select (select count(*)"): return self._send(200, [{"n": 0 if S["applied"] and not MODE["dirty_after"] else 3}])
            return self._send(400, {"message": "unexpected query " + q[:80]})
        if p == "/hub/functions/v1/send-candidate-message":
            S["fncalls"].append(("hub-scm", body))
            return self._send(404, {"error": "no matching booking"}) if body.get("kind") == "orientation_confirmation" else self._send(401, {"error": "Sign in"})
        if p == "/tp/functions/v1/job-offer":
            S["fncalls"].append(("tp-job-offer", body, self.headers.get("x-hub-token")))
            return self._send(401, {"error": "Sign in to the Hub first."})
        self._send(404, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
tmp = tempfile.mkdtemp(prefix="t415-"); LOG = os.path.join(tmp, "cli.log"); STATE = os.path.join(tmp, "deployed")
CLI = os.path.join(tmp, "supabase")
open(CLI, "w").write(f"""#!/bin/sh
# fake CLI: download gives the reviewed starting point's copy (known GitHub code) until a deploy, then the local build;
# deploy is logged. BAD_LIVE=1 makes the live copy unknown code.
cmd="$2"; fn="$3"; ref="$5"
if [ "$ref" = "{HUB}" ]; then root="{HERE}"; base="{HUB_BASE}"; else root="{TR}"; base="{TR_BASE}"; fi
if [ "$cmd" = "download" ]; then
  mkdir -p "supabase/functions/$fn" "supabase/functions/_shared"
  if grep -qx "$ref $fn" "{STATE}" 2>/dev/null; then
    cp "$root/supabase/functions/$fn/index.ts" "supabase/functions/$fn/index.ts"; cp "$root"/supabase/functions/_shared/*.ts supabase/functions/_shared/
  else
    git -C "$root" show "$base:supabase/functions/$fn/index.ts" > "supabase/functions/$fn/index.ts"
    for f in $(git -C "$root" ls-tree --name-only "$base" supabase/functions/_shared/); do git -C "$root" show "$base:$f" > "$f"; done
    if [ -n "$BAD_LIVE" ]; then echo "// hand edit" >> "supabase/functions/$fn/index.ts"; fi
  fi
  exit 0
fi
if [ "$cmd" = "deploy" ]; then echo "$ref $fn $*" >> "{LOG}"; echo "$ref $fn" >> "{STATE}"; exit 0; fi
exit 1
""")
os.chmod(CLI, 0o755)

def run(**over):
    reset(); open(LOG, "w").close(); open(STATE, "w").close(); rep = os.path.join(tmp, "report.txt")
    for f in glob.glob(os.path.join(tmp, "Hiring wording 415 before*.json")): os.unlink(f)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_SUPA_CLI=CLI, SB_API_BASE=URL, SB_HUB_ROOT=HERE, SB_TR_ROOT=TR,
               SB_HUB_BASE=HUB_BASE, SB_TR_BASE=TR_BASE, SB_HUB_SHAS=json.dumps(HUB_SHAS), SB_TR_SHAS=json.dumps(TR_SHAS), SB_SQL_SHA=SQL_SHA,
               SB_HUB_FN_BASE=URL + "/hub", SB_TR_FN_BASE=URL + "/tp")
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(HERE, "hiring_wording_415.py")], env=env, capture_output=True, text=True)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), [l.split()[:2] for l in open(LOG).read().splitlines()]

code, rep, dep = run()
open(os.environ.get("REHEARSAL_OUT","/dev/null"),"w").write(rep)
ck("rehearsal: DONE, exit 0", code == 0 and "RESULT: DONE" in rep, rep[-1800:])
ck("order: the SQL first, then Hub send-candidate-message, then Training job-offer", dep == [[HUB, "send-candidate-message"], [TP, "job-offer"]]
   and S["applied"], [dep, S["applied"]])
L = open(LOG).read().splitlines()
ck("each keeps its gateway setting (both off in this fake; the installer reads the real one)", all("--no-verify-jwt" in x for x in L) and len(L) == 2, L)
writes = [q for r, q in S["sql"] if re.search(r"\b(insert|update|delete|alter|create|drop|grant|truncate)\b", q, re.I)]
ck("the only writing SQL is the reviewed hiring_wording_415.sql, on the Hub, once; nothing on Training",
   len(writes) == 1 and writes[0] == open(os.path.join(HERE, "hiring_wording_415.sql")).read() and not [q for r, q in S["sql"] if r == TP], [w[:60] for w in writes])
ck("a copy of the adverts' current words is saved next to the report before the SQL runs",
   len(glob.glob(os.path.join(tmp, "Hiring wording 415 before*.json"))) == 1 and json.load(open(glob.glob(os.path.join(tmp, "Hiring wording 415 before*.json"))[0]))["job_postings"][0]["slug"] == "caregiver-springfield")
ck("the report shows the counts", "will change 6 of 8 job postings (5 of them published)" in rep and "2 of 3 saved descriptions" in rep, rep[:1500])
ck("proof: adverts read back clean, the one-liner on every open advert, a second run would change nothing",
   'no open advert says "five minutes"' in rep and 'no open advert says "under two minutes"' in rep and 'no open advert says "Ongoing paid training"' in rep
   and "every open advert (2) carries the one-liner" in rep and "would change nothing (0)" in rep, rep[-2500:])
ck("proof: the live copies are exactly the reviewed builds", rep.count("the live copy is now exactly the reviewed build") == 2 and "✗" not in rep, rep[-1500:])
calls = S["fncalls"]
ck("proof calls only: a stranger's text, a made-up booking, job-offer welcome without a sign-in and with a made-up one",
   [c[0] for c in calls] == ["hub-scm", "hub-scm", "tp-job-offer", "tp-job-offer"] and calls[1][1]["kind"] == "orientation_confirmation"
   and calls[2][1]["action"] == "send_welcome" and calls[2][2] is None and calls[3][2] == "not-a-real-hub-session", calls)
ck("the report hides keys", not re.search(r"eyJ\w|sbp_\w", rep), re.findall(r"(eyJ\w+|sbp_\w+)", rep))
ck("keys asked with ?reveal=true first", S["keyq"] and S["keyq"][0].endswith("?reveal=true"), S["keyq"])

MODE["keys"] = "no-reveal"
code, rep, dep = run()
ck("if the key list refuses ?reveal=true, it asks again without it and carries on (the 412 lesson)", code == 0 and "RESULT: DONE" in rep, [code, rep[-500:]])
MODE["keys"] = "ok"

MODE["dirty_after"] = True
code, rep, dep = run()
ck("an advert still saying the old words after the SQL: PARTLY DONE, named", code == 1 and "still in: caregiver-springfield" in rep and "PARTLY DONE" in rep, rep[-900:])
MODE["dirty_after"] = False

MODE["sqlfail"] = True
code, rep, dep = run()
ck("the SQL fails: STOP, no function deployed", code == 4 and not dep, [code, dep, rep[-400:]])
MODE["sqlfail"] = False

code, rep, dep = run(BAD_LIVE="1")
ck("a live copy that is not today's GitHub main: NOT changed, PARTLY DONE / STOP", code != 0 and [HUB, "send-candidate-message"] not in dep and "is not today's GitHub main" in rep, [code, dep, rep[-600:]])
code, rep, dep = run(SB_SQL_SHA="0" * 64)
ck("an SQL file that isn't the reviewed one: STOP before anything changes", code == 2 and not dep and not S["applied"], [code, rep[-300:]])
code, rep, dep = run(SB_TR_SHAS=json.dumps({"job-offer": "0" * 64}))
ck("a Training file that isn't the reviewed build: STOP before anything changes", code == 2 and not dep and not S["applied"], [code, rep[-300:]])
code, rep, dep = run(SB_HUB_SHAS=json.dumps({}))
ck("an unpinned changed file: STOP", code == 2 and not dep and "isn't the reviewed list" in rep, [code, rep[-300:]])
code, rep, dep = run(SB_HUB_BASE="")
ck("no reviewed starting point: STOP", code == 2 and not dep, [code, dep])
src = open(os.path.join(HERE, "hiring_wording_415.py")).read()
ck("no em dash in the installer's words", "\u2014" not in src, re.findall(r".{30}\u2014.{30}", src)[:3])
ck("the installer never says remote", not re.search(r"\bremote", src, re.I))

srv.shutdown()
allok = True; print("\n415 · INSTALLER REHEARSAL (fake Supabase, fake CLI)\n" + "=" * 50)
for n, g, note in res: allok &= g; print(("PASS  " if g else "FAIL  ") + n + ("" if g else "\n   └─ " + note))
print(f"ALL {len(res)} CHECKS PASS" if allok else "FAILED"); sys.exit(0 if allok else 1)
