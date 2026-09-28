#!/usr/bin/env python3
# Desktop 280 (public senders, three projects) against a fake Supabase over a real disposable Postgres (stand-in Vault,
# pg_cron, pg_net), with fake functions answering by the NEW rules (or the OLD ones on request). Never touches production.
import os, json, threading, subprocess, hashlib, re
from http.server import BaseHTTPRequestHandler, HTTPServer
from decimal import Decimal
from urllib.parse import urlparse
H = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(H, "journey_v2_proof.py")).read()
exec(compile(src[:src.index("# =============================================================================\n# CLUSTER 1")], "defs", "exec"))
c = Cluster("psi"); P = setup_supabase_like(c); s = c.su
for q in ["create schema if not exists vault", "create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, description text)",
          "create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets",
          "create function vault.create_secret(v text, n text, d text) returns uuid language sql as $$ insert into vault.secrets(name, secret, description) values (n, v, d) returning id $$",
          "create function vault.update_secret(i uuid, v text) returns void language sql as $$ update vault.secrets set secret = v where id = i $$",
          "create schema if not exists cron", "create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean default true)",
          """create function cron.schedule(n text, sch text, cmd text) returns bigint language sql as $$ insert into cron.job(jobname, schedule, command, active) values (n, sch, cmd, true)
             on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command, active = true returning jobid $$""",
          "create function cron.alter_job(job_id bigint, active boolean) returns void language sql as $$ update cron.job set active = alter_job.active where jobid = job_id $$",
          "create schema if not exists net", "create table net.requests (id bigserial primary key, url text, headers jsonb, body jsonb, done boolean default false)",
          "create table net._http_response (id bigint, status_code int, content text, created timestamptz default now())",
          "create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int default 5000) returns bigint language sql as $$ insert into net.requests(url, headers, body) values (url, headers, body) returning id $$",
          "create table htl_family_members (id uuid primary key default gen_random_uuid(), email text)"]: s.run(q)
TP, HT, HUB = "rdqujxiycycwhskyvrwa", "lrlczrpehjpncqixubuk", "zngsgedlsxinbygwmxwn"
ANON = {TP: "eyJtp.anon", HT: "eyJht.anon", HUB: "eyJhub.anon"}; S = {}
def setup(**k):
    for t in ("vault.secrets", "cron.job", "net.requests", "net._http_response"): s.run(f"delete from {t}")
    s.run("alter table htl_family_members drop column if exists invite_emailed_at")
    for name, fn, act in (("nightly-axiscare-sync", "sync-axiscare", True), ("monthly-training-backup", "monthly-backup", k.get("backup_active", True))):
        s.run("insert into cron.job(jobname, schedule, command, active) values (:n, '0 8 * * *', :c, :a)", n=name, a=act,
              c=f"select net.http_post(url := 'https://{TP}.supabase.co/functions/v1/{fn}', headers := jsonb_build_object('Authorization','Bearer {ANON[TP]}'), body := '{{}}'::jsonb);")
    S.clear(); S.update(dict(signup_off=True, old=False, secrets={}), **k)
def answer(fn, headers, body):
    h = {k.lower(): v for k, v in headers.items()}
    if S["old"]: return 200, {"ok": True}
    if fn == "resend-relay": return (200, {"ok": True}) if h.get("x-relay-secret") == S["secrets"].get((HUB, "RELAY_SECRET")) else (401, {})
    if fn == "htl-founding-emails": return (400, {}) if body.get("test") else (200, {})
    if fn == "htl-notify": return 401, {}
    if fn in ("sync-axiscare", "monthly-backup") and h.get("x-cron-secret") and h.get("x-cron-secret") == S["secrets"].get((TP, "TRAINING_CRON_SECRET")):
        return 200, ({"ok": True, "authorized": "cron"} if body.get("auth_check") else {"ok": True})
    return 401, {}
