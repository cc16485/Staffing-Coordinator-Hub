#!/usr/bin/env python3
# Rehearsal of 1037 (onboarding_1037.py) from a fresh worktree of this commit, against a FAKE management API whose database is
# a real Postgres (PGlite on disk), a fake supabase tool whose "live" functions are main's until this step deploys them, and
# a fake readiness sweep. Never touches a real project.   PGLITE=<path> python3 onboarding_1031_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil, sys
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
PGL = os.environ.get("PGLITE", "")
if not PGL: print("FAIL  PGLITE is not set"); sys.exit(1)
TMP = tempfile.mkdtemp(prefix="t1037-"); WT = os.path.join(TMP, "wt"); BASE = os.path.join(TMP, "base"); PGDIR = os.path.join(TMP, "pg")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WT, "HEAD"], check=True)
base_ref = subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD~1"], capture_output=True, text=True).stdout.strip()   # main before this build
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", BASE, base_ref], check=True)
PGQ = os.path.join(TMP, "pgq.mjs")
open(PGQ, "w").write(f"""import fs from 'fs'; const {{ PGlite }} = await import({json.dumps(PGL)}); const db = new PGlite(process.argv[2])
try {{ const r = await db.exec(fs.readFileSync(process.argv[3], 'utf8')); const last = r.filter((x) => x.fields && x.fields.length).pop(); process.stdout.write(JSON.stringify({{ ok: true, rows: last ? last.rows : [] }})) }}
catch (e) {{ process.stdout.write(JSON.stringify({{ ok: false, error: String(e.message || e) }})) }} finally {{ await db.close() }}""")
def pg(q):
    f = os.path.join(TMP, "q.sql"); open(f, "w").write(q)
    p = subprocess.run(["node", PGQ, PGDIR, f], capture_output=True, text=True, timeout=120)
    try: return json.loads(p.stdout)
    except Exception: return {"ok": False, "error": p.stderr[-300:]}
def seed(adv="", fp_active=False, no_cna_role=False):
    shutil.rmtree(PGDIR, ignore_errors=True)
    r = pg("""create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create table public.app_data (key text primary key, data jsonb, updated_at timestamptz default now());
      insert into public.app_data values ('ops_settings', '{"prn_team_minimum": 20}');
      create table public.job_positions (key text primary key, label text not null, screener jsonb not null default '[]', pay_min numeric(8,2), pay_max numeric(8,2), pay_unit text default 'HOUR', sort int default 0, active boolean not null default true, track text, pay_ack text, pay_ack_version text);
      """ + ("" if no_cna_role else "insert into public.job_positions (key, label, pay_min, track) values ('prn_cna', 'PRN CNA Team', 20, 'prn');") + """
      create table public.job_applicants (id uuid primary key default gen_random_uuid(), position text, prn jsonb, completed_at timestamptz, decline_reason text, pay_ack_at timestamptz, screen_flags text[], screen_grade text, office text, age_ok boolean, work_auth boolean, has_transport boolean, can_pass_background boolean, one_year text, status text);
      create table public.job_postings (slug text primary key, status text, title text, description text, employment_type text, pay_min numeric, pay_max numeric, pay_unit text, summary text, qualifications text, openings int, position text, indeed_feed boolean, valid_through date, internal_note text);
      """ + open(os.path.join(WT, "prn2.sql")).read())
    assert r["ok"], r
    for f in os.listdir(TMP):
        if f.startswith("dep-"): os.remove(os.path.join(TMP, f))
    shutil.rmtree(os.path.join(TMP, "live"), ignore_errors=True)
