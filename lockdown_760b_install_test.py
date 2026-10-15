#!/usr/bin/env python3
# Rehearsal of the 760b Desktop step (lockdown_760b_install.py) from a fresh detached worktree of HEAD. A fake Supabase:
# every SQL statement the step sends runs on a REAL local Postgres shaped like the hub project (access_760_fixture.py);
# the functions live in a fake store the fake supabase CLI downloads from and deploys to. Never touches a real project.
#   python3 lockdown_760b_install_test.py        (T760B_SHOW=1 prints each run's report)
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil, sys, datetime as dt, decimal, uuid
HERE = os.path.dirname(os.path.abspath(__file__))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
FNS = ["hub-access", "rn-review", "ai-draft-followup", "ai-draft-careplan"]
tmp = tempfile.mkdtemp(prefix="t760b-"); W = os.path.join(tmp, "wt")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", W, "HEAD"], check=True)
try:
    sys.path.insert(0, W); os.environ.setdefault("SB_REPORT", os.path.join(tmp, "unused.txt"))
    from cc_step_lib import need
    from access_760_fixture import make, U
    from pg8000.native import Connection, DatabaseError
    FNROOT = os.path.join(W, "supabase", "functions")
    BASE = subprocess.run(["git", "-C", W, "merge-base", "HEAD", "origin/main"], capture_output=True, text=True).stdout.strip()
    NEEDS = {fn: sorted(need(FNROOT, fn)) for fn in FNS}
    changed = set(subprocess.run(["git", "-C", W, "diff", "--name-only", BASE, "HEAD"], capture_output=True, text=True).stdout.split())
    SHAS = {k[len("supabase/functions/"):]: sha(os.path.join(W, k)) for fn in FNS for k in NEEDS[fn] if k in changed}
    SQLSHA, RBSHA = sha(os.path.join(W, "lockdown_760b.sql")), sha(os.path.join(W, "lockdown_760b_rollback.sql"))
    def base_bytes(k): return subprocess.run(["git", "-C", W, "show", f"{BASE}:{k}"], capture_output=True).stdout
    LIVE = os.path.join(tmp, "live"); M = {}; S = {}
    def reset(fresh_db=True, live="base"):
        shutil.rmtree(LIVE, ignore_errors=True)
        for fn in FNS:
            for k in NEEDS[fn]:
                dst = os.path.join(LIVE, fn, k); os.makedirs(os.path.dirname(dst), exist_ok=True)
                open(dst, "wb").write(base_bytes(k) if live == "base" else open(os.path.join(W, k), "rb").read())
        S.clear(); S.update(sql=[], deploys=[], posts=[])
        if fresh_db: M["c"], M["sock"] = make()
    def q(sqltext):
        c = Connection(user="postgres", database="postgres", unix_sock=M["sock"])
        try:
            rows = c.run(sqltext); cols = [d["name"] for d in (c.columns or [])]
            return 200, [dict(zip(cols, r)) for r in (rows or [])]
        except DatabaseError as e:
            return 400, {"message": "ERROR: " + str(e.args[0].get("M") if e.args and isinstance(e.args[0], dict) else e)}
        finally: c.close()
    def jd(o):
        if isinstance(o, (dt.datetime, dt.date)): return o.isoformat()
        if isinstance(o, (decimal.Decimal, uuid.UUID)): return str(o)
        return str(o)
    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def _send(self, code, obj):
            b = json.dumps(obj, default=jd).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
        def do_GET(self):
            if "/api-keys" in self.path: return self._send(200, [{"name": "anon", "api_key": "eyJanonKEY"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
            m = re.match(r"/v1/projects/\w+/functions/([\w-]+)$", self.path)
            if m: return self._send(200, {"version": 5 + sum(1 for d in S["deploys"] if d == m.group(1)), "verify_jwt": True})
            self._send(404, {})
        def do_PATCH(self): self._send(200, {})
        def do_POST(self):
            n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}")
            if self.path.startswith("/functions/v1/"): S["posts"].append(self.path); return self._send(401, {"error": "Sign in first."})
            S["sql"].append(body["query"]); code, out = q(body["query"]); self._send(code if code == 200 else 400, out)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
    API = f"http://127.0.0.1:{srv.server_address[1]}"
    CLI = os.path.join(tmp, "supabase"); open(CLI, "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil
a = sys.argv[1:]; LIVE = {LIVE!r}; fn = a[2]
if a[:2] == ["functions", "download"]:
    src = os.path.join(LIVE, fn)
    for r, _, fs in os.walk(src):
        for f in fs:
            rel = os.path.relpath(os.path.join(r, f), src); dst = os.path.join(os.getcwd(), rel); os.makedirs(os.path.dirname(dst), exist_ok=True); shutil.copy(os.path.join(r, f), dst)
elif a[:2] == ["functions", "deploy"]:
    open({os.path.join(tmp, "deploys.log")!r}, "a").write(fn + "\\n")
    for r, _, fs in os.walk(os.path.join(LIVE, fn)):
        for f in fs:
            rel = os.path.relpath(os.path.join(r, f), os.path.join(LIVE, fn)); s = os.path.join(os.getcwd(), rel)
            if os.path.exists(s): shutil.copy(s, os.path.join(r, f))
""")
    os.chmod(CLI, 0o755)
    def run(yes="yes", **env):
        rep = os.path.join(tmp, f"rep{len(res)}.txt")
        if os.path.exists(os.path.join(tmp, "deploys.log")): os.remove(os.path.join(tmp, "deploys.log"))
        e = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_test", SB_API_BASE=API, SB_FN_BASE=API, SB_SUPA_CLI=CLI, SB_FNROOT=FNROOT,
                 SB_BASE=BASE, SB_SHAS=json.dumps(SHAS), SB_SQL_SHA=SQLSHA, SB_RB_SHA=RBSHA, SB_YES=yes, SB_SETTLE="0", **env)
        p = subprocess.run([sys.executable, os.path.join(W, "lockdown_760b_install.py")], cwd=W, env=e, capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=600)
        out = open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr
        S["deploys"] = open(os.path.join(tmp, "deploys.log")).read().split() if os.path.exists(os.path.join(tmp, "deploys.log")) else []
        if os.environ.get("T760B_SHOW"): print(out)
        return p.returncode, out
    one = lambda s: M["c"].run(s)[0][0]
    def pols(): return one("select count(*) from pg_policies where qual = 'true' and tablename in ('person_identity','person_source_id','person_role','person_relationship','phone_index')")

    # 1 · Krystal has a blank list on the copy: the step refuses before anything changes
    reset()
    code, out = run()
    ck("a staff login with a blank list: stops in part 1, nothing changed, nothing deployed", code == 3 and "would be locked out" in out and pols() == 5 and not S["deploys"], out[-900:])
    M["c"].run("update auth.users set raw_app_meta_data = raw_app_meta_data || '{\"hub_access\": [\"care_coordinator\", \"staffing\", \"team_hub\"]}' where id = :u", u=U["kry"])
    # 2 · no to the question: nothing changes
    code, out = run(yes="no")
    ck("answering anything but yes changes nothing", code == 0 and "nothing was changed" in out and pols() == 5 and not S["deploys"], out[-600:])
    ck("part 1 sent only reads", all(re.match(r"\s*(select|with|do)", s, re.I) for s in S["sql"]) and not any("create" in s.lower() for s in S["sql"] if not s.lstrip().lower().startswith("do")), [s[:80] for s in S["sql"]])
    # 3 · the real run
    code, out = run()
    ck("clean run: DONE", code == 0 and "RESULT: DONE" in out, out[-1500:])
    ck("the rules went in on the real Postgres copy", pols() == 0 and one("select count(*) from pg_policies where policyname like '%_office_read'") == 5)
    ck("all four functions deployed, each once", sorted(S["deploys"]) == sorted(FNS), S["deploys"])
    ck("proof: a new login with no list opens nothing", "a new login with no hub list opens nothing (0 records, 0 phone links)" in out, out[-1500:])
    ck("proof: every office login still opens leads and caller recognition", out.count("still opens the leads and caller recognition") == 3 and "✗" not in out, out[-1500:])
    ck("proof: hub-access refuses the public key", "hub-access refuses the public key (401)" in out)
    ck("no key, token or email printed", "sbp_test" not in out and "eyJanonKEY" not in out and "@mo-care.com" not in out)
    # 4 · run again: nothing new happens
    code, out = run()
    ck("safe to run again (already this build, nothing redeployed)", code == 0 and "already this build" in out and not S["deploys"] and "RESULT: DONE" in out, out[-900:])
    # 5 · the undo puts today back
    M["c"].run(open(os.path.join(W, "lockdown_760b_rollback.sql")).read())
    ck("the undo puts every read-everything rule back", pols() == 5 and one("select count(*) from pg_policies where policyname like '%_office_read'") == 0)
    # 6 · a live rule that is not the one this was built on: stop
    reset(); M["c"].run("update auth.users set raw_app_meta_data = raw_app_meta_data || '{\"hub_access\": [\"care_coordinator\"]}' where id = :u", u=U["kry"])
    M["c"].run("create or replace function public.jwt_hub_access() returns jsonb language sql stable as $$ select '[]'::jsonb $$")
    code, out = run()
    ck("a live hub-list rule this was not built on: stops, nothing changed", code == 3 and "not the one this was built on" in out and pols() == 5 and not S["deploys"], out[-600:])
    # 7 · a live function that is neither the old nor this build: stop
    reset(); M["c"].run("update auth.users set raw_app_meta_data = raw_app_meta_data || '{\"hub_access\": [\"care_coordinator\"]}' where id = :u", u=U["kry"])
    f = os.path.join(LIVE, "rn-review", "supabase/functions/rn-review/index.ts"); open(f, "a").write("\n// someone else's change\n")
    code, out = run()
    ck("a live function someone else changed: stops, nothing changed", code == 3 and "rn-review on the server is not what 760b expects" in out and pols() == 5 and not S["deploys"], out[-600:])
    # 8 · a file of the build edited after review: stop before anything
    reset(); p_ = os.path.join(W, "lockdown_760b.sql"); keep = open(p_).read(); open(p_, "a").write("\n-- edited\n")
    code, out = run(); open(p_, "w").write(keep)
    ck("the rule file edited after review: stops, nothing sent", code == 2 and "not the reviewed build" in out and not S["sql"], out[-600:])
    srv.shutdown()
finally:
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", W], capture_output=True)
for n, ok, note in res: print(("PASS  " if ok else "FAIL  ") + n + (("\n      " + note) if note else ""))
print(f"{sum(ok for _, ok, _ in res)}/{len(res)} passed"); sys.exit(0 if all(ok for _, ok, _ in res) else 1)
