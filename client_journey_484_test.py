#!/usr/bin/env python3
# Rehearsal of 484 (the move-over) from a FRESH copy at the commit being tested, against a FAKE Supabase: a throwaway local Postgres with a
# stand-in job scheduler, vault and net; a fake deploy; a fake talk-notify. Never touches a real project.
import json, os, subprocess, sys, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "my_desk_463_sql_test.py")).read()
exec(src[:src.index("c = conn(); setup(c)")])
from pg8000.native import DatabaseError
REF = "zngsgedlsxinbygwmxwn"; COMMIT = os.environ.get("REHEARSE_COMMIT") or subprocess.run(["git", "rev-parse", "HEAD"], cwd=HERE, capture_output=True, text=True).stdout.strip()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
ANON, SVC = "eyJanon" + "a" * 40, "eyJsvc" + "s" * 40
M = {"version": None, "secrets": ["GHL_TOKEN", "GHL_LOCATION_ID"]}; ADOPT = []
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
            if self.headers.get("Authorization") != "Bearer " + SVC: return self._send(401, {"error": "Sign in first."})
            b = json.loads(raw or b"{}")
            if b.get("action") != "adopt": return self._send(200, {"ok": True, "live": False})
            cc = conn(); out = []
            try:
                ops = cc.run("select data from app_data where key='ops_settings'")[0][0]; routes = ops.get("client_journey_routing") or {}
                leads = cc.run("select data from app_data where key='leads'")[0][0]
                for x in b["people"]:
                    l = next((y for y in leads if str(y.get("id")) == str(x.get("lead_id"))), None) if x.get("lead_id") else None
                    pay = {"medicaid": "medicaid", "private": "private", "private pay": "private"}.get(str((l or {}).get("funding_source") or "").lower())
                    who = routes.get(pay or "unknown"); how = "routing"
                    if l and l.get("assigned_coordinator") == "Krystal": who, how = "krystal@mo-care.com", "lead coordinator"
                    name = x.get("client_name") or ((l.get("client_first_name") or "") + " " + (l.get("client_last_name") or "")).strip()
                    if cc.run("select count(*) from client_journey where lead_id is not distinct from :l and axiscare_client_id is not distinct from :a", l=x.get("lead_id"), a=x.get("axiscare_client_id"))[0][0]:
                        out.append({**x, "outcome": "exists"}); continue
                    cc.run("insert into client_journey(lead_id, axiscare_client_id, client_name, payer, assigned_cc, assigned_how, created_by) values (:l, :a, :n, :p, :c, :h, 'hub')",
                           l=x.get("lead_id"), a=x.get("axiscare_client_id"), n=name, p=pay, c=who, h=how)
                    out.append({**x, "outcome": "created", "assigned_cc": who, "how": how, "stage": "intake"})
            finally: cc.close()
            ADOPT.append(b); return self._send(200, {"ok": True, "adopted": out})
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
T = tempfile.mkdtemp(prefix="reh484-"); W = os.path.join(T, "hub")
subprocess.run(["git", "worktree", "add", "-q", "--detach", W, COMMIT], cwd=HERE, check=True)
FNROOT = os.path.join(W, "supabase", "functions"); sha = lambda p_: hashlib.sha256(open(p_, "rb").read()).hexdigest()
PINS = {"client-journey": sha(os.path.join(FNROOT, "client-journey", "index.ts")), "_shared/journey-rules.js": sha(os.path.join(FNROOT, "_shared", "journey-rules.js")),
        "_shared/staff-auth.ts": sha(os.path.join(FNROOT, "_shared", "staff-auth.ts")), "_shared/job-auth.ts": sha(os.path.join(FNROOT, "_shared", "job-auth.ts")),
        "client-journey/move-over.sql": sha(os.path.join(W, "client-journey", "move-over.sql"))}
