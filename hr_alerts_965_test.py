#!/usr/bin/env python3
# Rehearsal of 965 (hr_alerts_965.py, Zach's alerts, HR Agent step 7): a FAKE management API whose queries run in a
# throwaway LOCAL Postgres (pgserver), a fake hr-alerts function, a fake REST door and a fake Hub page. Never touches
# Supabase or GoHighLevel. Runs from a fresh copy of the committed build.   python3 hr_alerts_965_test.py
#   CMD=<path to the Desktop .command> also rehearses the launcher itself with a fake HOME (no real token, no real call).
import json, os, re, subprocess, tempfile, threading, http.server, glob, datetime, hashlib
import pgserver
from pg8000.native import Connection, DatabaseError
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1600]))
TMP = tempfile.mkdtemp(prefix="t965-"); COPY = os.path.join(TMP, "hub")
subprocess.run(["git", "clone", "-q", HERE, COPY], check=True)
HEAD = subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
subprocess.run(["git", "-C", COPY, "checkout", "-q", HEAD], check=True)
D = os.path.join(TMP, "pg"); os.makedirs(D)
srvpg = pgserver.get_server(D)
host = [kv[5:] for kv in srvpg.get_uri().split("?", 1)[1].split("&") if kv.startswith("host=")][0]
SOCK = [p for p in glob.glob(os.path.join(host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
conn = lambda: Connection(user="postgres", database="postgres", unix_sock=SOCK)
ZAC, KRY = "a0000000-0000-0000-0000-000000000003", "a0000000-0000-0000-0000-000000000002"
PHONE, EMAILS = "4175550100", "zach@example.com, Other@Example.org"

def seed(coaching=True, vault=1):
    c = conn()
    c.run("drop schema if exists public cascade; create schema public; drop schema if exists auth cascade; create schema auth")
    for r in ("authenticated", "anon", "service_role"):
        c.run(f"do $$ begin if not exists (select 1 from pg_roles where rolname = '{r}') then create role {r}; end if; end $$")
    c.run("grant usage on schema public, auth to authenticated, anon, service_role")
    c.run("create table auth.users(id uuid primary key, email text, banned_until timestamptz, raw_app_meta_data jsonb default '{}')")
    c.run(f"insert into auth.users(id, email) values ('{ZAC}', 'zach@mo-care.com'), ('{KRY}', 'krystal@mo-care.com')")
    c.run("create table public.app_data(key text primary key, data jsonb, updated_at timestamptz default now())")
    c.run("grant select, insert, update, delete on public.app_data to authenticated")
    c.run("insert into public.app_data values ('ops_settings', '{}'::jsonb)")
    c.run("create table public.hr_cases(id text primary key, kind text, status text)")
    if coaching: c.run("create table public.hr_coaching(id uuid primary key, status text)")
    c.run("drop schema if exists cron cascade; drop schema if exists vault cascade; drop schema if exists net cascade")
    c.run("create schema cron; create schema vault; create schema net")
    c.run("create table cron.job(jobid serial, jobname text unique, schedule text, command text)")
    c.run("create function cron.schedule(n text, s text, cmd text) returns bigint language sql as $$ insert into cron.job(jobname, schedule, command) values (n, s, cmd) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$")
    c.run("create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n returning true $$")
    c.run("create table vault.decrypted_secrets(name text, decrypted_secret text)")
    if vault: c.run("insert into vault.decrypted_secrets values ('hub_job_secret', 'sekret')")
    c.run("create table net._http_response(id bigserial primary key, status_code int, content text)")
    c.run("""create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint language sql as $$ insert into net._http_response(status_code, content) values (200, '{"ok": true, "caller": "cron"}') returning id $$""")
    c.close()
def q1(s, **kw):
    c = conn(); r = c.run(s, **kw); c.close(); return r
def act(uid, q):
    c = conn(); c.run("begin")
    c.run("select set_config('request.jwt.claims', :c, true)", c=json.dumps({"sub": uid, "role": "authenticated"}))
    c.run("set local role authenticated")
    try: out = c.run(q)
    except DatabaseError as e: out = "ERR " + str(e)[:200]
    try: c.run("rollback")
    except Exception: pass
    c.close(); return out
def jsonable(v): return v.isoformat() if isinstance(v, (datetime.date, datetime.datetime)) else (str(v) if v.__class__.__name__ == "UUID" else v)
M = {}
class F(http.server.BaseHTTPRequestHandler):
    """the fake management API, the fake hr-alerts function, the fake REST door and the fake Hub page"""
    def log_message(self, *a): pass
    def _send(self, code, obj, ctype="application/json"):
        b = (obj if isinstance(obj, str) else json.dumps(obj, default=str)).encode(); self.send_response(code); self.send_header("Content-Type", ctype); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if "/api-keys" in self.path: return self._send(200, [{"name": "anon", "api_key": "eyJanonKEY"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
        if self.path.endswith("/secrets"): return self._send(200, [{"name": n} for n in (("GHL_TOKEN", "GHL_LOCATION_ID") if M.get("ghl", True) else ("GHL_TOKEN",))])
        if self.path.endswith("/functions/hr-alerts"):
            return self._send(200, {"version": 1, "verify_jwt": True}) if os.path.exists(os.path.join(TMP, "deployed")) else self._send(404, {})
        if self.path.startswith("/rest/v1/"):
            return self._send(200, [{"id": "x"}]) if M.get("leak") and "hr_cases" in self.path else self._send(200, [])
        if self.path == "/":
            return self._send(200, '<div id="signinScreen"><input type="password" id="loginPassword"></div>' if M.get("hub", True) else "<div>open</div>", "text/html")
        self._send(404, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"null")
        if self.path.endswith("/database/query"):
            c = conn()
            try:
                rows = c.run(body["query"]); cols = [d_["name"] for d_ in (c.columns or [])]
                return self._send(201, [dict(zip(cols, [jsonable(v) for v in r])) for r in (rows or [])])
            except DatabaseError as e:
                try: c.run("rollback")
                except Exception: pass
                return self._send(400, {"message": str(e)[:600]})
            finally: c.close()
        if self.path.startswith("/functions/v1/hr-alerts"):
            auth = self.headers.get("Authorization", "")
            if "svc" not in auth: return self._send(401, {"error": "not allowed"})
            if "test=1" in self.path:
                M["tests"] = M.get("tests", 0) + 1
                if M.get("quiet"): return self._send(409, {"error": "quiet"})
                return self._send(200, {"ok": True, "test": True, "texts": 1, "emails": 2})
            if "dry=1" in self.path: return self._send(200, {"ok": True, "live": False, "dry": True, "waiting": 3, "new": 3, "would_text": True, "would_email": 2})
        self._send(404, {})
fsrv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), F); threading.Thread(target=fsrv.serve_forever, daemon=True).start()
FURL = f"http://127.0.0.1:{fsrv.server_address[1]}"
FAKEBIN = os.path.join(TMP, "bin"); os.makedirs(FAKEBIN)
open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil
a = sys.argv[1:]
if a[:2] == ['functions', 'deploy']: open(os.path.join({TMP!r}, 'deployed'), 'w').write('x'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    shutil.copytree(os.path.join({COPY!r}, 'supabase', 'functions'), os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True); sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
FNR = os.path.join(COPY, "supabase", "functions")
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
FILES = ("hr-alerts/index.ts", "_shared/hr-alert-rules.ts", "_shared/job-auth.ts", "_shared/clockin-admins.ts", "_shared/send-problems.ts", "_shared/staff-contact.ts")
SHAS = {k: sha(os.path.join(FNR, k)) for k in FILES}
ENVF = lambda rep: dict(os.environ, SB_STEP="965", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=FURL, SB_FN_BASE=FURL, SB_HUB_BASE=FURL,
                        SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_FNROOT=FNR, SB_SETTLE="0")
def run(phone=PHONE, emails=EMAILS, test="", shas=None, reseed=True, **m):
    if reseed: seed(coaching=m.pop("coaching", True))
    M.clear(); M.update(m)
    d = os.path.join(TMP, "deployed")
    if os.path.exists(d): os.remove(d)
    rep = os.path.join(TMP, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(ENVF(rep), SB_FN_SHAS=json.dumps(shas or SHAS), SB_HR_ALERT_PHONE=phone, SB_HR_ALERT_EMAILS=emails, SB_SEND_TEST=test)
    p = subprocess.run(["python3", os.path.join(COPY, "hr_alerts_965.py")], cwd=COPY, env=env, capture_output=True, text=True, timeout=300)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else "") + p.stdout + p.stderr

code, out = run()
ck("runs to DONE with no ✗", code == 0 and "RESULT: DONE" in out and "✗" not in out, out)
ck("the report never shows Zach's number, his addresses or a key", "4175550100" not in out and "example" not in out.lower() and "eyJ" not in out and "sbp_test" not in out and "zach@" not in out, out)
row = q1("select to_phone, to_emails, seen from public.hr_alert_state")
ck("the server-only row holds his cell and both addresses, cleaned", row == [["4175550100", ["other@example.org", "zach@example.com"], []]], row)
ck("the schedule is every 30 minutes with the vault secret", q1("select schedule, command like '%vault.decrypted_secrets%' from cron.job where jobname = 'hr-alerts'") == [["*/30 * * * *", True]])
ck("no test alert unless she said yes", not M.get("tests") and "no test alert was sent" in out, out)
ck("practice is stated, with the count of what is waiting", "PRACTICE" in out and "3 HR item(s) waiting" in out, out)
ck("Zach's own sign-in can't read where alerts go", str(act(ZAC, "select * from public.hr_alert_state")).startswith("ERR"))
ck("Krystal can't read it or change it", str(act(KRY, "select * from public.hr_alert_state")).startswith("ERR") and str(act(KRY, "update public.hr_alert_state set to_phone = 'x'")).startswith("ERR"))
def as_anon(q):
    c = conn(); c.run("begin"); c.run("set local role anon")
    try: out = c.run(q)
    except DatabaseError as e: out = "ERR " + str(e)[:200]
    try: c.run("rollback")
    except Exception: pass
    c.close(); return out
ck("the public key can't read it", str(as_anon("select * from public.hr_alert_state")).startswith("ERR"))
q1("update public.hr_alert_state set seen = '{case:c1}', practice_log = '[{\"n\":1}]'")
code2, out2 = run(reseed=False, test="1")
ck("run again with the test: DONE; Zach's told-list and practice log are kept", code2 == 0 and q1("select seen, practice_log from public.hr_alert_state") == [[["case:c1"], [{"n": 1}]]], out2)
ck("...one test alert, counted", M.get("tests") == 1 and "1 text and 2 of 2 email(s) accepted" in out2, out2)
code3, out3 = run(test="1", quiet=True)
ck("a test in quiet hours: DONE, says to run it in the daytime", code3 == 0 and "quiet hours" in out3, out3)
code4, out4 = run(phone="")
ck("no cell number from the launcher: stops, nothing changed", code4 == 3 and "cell number" in out4 and q1("select to_regclass('public.hr_alert_state') is null") == [[True]], out4)
code5, out5 = run(emails="not-an-email")
ck("no usable email: stops", code5 == 3 and "email address" in out5, out5)
code6, out6 = run(ghl=False)
ck("GoHighLevel keys missing: stops", code6 == 3 and "GoHighLevel" in out6, out6)
code7, out7 = run(coaching=False)
ck("no coaching tracker (961): stops", code7 == 3 and "961" in out7, out7)
code8, out8 = run(shas={"hr-alerts/index.ts": "0" * 64})
ck("not the reviewed build: stops before anything", code8 == 2 and q1("select to_regclass('public.hr_alert_state') is null") == [[True]], out8)
code9, out9 = run(leak=True)
ck("if the public key could read an HR item: flagged", code9 == 9 and "public key could read: hr_cases" in out9, out9)
code10, out10 = run(hub=False)
ck("if the Hub link did not open on sign-in: flagged", code10 == 9 and "sign-in screen" in out10, out10)
body = open(os.path.join(COPY, "hr_alerts_965.py")).read()
ck("no phone number or personal email in the public installer", not re.search(r"\b\d{3}[-. ]?\d{3}[-. ]?\d{4}\b", body) and "gmail" not in body.lower())
ck("no em dashes in the installer", "—" not in body)

CMD = os.environ.get("CMD", "")
if CMD:
    # the launcher itself: a fake HOME (with a fake supabase tool and a fake 'open'), the reviewed build cloned where it expects it
    src = open(CMD).read()
    P = re.search(r'^P="([^"]+)"', src, re.M).group(1); PIN = re.search(r'^PIN="([0-9a-f]{40})"', src, re.M).group(1)
    FH = os.path.join(TMP, "home"); os.makedirs(os.path.join(FH, ".local", "bin")); os.makedirs(os.path.join(FH, "Desktop"))
    os.symlink(os.path.join(FAKEBIN, "supabase"), os.path.join(FH, ".local", "bin", "supabase"))
    FB = os.path.join(TMP, "fakebin2"); os.makedirs(FB); open(os.path.join(FB, "open"), "w").write("#!/bin/sh\nexit 0\n"); os.chmod(os.path.join(FB, "open"), 0o755)
    REPO = os.path.join(TMP, "repo"); subprocess.run(["git", "clone", "-q", HERE, REPO], check=True)
    s2 = src.replace(P, REPO).replace("/Users/samantha/Desktop", os.path.join(FH, "Desktop"))
    ck("the launcher pins a commit that exists", subprocess.run(["git", "-C", REPO, "cat-file", "-e", PIN + "^{commit}"]).returncode == 0, PIN)
    LC = os.path.join(TMP, "launch.command"); open(LC, "w").write(s2); os.chmod(LC, 0o755)
    for ans, want in (("n", 0), ("y", 1)):
        seed(); M.clear()
        env = dict(ENVF(""), HOME=FH, PATH=FB + ":" + os.environ["PATH"]); env.pop("SB_REPORT"); env.pop("SB_FNROOT"); env.pop("SB_TOKEN")
        p = subprocess.run(["zsh", LC], input=f"sbp_fake_token\n{ans}\n\n", env=env, capture_output=True, text=True, timeout=300)
        reps = sorted(glob.glob(os.path.join(FH, "Desktop", "965 *report*.txt")))
        rep = open(reps[-1]).read() if reps else ""
        ck(f"launcher (test answer '{ans}'): DONE, {want} test alert(s)", "RESULT: DONE" in rep and "✗" not in rep and M.get("tests", 0) == want, p.stdout[-1500:] + p.stderr[-800:] + rep[-800:])
        ck(f"launcher (answer '{ans}'): the number and addresses never reach the report or the screen", not re.search(r"\d{10}|@", rep + p.stdout), (rep + p.stdout)[-600:])
        for r_ in reps: os.remove(r_)
    ck("launcher: the row was saved from the launcher's numbers", q1("select to_phone is not null and array_length(to_emails, 1) >= 1 from public.hr_alert_state") == [[True]])

for n, okk, note in res: print(("PASS  " if okk else "FAIL  ") + n + ("" if okk else "\n      " + note.replace("\n", "\n      ")))
print(f"{sum(1 for _, o, _ in res if o)}/{len(res)} passed"); raise SystemExit(0 if all(o for _, o, _ in res) else 1)
