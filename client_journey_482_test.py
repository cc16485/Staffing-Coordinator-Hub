#!/usr/bin/env python3
# Rehearsal of 482 from a FRESH copy at the commit being tested, against a FAKE Supabase: a throwaway local Postgres with a
# stand-in job scheduler, vault and net; a fake deploy; a fake talk-notify. Never touches a real project.
import json, os, subprocess, sys, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "my_desk_463_sql_test.py")).read()
exec(src[:src.index("c = conn(); setup(c)")])
from pg8000.native import DatabaseError
REF = "zngsgedlsxinbygwmxwn"; COMMIT = os.environ.get("REHEARSE_COMMIT") or subprocess.run(["git", "rev-parse", "HEAD"], cwd=HERE, capture_output=True, text=True).stdout.strip()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
ANON, SVC = "eyJanon" + "a" * 40, "eyJsvc" + "s" * 40
M = {"version": None, "secrets": ["GHL_TOKEN", "GHL_LOCATION_ID"]}
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body):
        b = json.dumps(body).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.headers.get("Authorization") != "Bearer sbp_fake": return self._send(401, {})
        if self.path.startswith(f"/v1/projects/{REF}/api-keys"): return self._send(200, [{"name": "anon", "api_key": ANON}, {"name": "service_role", "api_key": SVC}])
        if self.path == f"/v1/projects/{REF}/secrets": return self._send(200, [{"name": n} for n in M["secrets"]])
        if self.path == f"/v1/projects/{REF}/functions/client-journey": return self._send(200, {"version": M["version"], "verify_jwt": True}) if M["version"] else self._send(404, {})
        return self._send(404, {})
    def do_OPTIONS(self):
        self.send_response(200); self.end_headers()
    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
        if self.path == "/bump": M["version"] = (M["version"] or 0) + 1; return self._send(200, {})
        if self.path.startswith("/functions/v1/client-journey"):
            if self.headers.get("Authorization") == "Bearer " + SVC: return self._send(200, {"ok": True, "live": False})
            return self._send(401, {"error": "Sign in first."})
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
T = tempfile.mkdtemp(prefix="reh482-"); W = os.path.join(T, "hub")
subprocess.run(["git", "worktree", "add", "-q", "--detach", W, COMMIT], cwd=HERE, check=True)
FNROOT = os.path.join(W, "supabase", "functions"); sha = lambda p_: hashlib.sha256(open(p_, "rb").read()).hexdigest()
PINS = {"client-journey": sha(os.path.join(FNROOT, "client-journey", "index.ts")), "_shared/journey-rules.js": sha(os.path.join(FNROOT, "_shared", "journey-rules.js")),
        "_shared/staff-auth.ts": sha(os.path.join(FNROOT, "_shared", "staff-auth.ts")), "_shared/job-auth.ts": sha(os.path.join(FNROOT, "_shared", "job-auth.ts")),
        "client-journey/client-journey.sql": sha(os.path.join(W, "client-journey", "client-journey.sql")), "client-journey/catalog-v1.json": sha(os.path.join(W, "client-journey", "catalog-v1.json"))}
LOG = os.path.join(T, "deploys.txt"); CLI = os.path.join(T, "supabase")
open(CLI, "w").write(f"#!/bin/sh\necho \"$@\" >> {LOG}\n[ -f {T}/fail ] && {{ echo boom >&2; exit 1; }}\ncurl -s -o /dev/null -X POST {URL}/bump\nexit 0\n"); os.chmod(CLI, 0o755)
def db(q):
    c = conn()
    try: r = c.run(q); return r[0][0] if r else None
    finally: c.close()
def fresh(vault=True, ops='{}', leads='[]'):
    c = conn(); setup(c)
    c.run("create table public.app_data(key text primary key, data jsonb, version int default 1)")
    c.run("insert into public.app_data values ('ops_settings', :d::jsonb, 1), ('leads', :l::jsonb, 1)", d=ops, l=leads)
    c.run("""create or replace function public.upsert_app_data_item(target_key text, item jsonb) returns void language plpgsql as $f$
      begin update public.app_data set data = coalesce((select jsonb_agg(x) from jsonb_array_elements(data) x where x->>'id' <> item->>'id'), '[]'::jsonb) || jsonb_build_array(item) where key = target_key; end $f$""")
    c.run("do $$ begin if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if; end $$")
    c.run("drop schema if exists storage cascade; create schema storage; create table storage.buckets(id text primary key, name text, public boolean)")
    c.run("drop schema if exists cron cascade; create schema cron; create table cron.job(jobid serial primary key, jobname text unique, schedule text, command text, active boolean default true)")
    c.run("create function cron.schedule(n text, s text, cmd text) returns bigint language sql as $$ insert into cron.job(jobname, schedule, command) values (n, s, cmd) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$")
    c.run("create function cron.unschedule(n text) returns boolean language sql as $$ with d as (delete from cron.job where jobname = n returning 1) select exists (select 1 from d) $$")
    c.run("drop schema if exists vault cascade; create schema vault; create table vault.decrypted_secrets(name text, decrypted_secret text)")
    if vault: c.run("insert into vault.decrypted_secrets values ('hub_job_secret', 'j' || repeat('x', 63))")
    c.run("drop schema if exists net cascade; create schema net"); c.close()
    for f in (LOG, os.path.join(T, "fail")):
        if os.path.exists(f): os.remove(f)