def J(v): return int(v) if isinstance(v, Decimal) else (v if isinstance(v, (int, float, bool, str, dict, list, type(None))) else str(v))
class Hd(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def reply(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        u = urlparse(self.path); m = re.match(r"/v1/projects/(\w+)/(.*)", u.path)
        if not m: return self.reply(404, {})
        ref, rest = m.groups()
        if rest == "config/auth": return self.reply(200, {"disable_signup": S["signup_off"]})
        if rest.startswith("functions/"): return self.reply(200, {"verify_jwt": rest.endswith("monthly-backup") or rest.endswith("send-certificate")})
        if rest == "api-keys": return self.reply(200, [{"name": "anon", "api_key": ANON[ref]}, {"name": "service_role", "api_key": "eyJsvc." + ref}])
        self.reply(404, {})
    def do_POST(self):
        u = urlparse(self.path); body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        m = re.match(r"/v1/projects/(\w+)/(.*)", u.path)
        if m and m.group(2) == "secrets":
            for x in body: S["secrets"][(m.group(1), x["name"])] = x["value"]
            return self.reply(201, {})
        if m and m.group(2) == "database/query":
            cc = c.conn()
            try:
                rows = cc.run(body["query"]); cols = [d["name"] for d in (cc.columns or [])]
                out = [{k: J(v) for k, v in zip(cols, r)} for r in (rows or [])]; code = 201
            except Exception as e: out = {"message": str(e)[:300]}; code = 400
            finally: cc.close()
            for rid, url, hd, bd in s.run("select id, url, headers, body from net.requests where not done"):
                hd = hd if isinstance(hd, dict) else json.loads(hd); bd = bd if isinstance(bd, dict) else json.loads(bd or "{}")
                st, ans = answer(url.rsplit("/", 1)[1], hd, bd)
                s.run("insert into net._http_response(id, status_code, content) values (:i, :s, :c)", i=rid, s=st, c=json.dumps(ans)); s.run("update net.requests set done = true where id = :i", i=rid)
            return self.reply(code, out)
        if u.path.startswith("/functions/v1/"):
            st, ans = answer(u.path.rsplit("/", 1)[1], dict(self.headers), body); return self.reply(st, ans)
        self.reply(404, {})
srv = HTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_address[1]}"
HOME = os.path.expanduser("~/Claude/Projects")
ROOTS = {HUB: H, TP: os.path.join(HOME, "Caring Companions Training Platform"), HT: os.path.join(HOME, "HomeTogether")}
FILES = [f"{HUB}:resend-relay/index.ts", f"{HT}:htl-founding-emails/index.ts", f"{HT}:htl-notify/index.ts", f"{TP}:_shared/guard.ts"] + \
        [f"{TP}:{f}/index.ts" for f in ("send-certificate", "send-invite", "send-reminder", "monthly-backup", "sync-axiscare")]
def sha(f): ref, rel = f.split(":", 1); return hashlib.sha256(open(os.path.join(ROOTS[ref], "supabase/functions", rel), "rb").read()).hexdigest()
res = []
def ck(n, g, note=""): res.append((n, bool(g), "" if g else str(note)[-900:]))
def run(shas=None):
    rep = os.path.join(H, "_psi.txt")
    p = subprocess.run(["python3", "security_public_install.py"], cwd=H, capture_output=True, text=True, env=dict(os.environ, SB_TOKEN="sbp_x", SB_REPORT=rep,
        SB_API_BASE=BASE, SB_FN_BASE=BASE, SB_SKIP_FUNCTION="1", SB_ROOT_HUB=ROOTS[HUB], SB_ROOT_TP=ROOTS[TP], SB_ROOT_HT=ROOTS[HT],
        SB_PUBLIC_ORDER_TOKEN="htorder_pub", SB_PUBLIC_HTL_TOKEN="htlpub_pub", SB_POLL_SEC="0.2", SB_POLL_MAX="3", SB_SHAS=json.dumps(shas or {f: sha(f) for f in FILES})))
    t = open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr
    if os.path.exists(rep): os.remove(rep)
    return p.returncode, t
deployed = lambda t: [l.split("would deploy ")[1] for l in t.splitlines() if "would deploy" in l]
col = lambda: s.run("select exists (select 1 from information_schema.columns where table_name='htl_family_members' and column_name='invite_emailed_at')")[0][0]
setup(); rc, t = run()
ck("happy path: CLOSED; 8 functions deployed across three projects, each keeping its sign-in check", rc == 0 and "RESULT: CLOSED" in t and len(deployed(t)) == 8
   and "Training Platform monthly-backup" in "\n".join(deployed(t)) and any(d.startswith("Training Platform sync-axiscare --no-verify-jwt") for d in deployed(t)), t)
ck("the same relay secret went to the Hub and HomeTogether Hire; the Training secret is in its Vault; none are printed",
   S["secrets"].get((HUB, "RELAY_SECRET")) == S["secrets"].get((HT, "RELAY_SECRET")) and len(S["secrets"][(HUB, "RELAY_SECRET")]) >= 48
   and s.run("select decrypted_secret from vault.decrypted_secrets")[0][0] == S["secrets"][(TP, "TRAINING_CRON_SECRET")]
   and all(v not in t for v in S["secrets"].values()) and "eyJ" not in t, t)
jobs = {n: (a, cmd) for n, a, cmd in s.run("select jobname, active, command from cron.job")}
ck("both Training jobs now carry the secret from Vault, keep their schedule and state, and never hold the secret itself",
   all("vault.decrypted_secrets" in cmd and "x-cron-secret" in cmd and S["secrets"][(TP, "TRAINING_CRON_SECRET")] not in cmd for _, cmd in jobs.values()), jobs)
ck("the invite column is added; every live probe refused or check-only; both scheduled paths accepted through Vault",
   col() and t.count("refused, 401") >= 7 and "refused, 400 (the mode is gone)" in t and t.count("with the Vault secret: accepted") == 2, t)
setup(backup_active=False); rc, t = run()
ck("a paused Training job stays paused", s.run("select active from cron.job where jobname='monthly-training-backup'")[0][0] is False, t[-400:])
setup(signup_off=False); rc, t = run()
ck("if the Training Platform allowed self-signup: STOP before anything changes (a signed-in account would not mean staff)",
   rc == 2 and "allows anyone to create an account" in t and not S["secrets"] and not col() and deployed(t) == [], t)
setup(old=True); rc, t = run()
ck("if the old open code were still answering, the proof fails loudly", rc == 9 and "relay may still be open" in t, t)
setup(); bad = {f: sha(f) for f in FILES}; bad[f"{TP}:_shared/guard.ts"] = "0" * 64; rc, t = run(bad)
ck("a source that is not the reviewed build: STOP before any secret, column or deploy", rc == 4 and not S["secrets"] and not col() and deployed(t) == [], t)
srv.shutdown(); c.close()
print("\nDESKTOP 280 · PUBLIC SENDERS · INSTALL PROOF\n" + "=" * 60); ok = True
for n, g, note in res: ok &= g; print(("PASS  " if g else "FAIL  ") + n + (("\n   └─ " + note) if note else ""))
print("=" * 60); print(f"ALL {len(res)} PROOFS PASS" if ok else "FAILED")
