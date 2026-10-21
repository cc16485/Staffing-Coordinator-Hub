#!/usr/bin/env python3
# Rehearsal of 1032 (onboarding_1032.py) from a fresh worktree of this commit, against a FAKE management API whose database is
# a real Postgres (PGlite on disk), a fake supabase tool whose "live" functions are main's until this step deploys them, and
# a fake readiness sweep. Never touches a real project.   PGLITE=<path> python3 onboarding_1031_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil, sys
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
PGL = os.environ.get("PGLITE", "")
if not PGL: print("FAIL  PGLITE is not set"); sys.exit(1)
TMP = tempfile.mkdtemp(prefix="t1032-"); WT = os.path.join(TMP, "wt"); BASE = os.path.join(TMP, "base"); PGDIR = os.path.join(TMP, "pg")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WT, "HEAD"], check=True)
base_ref = subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD~2"], capture_output=True, text=True).stdout.strip()   # the 1031 build
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
def seed(adv="", fp_active=False):
    shutil.rmtree(PGDIR, ignore_errors=True)
    r = pg(f"""create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create table public.app_data (key text primary key, data jsonb, updated_at timestamptz default now());
      insert into public.app_data values ('ops_settings', '{json.dumps({"ref_auto_text_live": adv} if adv else {})}');
      create table public.client_journey_step_def (key text primary key, catalog_version int not null default 1, def jsonb not null, active boolean not null default true, updated_at timestamptz default now(), updated_by text);
      insert into public.client_journey_step_def (key, def, active) values
        ('cg.check.fingerprints', '{{"active": false}}', {'true' if fp_active else 'false'}),
        ('cg.training.dementia', '{{"required": true, "after": ["cg.training.orientation"]}}', true),
        ('cg.approve.advance', '{{"after": ["cg.check.oig", "cg.check.edl", "cg.check.fcsr", "cg.refs.cleared", "cg.check.casenet"]}}', true),
        ('cg.approve.work', '{{"after": ["cg.step2.i9_s1", "cg.training.orientation", "cg.training.dementia", "cg.check.oig", "cg.check.casenet"]}}', true);
      create table public.app_data_key_hub_map (data_key text, hub_slug text, primary key (data_key, hub_slug));
      create table public.bg_reviews (id serial primary key, candidate_id text, check_key text not null check (check_key in ('fcsr', 'edl', 'oig', 'fp')), status text);
      create table public.client_journey (journey_id text primary key, status text);
      create table public.client_journey_step (journey_id text, step_key text, state text);
      create table public.reference_requests (id text primary key, sent_at timestamptz, responded_at timestamptz);
      insert into public.reference_requests values ('r1', null, null);
      insert into public.client_journey values ('j1', 'open'); insert into public.client_journey_step values ('j1', 'cg.check.fingerprints', 'todo');""")
    assert r["ok"], r
    for f in os.listdir(TMP):
        if f.startswith("dep-"): os.remove(os.path.join(TMP, f))
    shutil.rmtree(os.path.join(TMP, "live"), ignore_errors=True)
