#!/usr/bin/env python3
# Rehearsal of 1208 (agreement_lead_1208.py): a FAKE management API whose database queries run in a throwaway LOCAL Postgres
# (pgserver) holding the agreements table as 871 made it (with two agreements) and the nine-step catalog, and a FAKE supabase
# CLI whose live copies start as main's build. Never touches Supabase or AxisCare.   python3 agreement_lead_1208_install_test.py
import json, os, subprocess, tempfile, threading, http.server, hashlib, glob, datetime
import pgserver
from pg8000.native import Connection, DatabaseError
HERE = os.path.dirname(os.path.abspath(__file__))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1200]))
TMP = tempfile.mkdtemp(prefix="t1208-"); D = os.path.join(TMP, "pg"); os.makedirs(D)
srvpg = pgserver.get_server(D)
host = [kv[5:] for kv in srvpg.get_uri().split("?", 1)[1].split("&") if kv.startswith("host=")][0]
SOCK = [p for p in glob.glob(os.path.join(host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
conn = lambda: Connection(user="postgres", database="postgres", unix_sock=SOCK)
NINE = json.load(open(os.path.join(HERE, "client-journey", "catalog-nine.json")))
STEPS = NINE["steps"] if isinstance(NINE, dict) and "steps" in NINE else NINE
T871 = open(os.path.join(HERE, "client_agreement_871.sql")).read()
TABLE = T871[T871.index("create table if not exists public.client_agreements"):T871.index("create index if not exists client_agreements_ax")]
OLD_HOWTO = "Create the client in AxisCare from the profile (More, Create in AxisCare). The Hub checks it read back."
def seed(no_step=False):
    c = conn(); c.run("drop schema if exists public cascade; create schema public")
    c.run(TABLE.replace("gen_random_uuid()", "md5(random()::text)::uuid"))
    c.run("alter table public.client_agreements add column contacts_review jsonb, add column copies jsonb")   # as 872/873 left it
    for ax in ("296", "301"): c.run("insert into public.client_agreements(axiscare_client_id, version, pdf_sha256) values (:a, 'Rev 10/2026', :s)", a=ax, s="a" * 64)
    c.run("create table public.client_journey_step_def(key text primary key, catalog_version int not null default 1, def jsonb not null, active boolean not null default true, updated_at timestamptz not null default now(), updated_by text)")
    for d in STEPS:
        d = json.loads(json.dumps(d))
        if d.get("key") == "soc.setup":
            if no_step: continue
            d["howto"][0] = OLD_HOWTO
        c.run("insert into public.client_journey_step_def(key, def) values (:k, cast(:d as jsonb))", k=d["key"], d=json.dumps(d))
    c.close()
def q1(sql_, **kw):
    c = conn(); r = c.run(sql_, **kw); c.close(); return r
def howto(): return q1("select def->'howto'->>0 from public.client_journey_step_def where key = 'soc.setup'")[0][0]
def snapshot(): return q1("select id::text, axiscare_client_id, status from public.client_agreements order by axiscare_client_id, id")
M = {}
def jsonable(v): return v.isoformat() if isinstance(v, (datetime.date, datetime.datetime)) else v
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if "/api-keys" in p: return self._send(200, [{"name": "anon", "api_key": "eyJfake.anon.key"}])
        for fn in ("client-agreement", "agreement-sign", "client-journey", "client-convert"):
            if p.endswith("/functions/" + fn): return self._send(200, {"version": 7, "verify_jwt": fn == "client-agreement"})
        return self._send(404, {})
    def do_PATCH(self): return self._send(200, {})
    def do_OPTIONS(self): self.send_response(200); self.end_headers()
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); raw = self.rfile.read(n) or b"{}"
        if self.path.startswith("/fn/"): return self._send(M.get("public", 401), {"error": "Not signed in"})
        q = json.loads(raw)["query"]
        if M.get("fail_sql") and "alter table public.client_agreements" in q: return self._send(400, {"message": "permission denied"})
        try:
            c = conn(); rows = c.run(q); cols = [x["name"] for x in (c.columns or [])]; c.close()
            return self._send(201, [{k: jsonable(v) for k, v in zip(cols, r)} for r in (rows or [])])
        except DatabaseError as e: return self._send(400, {"message": str(e)[:300]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
LOG = os.path.join(TMP, "cli.log"); STATE = os.path.join(TMP, "deployed"); CLI = os.path.join(TMP, "supabase")
open(CLI, "w").write(f"""#!/bin/sh
# fake tool: before a deploy, download gives main's build (BAD_LIVE=1: a hand edit nobody merged); after, the local build
cmd="$2"; fn="$3"; root="{HERE}"
if [ "$cmd" = "download" ]; then
  mkdir -p "supabase/functions/$fn" "supabase/functions/_shared"
  if grep -qx "$fn" "{STATE}" 2>/dev/null; then
    cp -R "$root/supabase/functions/$fn/." "supabase/functions/$fn/"; cp "$root"/supabase/functions/_shared/*.ts "$root"/supabase/functions/_shared/*.js supabase/functions/_shared/ 2>/dev/null
    for d in $(cd "$root" && grep -ho "\.\./\.\./[a-z-]*/" "supabase/functions/$fn/index.ts" | sort -u); do mkdir -p "$d" && cp -R "$root/supabase/functions/$fn/$d." "$d" 2>/dev/null; done
  else
    git -C "$root" show "origin/main:supabase/functions/$fn/index.ts" > "supabase/functions/$fn/index.ts"
    if [ "$BAD_LIVE" = "1" ]; then echo "// hand edit" >> "supabase/functions/$fn/index.ts"; fi
  fi
  exit 0
fi
if [ "$cmd" = "deploy" ]; then echo "$fn $*" >> "{LOG}"; echo "$fn" >> "{STATE}"; exit 0; fi
exit 1
""")
os.chmod(CLI, 0o755)
FNS = {k: sha(os.path.join(HERE, "supabase/functions", k)) for k in ("client-agreement/index.ts", "agreement-sign/index.ts", "client-journey/index.ts", "client-convert/index.ts", "_shared/agreement-steps.ts", "_shared/agreement-links.ts", "_shared/agreement-prefill.ts", "_shared/agreement-family-sign.ts")}
SQLS = {"agreement_lead_1208.sql": sha(os.path.join(HERE, "agreement_lead_1208.sql"))}
def run(fns=None, sqls=None, env=None, **mode):
    M.clear(); M.update(mode); open(LOG, "w").close(); open(STATE, "w").close()
    rep = os.path.join(TMP, "r.txt"); os.path.exists(rep) and os.remove(rep)
    e = dict(os.environ, SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_SUPA_CLI=CLI, SB_FNROOT=os.path.join(HERE, "supabase/functions"),
             SB_FN_SHAS=json.dumps(fns or FNS), SB_SQL_SHAS=json.dumps(sqls or SQLS), SB_FN_BASE=URL + "/fn", SB_SETTLE="0", PYTHONPATH=HERE, **(env or {}))
    p = subprocess.run(["python3", os.path.join(HERE, "agreement_lead_1208.py")], env=e, capture_output=True, text=True, timeout=600)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
deployed = lambda: open(LOG).read()

seed(); before = snapshot(); code, out = run()
dl = deployed().splitlines(); line = lambda fn: [l for l in dl if l.startswith(fn + " ")][0]
ck("fresh: exit 0, DONE; all four functions deployed, each keeping its sign-in setting", code == 0 and "RESULT: DONE" in out and all(any(l.startswith(f + " ") for l in dl) for f in ("client-agreement", "agreement-sign", "client-journey", "client-convert"))
   and "--no-verify-jwt" not in line("client-agreement") and all("--no-verify-jwt" in line(f) for f in ("agreement-sign", "client-journey", "client-convert")), out)
ck("the two agreements on file are untouched", snapshot() == before and "2 Client Care Agreements on file" in out, [before, snapshot()])
ok_lead = True
try: q1("insert into public.client_agreements(lead_id, version, pdf_sha256) values ('L-123', 'Rev 10/2026', :s)", s="b" * 64)
except DatabaseError: ok_lead = False
ck("after: an agreement can be saved on a lead with no AxisCare number", ok_lead)
refused = False
try: q1("insert into public.client_agreements(version, pdf_sha256) values ('Rev 10/2026', :s)", s="c" * 64)
except DatabaseError: refused = True
ck("after: an agreement with neither a lead nor an AxisCare number is refused", refused)
refused = False
try: q1("insert into public.client_agreements(axiscare_client_id, version, pdf_sha256) values ('abc', 'Rev 10/2026', :s)", s="d" * 64)
except DatabaseError: refused = True
ck("after: the AxisCare number's own check is kept (letters refused)", refused)
ck("step 4's first how-to line says the agreement comes first", howto().startswith("Once the Client Care Agreement is signed"), howto())
ck("the proof: live copies are this build, the public key is refused, the Hub can reach both", all(s in out for s in ["client-agreement: the live copy is exactly this build", "client-convert: the live copy is exactly this build", "client-agreement refuses anyone not signed in", "client-convert refuses anyone not signed in", "the Hub can reach client-convert"]), out)
ck("prints no key or secret", "eyJfake" not in out and "sbp_test" not in out)
code, out = run()
ck("run again: still DONE, nothing doubled", code == 0 and "already belong to a lead" in out and q1("select count(*) from pg_constraint where conname = 'client_agreements_client_or_lead'")[0][0] == 1, out)
seed(); code, out = run(fns={**FNS, "client-convert/index.ts": "0" * 64})
ck("not the reviewed build: stops before changing anything", code == 2 and not deployed() and howto() == OLD_HOWTO, out)
seed(); code, out = run(sqls={"agreement_lead_1208.sql": "0" * 64})
ck("not the reviewed SQL: stops before changing anything", code == 3 and not deployed() and howto() == OLD_HOWTO, out)
seed(no_step=True); code, out = run()
ck("no nine-step Start of Care in the catalog: stops before changing anything", code == 3 and "comes with 911" in out and not deployed(), out)
seed(); code, out = run(env={"BAD_LIVE": "1"})
ck("a live copy nobody merged: stops before changing anything and says so", code == 3 and "never on main" in out and not deployed() and howto() == OLD_HOWTO, out)
seed(); code, out = run(fail_sql=True)
ck("the database refuses the change: says nothing changed, deploys nothing", code == 6 and "did not go in (nothing changed)" in out and not deployed() and howto() == OLD_HOWTO, out)
seed(); code, out = run(public=200)
ck("a function answers the public key: a ✗ line, not DONE", code == 9 and "answered the public key" in out, out)
seed(); run(); rb = open(os.path.join(HERE, "agreement_lead_1208_rollback.sql")).read()
q1("insert into public.client_agreements(lead_id, version, pdf_sha256) values ('L-9', 'Rev 10/2026', :s)", s="e" * 64)
refused = False
try: q1(rb)
except DatabaseError: refused = True
ck("rollback refuses while an agreement sits on a lead with no AxisCare number", refused and howto().startswith("Once"))
q1("delete from public.client_agreements where axiscare_client_id is null"); q1(rb)
ck("rollback otherwise puts the table and step 4 back", howto() == OLD_HOWTO and q1("select is_nullable from information_schema.columns where table_name = 'client_agreements' and column_name = 'axiscare_client_id'")[0][0] == "NO" and [x[1:] for x in snapshot()] == [x[1:] for x in before])
sqltxt = open(os.path.join(HERE, "agreement_lead_1208.sql")).read().lower()
ck("the SQL deletes, drops and truncates nothing, and changes no row of the agreements", not any(w in sqltxt.replace("drop not null", "") for w in ["delete ", "drop ", "truncate", "insert into", "update public.client_agreements"]) and sqltxt.count("update public.") == 1)
srv.shutdown()
for n, c, note in res: print(("PASS" if c else "FAIL") + " · " + n + ("" if c else "\n     " + note))
print(sum(c for _, c, _ in res), "/", len(res)); raise SystemExit(0 if all(c for _, c, _ in res) else 1)
