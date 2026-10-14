#!/usr/bin/env python3
# Rehearsal of 707 (nurse_visit_check_707.py) against a FAKE Supabase (the management API, the service) and a FAKE supabase
# CLI. Never touches a real project. Runs the installer from a fresh detached worktree of HEAD (never ../ sibling folders),
# the way the Desktop step does.   python3 nurse_visit_check_707_install_test.py   (T707_SHOW=1 prints the clean report)
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
FN, JOB = "nurse-visit-check", "nurse-visit-check-pass"
tmp = tempfile.mkdtemp(prefix="t707-"); W = os.path.join(tmp, "wt")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", W, "HEAD"], check=True)
try:
    # the worktree holds HEAD; the files under test are this build's own (copied in, so an uncommitted rehearsal matches)
    for rel in subprocess.run(["git", "-C", HERE, "ls-files", "-m", "-o", "--exclude-standard", "--", "supabase/functions", "nurse_visit_check_707.py", "cc_step_lib.py"], capture_output=True, text=True).stdout.split():
        os.makedirs(os.path.dirname(os.path.join(W, rel)) or W, exist_ok=True); shutil.copyfile(os.path.join(HERE, rel), os.path.join(W, rel))
    sys.path.insert(0, W); os.environ.setdefault("SB_REPORT", os.path.join(tmp, "unused.txt"))
    from cc_step_lib import need
    FNROOT = os.path.join(W, "supabase", "functions")
    NEED = sorted(need(FNROOT, FN))
    FNSHAS = {k[len("supabase/functions/"):]: sha(os.path.join(W, k)) for k in NEED}
    ck("the service needs its own files and the shared rules (nurse-services, nurse-bill, nurse-license, the senders), all pinned",
       all(f"supabase/functions/_shared/{x}" in NEED for x in ["nurse-services.ts", "nurse-bill.ts", "nurse-license.ts", "optout.ts", "send-problems.ts", "job-auth.ts", "staff-auth.ts"]) and f"supabase/functions/{FN}/index.ts" in NEED, NEED)
    S = {}; M = {}
    def reset(**m):
        S.clear(); S.update(sql=[], posts=[], patches=[], ops_reads=0)
        M.clear(); M.update(dict(live=False, vj=True, vault=1, job=None, ops={"ghe_watch_live": True, "visit_watch_live": False, "nurse_visit_check_live": False}, versions={"nurse_bill_check": 3},
                                 dry_answer="ok", write_in_dry=False, deploy_fail=False, flip=False), **m)
    CLI_LOG = os.path.join(tmp, "cli.log"); STATE = os.path.join(tmp, "state.json")
    dlines = lambda: [l for l in (open(CLI_LOG).read().splitlines() if os.path.exists(CLI_LOG) else []) if l.startswith("functions deploy")]
    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def _send(self, code, obj):
            b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
        def do_GET(self):
            p = self.path
            if "/api-keys" in p: return self._send(200, [{"name": "anon", "api_key": "eyJanonKEY"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
            m = re.match(r"/v1/projects/zngsgedlsxinbygwmxwn/functions/([\w-]+)$", p)
            if m:
                if not dlines() and not M["live"]: return self._send(404, {})
                return self._send(200, {"version": 3 + len(dlines()), "verify_jwt": M["vj"] if not dlines() else ("--no-verify-jwt" not in dlines()[-1])})
            self._send(404, {})
        def do_PATCH(self): self._send(200, {})
        def do_POST(self):
            n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
            if p.startswith("/functions/v1/"):
                auth = self.headers.get("Authorization"); S["posts"].append((p, auth, body))
                if auth != "Bearer eyJsvcKEY": return self._send(401, {"ok": False, "error": "not allowed"})
                if M["write_in_dry"]: M["versions"]["nurse_bill_check"] += 1
                if M["dry_answer"] == "axfail": return self._send(200, {"ok": False, "visits": {"ok": False, "dry": True, "error": "AxisCare is not set up on the server"}, "license": {"dry": True, "due": 0}})
                return self._send(200, {"ok": True, "visits": {"ok": True, "dry": "?dry=1" in p, "clients": 12, "visits_checked": 0, "ready": 0, "not_ready": 0, "services_from": "built-in"}, "license": {"dry": "?dry=1" in p, "due": 1}})
            q = body["query"]; S["sql"].append(q)
            if q == "select data, version from public.app_data where key = 'ops_settings'":
                S["ops_reads"] += 1; d = json.loads(json.dumps(M["ops"]))
                if M["flip"] and S["ops_reads"] > 1: d["ghe_watch_live"] = False
                return self._send(200, [{"data": d, "version": 9}])
            if "from vault.decrypted_secrets" in q and "as vault" in q: return self._send(200, [{"vault": M["vault"], "job": M["job"]}])
            if "jsonb_array_elements" in q and "ghe_watch" in q: return self._send(200, [{"month": "2026-09", "stage": "missed", "n": 2}, {"month": "2026-10", "stage": "not_booked", "n": 3}])
            if "jsonb_array_length" in q: return self._send(200, [{"key": "nurse_clients", "n": 14}, {"key": "medicaid_plans", "n": 20}, {"key": "nurse_staff", "n": 2}])
            if q.startswith("select key, version from public.app_data where key in"): return self._send(200, [{"key": k, "version": v} for k, v in M["versions"].items()])
            if q.startswith("select cron.unschedule"): return self._send(200, [])
            mm = re.match(r"select cron\.schedule\('([\w-]+)', '([^']+)', '(.*)'\) as id$", q, re.S)
            if mm: M["job"] = [{"schedule": mm.group(2), "active": True, "command": mm.group(3)}]; return self._send(200, [{"id": 7}])
            if q.startswith("select schedule, active from cron.job"): return self._send(200, [{"schedule": j["schedule"], "active": j["active"]} for j in (M["job"] or [])])
            return self._send(400, {"message": "unexpected query " + q[:160]})
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
    URL = f"http://127.0.0.1:{srv.server_address[1]}"
    FAKEBIN = os.path.join(tmp, "bin"); os.makedirs(FAKEBIN)
    open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, json
a = sys.argv[1:]; open({CLI_LOG!r}, 'a').write(' '.join(a) + '\\n')
st = json.load(open({STATE!r}))
if a[:2] == ['functions', 'deploy']: sys.exit(1 if st.get('deploy_fail') else 0)
if a[:2] == ['functions', 'download']:
    done = any(l.startswith('functions deploy ') for l in open({CLI_LOG!r}).read().splitlines())
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
    def run(shas=None, override=None, **mode):
        reset(**mode); rep = os.path.join(tmp, "r.txt")
        for f in (CLI_LOG, rep):
            if os.path.exists(f): os.remove(f)
        open(CLI_LOG, "w").close()
        json.dump({"root": W, "need": NEED, "override": override or {}, "deploy_fail": M["deploy_fail"]}, open(STATE, "w"))
        env = dict(os.environ, PATH=FAKEBIN + ":/usr/bin:/bin", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"),
                   SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(shas or FNSHAS), PYTHONPATH=W, SB_STEP="707", SB_MAIN_REF="HEAD")
        p = subprocess.run(["python3", os.path.join(W, "nurse_visit_check_707.py")], env=env, capture_output=True, text=True, timeout=600, cwd=tmp)
        return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
    writes = lambda: [q for q in S["sql"] if re.match(r"(?i)\s*(update|insert|delete|select cron\.(un)?schedule)", q)]
    nothing = lambda: not writes() and not dlines()

    c, out = run()
    if os.environ.get("T707_SHOW"): print(out)
    ck("clean run: DONE, exit 0", c == 0 and "RESULT: DONE" in out, out)
    ck("...PART 1 says the service is new, the secret is there, the three nurse switches are off, and what the check reads", "✓ nurse-visit-check is not live yet" in out and "✓ the job secret is in the Vault" in out and "✓ the three nurse switches are off" in out and "nurse_clients 14" in out and "the GHE watch (ghe-reminders) as of its last run: 2026-09 missed 2, 2026-10 not_booked 3" in out, out)
    ck("...deploys ONLY nurse-visit-check, gateway sign-in check on", [l.split()[2] for l in dlines()] == [FN] and "--no-verify-jwt" not in dlines()[0], dlines())
    j = M["job"][0] if M["job"] else {}
    ck("...schedules nurse-visit-check-pass every 30 minutes with the vault secret and { action: 'pass' }", j.get("schedule") == "*/30 * * * *" and "hub_job_secret" in j.get("command", "") and '"action": "pass"' in j.get("command", "") and "/functions/v1/nurse-visit-check" in j.get("command", ""), j)
    ck("...changes no switch: the only writes are the schedule (no update, insert or delete anywhere)", [q.split("(")[0] for q in writes()] == ["select cron.unschedule", "select cron.schedule"], writes())
    vis = [x for x in S["posts"] if x[1] == "Bearer eyJanonKEY"]; dry = [x for x in S["posts"] if x[1] == "Bearer eyJsvcKEY"]
    ck("...proof: a visitor is refused on the pass and the report; the one server-key call is a dry pass", len(vis) == 2 and {x[2]["action"] for x in vis} == {"pass", "report"} and len(dry) == 1 and dry[0][0].endswith("?dry=1") and dry[0][2] == {"action": "pass"}, S["posts"])
    ck("...the practice run's numbers are in the report, and nothing it read changed", "✓ practice run (nothing written): 12 clients read" in out and "license reminders due now: 1" in out and "✓ the practice run wrote nothing" in out, out)
    ck("...no key is printed in the report", "eyJ" not in out and "sbp_" not in out)
    c, out = run(ops={"nurse_visit_check_live": True})
    ck("a nurse switch already on: STOPPED in PART 1, nothing deployed or scheduled", c == 3 and "already on: nurse_visit_check_live" in out and nothing(), out)
    c, out = run(vault=0)
    ck("no job secret in the Vault: STOPPED, nothing changed", c == 3 and "does not hold hub_job_secret" in out and nothing(), out)
    bad = dict(FNSHAS); bad["_shared/nurse-bill.ts"] = "0" * 64
    c, out = run(shas=bad)
    ck("a file that is not the reviewed build: STOPPED, nothing changed", c == 2 and "nurse-bill.ts is not the reviewed build" in out and nothing(), out)
    c, out = run(live=True, override={f"supabase/functions/{FN}/index.ts": "// someone's unmerged work\n"})
    ck("a live copy that is not from this build's history: STOPPED, nothing changed", c == 3 and "not from this build's history" in out and nothing(), out)
    c, out = run(live=True, vj=False)
    ck("already live as this build: deployed again keeping its own gateway setting (off)", c == 0 and "already this build" in out and "--no-verify-jwt" in dlines()[0], [out, dlines()])
    c, out = run(deploy_fail=True)
    ck("the deploy fails: STOPPED before the schedule", c == 6 and M["job"] is None and "the schedule was not added" in out.lower(), [c, M["job"], out[-700:]])
    c, out = run(write_in_dry=True)
    ck("the practice run changed a record: said, with a ✗", c == 9 and "the nurse check records changed during the practice run" in out, out)
    c, out = run(dry_answer="axfail")
    ck("the practice run cannot reach AxisCare: said, with a ✗", c == 9 and "could not read AxisCare: AxisCare is not set up on the server" in out, out)
    c, out = run(flip=True)
    ck("a switch changed by someone during the step: said", c == 9 and "these switches changed during the step: ghe_watch_live" in out, out)
    cmd = open(os.path.join(HERE, "..", "desktop", "707 Nurse visit checks, the Hub project.command")).read() if os.path.exists(os.path.join(HERE, "..", "desktop", "707 Nurse visit checks, the Hub project.command")) else ""
    if cmd:
        pins = json.loads(re.search(r"FN_SHAS='(\{.*?\})'", cmd).group(1))
        ck("the Desktop file pins exactly these files at this build", pins == FNSHAS, sorted(set(pins.items()) ^ set(FNSHAS.items())))
finally:
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", W], capture_output=True); shutil.rmtree(tmp, ignore_errors=True)
for n, ok, note in res: print(("PASS  " if ok else "FAIL  ") + n + ("" if ok else "\n      " + note))
p = sum(1 for r in res if r[1]); print(f"\n{p}/{len(res)} passed"); sys.exit(0 if p == len(res) else 1)
