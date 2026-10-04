#!/usr/bin/env python3
# Rehearsal of 434 (CI1) against a FAKE Supabase: the management API's SQL runs on a real local Postgres (pgserver),
# the functions and the supabase CLI are fakes. Never touches a real project. Run from the CI1 branch.
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib, glob, shutil
import pgserver
from pg8000.native import Connection, DatabaseError
HERE = os.path.dirname(os.path.abspath(__file__)); REF = "zngsgedlsxinbygwmxwn"
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
git = lambda *a: subprocess.run(["git", *a], cwd=HERE, capture_output=True, text=True).stdout.strip()
BASE = git("merge-base", "HEAD", "origin/main")
CHANGED = [x for x in git("diff", "--name-only", BASE, "HEAD", "--", "supabase/functions").split() if x.endswith(".ts")]
key = lambda rel: rel.split("supabase/functions/", 1)[1][:-3] if "/_shared/" in rel else rel.split("/")[2]
SHAS = {key(r): sha(os.path.join(HERE, r)) for r in CHANGED}
D = tempfile.mkdtemp(prefix="ci1i-"); srv = pgserver.get_server(D)
host = [kv[5:] for kv in srv.get_uri().split("?", 1)[1].split("&") if kv.startswith("host=")][0]
SOCK = [p for p in glob.glob(os.path.join(host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
conn = lambda: Connection(user="postgres", database="postgres", unix_sock=SOCK)
c = conn()
for r in ("anon", "authenticated", "service_role"):
    try: c.run(f"create role {r}")
    except DatabaseError: pass
c.run("create table app_data(key text primary key, data jsonb, updated_at timestamptz default now())")
c.run("""create function upsert_app_data_item(target_key text, item jsonb) returns void language plpgsql security definer as $$
declare d jsonb; begin select data into d from app_data where key = target_key for update;
  if exists (select 1 from jsonb_array_elements(d) x where x->>'id' = item->>'id') then
    update app_data set data = (select jsonb_agg(case when x->>'id' = item->>'id' then item else x end) from jsonb_array_elements(d) x) where key = target_key;
  else update app_data set data = d || jsonb_build_array(item) where key = target_key; end if; end $$""")
c.run("""insert into app_data values ('coverage_cases', '[{"id":"real1","status":"open","asked":[]},{"id":"real2","status":"done","asked":[]}]'::jsonb)""")
c.close()
res = []; ck = lambda n, cnd, note="": res.append((n, bool(cnd), "" if cnd else str(note)[:1500]))
ANONK, SVCK = "eyJanon" + REF, "eyJsvc" + REF
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj, default=str).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if re.match(r"/v1/projects/\w+/functions/[\w-]+$", p): return self._send(200, {"verify_jwt": True, "version": 7})
        if re.match(r"/v1/projects/\w+/api-keys", p): return self._send(200, [{"name": "anon", "api_key": ANONK}, {"name": "service_role", "api_key": SVCK}])
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); raw = self.rfile.read(n) or b"{}"; p = self.path
        if p.endswith("/database/query"):
            q = json.loads(raw)["query"]; cc = conn()
            try: rows = cc.run(q); names = [x["name"] for x in (cc.columns or [])]; return self._send(201, [dict(zip(names, r)) for r in (rows or [])])
            except DatabaseError as e:
                a = e.args[0] if e.args else {}; return self._send(400, {"message": "Failed to run sql query: ERROR:  " + (a.get("C", "") + ": " + a.get("M", "") if isinstance(a, dict) else str(e))})
            finally:
                try: cc.close()
                except Exception: pass
        if p.startswith("/fn/functions/v1/"):
            fn = p.rsplit("/", 1)[1]; auth = self.headers.get("Authorization", ""); body = json.loads(raw)
            if fn == "coverage-assign":
                if auth == "Bearer " + SVCK: return self._send(404 if body.get("case_id") == "ci1-proof-no-such-case" else 400, {"error": "x"})
                return self._send(401, {"error": "Sign in first."})
            if fn == "coverage-run": return self._send(401, {"error": "Sign in first."})
        self._send(404, {})
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
tmp = tempfile.mkdtemp(prefix="t434-"); LOG = os.path.join(tmp, "cli.log"); STATE = os.path.join(tmp, "deployed")
CLI = os.path.join(tmp, "supabase")
open(CLI, "w").write(f"""#!/bin/sh
cmd="$2"; fn="$3"; root="{HERE}"; base="{BASE}"
if [ "$cmd" = "download" ]; then
  mkdir -p "supabase/functions/$fn" "supabase/functions/_shared"
  if grep -qx "$fn" "{STATE}" 2>/dev/null; then
    cp "$root/supabase/functions/$fn/index.ts" "supabase/functions/$fn/index.ts"; cp "$root"/supabase/functions/_shared/*.ts supabase/functions/_shared/; rm -f supabase/functions/_shared/_*.ts
  else
    git -C "$root" show "$base:supabase/functions/$fn/index.ts" > "supabase/functions/$fn/index.ts"
    for f in $(git -C "$root" ls-tree --name-only "$base" supabase/functions/_shared/); do git -C "$root" show "$base:$f" > "$f"; done
    rm -f supabase/functions/_shared/job-auth.ts.x
    if [ "$BAD_LIVE" = "$fn" ]; then echo "// hand edit" >> "supabase/functions/$fn/index.ts"; fi
  fi
  exit 0
fi
if [ "$cmd" = "deploy" ]; then echo "$fn" >> "{LOG}"; echo "$fn" >> "{STATE}"; exit 0; fi
exit 1
""")
os.chmod(CLI, 0o755)
FAKEBIN = os.path.join(tmp, "bin"); os.makedirs(FAKEBIN)
open(os.path.join(FAKEBIN, "node"), "w").write("#!/bin/sh\necho 'PASS · fake'\necho '1/1'\n"); os.chmod(os.path.join(FAKEBIN, "node"), 0o755)
def run(keep=False, **over):
    open(LOG, "w").close()
    if not keep: open(STATE, "w").close()
    rep = os.path.join(tmp, "report.txt")
    if os.path.exists(rep): os.unlink(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_SUPA_CLI=CLI, SB_API_BASE=URL, SB_REPO=HERE, SB_BASE=BASE, SB_SHAS=json.dumps(SHAS),
               SB_SQL_SHA=sha(os.path.join(HERE, "ci1.sql")), SB_FN_BASE=URL + "/fn", SB_SETTLE="0", PATH=FAKEBIN + ":" + os.environ.get("PATH", ""))
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(HERE, "ci1_install.py")], env=env, capture_output=True, text=True)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), open(LOG).read().split()
q1 = lambda q: (lambda cc: (cc.run(q), cc.close())[0])(conn())
ck("the changed files are the CI1 ones", sorted(SHAS) == ["_shared/coverage-fill", "coverage-assign", "coverage-run"], SHAS)
rc, r, d = run(SB_SQL_SHA="0" * 64)
ck("ci1.sql not the reviewed file: stops before anything", rc == 2 and not d and q1("select to_regproc('public.coverage_case_patch')")[0][0] is None, r)
before = q1("select data from app_data where key='coverage_cases'")[0][0]
rc, r, d = run(); print(r)
ck("DONE: the SQL first, then both functions", rc == 0 and "RESULT: DONE" in r and d == ["coverage-assign", "coverage-run"], r)
ck("every proof line passed (guard, one winner, no double ask, outsiders refused, nothing left behind)", "✗" not in r and r.count("proven inside a transaction that was undone") == 5, r)
ck("the real cases are exactly as before (the proof was undone)", q1("select data from app_data where key='coverage_cases'")[0][0] == before and q1("select count(*) from coverage_case_guard_log")[0][0] == 0)
ck("no key, token or email in the report", ANONK not in r and SVCK not in r and "sbp_fake" not in r and not re.search(r"[\w.]+@[\w.]+\.\w+", r), r)
rc, r, d = run(keep=True); ck("run again: DONE, both already had it", rc == 0 and "already had it" in r and not d, r)
q1("drop trigger coverage_cases_guard_t on app_data"); q1("drop function coverage_case_patch(text, jsonb, jsonb)")
rc, r, d = run(BAD_LIVE="coverage-run")
ck("a hand-edited live coverage-run is not replaced (the SQL still goes in, coverage-assign updates)", "coverage-run: its live code is not today's GitHub main" in r and d == ["coverage-assign"] and q1("select to_regproc('public.coverage_case_patch') is not null")[0][0], r)
H.shutdown(); srv.cleanup(); shutil.rmtree(D, ignore_errors=True)
for n, ok, note in res: print(("PASS " if ok else "FAIL ") + n + ("" if ok else "\n      " + note))
print("ALL %d CHECKS PASS" % len(res) if all(x[1] for x in res) else "FAILED")
