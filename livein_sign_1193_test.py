#!/usr/bin/env python3
# Rehearsal of 1193 (livein_sign_1193.py, Live-In Caregiver Agreement signed on a phone): a FAKE management API whose queries
# run in a throwaway LOCAL Postgres (pgserver), a fake livein-sign service and storage that write there, and a fake Hub page.
# Never touches Supabase or GoHighLevel. Runs from a fresh copy of the committed build.   python3 livein_sign_1193_test.py
#   CMD=<path to the Desktop .command> also rehearses the launcher itself with a fake HOME.
import json, os, re, subprocess, tempfile, threading, http.server, glob, datetime, hashlib, uuid
import pgserver
from pg8000.native import Connection, DatabaseError
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1600]))
TMP = tempfile.mkdtemp(prefix="t1193-"); COPY = os.path.join(TMP, "hub")
subprocess.run(["git", "clone", "-q", HERE, COPY], check=True)
HEAD = subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
subprocess.run(["git", "-C", COPY, "checkout", "-q", HEAD], check=True)
D = os.path.join(TMP, "pg"); os.makedirs(D)
srvpg = pgserver.get_server(D)
host = [kv[5:] for kv in srvpg.get_uri().split("?", 1)[1].split("&") if kv.startswith("host=")][0]
SOCK = [p for p in glob.glob(os.path.join(host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
conn = lambda: Connection(user="postgres", database="postgres", unix_sock=SOCK)
ZAC, KRY = "a0000000-0000-0000-0000-000000000003", "a0000000-0000-0000-0000-000000000002"
CGS = [{"first": "Rhonda", "last": "Blakemore", "phone": "4175550100"}, {"first": "Sheryelle", "last": "Dunniehigh", "phone": "4175550101"}, {"first": "Pat", "last": "Doe"}]
MSHA = "e35b98102d4664ce79df96168cac354b0d006783f58a78fe33d4939c40fc322c"

def seed(store=True, people=CGS):
    c = conn()
    c.run("drop schema if exists public cascade; create schema public; drop schema if exists auth cascade; create schema auth; drop schema if exists storage cascade; create schema storage")
    for r in ("authenticated", "anon", "service_role"):
        c.run(f"do $$ begin if not exists (select 1 from pg_roles where rolname = '{r}') then create role {r}; end if; end $$")
    c.run("grant usage on schema public, auth, storage to authenticated, anon, service_role")
    c.run("create table auth.users(id uuid primary key, email text, banned_until timestamptz, raw_app_meta_data jsonb default '{}')")
    c.run(f"insert into auth.users(id, email) values ('{ZAC}', 'zach@mo-care.com'), ('{KRY}', 'krystal@mo-care.com')")
    c.run("create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[])")
    c.run("create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, body bytea)")
    c.run("create table public.app_data(key text primary key, data jsonb)")
    c.run("grant select, insert, update, delete on public.app_data to authenticated")
    c.run("insert into public.app_data values ('caregivers', cast(:d as jsonb))", d=json.dumps(people))
    c.run("create table public.document_access_log(id bigserial primary key, offer_id text, doc text, path text)")
    if store:   # what 968 put in: the private bucket and its keep-guard
        c.run("insert into storage.buckets values ('hr-docs', 'hr-docs', false, 15728640, array['application/pdf'])")
        c.run("""create or replace function public.hr_docs_keep() returns trigger language plpgsql as $k$ begin
          if old.bucket_id = 'hr-docs' then if tg_op = 'DELETE' then raise exception 'kept'; elsif new.name is distinct from old.name then raise exception 'kept'; end if; end if;
          return case when tg_op = 'DELETE' then old else new end; end $k$""")
        c.run("create trigger hr_docs_keep before delete or update on storage.objects for each row when (old.bucket_id = 'hr-docs') execute function public.hr_docs_keep()")
    c.close()
def q1(s, **kw):
    c = conn(); r = c.run(s, **kw); c.close(); return r
def jsonable(v): return v.isoformat() if isinstance(v, (datetime.date, datetime.datetime)) else (str(v) if v.__class__.__name__ == "UUID" else v)
M = {}
sha = lambda s: hashlib.sha256(s.encode()).hexdigest()
FAKE_PDF = b"%PDF-1.7\n" + b"<< /Type /Page >>\n" * 13 + b"%%EOF"
class F(http.server.BaseHTTPRequestHandler):
    """the fake management API, the fake livein-sign service and storage (writing to the local database) and the fake Hub page"""
    def log_message(self, *a): pass
    def _send(self, code, obj, ctype="application/json", extra=None):
        b = obj if isinstance(obj, bytes) else (obj if isinstance(obj, str) else json.dumps(obj, default=str)).encode()
        self.send_response(code); self.send_header("Content-Type", ctype)
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(b)
    def do_OPTIONS(self):
        allow = "authorization, x-client-info, content-type" if M.get("badcors") else "authorization, x-client-info, apikey, content-type"
        self._send(200, "ok", "text/plain", {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": allow, "Access-Control-Allow-Methods": "POST, OPTIONS"})
    def do_GET(self):
        if "/api-keys" in self.path: return self._send(200, [{"name": "anon", "api_key": "eyJanonKEY"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
        if self.path.endswith("/secrets"): return self._send(200, [{"name": n} for n in ["GHL_TOKEN", "GHL_LOCATION_ID"] if not (M.get("noghl") and n == "GHL_TOKEN")])
        if self.path.endswith("/functions/livein-sign"):
            return self._send(200, {"version": 1, "verify_jwt": True}) if os.path.exists(os.path.join(TMP, "deployed")) else self._send(404, {})
        if self.path.startswith("/storage/v1/object/hr-docs/"):
            if "svc" not in self.headers.get("Authorization", ""): return self._send(400, {"error": "not allowed"})
            r = q1("select body from storage.objects where bucket_id = 'hr-docs' and name = :n", n=self.path.split("/hr-docs/", 1)[1])
            return self._send(200, bytes(r[0][0]), "application/pdf") if r else self._send(404, {"error": "not found"})
        if self.path.startswith("/signed/"): return self._send(200, FAKE_PDF, "application/pdf")
        if self.path == "/livein.html": return self._send(200, "<script>const FN = SUPA_URL + '/functions/v1/livein-sign';</script>", "text/html") if M.get("page") else self._send(404, "")
        self._send(404, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); rawb = self.rfile.read(n)
        if self.path.startswith("/storage/v1/object/hr-docs/"):
            name = self.path.split("/hr-docs/", 1)[1]
            if q1("select 1 from storage.objects where bucket_id = 'hr-docs' and name = :n", n=name): return self._send(400, {"error": "Duplicate", "statusCode": "409"})
            q1("insert into storage.objects(bucket_id, name, body) values ('hr-docs', :n, :b)", n=name, b=rawb); return self._send(200, {"Key": "hr-docs/" + name})
        body = json.loads(rawb or b"null")
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
        if self.path.startswith("/functions/v1/livein-sign"):
            auth = self.headers.get("Authorization", ""); a = body.get("action"); owner = "svc" in auth
            c = conn()
            try:
                if a == "sample":
                    if not owner: return self._send(401, {"error": "not allowed"})
                    tok = uuid.uuid4().hex + uuid.uuid4().hex[:11]; i = str(uuid.uuid4())
                    c.run("insert into public.livein_sign(id, practice, caregiver, master_sha, token_hash, expires_at, started_by) values (cast(:i as uuid), true, 'Test Caregiver', :m, :t, now() + interval '1 hour', 'desktop-step')", i=i, m=MSHA, t=sha(tok))
                    return self._send(200, {"ok": True, "id": i, "token": tok, "link": "https://cc.mo-care.com/livein.html?t=" + tok})
                if a in ("view", "sign"):
                    r = c.run("select id, status from public.livein_sign where token_hash = :t", t=sha(str(body.get("t"))))
                    if not r: return self._send(404, {"error": "not active"})
                    if a == "view": return self._send(200, {"ok": True, "first": "Test", "pages": 12, "practice": True, "master_sha": MSHA, "statement": "the $250.00 live-in assignment rate", "status": r[0][1]})
                    if body.get("typed_name") != "Test Caregiver": return self._send(400, {"error": "Type your full first and last name"})
                    if not str(body.get("signature", "")).startswith("data:image/png;base64,iVBOR"): return self._send(400, {"error": "Sign in the box"})
                    p = f"practice/{r[0][0]}-employee.pdf"
                    c.run("insert into storage.objects(bucket_id, name) values ('hr-docs', :p)", p=p)
                    c.run("update public.livein_sign set status = 'signed', signed_name = 'Test Caregiver', signed_at = now(), sig_png = 'x', pdf_path = :p, token_hash = null where id = cast(:i as uuid)", p=p, i=str(r[0][0]))
                    return self._send(200, {"ok": True, "copy_url": "https://signed/x", "practice": True})
                if a == "countersign":
                    if not owner: return self._send(401, {"error": "not allowed"})
                    p = f"practice/{body['id']}-final.pdf"
                    c.run("insert into storage.objects(bucket_id, name) values ('hr-docs', :p)", p=p)
                    c.run("update public.livein_sign set status = 'countersigned', rep_name = 'Desktop step', rep_sig_png = 'y', countersigned_at = now(), final_pdf_path = :p where id = cast(:i as uuid)", p=p, i=body["id"])
                    return self._send(200, {"ok": True})
                if a == "open":
                    if not owner: return self._send(401, {"error": "not allowed"})
                    return self._send(200, {"ok": True, "url": FURL + "/signed/" + body["id"]})
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
FILES = ("livein-sign/index.ts", "_shared/livein.ts", "_shared/hr-ack.ts", "_shared/agreement-pdf.ts", "_shared/outreach.ts", "_shared/staff-auth.ts", "_shared/job-auth.ts", "_shared/doc-log.ts", "_shared/office-from.ts")
SHAS = {k: hsha(os.path.join(FNR, k)) for k in FILES}
ENVF = lambda rep: dict(os.environ, SB_STEP="1193", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=FURL, SB_FN_BASE=FURL, SB_HUB_BASE=FURL,
                        SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_FNROOT=FNR, SB_SETTLE="0")
def run(shas=None, reseed=True, store=True, people=CGS, **m):
    if reseed: seed(store, people)
    M.clear(); M.update(m)
    d = os.path.join(TMP, "deployed")
    if os.path.exists(d): os.remove(d)
    rep = os.path.join(TMP, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    p = subprocess.run(["python3", os.path.join(COPY, "livein_sign_1193.py")], cwd=COPY, env=dict(ENVF(rep), SB_FN_SHAS=json.dumps(shas or SHAS)), capture_output=True, text=True, timeout=300)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else "") + p.stdout + p.stderr

code, out = run(page=True)
ck("runs to DONE with no ✗", code == 0 and "RESULT: DONE" in out and "✗" not in out, out)
ck("the report never shows a key or a link code", "eyJ" not in out and "sbp_test" not in out and not re.search(r"[0-9a-f]{40}", out), out)
ck("both people found on the roster", "2 of 2 (Rhonda Blakemore, Sheryelle Dunniehigh) found" in out, out)
ck("the tables are in, server only", q1("select to_regclass('public.livein_sign') is not null, to_regclass('public.livein_sign_event') is not null, has_table_privilege('authenticated', 'public.livein_sign', 'select')") == [[True, True, False]])
ck("her PDF is in the private store as the master, byte for byte", hashlib.sha256(bytes(q1("select body from storage.objects where name = 'master/live-in-caregiver-agreement-rev-2026-10.pdf'")[0][0])).hexdigest() == MSHA)
ck("one practice agreement, countersigned, PDFs under practice/; no real one", q1("select practice, status, pdf_path like 'practice/%', final_pdf_path like 'practice/%' from public.livein_sign") == [[True, "countersigned", True, True]])
c = conn()
try: c.run("delete from public.livein_sign"); gone = True
except DatabaseError: gone = False
c.close(); ck("a signing record can't be deleted", not gone and q1("select count(*) from public.livein_sign") == [[1]])
for what, stmt in (("the employee's signature", "update public.livein_sign set signed_name = 'Someone'"), ("the representative's signature", "update public.livein_sign set rep_name = 'Someone'"),
                   ("the master it was signed on", "update public.livein_sign set master_sha = 'x'"), ("back to waiting", "update public.livein_sign set status = 'waiting'")):
    c = conn()
    try: c.run(stmt); changed = True
    except DatabaseError: changed = False
    c.close(); ck(f"a finished agreement can't be changed: {what}", not changed)
c = conn(); c.run("insert into public.livein_sign_event(sign_id, kind) select id, 'x' from public.livein_sign limit 1")
try: c.run("delete from public.livein_sign_event"); gone = True
except DatabaseError: gone = False
c.close(); ck("the history can only be added to", not gone)
ck("the page is reported live when it is", "signing page is live" in out, out)
code2, out2 = run(reseed=False)
ck("run again: DONE, the master kept (already there), nothing lost", code2 == 0 and "already there from an earlier run" in out2 and q1("select count(*) from public.livein_sign") == [[2]], out2)
ck("...and before the Hub change is merged it says so plainly", "not live yet" in out2, out2)
code3, out3 = run(store=False)
ck("without the 968 private store: stops, nothing changed", code3 == 3 and "968" in out3 and q1("select to_regclass('public.livein_sign') is null") == [[True]], out3)
code4, out4 = run(noghl=True)
ck("without the GoHighLevel key: stops", code4 == 3 and "GoHighLevel" in out4, out4)
code5, out5 = run(shas={"livein-sign/index.ts": "0" * 64})
ck("not the reviewed build: stops before anything", code5 == 2 and q1("select to_regclass('public.livein_sign') is null") == [[True]], out5)
code6, out6 = run(badcors=True)
ck("if the browser check (CORS) would block the pages: flagged", code6 == 9 and "CORS" in out6, out6)
code7, out7 = run(people=[CGS[0]])
ck("only one of them on the roster: still DONE, says Send can't find the other's phone", code7 == 0 and "1 of 2" in out7 and "copy the link instead" in out7, out7)
body = open(os.path.join(COPY, "livein_sign_1193.py")).read() + open(os.path.join(COPY, "livein_sign.sql")).read()
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
    for k, v in SHAS.items(): ck(f"the launcher pins {k} at the reviewed build", f'"{k}":"{v}"' in src, k)
    LC = os.path.join(TMP, "launch.command"); open(LC, "w").write(s2); os.chmod(LC, 0o755)
    seed(); M.clear(); M["page"] = True
    env = dict(ENVF(""), HOME=FH, PATH=FB + ":" + os.environ["PATH"]); env.pop("SB_REPORT"); env.pop("SB_FNROOT"); env.pop("SB_TOKEN")
    p = subprocess.run(["zsh", LC], input="sbp_fake_token\n\n", env=env, capture_output=True, text=True, timeout=300)
    reps = sorted(glob.glob(os.path.join(FH, "Desktop", "1193 *report*.txt")))
    rep = open(reps[-1]).read() if reps else ""
    ck("the launcher runs the reviewed build to DONE", "RESULT: DONE" in rep and "✗" not in rep, p.stdout[-1500:] + p.stderr[-800:] + rep[-800:])

for n, okk, note in res: print(("PASS  " if okk else "FAIL  ") + n + ("" if okk else "\n      " + note.replace("\n", "\n      ")))
print(f"{sum(1 for _, o, _ in res if o)}/{len(res)} passed"); raise SystemExit(0 if all(o for _, o, _ in res) else 1)
