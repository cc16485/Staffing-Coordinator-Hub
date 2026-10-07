#!/usr/bin/env python3
# Rehearsal of 498 (Pause care and End care): live functions start as the reviewed main (BASE); a live copy that differs stops it from a FRESH copy at the commit being tested, against a FAKE Supabase: a throwaway local Postgres
# holding the real journey tables and the first catalog, a fake Management API and a fake supabase CLI. Never touches a real project.
# (python3 leads_stage3_492_test.py; REHEARSE_COMMIT pins a commit)
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib, shutil
FNS = ["client-journey", "client-status-review", "identity-backfill", "obligations-run", "campaign-send", "campaign-auto", "timekeeper-watch", "late-watch", "coverage-watch", "coverage-reply", "coverage-run", "missed-notes", "carematch-watch"]
VJ0 = {f: f in ("client-journey", "client-status-review", "obligations-run") for f in FNS}; PATCHED = []
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "my_desk_463_sql_test.py")).read()
exec(src[:src.index("c = conn(); setup(c)")])
from pg8000.native import DatabaseError
REF = "zngsgedlsxinbygwmxwn"; COMMIT = os.environ.get("REHEARSE_COMMIT") or subprocess.run(["git", "rev-parse", "HEAD"], cwd=HERE, capture_output=True, text=True).stdout.strip()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
M = {"version": 9, "vj": True}
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body):
        b = json.dumps(body, default=str).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.headers.get("Authorization") != "Bearer sbp_fake": return self._send(401, {})
        mm = re.match(f"/v1/projects/{REF}/functions/([\\w-]+)$", self.path)
        if mm and mm.group(1) in VJ0: return self._send(200, {"version": M["version"], "verify_jwt": M.setdefault("vj_" + mm.group(1), VJ0[mm.group(1)])})
        return self._send(404, {})
    def do_PATCH(self):
        mm = re.match(f"/v1/projects/{REF}/functions/([\\w-]+)$", self.path); raw = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
        if mm: PATCHED.append(mm.group(1)); M["vj_" + mm.group(1)] = json.loads(raw).get("verify_jwt"); return self._send(200, {})
        self._send(404, {})
    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
        if self.path.startswith("/bump"): M["version"] += 1; q = dict(x.split("=") for x in self.path.split("?", 1)[1].split("&")); M["vj_" + q["fn"]] = (q.get("novj") == "0"); return self._send(200, {})
        if not self.path.endswith(f"/v1/projects/{REF}/database/query"): return self._send(404, {})
        if self.headers.get("Authorization") != "Bearer sbp_fake": return self._send(401, {"message": "bad token"})
        cc = conn()
        try:
            rows = cc.run(json.loads(raw)["query"]); cols = [c["name"] for c in (cc.columns or [])]
            return self._send(201, [dict(zip(cols, r)) for r in (rows or [])])
        except DatabaseError as e:
            try: cc.run("rollback")
            except Exception: pass
            return self._send(400, {"message": str(e)[:200]})
        finally: cc.close()
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
T = tempfile.mkdtemp(prefix="reh498-"); W = os.path.join(T, "hub")
subprocess.run(["git", "worktree", "add", "-q", "--detach", W, COMMIT], cwd=HERE, check=True)
BASEC = os.environ.get("REHEARSE_BASE") or subprocess.run(["git", "merge-base", COMMIT, "origin/main"], cwd=HERE, capture_output=True, text=True).stdout.strip()
LIVE = os.path.join(T, "live"); subprocess.run(["git", "worktree", "add", "-q", "--detach", LIVE, BASEC], cwd=HERE, check=True)
FNROOT = os.path.join(W, "supabase", "functions"); sha = lambda p_: hashlib.sha256(open(p_, "rb").read()).hexdigest()
PINS = {"client-journey": sha(os.path.join(FNROOT, "client-journey", "index.ts")), "client-journey/care.ts": sha(os.path.join(FNROOT, "client-journey", "care.ts")), "_shared/client-quiet.ts": sha(os.path.join(FNROOT, "_shared", "client-quiet.ts")), "_shared/audience-guard.ts": sha(os.path.join(FNROOT, "_shared", "audience-guard.ts")), "client-journey/client-care.sql": sha(os.path.join(W, "client-journey", "client-care.sql"))}
BASE = {}
for r_, _, fs_ in os.walk(os.path.join(LIVE, "supabase", "functions")):
    for f_ in fs_: p_ = os.path.join(r_, f_); BASE["supabase/functions/" + os.path.relpath(p_, os.path.join(LIVE, "supabase", "functions")).replace(os.sep, "/")] = sha(p_)