FNS = ["reference-chase", "welcome-call", "step2-handoff", "caregiver-journey"]
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
        if self.path.startswith("/functions/v1/reference-chase?dry=1"):
            if "eyJsvc" not in self.headers.get("Authorization", ""): return self._send(401, {})
            return self._send(200, {"ok": True, "dry": True, "texts": "practice", "would_text": 2})
        if self.path.startswith("/functions/v1/caregiver-journey"):
            if "eyJsvc" not in self.headers.get("Authorization", ""): return self._send(401, {})
            return self._send(200, {"ok": True, "looked_at": 3, "auto_ask": {"live": False, "made": 0, "would": 3, "people": ["Ava Lee (2 references)", "Bo Ray (1 reference)"]}})
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
FILES = ["reference-chase/index.ts", "_shared/reference-texts.ts", "_shared/welcome-message.ts", "_shared/ref-auto-ask.ts", "welcome-call/index.ts", "step2-handoff/index.ts", "caregiver-journey/index.ts", "_shared/caregiver-journey.ts"]
SHAS = {k: hashlib.sha256(open(os.path.join(WT, "supabase/functions", k), "rb").read()).hexdigest() for k in FILES}
def run(env_over=None):
    rep = os.path.join(TMP, "r.txt"); os.path.exists(rep) and os.remove(rep); CALLS.clear()
    env = dict(os.environ, SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_SUPA_CLI=SUPA, SB_FNROOT=os.path.join(WT, "supabase/functions"), SB_BASE_ROOT=BASE, SB_STEP="1032", SB_FN_SHAS=json.dumps(SHAS)); env.update(env_over or {})
    p = subprocess.run(["python3", os.path.join(WT, "onboarding_1032.py")], cwd=WT, env=env, capture_output=True, text=True, timeout=300)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else "") + p.stdout + p.stderr
q = lambda s: pg(s)["rows"]
try:
    seed(); c, out = run()
    ck("clean run from a fresh copy: exit 0, DONE, no ✗", c == 0 and "RESULT: DONE" in out and "✗" not in out, out[-2500:])
    ck("the report never shows a key", "eyJsvc" not in out and "sbp_test" not in out)
    deployed = sorted(f[4:] for f in os.listdir(TMP) if f.startswith("dep-"))
    ck("the services whose files changed since 1031 went out (the four named, plus the ones sharing caregiver-journey.ts), gateway kept", all(f in deployed for f in FNS) and "--no-verify-jwt" in open(os.path.join(TMP, "dep-welcome-call")).read() and "step1-sign" not in deployed, deployed)
    ck("the two columns are on reference requests", {"texted_at", "reminder_texted_at"} <= {r["column_name"] for r in q("select column_name from information_schema.columns where table_name = 'reference_requests'")})
    ck("the proof: practice run says 2 would be texted and the Hub would ask 3 references by itself, for whom; no switch on", "2 reference(s) would get a text" in out and "the Hub would make 3 reference request(s) for Ava Lee (2 references), Bo Ray (1 reference)" in out and q("select data from public.app_data where key = 'ops_settings'")[0]["data"] == {}, out[-1200:])
    c, out = run()
    ck("run again: DONE (already this build)", c == 0 and "already this build" in out and "RESULT: DONE" in out, out[-1500:])
    seed(fp_active=True); c, out = run()
    ck("1031 not in yet: STOP before anything changed", c == 3 and "Run 1031 first" in out and not any(x.startswith("begin;") for x in CALLS), out[-1000:])
    seed(adv="true"); c, out = run()
    ck("a new switch already on: STOP", c == 3 and not any(x.startswith("begin;") for x in CALLS), out[-800:])
    seed(); open(os.path.join(TMP, "drift-reference-chase"), "w").write("1"); c, out = run(); os.remove(os.path.join(TMP, "drift-reference-chase"))
    ck("a live function someone else changed: STOP, nothing replaced", c == 3 and "the live reference-chase is not what 1031 left" in out and not any(x.startswith("begin;") for x in CALLS), out[-1000:])
    seed(); c, out = run({"SB_FN_SHAS": json.dumps(dict(SHAS, **{"reference-chase/index.ts": "0" * 64}))})
    ck("a file that is not the reviewed build: STOP, nothing run", c == 2 and not CALLS, out[-800:])
finally:
    srv.shutdown()
    for w in (WT, BASE): subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", w], capture_output=True)
    shutil.rmtree(TMP, ignore_errors=True)
for n, ok, note in res: print(("PASS  " if ok else "FAIL  ") + n + ("" if ok else "\n      " + note))
bad_ = sum(1 for r in res if not r[1]); print(f"{len(res) - bad_}/{len(res)} passed"); sys.exit(1 if bad_ else 0)
