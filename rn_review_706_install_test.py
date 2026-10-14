#!/usr/bin/env python3
# Rehearsal of 706 (rn_review_706.py) against a FAKE Supabase (management API, the service) and a FAKE supabase CLI.
# Never touches a real project. Runs the installer from a fresh detached worktree of HEAD (never ../ sibling folders).
#   python3 rn_review_706_install_test.py        (T706_SHOW=1 prints the clean run's report)
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
SQLF = "supabase/nurse-review.sql"; FN = "rn-review"; JOB = "rn-review-pass"
tmp = tempfile.mkdtemp(prefix="t706-"); W = os.path.join(tmp, "wt")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", W, "HEAD"], check=True)
try:
    sys.path.insert(0, W); os.environ.setdefault("SB_REPORT", os.path.join(tmp, "unused.txt"))
    from cc_step_lib import need
    FNROOT = os.path.join(W, "supabase", "functions")
    NEED = sorted(need(FNROOT, FN))
    FNSHAS = {k[len("supabase/functions/"):]: sha(os.path.join(W, k)) for k in NEED}
    SQLSHA = sha(os.path.join(W, SQLF)); SRC = open(os.path.join(W, SQLF)).read(); HEAD300 = SRC[:300]
    # a file rn-review uses that main has in an older version (the live-vs-history case): brand-pdf.ts or another shared file
    OLDER = None
    for k in NEED:
        for c in subprocess.run(["git", "-C", W, "log", "origin/main", "--format=%H", "--", k], capture_output=True, text=True).stdout.split()[1:3]:
            b = subprocess.run(["git", "-C", W, "show", f"{c}:{k}"], capture_output=True).stdout
            if b and hashlib.sha256(b).hexdigest() != sha(os.path.join(W, k)): OLDER = (k, b.decode()); break
        if OLDER: break
    S = {}; M = {}
    def reset(**m):
        S.clear(); S.update(sql=[], posts=[], patches=[], files=[], sched={})
        M.clear(); M.update(dict(live=False, vj=True, ops={"nurse_review_live": False, "ghe_watch_live": True, "other": {"keep": 1}}, jobs={}, vault=1, sqlfail=False, trigger="ok",
                                 probe="refused", tables_open=None, open_fn=False, switch_flips=False, patched=False, reset_gateway=False, staff=[{"name": "Natasha Early", "cred": "RN", "email": "natasha@mo-care.com", "supervising_rn": True}, {"name": "Lena Park", "cred": "LPN"}]), **m)
    CLI_LOG = os.path.join(tmp, "cli.log"); STATE = os.path.join(tmp, "state.json")
    dlines = lambda: [l for l in (open(CLI_LOG).read().splitlines() if os.path.exists(CLI_LOG) else []) if l.startswith("functions deploy")]
    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def _send(self, code, obj):
            b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
        def do_GET(self):
            p = self.path
            if "/api-keys" in p: return self._send(200, [{"name": "anon", "api_key": "eyJanonKEY"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
            m = re.match(r"/v1/projects/\w+/functions/([\w-]+)$", p)
            if m and m.group(1) == FN:
                dl = dlines()
                if M["patched"]: return self._send(200, {"version": 10 + len(dl), "verify_jwt": M["vj"]})
                if dl: return self._send(200, {"version": 10 + len(dl), "verify_jwt": False if M["reset_gateway"] else ("--no-verify-jwt" not in dl[-1])})
                if not M["live"]: return self._send(404, {})
                return self._send(200, {"version": 10, "verify_jwt": M["vj"]})
            self._send(404, {})
        def do_PATCH(self):
            n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}")
            S["patches"].append(body); M["vj"] = body.get("verify_jwt", M["vj"]); M["patched"] = True; self._send(200, {})
        def do_POST(self):
            n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
            if p.startswith("/functions/v1/"):
                S["posts"].append((p.split("/")[3], self.headers.get("Authorization"), body))
                return self._send(200 if M["open_fn"] else 401, {"ok": False, "error": "Sign in first."})
            q = body["query"]; S["sql"].append(q)
            if "to_regclass('storage.objects') is not null as objs" in q:
                return self._send(200, [{"objs": True, "dal": True, "door": True, "ev": True, "bucket": 0, "trig": 0, "tables": 0, "vault": M["vault"]}])
            if q.startswith("select jobname, schedule, active from cron.job where jobname = 'rn-review-pass'"):
                return self._send(200, [{"jobname": j, "schedule": s_, "active": a} for j, (s_, a) in M["jobs"].items()])
            if q == "select data, version from public.app_data where key = 'ops_settings'":
                d = json.loads(json.dumps(M["ops"])); S.setdefault("ops_reads", 0); S["ops_reads"] += 1
                if M["switch_flips"] and S["ops_reads"] > 1: d["ghe_watch_live"] = False
                return self._send(200, [{"data": d, "version": 4}])
            if q == "select data from public.app_data where key = 'nurse_staff'": return self._send(200, [{"data": M["staff"]}])
            if q.startswith(HEAD300):
                S["files"].append("full" if q == SRC else "rest")
                if M["sqlfail"]: return self._send(400, {"message": "ERROR: 42P01: relation does not exist"})
                if M["trigger"] == "perm" and "create trigger nurse_documents_keep" in q: return self._send(400, {"message": "ERROR: 42501: must be owner of table objects"})
                return self._send(201, [])
            mm = re.match(r"select cron\.unschedule\('([\w-]+)'\)", q)
            if mm: M["jobs"].pop(mm.group(1), None); return self._send(200, [])
            mm = re.match(r"select cron\.schedule\('([\w-]+)', '([^']+)', '(.*)'\) as id$", q, re.S)
            if mm: M["jobs"][mm.group(1)] = (mm.group(2), True); S["sched"][mm.group(1)] = mm.group(3).replace("''", "'"); return self._send(200, [{"id": 9}])
            if "from unnest(array[" in q:
                ts = re.findall(r"'(\w+)'", q[q.find("unnest(array["):])
                return self._send(200, [{"t": t, "here": True, "browser": t == M["tables_open"]} for t in ts])
            if q == "select public from storage.buckets where id = 'nurse-docs'": return self._send(200, [{"public": False}])
            if "706_PROBE_RESULT" in q:
                msg = {"refused": "Signed nursing documents are kept for seven years and cannot be deleted (_706_probe/x.pdf).", "deleted": "deleted"}[M["probe"]]
                return self._send(400, {"message": f"ERROR: P0001: 706_PROBE_RESULT: {msg}"})
            if "starts_with(name, '_706_probe/')" in q: return self._send(200, [{"n": 0}])
            return self._send(400, {"message": "unexpected query " + q[:160]})
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
    URL = f"http://127.0.0.1:{srv.server_address[1]}"
    FAKEBIN = os.path.join(tmp, "bin"); os.makedirs(FAKEBIN)
    open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, json
a = sys.argv[1:]; open({CLI_LOG!r}, 'a').write(' '.join(a) + '\\n')
st = json.load(open({STATE!r}))
if a[:2] == ['functions', 'deploy']: sys.exit(0)
if a[:2] == ['functions', 'download']:
    done = any(l.startswith('functions deploy ' + a[2] + ' ') for l in open({CLI_LOG!r}).read().splitlines())
    files = {{k: open(os.path.join(st['root'], k), 'rb').read() for k in st['need']}}
    if not done:
        for k, v in st['override'].items():
            if v is None: files.pop(k, None)
            else: files[k] = v.encode()
    for k, b in files.items():
        p = os.path.join(os.getcwd(), k); os.makedirs(os.path.dirname(p), exist_ok=True); open(p, 'wb').write(b)
    sys.exit(0)
sys.exit(1)
""")
    os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
    def run(env_over=None, override=None, **mode):
        reset(**mode); rep = os.path.join(tmp, "r.txt")
        for f in (CLI_LOG, rep):
            if os.path.exists(f): os.remove(f)
        open(CLI_LOG, "w").close()
        json.dump({"root": W, "need": NEED, "override": override or {}}, open(STATE, "w"))
        env = dict(os.environ, PATH=FAKEBIN + ":/usr/bin:/bin", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"),
                   SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(FNSHAS), SB_SQL_SHA=SQLSHA, PYTHONPATH=W, SB_STEP="706")
        env.update(env_over or {})
        p = subprocess.run(["python3", os.path.join(W, "rn_review_706.py")], env=env, capture_output=True, text=True, timeout=600, cwd=tmp)
        return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
    deployed = lambda: [l.split()[2] for l in dlines()]
    changed = lambda: bool(S["files"]) or bool(deployed()) or any("cron.schedule(" in q for q in S["sql"])
    writes_app_data = lambda: any(re.search(r"(?i)update public\.app_data|insert into public\.app_data|select public\.upsert_app_data_item|rpc/upsert_app_data_item", q) for q in S["sql"])

    c, out = run()
    if os.environ.get("T706_SHOW"): print(out)
    ck("clean run: exit 0, RESULT: DONE, then NEXT (merge the Hub and Owners Hub pull requests)", c == 0 and "RESULT: DONE" in out and out.strip().splitlines()[-1].startswith("NEXT: merge the Hub pull request"), out)
    ck("the SQL ran once, the reviewed file byte for byte, before the deploy", S["files"] == ["full"] and any(q == SRC for q in S["sql"]), S["files"])
    ck("only rn-review is deployed (new: gateway sign-in check on, so no --no-verify-jwt)", deployed() == [FN] and "--no-verify-jwt" not in dlines()[0] and "rn-review is new (not live yet)" in out, dlines())
    ck("the hourly schedule: POST {\"action\": \"pass\"} to rn-review with the Vault's x-cron-secret and the public key; proved on", JOB in S["sched"] and "/functions/v1/rn-review'" in S["sched"][JOB]
       and "'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'hub_job_secret')" in S["sched"][JOB] and "body := '{\"action\": \"pass\"}'::jsonb" in S["sched"][JOB]
       and M["jobs"][JOB] == ("7 * * * *", True) and "rn-review-pass is on, every hour" in out, [S["sched"], out])
    ck("the proofs: live as tested, refuses a visitor and a pass without the secret, tables closed, bucket private, the keep-guard tried and rolled back, no probe left",
       all(s in out for s in ["rn-review is live as tested", "refuses a visitor who is not signed in (401)", "refuses a pass without the job secret (401)", "a visitor or a signed-in page can reach none of them",
                                "the nurse-docs bucket is private", "kept for seven years", "no probe is left in storage"]), out)
    pq = [q for q in S["sql"] if "706_PROBE_RESULT" in q]
    ck("the probe is one DO block on nurse-docs that always raises (so it always rolls back)", len(pq) == 1 and pq[0].startswith("do $p$") and "'nurse-docs'" in pq[0] and pq[0].rstrip().endswith("raise exception '706_PROBE_RESULT: %', m; end $p$"), pq)
    ck("the services are called as a visitor (the public key), never the server key", S["posts"] and all(a == "Bearer eyJanonKEY" for _, a, _ in S["posts"]), S["posts"])
    ck("no switch or app_data is written; the switch is shown only; no switch changed", not writes_app_data() and "nurse_review_live is off (practice); this step does not change it" in out and "no switch changed" in out, out)
    ck("the RNs on the nurse list are named (supervising marked)", "RNs on the nurse list: Natasha Early (supervising)" in out, out)
    ck("no key or token is printed; no em dash in the report or the step's own files", "sbp_test" not in out and "eyJanonKEY" not in out and "eyJsvcKEY" not in out and "—" not in out
       and "—" not in open(os.path.join(W, "rn_review_706.py")).read(), out)

    # ── live vs history ──
    c, out = run(live=True)
    ck("already live and already this build: said so, redeployed with its own gateway setting, DONE", c == 0 and "is already this build" in out and deployed() == [FN], out)
    if OLDER:
        k, b = OLDER
        c, out = run(live=True, override={k: b})
        ck(f"a live file from main's own history ({k.split('/')[-1]}) is just older: named, deployed, DONE", c == 0 and "older versions (from main's own history)" in out and deployed() == [FN], out)
    else: ck("an older-from-main live file was found to rehearse", False, "none")
    k1 = "supabase/functions/rn-review/index.ts"
    c, out = run(live=True, override={k1: "// someone's hand deploy\n" + open(os.path.join(W, k1)).read()})
    ck("a live file in NO main history (someone's unmerged work): STOP before any change", c == 3 and "never on main" in out and not changed(), out)
    c, out = run(live=True, override={"supabase/functions/_shared/someones-file.ts": "export const x = 1\n"})
    ck("a live file this build does not use and main never had: STOP before any change", c == 3 and "someones-file.ts" in out and not changed(), out)
    c, out = run(live=True, vj=False)
    ck("already live with the gateway check off: kept off (deployed with --no-verify-jwt)", c == 0 and "--no-verify-jwt" in dlines()[0], dlines())
    c, out = run(reset_gateway=True)
    ck("a deploy that comes back with the wrong gateway setting is put back (on)", c == 0 and S["patches"] == [{"verify_jwt": True}], [S["patches"], out])

    # ── pins and prerequisites ──
    c, out = run(env_over={"SB_SQL_SHA": "0" * 64})
    ck("the SQL is not the reviewed build: STOP, no query at all", c == 2 and not S["sql"] and "nurse-review.sql is not the reviewed build" in out, out)
    c, out = run(env_over={"SB_FN_SHAS": json.dumps({k: v for k, v in FNSHAS.items() if k != "_shared/rn-review.ts"})})
    ck("a needed file not pinned: STOP, no query at all", c == 2 and "not pinned" in out and not S["sql"], out)
    c, out = run(env_over={"SB_FN_SHAS": json.dumps(dict(FNSHAS, **{"rn-review/index.ts": "0" * 64}))})
    ck("a service file that is not the reviewed build: STOP, no query at all", c == 2 and not S["sql"], out)
    c, out = run(vault=0)
    ck("no job secret in the Vault: STOP before any change", c == 3 and "hub_job_secret" in out and not changed(), out)
    c, out = run(jobs={JOB: ("0 * * * *", True)})
    ck("an existing rn-review-pass is replaced (unscheduled, then hourly)", c == 0 and "exists (it is replaced)" in out and M["jobs"][JOB] == ("7 * * * *", True) and any(q.startswith("select cron.unschedule('rn-review-pass')") for q in S["sql"]), out)
    c, out = run(staff=[{"name": "Natasha Early", "cred": "RN"}])
    ck("no supervising RN and no email on the list: said plainly, not a stop", c == 0 and "no supervising RN is marked" in out and "no email: cannot sign in" in out, out)

    # ── changes ──
    c, out = run(sqlfail=True)
    ck("a SQL error: STOP, nothing deployed, no schedule", c == 5 and "did not install" in out and not deployed() and not S["sched"], out)
    c, out = run(trigger="perm")
    rq = [q for q in S["sql"] if q.startswith(HEAD300) and q != SRC]
    ck("no permission for the storage trigger: reported, the file rerun without the trigger only, deployed, RESULT not clean, the probe not tried",
       c == 9 and "NOT protected yet" in out and S["files"] == ["full", "rest"] and len(rq) == 1 and "create trigger nurse_documents_keep" not in rq[0] and "function public.nurse_documents_keep()" in rq[0]
       and "create trigger nurse_flag_guard_t" in rq[0] and deployed() == [FN] and not any("706_PROBE_RESULT" in q for q in S["sql"]) and "the keep-guard was not tried" in out, out)
    c, out = run(probe="deleted")
    ck("the guard letting a delete through: reported", c == 9 and "let a signed nursing PDF be deleted" in out, out)
    c, out = run(open_fn=True)
    ck("rn-review answering a visitor: reported", c == 9 and "answered a visitor with 200" in out, out)
    c, out = run(tables_open="nurse_flag")
    ck("a table a browser can reach: reported", c == 9 and "can reach: nurse_flag" in out, out)
    c, out = run(switch_flips=True)
    ck("a switch changing during the step: reported", c == 9 and "these switches changed during the step: ghe_watch_live" in out, out)
finally:
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", W], capture_output=True)
    shutil.rmtree(tmp, ignore_errors=True)
failed = [r for r in res if not r[1]]
for n, ok, note in res: print(("PASS  " if ok else "FAIL  ") + n + ("" if ok else "\n      " + note))
print(f"\n{len(res) - len(failed)}/{len(res)} passed" + (" · FAIL" if failed else ""))
raise SystemExit(1 if failed else 0)