CAT = json.load(open(os.path.join(W, "client-journey", "catalog-v1.json")))["steps"]
OLD = [dict(s, after=(["asmt.outcome"] if s["key"] in ("docs.agreement", "docs.rights", "docs.assessment", "ax.client") else s["after"])) for s in CAT if s["key"] != "signed.yes"]   # the catalog as 482 installed it
LOG = os.path.join(T, "deploys.txt"); CLI = os.path.join(T, "supabase")
open(CLI, "w").write(f"""#!/bin/sh
echo "$@" >> {LOG}
[ -f {T}/fail ] && [ "$2" = "deploy" ] && {{ echo boom >&2; exit 1; }}
if [ "$2" = "deploy" ]; then touch {T}/deployed_$3; curl -s -o /dev/null -X POST "{URL}/bump?fn=$3&novj=$(echo "$@" | grep -c -- --no-verify-jwt)"; exit 0; fi
if [ "$2" = "download" ]; then mkdir -p supabase/functions/_shared supabase/functions/$3
  SRC={LIVE}/supabase/functions; [ -f {T}/deployed_$3 ] && SRC={FNROOT}
  cp $SRC/$3/*.ts supabase/functions/$3/ 2>/dev/null
  cp $SRC/_shared/*.ts $SRC/_shared/*.js supabase/functions/_shared/ 2>/dev/null
  [ -f {T}/drift ] && [ "$3" = "late-watch" ] && echo "// someone else's change" >> supabase/functions/late-watch/index.ts
  exit 0
fi
exit 0
"""); os.chmod(CLI, 0o755)
def db(q):
    c = conn()
    try: r = c.run(q); return r[0][0] if r else None
    finally: c.close()
def fresh(with_yes=False):
    c = conn(); setup(c)
    c.run("create table public.app_data(key text primary key, data jsonb, version int default 1)")
    c.run("insert into public.app_data values ('ops_settings', '{}'::jsonb, 1), ('leads', '[]'::jsonb, 1), ('ops_items', '[]'::jsonb, 1)")
    c.run("do $$ begin if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if; end $$")
    c.run("drop schema if exists storage cascade; create schema storage; create table storage.buckets(id text primary key, name text, public boolean)")
    c.run("drop schema if exists cron cascade; create schema cron; create table cron.job(jobid serial primary key, jobname text unique, schedule text, command text, active boolean default true)")
    c.run("create function cron.schedule(n text, s text, cmd text) returns bigint language sql as $$ insert into cron.job(jobname, schedule, command) values (n, s, cmd) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$")
    c.run("drop schema if exists vault cascade; create schema vault; create table vault.decrypted_secrets(name text, decrypted_secret text)")
    c.run("drop schema if exists net cascade; create schema net"); c.close()
    c = conn(); c.run(open(os.path.join(W, "client-journey", "client-journey.sql")).read())
    for s in (CAT if with_yes else OLD):
        s = dict(s)
        if s["key"] in ("sched.axiscare", "team.staffed"): s = dict(s, proof="confirmed"); s.pop("verify", None)
        if s["key"] == "team.staffed": s["title"] = "Staff every shift (edited)"
        c.run("insert into public.client_journey_step_def (key, catalog_version, def, active, updated_by) values (:k, 1, :d::jsonb, true, 'seed')", k=s["key"], d=json.dumps(s))
    c.run("insert into public.client_journey (lead_id, client_name, payer, assigned_cc, created_by) values ('a1', 'Tommy Fortner', 'medicaid', 'krystal@mo-care.com', 'hub')")
    c.run("insert into public.client_journey (axiscare_client_id, client_name, payer, assigned_cc, created_by) values ('296', 'Edward Anderson', 'private', 'krystal@mo-care.com', 'hub'), ('295', 'Peggy Thomason', null, 'krystal@mo-care.com', 'hub')")
    c.run("create table public.person_source_id(person_id text, system text, entity_type text, source_id text)")
    c.run("create table public.person_role(person_id text, role text, status text, ended_at date, end_reason text)")
    c.run("insert into public.person_source_id values ('pe','axiscare','client','296'), ('pp','axiscare','client','295')")
    c.run("insert into public.person_role values ('pe','client','former','2026-10-06','deceased'), ('pp','client','active',null,null)")
    c.run("create table public.client_admission_case(case_id text, axiscare_client_id text, status text)")
    c.run("insert into public.client_admission_case values ('c1','299','open')")
    c.run("insert into public.app_data values ('campaign_settings', '[{\"id\":\"settings\",\"enabled\":true,\"aud_monthly\":true,\"aud_caregivers\":true}]'::jsonb, 1)")
    c.close(); M.update({"version": 9, "vj": True})
    for f in [LOG, os.path.join(T, "fail"), os.path.join(T, "drift")] + [os.path.join(T, "deployed_" + x) for x in FNS]:
        if os.path.exists(f): os.remove(f)
