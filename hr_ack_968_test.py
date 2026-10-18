#!/usr/bin/env python3
# Rehearsal of 968 (hr_ack_968.py, write-up acknowledgment, HR Agent step 8): a FAKE management API whose queries run in
# a throwaway LOCAL Postgres (pgserver), a fake hr-ack service that writes its rows there, and a fake Hub page. Never
# touches Supabase, GoHighLevel or AxisCare. Runs from a fresh copy of the committed build.   python3 hr_ack_968_test.py
#   CMD=<path to the Desktop .command> also rehearses the launcher itself with a fake HOME.
import json, os, re, subprocess, tempfile, threading, http.server, glob, datetime, hashlib, uuid
import pgserver
from pg8000.native import Connection, DatabaseError
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1600]))
TMP = tempfile.mkdtemp(prefix="t968-"); COPY = os.path.join(TMP, "hub")
subprocess.run(["git", "clone", "-q", HERE, COPY], check=True)
HEAD = subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
subprocess.run(["git", "-C", COPY, "checkout", "-q", HEAD], check=True)
D = os.path.join(TMP, "pg"); os.makedirs(D)
srvpg = pgserver.get_server(D)
host = [kv[5:] for kv in srvpg.get_uri().split("?", 1)[1].split("&") if kv.startswith("host=")][0]
SOCK = [p for p in glob.glob(os.path.join(host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
conn = lambda: Connection(user="postgres", database="postgres", unix_sock=SOCK)
ZAC, KRY = "a0000000-0000-0000-0000-000000000003", "a0000000-0000-0000-0000-000000000002"
WU = [{"id": "w1", "caregiver": "Pat", "level": "Verbal Warning", "status": "approved"}, {"id": "w2", "caregiver": "Lee", "level": "Verbal Warning", "status": "draft"}]

def seed(lock=True, openlog=True):
    c = conn()
    c.run("drop schema if exists public cascade; create schema public; drop schema if exists auth cascade; create schema auth; drop schema if exists storage cascade; create schema storage")
    for r in ("authenticated", "anon", "service_role"):
        c.run(f"do $$ begin if not exists (select 1 from pg_roles where rolname = '{r}') then create role {r}; end if; end $$")
    c.run("grant usage on schema public, auth, storage to authenticated, anon, service_role")
    c.run("create table auth.users(id uuid primary key, email text, banned_until timestamptz, raw_app_meta_data jsonb default '{}')")
    c.run(f"insert into auth.users(id, email) values ('{ZAC}', 'zach@mo-care.com'), ('{KRY}', 'krystal@mo-care.com')")
    c.run("create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[])")
    c.run("create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text)")
    c.run("create table public.app_data(key text primary key, data jsonb)")
    c.run("grant select, insert, update, delete on public.app_data to authenticated")
    c.run("insert into public.app_data values ('discipline_actions', cast(:d as jsonb)), ('ops_settings', '{}'::jsonb)", d=json.dumps(WU))
    c.run("alter table public.app_data enable row level security")
    c.run("create policy everyone on public.app_data for all to authenticated using (true) with check (true)")
    if lock:
        for op, cmd in (("sel", "select"), ("ins", "insert"), ("upd", "update"), ("del", "delete")):
            clause = "with check" if op == "ins" else "using"
            c.run(f"create policy app_data_hr_formal_{op} on public.app_data as restrictive for {cmd} to authenticated {clause} (key <> 'discipline_actions')")
    if openlog: c.run("create table public.document_access_log(id bigserial primary key, offer_id text, doc text, path text)")
    c.close()
def q1(s, **kw):
    c = conn(); r = c.run(s, **kw); c.close(); return r
def jsonable(v): return v.isoformat() if isinstance(v, (datetime.date, datetime.datetime)) else (str(v) if v.__class__.__name__ == "UUID" else v)
M = {}
sha = lambda s: hashlib.sha256(s.encode()).hexdigest()
class F(http.server.BaseHTTPRequestHandler):
    """the fake management API, the fake hr-ack service (writing to the local database) and the fake Hub page"""
    def log_message(self, *a): pass
    def _send(self, code, obj, ctype="application/json"):
        b = (obj if isinstance(obj, str) else json.dumps(obj, default=str)).encode(); self.send_response(code); self.send_header("Content-Type", ctype); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if "/api-keys" in self.path: return self._send(200, [{"name": "anon", "api_key": "eyJanonKEY"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
        if self.path.endswith("/secrets"): return self._send(200, [{"name": n} for n in ["GHL_TOKEN", "AXISCARE_TOKEN", "AXISCARE_SITE"] if not (n.startswith("AXIS") and M.get("noax"))])
        if self.path.endswith("/functions/hr-ack"):
            return self._send(200, {"version": 1, "verify_jwt": True}) if os.path.exists(os.path.join(TMP, "deployed")) else self._send(404, {})
        if self.path == "/notice.html": return self._send(200, "<script>const FN = '/functions/v1/hr-ack'</script>", "text/html") if M.get("page") else self._send(404, "")
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
        if self.path.startswith("/functions/v1/hr-ack"):
            auth = self.headers.get("Authorization", ""); a = body.get("action"); owner = "svc" in auth
            c = conn()
            try:
                if a == "sample":
                    if not owner: return self._send(401, {"error": "not allowed"})
                    tok = uuid.uuid4().hex + uuid.uuid4().hex[:11]; i = str(uuid.uuid4())
                    c.run("insert into public.hr_ack(id, writeup_id, practice, caregiver, level, notice, notice_hash, via, token_hash, expires_at, started_by) values (cast(:i as uuid), 'practice-sample', true, 'Test Caregiver', 'Verbal Warning', 'n', 'h1', 'sample', :t, now() + interval '1 hour', 'desktop-step')", i=i, t=sha(tok))
                    return self._send(200, {"ok": True, "ack_id": i, "token": tok, "link": "https://cc.mo-care.com/notice.html?t=" + tok})
                if a in ("view", "sign"):
                    r = c.run("select id, status from public.hr_ack where token_hash = :t", t=sha(str(body.get("t"))))
                    if not r: return self._send(404, {"error": "not active"})
                    if a == "view": return self._send(200, {"ok": True, "first": "Test", "practice": True, "notice_hash": "h1", "receipt": "Signing only shows that I received it. It does not mean I agree with it.", "status": r[0][1]})
                    if body.get("typed_name") != "Test Caregiver": return self._send(400, {"error": "Type your full first and last name"})
                    p = f"practice/practice-sample/{r[0][0]}.pdf"
                    c.run("insert into storage.objects(bucket_id, name) values ('hr-docs', :p)", p=p)
                    c.run("update public.hr_ack set status = 'signed', signed_name = 'Test Caregiver', signed_at = now(), pdf_path = :p, token_hash = null where id = cast(:i as uuid)", p=p, i=str(r[0][0]))
                    return self._send(200, {"ok": True, "copy_url": "https://signed/x", "practice": True})
                if a == "record":
                    if not owner: return self._send(401, {"error": "not allowed"})
                    if not body.get("witness") and not body.get("witness_reason"): return self._send(400, {"error": "Name the witness"})
                    p = f"practice/practice-sample/{body['ack_id']}.pdf"
                    c.run("insert into storage.objects(bucket_id, name) values ('hr-docs', :p)", p=p)
                    c.run("update public.hr_ack set status = 'refused', refused_on = current_date, refused_how = 'phone', witness = :w, recorded_by = 'desktop-step', recorded_at = now(), pdf_path = :p where id = cast(:i as uuid)", w=body["witness"], p=p, i=body["ack_id"])
                    if M.get("touch"): c.run("update public.app_data set data = data || '[{\"id\":\"x\"}]'::jsonb where key = 'discipline_actions'")
                    return self._send(200, {"ok": True})
                return self._send(401 if not owner else 400, {"error": "Sign in"})
            finally: c.close()
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
hsha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
FILES = ("hr-ack/index.ts", "_shared/hr-ack.ts", "_shared/brand-pdf.ts", "_shared/outreach.ts", "_shared/staff-auth.ts", "_shared/job-auth.ts", "_shared/doc-log.ts", "_shared/office-from.ts")
SHAS = {k: hsha(os.path.join(FNR, k)) for k in FILES}
ENVF = lambda rep: dict(os.environ, SB_STEP="968", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=FURL, SB_FN_BASE=FURL, SB_HUB_BASE=FURL,
                        SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_FNROOT=FNR, SB_SETTLE="0")
def run(shas=None, reseed=True, lock=True, openlog=True, **m):
    if reseed: seed(lock, openlog)
    M.clear(); M.update(m)
    d = os.path.join(TMP, "deployed")
    if os.path.exists(d): os.remove(d)
    rep = os.path.join(TMP, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    p = subprocess.run(["python3", os.path.join(COPY, "hr_ack_968.py")], cwd=COPY, env=dict(ENVF(rep), SB_FN_SHAS=json.dumps(shas or SHAS)), capture_output=True, text=True, timeout=300)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else "") + p.stdout + p.stderr

code, out = run(page=True)
ck("runs to DONE with no ✗", code == 0 and "RESULT: DONE" in out and "✗" not in out, out)
ck("the report never shows a key or a link code", "eyJ" not in out and "sbp_test" not in out and not re.search(r"[0-9a-f]{40}", out), out)
ck("the tables, the private bucket and its keep-guard are in", q1("select to_regclass('public.hr_ack') is not null, (select public from storage.buckets where id = 'hr-docs'), exists (select 1 from pg_trigger where tgname = 'hr_docs_keep')") == [[True, False, True]])
ck("two practice notices finished, one signed and one refused, with PDFs; no real notice", q1("select status from public.hr_ack order by status") == [["refused"], ["signed"]] and q1("select count(*) from storage.objects where bucket_id = 'hr-docs'") == [[2]])
ck("a PDF really can't be deleted, moved or renamed", "kept" in str(q1("""do $p$ begin delete from storage.objects where bucket_id = 'hr-docs'; raise exception 'deleted'; exception when others then if sqlerrm = 'deleted' then raise; end if; end $p$""") or "kept")
   and q1("select count(*) from storage.objects where bucket_id = 'hr-docs'") == [[2]])
c = conn()
try: c.run("update storage.objects set name = 'x' where bucket_id = 'hr-docs'"); moved = True
except DatabaseError: moved = False
c.close(); ck("...nor renamed", not moved)
c = conn()
try: c.run("delete from public.hr_ack"); gone = True
except DatabaseError: gone = False
c.close(); ck("a signing record can't be deleted", not gone and q1("select count(*) from public.hr_ack") == [[2]])
c = conn()
try: c.run("update public.hr_ack set signed_name = 'Someone' where status = 'signed'"); changed = True
except DatabaseError: changed = False
c.close(); ck("a finished signature can't be changed", not changed)
c = conn()
try: c.run("update public.hr_ack set notice = 'other'"); changed = True
except DatabaseError: changed = False
c.close(); ck("the notice that was signed can't be changed", not changed)
c = conn(); c.run("insert into public.hr_ack_event(ack_id, kind) select id, 'x' from public.hr_ack limit 1")
try: c.run("delete from public.hr_ack_event"); gone = True
except DatabaseError: gone = False
c.close(); ck("the history can only be added to", not gone)
ck("the page is reported live when it is", "signing page is live" in out, out)
code2, out2 = run(reseed=False)
ck("run again: DONE, nothing lost (the earlier records are kept)", code2 == 0 and q1("select count(*) from public.hr_ack") == [[4]], out2)
ck("...and before the Hub change is merged it says so plainly", "not live yet" in out2, out2)
code3, out3 = run(lock=False)
ck("without the 946 lock: stops, nothing changed", code3 == 3 and "946" in out3 and q1("select to_regclass('public.hr_ack') is null") == [[True]], out3)
code4, out4 = run(openlog=False)
ck("without the document open log: stops", code4 == 3 and "open log" in out4, out4)
code5, out5 = run(noax=True)
ck("without the AxisCare keys: stops", code5 == 3 and "AxisCare" in out5, out5)
code6, out6 = run(shas={"hr-ack/index.ts": "0" * 64})
ck("not the reviewed build: stops before anything", code6 == 2 and q1("select to_regclass('public.hr_ack') is null") == [[True]], out6)
code7, out7 = run(touch=True)
ck("if a write-up changed during the step: flagged", code7 == 9 and "write-ups changed" in out7, out7)
body = open(os.path.join(COPY, "hr_ack_968.py")).read() + open(os.path.join(COPY, "hr_ack.sql")).read()
ck("no em dashes in the installer or its SQL", "—" not in body)

CMD = os.environ.get("CMD", "")
if CMD:
    src = open(CMD).read()
    P = re.search(r'^P="([^"]+)"', src, re.M).group(1); PIN = re.search(r'^PIN="([0-9a-f]{40})"', src, re.M).group(1)
    FH = os.path.join(TMP, "home"); os.makedirs(os.path.join(FH, ".local", "bin")); os.makedirs(os.path.join(FH, "Desktop"))
    os.symlink(os.path.join(FAKEBIN, "supabase"), os.path.join(FH, ".local", "bin", "supabase"))
    FB = os.path.join(TMP, "fakebin2"); os.makedirs(FB); open(os.path.join(FB, "open"), "w").write("#!/bin/sh\nexit 0\n"); os.chmod(os.path.join(FB, "open"), 0o755)
    REPO = os.path.join(TMP, "repo"); subprocess.run(["git", "clone", "-q", HERE, REPO], check=True)
    s2 = src.replace(P, REPO).replace("/Users/samantha/Desktop", os.path.join(FH, "Desktop"))
    ck("the launcher pins a commit that exists", subprocess.run(["git", "-C", REPO, "cat-file", "-e", PIN + "^{commit}"]).returncode == 0, PIN)
    LC = os.path.join(TMP, "launch.command"); open(LC, "w").write(s2); os.chmod(LC, 0o755)
    seed(); M.clear(); M["page"] = True
    env = dict(ENVF(""), HOME=FH, PATH=FB + ":" + os.environ["PATH"]); env.pop("SB_REPORT"); env.pop("SB_FNROOT"); env.pop("SB_TOKEN")
    p = subprocess.run(["zsh", LC], input="sbp_fake_token\n\n", env=env, capture_output=True, text=True, timeout=300)
    reps = sorted(glob.glob(os.path.join(FH, "Desktop", "968 *report*.txt")))
    rep = open(reps[-1]).read() if reps else ""
    ck("the launcher runs the reviewed build to DONE", "RESULT: DONE" in rep and "✗" not in rep, p.stdout[-1500:] + p.stderr[-800:] + rep[-800:])

for n, okk, note in res: print(("PASS  " if okk else "FAIL  ") + n + ("" if okk else "\n      " + note.replace("\n", "\n      ")))
print(f"{sum(1 for _, o, _ in res if o)}/{len(res)} passed"); raise SystemExit(0 if all(o for _, o, _ in res) else 1)
