#!/usr/bin/env python3
# Rehearsal of 1031 (onboarding_1031.py) from a fresh worktree of this commit, against a FAKE management API whose database is
# a real Postgres (PGlite on disk), a fake supabase tool whose "live" functions are main's until this step deploys them, and
# a fake readiness sweep. Never touches a real project.   PGLITE=<path> python3 onboarding_1031_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil, sys
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
PGL = os.environ.get("PGLITE", "")
if not PGL: print("FAIL  PGLITE is not set"); sys.exit(1)
TMP = tempfile.mkdtemp(prefix="t1031-"); WT = os.path.join(TMP, "wt"); BASE = os.path.join(TMP, "base"); PGDIR = os.path.join(TMP, "pg")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WT, "HEAD"], check=True)
base_ref = subprocess.run(["git", "-C", HERE, "merge-base", "HEAD", "origin/main"], capture_output=True, text=True).stdout.strip()
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
def seed(adv="", fp_active=True):
    shutil.rmtree(PGDIR, ignore_errors=True)
    r = pg(f"""create table public.app_data (key text primary key, data jsonb, updated_at timestamptz default now());
      insert into public.app_data values ('ops_settings', '{json.dumps({"approve_advance_auto_live": adv} if adv else {})}');
      create table public.client_journey_step_def (key text primary key, catalog_version int not null default 1, def jsonb not null, active boolean not null default true, updated_at timestamptz default now(), updated_by text);
      insert into public.client_journey_step_def (key, def, active) values
        ('cg.check.fingerprints', '{{"active": true, "applies": {{"lived_outside_mo": true}}}}', {'true' if fp_active else 'false'}),
        ('cg.training.dementia', '{{"required": true, "after": ["cg.training.orientation"]}}', true),
        ('cg.approve.advance', '{{"after": ["cg.check.oig", "cg.check.edl", "cg.check.fcsr", "cg.refs.cleared", "cg.check.casenet"]}}', true),
        ('cg.approve.work', '{{"after": ["cg.step2.i9_s1", "cg.training.orientation", "cg.training.dementia", "cg.check.oig", "cg.check.casenet"]}}', true);
      create table public.app_data_key_hub_map (data_key text, hub_slug text, primary key (data_key, hub_slug));
      create table public.bg_reviews (id serial primary key, candidate_id text, check_key text not null check (check_key in ('fcsr', 'edl', 'oig', 'fp')), status text);
      create table public.client_journey (journey_id text primary key, status text);
      create table public.client_journey_step (journey_id text, step_key text, state text);
      insert into public.client_journey values ('j1', 'open'); insert into public.client_journey_step values ('j1', 'cg.check.fingerprints', 'todo');""")
    assert r["ok"], r
    for f in os.listdir(TMP):
        if f.startswith("dep-"): os.remove(os.path.join(TMP, f))
    shutil.rmtree(os.path.join(TMP, "live"), ignore_errors=True)
FNS = ["caregiver-journey", "step1-sign", "welcome-call", "bg-review", "references-run", "hire-profile", "caregiver-export"]
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
        if self.path.startswith("/functions/v1/caregiver-journey"):
            if "eyJsvc" not in self.headers.get("Authorization", ""): return self._send(401, {})
            return self._send(200, {"ok": True, "looked_at": 3, "advance": {"live": False, "done": 0, "would": 1}, "oig_search": {"live": False, "ran": 0, "would": 2, "matches": 0}})
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
FILES = ["caregiver-journey/index.ts", "_shared/caregiver-journey.ts", "_shared/onboarding-auto.ts", "_shared/bg-review.ts", "_shared/team-onboarding.ts", "step1-sign/index.ts", "welcome-call/index.ts", "bg-review/index.ts", "references-run/index.ts"]
SHAS = {k: hashlib.sha256(open(os.path.join(WT, "supabase/functions", k), "rb").read()).hexdigest() for k in FILES}
def run(env_over=None):
    rep = os.path.join(TMP, "r.txt"); os.path.exists(rep) and os.remove(rep); CALLS.clear()
    env = dict(os.environ, SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_SUPA_CLI=SUPA, SB_FNROOT=os.path.join(WT, "supabase/functions"), SB_BASE_ROOT=BASE, SB_STEP="1031", SB_FN_SHAS=json.dumps(SHAS)); env.update(env_over or {})
    p = subprocess.run(["python3", os.path.join(WT, "onboarding_1031.py")], cwd=WT, env=env, capture_output=True, text=True, timeout=300)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else "") + p.stdout + p.stderr