LEADS = json.dumps([
  {"id": "a1", "client_first_name": "Tommy", "client_last_name": "Fortner", "funding_source": "Medicaid", "status": "New"},
  {"id": "a2", "client_first_name": "Phyllis", "client_last_name": "Netzer", "funding_source": "private", "status": "Contacted", "assigned_coordinator": "Krystal"},
  {"id": "a3", "client_first_name": "Karen", "funding_source": "private", "status": "New", "assigned_coordinator": "Krystal"},
  {"id": "a4", "client_first_name": "Andrew", "client_last_name": "T", "status": "New"},
  {"id": "id_aadljdmgms9vl8xp", "status": "New", "soc": {"pathway": "A1", "steps": [{"id": "p0", "label": "Intake call"}]}},
  {"id": "TEST-J1", "is_test": True, "client_first_name": "Linda", "client_last_name": "Boyd (TEST)", "status": "Contacted"}])
LOG = os.path.join(T, "deploys.txt"); CLI = os.path.join(T, "supabase")
open(CLI, "w").write(f"#!/bin/sh\necho \"$@\" >> {LOG}\n[ -f {T}/fail ] && {{ echo boom >&2; exit 1; }}\ncurl -s -o /dev/null -X POST {URL}/bump\nexit 0\n"); os.chmod(CLI, 0o755)
def db(q):
    c = conn()
    try: r = c.run(q); return r[0][0] if r else None
    finally: c.close()
def fresh(vault=True, ops='{"client_start_live": true}', leads=None, angiel=True):
    leads = leads if leads is not None else LEADS
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
    c = conn()
    c.run(open(os.path.join(W, "client-journey", "client-journey.sql")).read())
    c.run("create table public.client_queue(id serial primary key, client_name text, axiscare_client_id text, status text, completed_at timestamptz, launch_completed_at timestamptz, exception_reason text)")
    c.run("insert into public.client_queue(client_name, axiscare_client_id, status) values ('Tommy Mason','294','open'), ('Office Staff','293','open'), ('Test Client 6','291','open'), ('Test Client 5','290','open')")
    c.run("insert into public.app_data values ('ops_items', '[]'::jsonb, 1)")
    c.run("select cron.schedule('client-start-run', '35 * * * *', 'select 1')")
    if angiel: c.run("insert into public.staff_roles values (:a, 'cc_ihs', 'care_coordinator')", a=ANG)
    c.close()
    for f in (LOG, os.path.join(T, "fail")):
        if os.path.exists(f): os.remove(f)
def run(**over):
    rep = os.path.join(T, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_API_BASE=URL, SB_FN_BASE=URL, SB_SUPA_CLI=CLI, SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(PINS), SB_SETTLE="0"); env.update(over)
    p = subprocess.run([sys.executable, os.path.join(W, "client_journey_484.py")], env=env, capture_output=True, text=True, timeout=300)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