FNS = ["prn-team", "interview-messages"]
CALLS = []; MODE = {}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path.endswith("/api-keys?reveal=true") or self.path.endswith("/api-keys"): return self._send(200, [{"name": "service_role", "api_key": "eyJsvc.test.key"}, {"name": "anon", "api_key": "eyJanon.test.key"}])
        m = re.search(r"/functions/([a-z0-9-]+)$", self.path)
        if m: return self._send(200, {"version": 3, "verify_jwt": m.group(1) not in ("step1-sign", "welcome-call")})
        return self._send(404, {})
    def do_PATCH(self): return self._send(200, {})
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        if self.path.endswith("/database/query"):
            q = body["query"]; CALLS.append(q)
            if MODE.get("fail_sql") and q.startswith("begin;"): return self._send(400, {"message": "ERROR: injected"})
            r = pg(q); return self._send(201, r["rows"]) if r["ok"] else self._send(400, {"message": r["error"]})
        if self.path.startswith("/functions/v1/prn-team"):
            if "eyJsvc" not in self.headers.get("Authorization", ""): return self._send(401, {})
            return self._send(200, {"prn": "PRN TEAM - CNA", "cna": "CERTIFIED NURSES AIDE", "why": [], "prn_caregiver": MODE.get("pcg"), "why_caregiver": []})
        return self._send(404, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
# the fake supabase tool: deploy records the call and makes that build live; download hands back the live files
SUPA = os.path.join(TMP, "supabase"); sys.path.insert(0, WT)
open(SUPA, "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil; sys.path.insert(0, {json.dumps(WT)}); os.environ.setdefault('SB_REPORT', '/dev/null')
from cc_step_lib import need
a = sys.argv[1:]; fn = a[2]; TMP = {json.dumps(TMP)}
if a[:2] == ['functions', 'deploy']:
    open(os.path.join(TMP, 'dep-' + fn), 'w').write(' '.join(a)); src = os.getcwd()
    live = os.path.join(TMP, 'live', fn); shutil.rmtree(live, ignore_errors=True)
    for k in need(os.path.join(src, 'supabase', 'functions'), fn): os.makedirs(os.path.dirname(os.path.join(live, k)), exist_ok=True); shutil.copy(os.path.join(src, k), os.path.join(live, k))
elif a[:2] == ['functions', 'download']:
    live = os.path.join(TMP, 'live', fn)
    if os.path.isdir(live): shutil.copytree(live, os.getcwd(), dirs_exist_ok=True)
    else:
        base = {json.dumps(BASE)}
        for k in need(os.path.join(base, 'supabase', 'functions'), fn): os.makedirs(os.path.dirname(os.path.join(os.getcwd(), k)), exist_ok=True); shutil.copy(os.path.join(base, k), os.path.join(os.getcwd(), k))
        if os.path.exists(os.path.join(TMP, 'drift-' + fn)): open(os.path.join(os.getcwd(), 'supabase/functions', fn, 'index.ts'), 'a').write('// someone else')
""")
os.chmod(SUPA, 0o755)
FILES = ["prn-team/index.ts", "interview-messages/index.ts", "_shared/applicant-words.ts", "_shared/hepb.ts"]
SHAS = {k: hashlib.sha256(open(os.path.join(WT, "supabase/functions", k), "rb").read()).hexdigest() for k in FILES}
def run(env_over=None):
    rep = os.path.join(TMP, "r.txt"); os.path.exists(rep) and os.remove(rep); CALLS.clear()
    env = dict(os.environ, SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_SUPA_CLI=SUPA, SB_FNROOT=os.path.join(WT, "supabase/functions"), SB_BASE_ROOT=BASE, SB_STEP="1037", SB_FN_SHAS=json.dumps(SHAS)); env.update(env_over or {})
    p = subprocess.run(["python3", os.path.join(WT, "onboarding_1037.py")], cwd=WT, env=env, capture_output=True, text=True, timeout=300)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else "") + p.stdout + p.stderr
q = lambda s: pg(s)["rows"]
try:
    seed(); c, out = run()
    ck("clean run from a fresh copy: exit 0, DONE, no ✗", c == 0 and "RESULT: DONE" in out and "✗" not in out, out[-2500:])
    ck("the report never shows a key", "eyJsvc" not in out and "sbp_test" not in out)
    deployed = sorted(f[4:] for f in os.listdir(TMP) if f.startswith("dep-"))
    ck("prn-team, interview-messages and the services sharing applicant-words or hepb went out; nothing else", all(f in deployed for f in FNS) and "caregiver-journey" not in deployed, deployed)
    ck("the role, the team column, the goal and the draft posting are in", q("select requires_cna from public.job_positions where key = 'prn_caregiver'")[0]["requires_cna"] is False
       and q("select data->>'prn_caregiver_minimum' as v from public.app_data where key = 'ops_settings'")[0]["v"] == "10" and q("select status from public.job_postings where slug = 'prn-caregiver-springfield'")[0]["status"] == "draft")
    ck("the proof: AxisCare has no PRN TEAM - CAREGIVER yet, so the report asks her to add it once, by its exact name", "add a caregiver class named exactly PRN TEAM - CAREGIVER" in out and "Add the AxisCare class above first." in out, out[-1500:])
    MODE["pcg"] = "PRN TEAM - CAREGIVER"; c, out = run(); MODE.pop("pcg")
    ck("run again (the class added): DONE, already this build, no ask", c == 0 and "already this build" in out and "the PRN Caregiver Team class is PRN TEAM - CAREGIVER" in out and "ONE THING FOR YOU" not in out, out[-1500:])
    seed(no_cna_role=True); c, out = run()
    ck("no PRN CNA Team role (Desktop 352 never ran): STOP before anything changed", c == 3 and not any(x.startswith("begin;") for x in CALLS), out[-1000:])
    seed(); open(os.path.join(TMP, "drift-prn-team"), "w").write("1"); c, out = run(); os.remove(os.path.join(TMP, "drift-prn-team"))
    ck("a live function someone else changed: STOP, nothing replaced", c == 3 and "the live prn-team is not what main had before this build" in out and not any(x.startswith("begin;") for x in CALLS), out[-1000:])
    seed(); c, out = run({"SB_FN_SHAS": json.dumps(dict(SHAS, **{"prn-team/index.ts": "0" * 64}))})
    ck("a file that is not the reviewed build: STOP, nothing run", c == 2 and not CALLS, out[-800:])
finally:
    srv.shutdown()
    for w in (WT, BASE): subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", w], capture_output=True)
    shutil.rmtree(TMP, ignore_errors=True)
for n, ok, note in res: print(("PASS  " if ok else "FAIL  ") + n + ("" if ok else "\n      " + note))
bad_ = sum(1 for r in res if not r[1]); print(f"{len(res) - bad_}/{len(res)} passed"); sys.exit(1 if bad_ else 0)