def run(**over):
    rep = os.path.join(T, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_API_BASE=URL, SB_SUPA_CLI=CLI, SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(PINS), SB_BASE_SHAS=json.dumps(BASE)); env.update(over)
    p = subprocess.run([sys.executable, os.path.join(W, "pause_end_care_498.py")], env=env, capture_output=True, text=True, timeout=300)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
log = lambda: open(LOG).read() if os.path.exists(LOG) else ""
try:
    fresh(True); code, out = run(SB_FN_SHAS=json.dumps(dict(PINS, **{"client-journey/care.ts": "0" * 64})))
    ck("a changed build is refused before anything runs", code == 2 and "not the reviewed build" in out and "deploy" not in log(), out)
    fresh(True); open(os.path.join(T, "drift"), "w").write("1"); code, out = run()
    ck("a live function that differs from the reviewed main (someone else's unreleased change): STOPS before anything changes", code == 3 and "late-watch: the live copy differs from the reviewed main" in out and "deploy" not in log() and db("select count(*) from information_schema.tables where table_name = 'client_pause'") == 0, out)
    fresh(True); M.update({("vj_" + f): VJ0[f] for f in FNS}); code, out = run()
    ck("DONE: the database part, then all 13 functions, each checked live", code == 0 and "RESULT: DONE" in out and log().count("functions deploy") == 13 and out.count("deployed: the live copy is this reviewed build") == 13, out)
    ck("...each kept its gateway sign-in setting", all(M["vj_" + f] == VJ0[f] for f in FNS), M)
    ck("...one journey per episode now (the old one-per-person rule is gone), records permanent and server-only", "one journey per episode" in out and "can't be deleted or rewritten" in out and "can read or change them directly" in out
       and db("select count(*) from pg_indexes where indexname = 'client_journey_one_open_ax'") == 1 and db("select count(*) from pg_constraint where conname = 'client_journey_axiscare_client_id_key'") == 0, out)
    ck("...nothing was imported", "Nothing was imported" in out)
    code, out = run()
    ck("run again: safe (tables kept, functions already this build)", code == 0 and "already there (kept)" in out, out)
    fresh(True); open(os.path.join(T, "fail"), "w").write("1"); code, out = run()
    ck("a failed deploy stops and says what stays", code == 6 and "did not deploy cleanly" in out and "stays" in out, out)
finally:
    subprocess.run(["git", "worktree", "remove", "--force", W], cwd=HERE); subprocess.run(["git", "worktree", "remove", "--force", LIVE], cwd=HERE); shutil.rmtree(T, ignore_errors=True); H.shutdown()
for n, okk, d_ in res: print(("PASS" if okk else "FAIL"), "·", n, d_)
print(f"{sum(1 for x in res if x[1])} passed, {sum(1 for x in res if not x[1])} failed")
raise SystemExit(0 if all(x[1] for x in res) else 1)