def run(**over):
    rep = os.path.join(T, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_API_BASE=URL, SB_FN_BASE=URL, SB_SUPA_CLI=CLI, SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(PINS), SB_SETTLE="0"); env.update(over)
    p = subprocess.run([sys.executable, os.path.join(W, "client_journey_482.py")], env=env, capture_output=True, text=True, timeout=300)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
deployed = lambda: os.path.exists(LOG) and "functions deploy client-journey" in open(LOG).read()
try:
    fresh(); code, out = run(SB_FN_SHAS=json.dumps(dict(PINS, **{"client-journey/catalog-v1.json": "0" * 64})))
    ck("a changed build (even the catalog) is refused before anything runs", code == 2 and "not the reviewed build" in out and not deployed(), out)
    fresh(vault=False); code, out = run()
    ck("no job secret in the vault: stops before changing anything", code == 4 and not deployed() and db("select count(*) from information_schema.tables where table_name='client_journey'") == 0, out)
    fresh(leads=json.dumps([{"id": "L1", "client_first_name": "Real", "client_last_name": "Person", "funding_source": "medicaid"}]))
    code, out = run()
    ck("DONE: tables, catalog, service, the 10-minute check, three TEST clients", code == 0 and deployed() and "RESULT: DONE" in out and db("select count(*) from client_journey_step_def") == 38
       and db("select count(*) from cron.job where jobname='client-journey-sweep' and schedule='*/10 * * * *' and command like '%x-cron-secret%' and command like '%sweep%'") == 1, out)
    L = db("select data from app_data where key='leads'"); L = json.loads(L) if isinstance(L, str) else L
    ck("...the three TEST clients are marked TEST, assigned to Samantha; the real lead is untouched", sorted(x["id"] for x in L) == ["L1", "TEST-J1", "TEST-J2", "TEST-J3"]
       and all(x.get("is_test") and x["assigned_coordinator"] == "samantha@mo-care.com" and "(TEST)" in x["client_last_name"] for x in L if x["id"].startswith("TEST")) and [x for x in L if x["id"] == "L1"][0] == {"id": "L1", "client_first_name": "Real", "client_last_name": "Person", "funding_source": "medicaid"}, L)
    ck("...the switch stays off, no real journey, nothing for signed-in users", db("select data->>'client_journey_live' from app_data where key='ops_settings'") is None and "OFF (stays off" in out and "no real lead or client has a journey yet" in out and "can read or change the journey tables directly" in out, out)
    ck("...keys never printed", ANON not in out and SVC not in out, out)
    db("update client_journey_step_def set def = jsonb_set(def, '{title}', '\"Edited by an owner\"') where key = 'intake.payer'")
    code, out = run()
    ck("run again: nothing doubles (catalog kept as edited, TEST clients not added twice)", code == 0 and "0 step(s) added" in out and db("select def->>'title' from client_journey_step_def where key='intake.payer'") == "Edited by an owner" and "0 added, 3 already there" in out, out)
    fresh(); open(os.path.join(T, "fail"), "w").write("1"); code, out = run()
    ck("a failed deploy stops (tables are in, nothing scheduled, no TEST clients)", code == 6 and db("select count(*) from cron.job") == 0, out)
finally:
    subprocess.run(["git", "worktree", "remove", "--force", W], cwd=HERE); shutil.rmtree(T, ignore_errors=True); H.shutdown()
for n, okk, d_ in res: print(("PASS" if okk else "FAIL"), "·", n, d_)
print(f"{sum(1 for x in res if x[1])} passed, {sum(1 for x in res if not x[1])} failed")
raise SystemExit(0 if all(x[1] for x in res) else 1)