deployed = lambda: os.path.exists(LOG) and "functions deploy client-journey" in open(LOG).read()
try:
    fresh(); code, out = run(SB_FN_SHAS=json.dumps(dict(PINS, **{"client-journey/move-over.sql": "0" * 64})))
    ck("a changed build is refused before anything runs", code == 2 and "not the reviewed build" in out and not deployed(), out)
    fresh(angiel=False); code, out = run()
    ck("Angiel hasn't started (no office role): Medicaid and VA go to Krystal for now, and the report says so", code == 0 and "Angiel hasn't started yet" in out and "everyone to Krystal for now" in out
       and db("select data->'client_journey_routing' from app_data where key='ops_settings'") == {k: "krystal@mo-care.com" for k in ("medicaid", "va", "private", "ltc", "other", "unknown")}
       and "journey started: Tommy Fortner · Krystal" in out, out)
    fresh(); code, out = run()
    ck("DONE", code == 0 and "RESULT: DONE" in out and deployed(), out)
    ck("...routing saved: Medicaid and VA to Angiel, the rest to Krystal; the older job's switch off; the client journeys switch untouched (off)",
       db("select data->'client_journey_routing' from app_data where key='ops_settings'") == {"medicaid": "angiel@example.invalid", "va": "angiel@example.invalid", "private": "krystal@mo-care.com", "ltc": "krystal@mo-care.com", "other": "krystal@mo-care.com", "unknown": "krystal@mo-care.com"}
       and db("select data->>'client_start_live' from app_data where key='ops_settings'") == "false" and db("select data->>'client_journey_live' from app_data where key='ops_settings'") is None, out)
    ck("...client-start-run unscheduled; the 10-minute journey check (482) not touched", db("select count(*) from cron.job where jobname='client-start-run'") == 0, out)
    ck("...the move-over record lists every lead that exists now (the August ones included)", sorted(db("select data->'lead_ids' from app_data where key='client_journey_cutover'")) == sorted(["a1", "a2", "a3", "a4", "id_aadljdmgms9vl8xp", "TEST-J1"]), out)
    ck("...Office Staff and Test Clients 5 and 6 closed with the reason; Tommy Mason left open", db("select string_agg(client_name || ':' || status, ',' order by id) from client_queue") == "Tommy Mason:open,Office Staff:complete,Test Client 6:complete,Test Client 5:complete"
       and db("select count(*) from client_queue where status='complete' and launch_completed_at is not null and exception_reason like '%move-over%'") == 3, out)
    L = db("select data from app_data where key='leads'"); B = [x for x in L if x["id"] == "id_aadljdmgms9vl8xp"][0]
    ck("...the blank checklist's lead archived with a note; every other lead untouched", B.get("archived") is True and "unarchive" in B.get("archive_note", "").lower() and [x for x in L if x["id"] != "id_aadljdmgms9vl8xp"] == [x for x in json.loads(LEADS) if x["id"] != "id_aadljdmgms9vl8xp"], L)
    ck("...journeys started for Tommy Fortner, Phyllis Netzer, Karen, Ed and Peggy (and nobody else)", db("select string_agg(client_name, ',' order by client_name) from client_journey") == "Edward Anderson,Karen,Peggy Thomason,Phyllis Netzer,Tommy Fortner"
       and ADOPT[-1]["people"] == [{"lead_id": "a1"}, {"lead_id": "a2"}, {"lead_id": "a3"}, {"axiscare_client_id": "296", "client_name": "Edward Anderson"}, {"axiscare_client_id": "295", "client_name": "Peggy Thomason"}], [out, ADOPT[-1]])
    ck("...the report says who got each one", "journey started: Tommy Fortner · Angiel" in out and "journey started: Phyllis Netzer · Krystal (lead coordinator)" in out and "journey started: Edward Anderson · Krystal" in out, out)
    ck("...switched off: no journey on anyone's My Work; keys never printed", "no real journey shows on anyone's My Work yet" in out and ANON not in out and SVC not in out, out)
    code, out = run()
    ck("run again: nothing doubles (journeys exist, launches and the blank lead left alone, the move-over record kept)", code == 0 and out.count("already had a journey") == 5 and "move-over record was already there" in out
       and "not open any more, left alone" in out and db("select count(*) from client_journey") == 5, out)
    fresh(leads=json.dumps([x for x in json.loads(LEADS) if x["id"] != "a3"] + [{"id": "k1", "client_first_name": "Karen"}, {"id": "k2", "client_first_name": "Karen"}]))
    code, out = run()
    ck("two open leads named Karen: neither is guessed; it says to use Start the journey; everything else still happens", code == 8 and "Karen: 2 open leads have that name" in out and db("select count(*) from client_journey") == 4, out)
    fresh(); open(os.path.join(T, "fail"), "w").write("1"); code, out = run()
    ck("a failed deploy stops: nothing after it changed (routing, launches, journeys)", code == 6 and db("select data->'client_journey_routing' from app_data where key='ops_settings'") is None
       and db("select count(*) from client_queue where status='complete'") == 0 and db("select count(*) from client_journey") == 0, out)
finally:
    subprocess.run(["git", "worktree", "remove", "--force", W], cwd=HERE); shutil.rmtree(T, ignore_errors=True); H.shutdown()
for n, okk, d_ in res: print(("PASS" if okk else "FAIL"), "·", n, d_)
print(f"{sum(1 for x in res if x[1])} passed, {sum(1 for x in res if not x[1])} failed")
raise SystemExit(0 if all(x[1] for x in res) else 1)
