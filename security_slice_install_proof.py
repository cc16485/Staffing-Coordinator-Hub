#!/usr/bin/env python3
# Desktop 274 (security slice install) against a fake Supabase: Management API over a real disposable Postgres (with
# stand-in Vault, pg_cron and pg_net), fake Auth, fake functions that answer by the NEW rules (or, on request, the OLD
# token rule), and a fake live Hub page. Never touches production.
import os, json, re, threading, subprocess, uuid, hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
from decimal import Decimal
from urllib.parse import urlparse, parse_qs
H = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(H, "journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
c = Cluster("ssi"); P = setup_supabase_like(c); s = c.su
PUBLIC = "htorder_" + "ab" * 20; SVC = "eyJsvc.fake.service"; ANON = "eyJanon.fake.anon"
for q in [
  "create table if not exists persons (person_id text primary key, full_name text, active boolean)",
  "create table if not exists entity_memberships (person_id text, entity text, active boolean, ended_at date)",
  "create table if not exists staff_roles (person_id text, entity text, role text)",
  "create table if not exists auth_identities (person_id text, project_ref text, auth_user_id uuid)",
  "create schema if not exists auth", "create table if not exists auth.users (id uuid primary key, raw_app_meta_data jsonb)",
  "create table if not exists care_circles (id uuid primary key default gen_random_uuid(), active boolean default true)",
  "create schema if not exists vault",
  "create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, description text)",
  "create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets",
  "create function vault.create_secret(v text, n text, d text) returns uuid language sql as $$ insert into vault.secrets(name, secret, description) values (n, v, d) returning id $$",
  "create function vault.update_secret(i uuid, v text) returns void language sql as $$ update vault.secrets set secret = v where id = i $$",
  "create schema if not exists cron",
  "create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean default true)",
  """create function cron.schedule(n text, sch text, cmd text) returns bigint language sql as $$
       insert into cron.job(jobname, schedule, command, active) values (n, sch, cmd, true)
       on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command, active = true returning jobid $$""",
  "create function cron.alter_job(job_id bigint, active boolean) returns void language sql as $$ update cron.job set active = alter_job.active where jobid = job_id $$",
  "create schema if not exists net",
  "create table net.requests (id bigserial primary key, url text, headers jsonb, done boolean default false)",
  "create table net._http_response (id bigint, status_code int, content text, created timestamptz default now())",
  """create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int default 5000) returns bigint language sql as $$
       insert into net.requests(url, headers) values (url, headers) returning id $$""",
]: s.run(q)
S = {}   # the fake platform's state
def setup(roles=(("Samantha Owner", "owner_admin"), ("Krystal Coord", "care_coordinator")), job_active=True, job=True, old_code=False, hub_has_token=False):
    for t in ("persons", "entity_memberships", "staff_roles", "auth_identities", "auth.users", "vault.secrets", "cron.job", "net.requests", "net._http_response", "care_circles"):
        s.run(f"delete from {t}")
    for i, (name, role) in enumerate(roles):
        pid, uid = f"p{i}", str(uuid.uuid4())
        s.run("insert into persons values (:p, :n, true)", p=pid, n=name); s.run("insert into entity_memberships values (:p, 'cc_ihs', true, null)", p=pid)
        s.run("insert into staff_roles values (:p, 'cc_ihs', :r)", p=pid, r=role)
        s.run("insert into auth_identities values (:p, 'zngsgedlsxinbygwmxwn', cast(:u as uuid))", p=pid, u=uid)
        s.run("insert into auth.users values (cast(:u as uuid), cast(:m as jsonb))", u=uid, m=json.dumps({"hub_access": ["care_coordinator"]}))
    s.run("insert into care_circles default values")
    if job:
        cmd = ("select net.http_post(url := 'https://ref.supabase.co/functions/v1/campaign-auto?token=" + PUBLIC + "', headers := jsonb_build_object('Content-Type','application/json'), body := '{}'::jsonb);")
        s.run("insert into cron.job(jobname, schedule, command, active) values ('daily-campaign-auto', '0 15 * * *', :c, :a)", c=cmd, a=job_active)
    S.clear(); S.update(fn_secret=None, verify={"campaign-auto": True, "campaign-send": False, "circle-send": True}, old_code=old_code,
                        hub=("<script>const CAMPAIGN_ENDPOINT='x/functions/v1/campaign-send?token=" + PUBLIC + "'</script>") if hub_has_token else "<html>hub</html>",
                        sessions={}, logged_out=[], calls=[])
def J(v): return int(v) if isinstance(v, Decimal) else (v if isinstance(v, (int, float, bool, str, dict, list, type(None))) else str(v))
def fn_answer(fn, qs, headers, body):
    """What the NEW functions answer (or the OLD token rule, when old_code is set)."""
    S["calls"].append(fn)
    if S["old_code"] and qs.get("token", [""])[0] == PUBLIC: return 200, {"ok": True, "recipients": []} if fn == "campaign-auto" else {"ok": True}
    sec = headers.get("x-cron-secret", "")
    if fn == "campaign-auto" and S["fn_secret"] and len(S["fn_secret"]) >= 32 and sec == S["fn_secret"]:
        return 200, ({"ok": True, "authorized": "server"} if qs.get("auth_check") else {"ok": True})
    tok = (headers.get("authorization") or "").replace("Bearer ", "")
    who = S["sessions"].get(tok)
    if not who: return 401, {"error": "Sign in first."}
    if fn == "campaign-auto":
        if not qs.get("resolve") and not qs.get("auth_check") and not qs.get("probe"): return 403, {"error": "schedule only"}
        return 200, {"ok": True, "authorized": "staff"}
    return 200, {"ok": True, "authorized": True}
class Hd(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def reply(self, code, obj=None, text=None):
        b = (text if text is not None else json.dumps(obj)).encode(); self.send_response(code); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        u = urlparse(self.path)
        if u.path.startswith("/v1/projects/r/functions/"): return self.reply(200, {"verify_jwt": S["verify"][u.path.rsplit("/", 1)[1]]})
        if u.path == "/v1/projects/r/api-keys": return self.reply(200, [{"name": "anon", "api_key": ANON}, {"name": "service_role", "api_key": SVC}])
        if u.path == "/hub": return self.reply(200, text=S["hub"])
        self.reply(404, {})
    def do_POST(self):
        u = urlparse(self.path); raw = self.rfile.read(int(self.headers.get("Content-Length") or 0)); body = json.loads(raw or b"{}")
        hd = {k.lower(): v for k, v in self.headers.items()}
        if u.path == "/v1/projects/r/database/query":
            cc = c.conn()
            try:
                rows = cc.run(body["query"]); cols = [d["name"] for d in (cc.columns or [])]
                out = [{k: J(v) for k, v in zip(cols, r)} for r in (rows or [])]; code = 201
            except Exception as e: out = {"message": str(e)[:300]}; code = 400
            finally: cc.close()
            for rid, url, h in s.run("select id, url, headers from net.requests where not done"):   # pg_net: deliver queued requests
                h = h if isinstance(h, dict) else json.loads(h); pu = urlparse(url)
                st, ans = fn_answer(pu.path.rsplit("/", 1)[1], parse_qs(pu.query), {k.lower(): v for k, v in h.items()}, {})
                s.run("insert into net._http_response(id, status_code, content) values (:i, :s, :c)", i=rid, s=st, c=json.dumps(ans))
                s.run("update net.requests set done = true where id = :i", i=rid)
            return self.reply(code, out)
        if u.path == "/v1/projects/r/secrets":
            for x in body: S["fn_secret"] = x["value"] if x["name"] == "CAMPAIGN_CRON_SECRET" else S["fn_secret"]
            return self.reply(201, {})
        if u.path == "/auth/v1/admin/generate_link":
            if hd.get("authorization") != "Bearer " + SVC: return self.reply(401, {})
            th = "th-" + uuid.uuid4().hex; S["pending"] = th; return self.reply(200, {"hashed_token": th, "action_link": "x"})
        if u.path == "/auth/v1/verify":
            if body.get("token_hash") != S.get("pending"): return self.reply(400, {})
            at = "eyJuser." + uuid.uuid4().hex; S["sessions"][at] = "owner"; return self.reply(200, {"access_token": at})
        if u.path == "/auth/v1/logout":
            S["logged_out"].append(hd.get("authorization")); S["sessions"].pop((hd.get("authorization") or "").replace("Bearer ", ""), None); return self.send_response(204) or self.end_headers()
        if u.path.startswith("/functions/v1/"):
            st, ans = fn_answer(u.path.rsplit("/", 1)[1], parse_qs(u.query), hd, body); return self.reply(st, ans)
        self.reply(404, {})
srv = HTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_address[1]}"
FNROOT = os.path.join(H, "supabase", "functions")
FILES = ["campaign-auto", "campaign-send", "circle-send", "_shared/staff-auth.ts", "_shared/outreach.ts"]
def sha(f): return hashlib.sha256(open(os.path.join(FNROOT, f) if f.endswith(".ts") else os.path.join(FNROOT, f, "index.ts"), "rb").read()).hexdigest()
HUBF = os.path.join(H, "_ssi_hub.html"); open(HUBF, "w").write("const HL_EP='x?token=" + PUBLIC + "';")
res = []
def ck(n, g, note=""): res.append((n, bool(g), "" if g else str(note)[-900:]))
def run(shas=None):
    rep = os.path.join(H, "_ssi.txt")
    p = subprocess.run(["python3", "security_slice_install.py"], cwd=H, capture_output=True, text=True, env=dict(os.environ,
        SB_TOKEN="sbp_x", SB_REF="r", SB_REPORT=rep, SB_API_BASE=BASE, SB_FN_BASE=BASE, SB_HUB_URL=BASE + "/hub", SB_HUB_FILE=HUBF,
        SB_SKIP_FUNCTION="1", SB_FNROOT=FNROOT, SB_PROOF_EMAIL="owner@example.test", SB_POLL_SEC="0.2", SB_POLL_MAX="3",
        SB_FN_SHAS=json.dumps(shas or {f: sha(f) for f in FILES})))
    t = open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr
    if os.path.exists(rep): os.remove(rep)
    return p.returncode, t
job = lambda: s.run("select schedule, active, command from cron.job where jobname = 'daily-campaign-auto'")
vault = lambda: [r[0] for r in s.run("select decrypted_secret from vault.decrypted_secrets where name = 'campaign_cron_secret'")]

setup(); rc, t = run(); j = job()[0]; v = vault()
ck("happy path: CLOSED, every refusal proven, the scheduled path accepted through Vault, and the permission checks as the owner pass",
   rc == 0 and "RESULT: CLOSED" in t and t.count("✓") >= 20 and "accepted as the scheduled run" in t and "Family Circle check as you" in t, t)
ck("the same new secret is in Vault and in the function secrets, at least 48 characters", len(v) == 1 and v[0] == S["fn_secret"] and len(v[0]) >= 48, (v, S["fn_secret"]))
ck("the daily job keeps its schedule and stays active, no longer carries the token, reads the secret from Vault, and never holds the secret itself",
   j[0] == "0 15 * * *" and j[1] is True and "token=" not in j[2] and "vault.decrypted_secrets" in j[2] and v[0] not in j[2], j)
ck("nothing secret reaches the report: not the new secret, the public token, the service or anon key, or the one-time sign-in",
   all(x not in t for x in (v[0], PUBLIC, SVC, ANON, "eyJuser")) and "owner@example.test" not in t, t)
ck("the report lists staff by first name and role only, with what each can do", "Samantha" in t and "campaigns: yes" in t and "Krystal" in t and "Family Circle send: yes" in t and "Owner" not in t, t)
ck("the one-time sign-in used for the permission check was signed out", len(S["logged_out"]) == 1 and not S["sessions"], S["logged_out"])
ck("no real circle id is printed", all(str(r[0]) not in t for r in s.run("select id from care_circles")), t)
setup(job_active=False); rc, t = run()
ck("a paused daily job stays paused", job()[0][1] is False, (job(), t[-400:]))
setup(hub_has_token=True); rc, t = run()
ck("if the live Hub page still has the old token, it says so plainly and it is not a failure (the server is the boundary)", rc == 0 and "has not reached the site yet" in t, t)
setup(old_code=True); rc, t = run()
ck("if a function still accepted the public token (the old code), the proof catches it and fails", rc == 9 and "old public page token → refused" not in t.replace("✗ old public page token → refused", "") and "✗ old public page token" in t, t)
setup(); bad_sha = {f: sha(f) for f in FILES}; bad_sha["campaign-send"] = "0" * 64; rc, t = run(bad_sha)
ck("a source that is not the reviewed build: STOP before any secret is set, any job changed, or anything deployed",
   rc == 5 and S["fn_secret"] is None and not vault() and "token=" in job()[0][2], t)
setup(roles=(("Krystal Coord", "care_coordinator"),)); rc, t = run()
ck("if nobody would be able to use campaigns, it stops and changes nothing", rc == 2 and "nobody would be able to use campaigns" in t and S["fn_secret"] is None and "token=" in job()[0][2], t)
setup(job=False); rc, t = run()
ck("if the daily job is missing, it stops and changes nothing", rc == 4 and S["fn_secret"] is None and not vault(), t)
setup(); rc, t = run(); first = vault()[0]; rc2, t2 = run()
ck("a rerun replaces the secret in both places (no duplicate Vault entry) and still passes", rc2 == 0 and len(vault()) == 1 and vault()[0] != first and vault()[0] == S["fn_secret"], t2)
os.remove(HUBF); srv.shutdown(); c.close()
print("\nDESKTOP 274 · SECURITY SLICE INSTALL · PROOF\n" + "=" * 60); ok = True
for n, g, note in res: ok &= g; print(("PASS  " if g else "FAIL  ") + n + (("\n   └─ " + note) if note else ""))
print("=" * 60); print(f"ALL {len(res)} PROOFS PASS" if ok else "FAILED")