q = lambda s: pg(s)["rows"]
try:
    seed(); c, out = run()
    ck("clean run from a fresh copy: exit 0, DONE, no ✗", c == 0 and "RESULT: DONE" in out and "✗" not in out, out[-2500:])
    ck("the report never shows a key", "eyJsvc" not in out and "sbp_test" not in out)
    ck("all seven functions deployed with their gateway setting kept (step1-sign and welcome-call stay off)", all(os.path.exists(os.path.join(TMP, "dep-" + f)) for f in FNS)
       and "--no-verify-jwt" in open(os.path.join(TMP, "dep-step1-sign")).read() and "--no-verify-jwt" not in open(os.path.join(TMP, "dep-caregiver-journey")).read())
    ck("the catalog: fingerprints off, dementia optional and out of Approve to Work, Case.net reviewable, the Hub may read OIG searches", q("select active from public.client_journey_step_def where key = 'cg.check.fingerprints'")[0]["active"] is False
       and q("select def->>'required' as r from public.client_journey_step_def where key = 'cg.training.dementia'")[0]["r"] == "false" and "cg.training.dementia" not in q("select def from public.client_journey_step_def where key = 'cg.approve.work'")[0]["def"]["after"]
       and q("select count(*)::int as n from public.app_data_key_hub_map where data_key = 'oig_auto_search'")[0]["n"] == 1, out[-1200:])
    ck("the proof: the sweep answered in practice for both new parts; the old open fingerprint row is reported, not changed", "would complete itself for 1" in out and "would run for 2 (practice)" in out and "1 open card(s) still hold an old fingerprint row" in out, out[-1200:])
    ck("no switch turned on", q("select data from public.app_data where key = 'ops_settings'")[0]["data"] == {})
    c, out = run()
    ck("run again: DONE (safe to re-run; the SQL checks before changing)", c == 0 and "RESULT: DONE" in out, out[-1500:])
    seed(adv="true"); c, out = run()
    ck("a new switch already on: STOP before anything changed", c == 3 and not any(x.startswith("begin;") for x in CALLS) and not os.path.exists(os.path.join(TMP, "dep-caregiver-journey")), out[-1200:])
    seed(); open(os.path.join(TMP, "drift-welcome-call"), "w").write("1"); c, out = run(); os.remove(os.path.join(TMP, "drift-welcome-call"))
    ck("a live function someone else changed: STOP, nothing replaced, the catalog untouched", c == 3 and "the live welcome-call is not what main had" in out and not any(x.startswith("begin;") for x in CALLS)
       and q("select active from public.client_journey_step_def where key = 'cg.check.fingerprints'")[0]["active"] is True, out[-1200:])
    seed(); MODE["fail_sql"] = True; c, out = run(); MODE.clear()
    ck("the database refuses the change: STOP, no function deployed", c == 5 and not os.path.exists(os.path.join(TMP, "dep-caregiver-journey")), out[-1200:])
    seed(); c, out = run({"SB_FN_SHAS": json.dumps(dict(SHAS, **{"caregiver-journey/index.ts": "0" * 64}))})
    ck("a file that is not the reviewed build: STOP, nothing run", c == 2 and not CALLS, out[-800:])
finally:
    srv.shutdown()
    for w in (WT, BASE): subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", w], capture_output=True)
    shutil.rmtree(TMP, ignore_errors=True)
for n, ok, note in res: print(("PASS  " if ok else "FAIL  ") + n + ("" if ok else "\n      " + note))
bad_ = sum(1 for r in res if not r[1]); print(f"{len(res) - bad_}/{len(res)} passed"); sys.exit(1 if bad_ else 0)
