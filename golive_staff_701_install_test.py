#!/usr/bin/env python3
# Rehearsal of 701 (golive_staff_701.py) against a FAKE Supabase (management API, the services) and a FAKE supabase CLI.
# Never touches a real project. Runs the installer from a fresh detached worktree of HEAD (never ../ sibling folders).
#   python3 golive_staff_701_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
FNS = ["bg-review", "caregiver-export", "caregiver-journey", "hire-profile", "match-dark", "offer-sign", "reference-send",
       "reference-tasks", "step1-sign", "step2-handoff", "welcome-call"]
SWITCHES = ["offer_send_live", "offer_reminders_live", "step1_auto_live", "step2_send_live", "step2_reminders_live", "wc_auto_invite_live",
            "orient_remind_live", "approve_work_text_live", "approve_work_axiscare_live", "axiscare_hire_date_live", "axiscare_level_live"]
tmp = tempfile.mkdtemp(prefix="t701-"); W = os.path.join(tmp, "wt")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", W, "HEAD"], check=True)
try:
    sys.path.insert(0, W); os.environ.setdefault("SB_REPORT", os.path.join(tmp, "unused.txt"))
    from cc_step_lib import need
    FNROOT = os.path.join(W, "supabase", "functions")
    NEED = {fn: sorted(need(FNROOT, fn)) for fn in FNS}
    ALL = sorted({k for v in NEED.values() for k in v})
    FNSHAS = {k[len("supabase/functions/"):]: sha(os.path.join(W, k)) for k in ALL}
    SQLSHAS = {r: sha(os.path.join(W, r)) for r in ("supabase/step1-link-tighten.sql", "supabase/onboarding-retention-700.sql")}
    # a file whose origin/main version differs from this build: the "older live copy" case
    OLDER = None
    for fn in FNS:
        for k in NEED[fn]:
            b = subprocess.run(["git", "-C", W, "show", f"origin/main:{k}"], capture_output=True).stdout
            if b and hashlib.sha256(b).hexdigest() != sha(os.path.join(W, k)): OLDER = (fn, k, b.decode()); break
        if OLDER: break
    S = {}; M = {}
    def reset(**m):
        S.clear(); S.update(sql=[], posts=[], patches=[])
        ops = {k: False for k in SWITCHES}; ops["orient_remind_live"] = True
        M.clear(); M.update(dict(vj={fn: fn != "step1-sign" for fn in FNS}, ops=ops, jobs={"caregiver-journey-sweep": ("*/10 * * * *", True), "caregiver-audit-nightly": ("5 11 * * *", True), "step2-handoff-pass": ("*/15 * * * *", True)},
                                 trigger="ok", link="ok", real_started=0, notlive=None, reset_gateway=False, probe="refused", preview_v=2, open_review=False, switch_flips=False, patched=set()), **m)
    CLI_LOG = os.path.join(tmp, "cli.log"); STATE = os.path.join(tmp, "state.json")
    deployed = lambda: [l.split()[2] for l in (open(CLI_LOG).read().splitlines() if os.path.exists(CLI_LOG) else []) if l.startswith("functions deploy")]
    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def _send(self, code, obj):
            b = obj if isinstance(obj, bytes) else json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
        def do_GET(self):
            p = self.path
            if "/api-keys" in p: return self._send(200, [{"name": "anon", "api_key": "eyJanonKEY"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
            m = re.match(r"/v1/projects/\w+/functions/([\w-]+)$", p)
            if m:
                fn = m.group(1)
                if fn == M["notlive"]: return self._send(404, {})
                vj = M["vj"][fn]
                if M["reset_gateway"] and fn in deployed() and fn not in M["patched"]: vj = True  # a deploy that put the gateway back on
                return self._send(200, {"version": 10 + deployed().count(fn), "verify_jwt": vj})
            self._send(404, {})
        def do_PATCH(self):
            n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}")
            fn = self.path.rstrip("/").split("/")[-1]; S["patches"].append((fn, body))
            if "verify_jwt" in body: M["vj"][fn] = body["verify_jwt"]; M["patched"].add(fn)
            self._send(200, {})
        def do_POST(self):
            n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
            if p.startswith("/functions/v1/"):
                fn = p.split("/")[3]; S["posts"].append((fn, self.headers.get("Authorization"), body))
                if fn == "step1-sign" and body.get("action") == "preview":
                    return self._send(200, {"ok": True, "preview": True, "forms": [{"key": "employee_application", "title": "Employee Application", "version": 4},
                                                                                {"key": "fcra_disclosure", "title": "Permission for Background Checks and References", "version": M["preview_v"]}]})
                if fn == "step1-sign" and body.get("action") == "review": return self._send(200 if M["open_review"] else 401, {"ok": False, "error": "Sign in first."})
                if fn == "hire-profile": return self._send(401, {"error": "Sign in first."})
                return self._send(404, {})
            q = body["query"]; S["sql"].append(q)
            if "to_regprocedure('public.step1_candidate_create(text,jsonb)')" in q:
                return self._send(200, [{"fn": True, "forms": True, "objs": True, "bucket": 1, "view": False, "trig": 0}])
            if "from cron.job j where j.jobname in" in q:
                return self._send(200, [{"jobname": j, "schedule": s_, "active": a, "last_status": "succeeded", "last_at": "2026-10-13 09:50:00+00"} for j, (s_, a) in M["jobs"].items()])
            if q == "select data from public.app_data where key = 'ops_settings'":
                S["ops_reads"] = S.get("ops_reads", 0) + 1; d = dict(M["ops"])
                if M["switch_flips"] and S["ops_reads"] > 1: d["step1_auto_live"] = True
                return self._send(200, [{"data": d}])
            if "from public.step1_forms" in q and "real_started" in q: return self._send(200, [{"practice": 3, "real": M["real_started"], "real_started": M["real_started"]}])
            if "STEP 1 LINK TIGHTEN" in q: return self._send(201, []) if M["link"] == "ok" else self._send(400, {"message": "ERROR: refused"})
            if "700 · SEVEN-YEAR RETENTION" in q:
                if "create trigger onboarding_documents_keep" in q and M["trigger"] == "perm":
                    return self._send(400, {"message": "ERROR: 42501: must be owner of table objects"})
                return self._send(201, [])
            if "701_PROBE_RESULT" in q:
                msg = {"refused": "Signed onboarding documents are kept for seven years and cannot be deleted (_701_probe/x.pdf).", "deleted": "deleted"}[M["probe"]]
                return self._send(400, {"message": f"ERROR: P0001: 701_PROBE_RESULT: {msg}"})
            if "starts_with(name, '_701_probe/')" in q: return self._send(200, [{"n": 0}])
            if "has_function_privilege" in q: return self._send(200, [{"a": False, "b": False}])
            if "from public.onboarding_retention" in q: return self._send(200, [{"n": 3, "dated": 3}])
            return self._send(400, {"message": "unexpected query " + q[:160]})
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
    URL = f"http://127.0.0.1:{srv.server_address[1]}"
    FAKEBIN = os.path.join(tmp, "bin"); os.makedirs(FAKEBIN)
    # the fake CLI: download gives the service's own files (as live: overrides until it is deployed); deploy is logged
    open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, json
a = sys.argv[1:]; open({CLI_LOG!r}, 'a').write(' '.join(a) + '\\n')
st = json.load(open({STATE!r}))
if a[:2] == ['functions', 'deploy']: sys.exit(0)
if a[:2] == ['functions', 'download']:
    fn = a[2]; done = any(l.startswith('functions deploy ' + fn + ' ') for l in open({CLI_LOG!r}).read().splitlines())
    files = {{k: open(os.path.join(st['root'], k), 'rb').read() for k in st['need'][fn]}}
    if not done:
        for k, v in st['override'].get(fn, {{}}).items():
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
                   SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(FNSHAS), SB_SQL_SHAS=json.dumps(SQLSHAS), PYTHONPATH=W, SB_STEP="701")
        env.update(env_over or {})
        p = subprocess.run(["python3", os.path.join(W, "golive_staff_701.py")], env=env, capture_output=True, text=True, timeout=600, cwd=tmp)
        return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
    changed_db = lambda: any("STEP 1 LINK TIGHTEN" in q or "700 · SEVEN-YEAR RETENTION" in q for q in S["sql"])
    cli = lambda: open(CLI_LOG).read()
    writes_switch = lambda: any(re.search(r"update public\.app_data|jsonb_set|insert into public\.app_data", q) and ("ops_settings" in q or "onboarding_switch_date" in q) for q in S["sql"])

    c, out = run()
    if os.environ.get("T701_SHOW"): print(out)
    ck("clean run: exit 0, ends RESULT: DONE", c == 0 and out.strip().splitlines()[-1].startswith("RESULT: DONE"), out)
    il = [i for i, q in enumerate(S["sql"]) if "STEP 1 LINK TIGHTEN" in q]; ir = [i for i, q in enumerate(S["sql"]) if "700 · SEVEN-YEAR RETENTION" in q]
    ck("order: the Step 1 link SQL, then the retention SQL (with its trigger), then the eleven deploys", len(il) == 1 and len(ir) == 1 and il[0] < ir[0] and "create trigger onboarding_documents_keep" in S["sql"][ir[0]] and deployed() == FNS, [il, ir, deployed()])
    ck("the SQL that ran is the reviewed files, byte for byte", S["sql"][il[0]] == open(os.path.join(W, "supabase/step1-link-tighten.sql")).read() and S["sql"][ir[0]] == open(os.path.join(W, "supabase/onboarding-retention-700.sql")).read())
    dl = [l for l in cli().splitlines() if l.startswith("functions deploy")]
    ck("verify_jwt kept: step1-sign (live off) deploys with --no-verify-jwt, the ten others (live on) without", all(("--no-verify-jwt" in l) == (l.split()[2] == "step1-sign") for l in dl) and len(dl) == 11 and "step1-sign is live at version 10 (gateway sign-in check off)" in out and "step1-sign is live as tested (version 11, gateway sign-in check off, as before)" in out, dl)
    pq = [q for q in S["sql"] if "701_PROBE_RESULT" in q]
    ck("the retention probe: one DO block on onboarding-documents/_701_probe/x.pdf that always raises (so it always rolls back), then a check that no probe is left",
       len(pq) == 1 and pq[0].startswith("do $p$") and "'onboarding-documents'" in pq[0] and "'_701_probe/x.pdf'" in pq[0] and pq[0].rstrip().endswith("raise exception '701_PROBE_RESULT: %', m; end $p$")
       and "kept for seven years" in out and "no probe is left in storage" in out, pq)
    ck("the proofs: server only, the view reads, the preview has the form at version 2, review and hire profile refuse a visitor, switch date and switches unchanged",
       all(s in out for s in ["step1_candidate_create is server only", "the retention view reads (3 Step 1 records", "\"Permission for Background Checks and References\" version 2",
                                "Step 1 review refuses a visitor", "hire profile refuses a visitor", "switch date is still not set", "no switch changed"]), out)
    ck("the services are called as a visitor (the public key), never the server key", S["posts"] and all(a == "Bearer eyJanonKEY" for _, a, _ in S["posts"]), S["posts"])
    ck("the cron jobs are reported with their last run", "caregiver-journey-sweep is on, every */10 * * * *; last run 2026-10-13 09:50 (succeeded)" in out and "step2-handoff-pass is on" in out and "caregiver-audit-nightly is on, every 5 11 * * *" in out, out)
    ck("the switches are shown, never written; the switch date is never set", "orient_remind_live on" in out and "offer_send_live off" in out and not writes_switch(), out)
    ck("no key or token is printed; no em dash in the report", "sbp_test" not in out and "eyJanonKEY" not in out and "eyJsvcKEY" not in out and "—" not in out, out)

    if OLDER:
        fn, k, b = OLDER
        c, out = run(override={fn: {k: b}})
        ck(f"a live file from main's own history ({k.split('/')[-1]} in {fn}) is just older: named, deployed, DONE", c == 0 and "RESULT: DONE" in out and f"{fn} is live at version 10" in out and "older versions (from main's own history) of " + "/".join(k.split("/")[-2:]) in out and fn in deployed(), out)
    else: ck("an older-from-main live file case was found to rehearse", False, "no function file differs from origin/main")
    k0 = NEED["match-dark"][0]
    c, out = run(override={"match-dark": {k0: None}})
    ck("a file missing from the live copy counts as older: named, deployed, DONE", c == 0 and "built before it used " + "/".join(k0.split("/")[-2:]) in out and "match-dark" in deployed(), out)
    k1 = "supabase/functions/step1-sign/index.ts"
    c, out = run(override={"step1-sign": {k1: "// someone's unmerged work\n" + open(os.path.join(W, k1)).read()}})
    ck("a live file in NO main history (someone's unmerged work): STOP before any change, names the service and the file; no SQL change, no deploy",
       c == 3 and "step1-sign's live copy holds step1-sign/index.ts in a version that was never on main" in out and "STOPPED before anything changed" in out and not changed_db() and not deployed(), out)
    c, out = run(override={"bg-review": {"supabase/functions/_shared/someones-new-file.ts": "export const x = 1\n"}})
    ck("a live file this build does not use and main never had: STOP before any change", c == 3 and "someones-new-file.ts" in out and not changed_db() and not deployed(), out)
    c, out = run(ops=dict({k: False for k in SWITCHES}, onboarding_switch_date="2026-10-20"))
    ck("the switch date already set: STOP before any change", c == 3 and "the switch date is already set (2026-10-20)" in out and not changed_db() and not deployed(), out)
    c, out = run(jobs={"caregiver-journey-sweep": ("*/10 * * * *", True), "caregiver-audit-nightly": ("5 11 * * *", True)})
    ck("a missing cron job: STOP before any change", c == 3 and "the schedule step2-handoff-pass does not exist" in out and not changed_db() and not deployed(), out)
    c, out = run(jobs={"caregiver-journey-sweep": ("*/10 * * * *", True), "caregiver-audit-nightly": ("5 11 * * *", False), "step2-handoff-pass": ("*/15 * * * *", True)})
    ck("an inactive cron job: STOP before any change", c == 3 and "the schedule caregiver-audit-nightly is turned off" in out and not changed_db() and not deployed(), out)
    c, out = run(trigger="perm")
    rest = [q for q in S["sql"] if "700 · SEVEN-YEAR RETENTION" in q and "create trigger" not in q]
    ck("no permission for the storage trigger: reported clearly, the view still goes in, all eleven still deploy, RESULT not clean",
       c == 9 and "could NOT be added" in out and "must be owner of table objects" in out and "Signed documents are NOT protected yet" in out and len(rest) == 1 and "create or replace view public.onboarding_retention" in rest[0]
       and "drop trigger if exists onboarding_documents_keep on storage.objects;" not in rest[0] and "create trigger" not in rest[0] and deployed() == FNS and not any("701_PROBE_RESULT" in q for q in S["sql"]) and "RESULT: CHECK THE ✗ LINES ABOVE" in out and "RESULT: DONE" not in out, out)
    c, out = run(reset_gateway=True)
    ck("a deploy that turns the gateway back on is put back to off for step1-sign (live off), and only for it", c == 0 and S["patches"] == [("step1-sign", {"verify_jwt": False})] and "step1-sign deployed: version 11, gateway sign-in check off" in out, [S["patches"], out])
    c, out = run(vj=dict({fn: True for fn in FNS}, **{"step1-sign": False, "match-dark": False}))
    dl = [l for l in cli().splitlines() if l.startswith("functions deploy")]
    ck("verify_jwt read per service, never assumed: two services live off both keep off", c == 0 and {l.split()[2] for l in dl if "--no-verify-jwt" in l} == {"step1-sign", "match-dark"}, dl)
    c, out = run(real_started=2)
    ck("real Step 1 records before the switch date: reported, not a stop", c == 0 and "2 real Step 1 record(s) already started" in out and "RESULT: DONE" in out, out)
    c, out = run(env_over={"SB_SQL_SHAS": json.dumps(dict(SQLSHAS, **{"supabase/onboarding-retention-700.sql": "0" * 64}))})
    ck("a SQL file that is not the reviewed build: STOP, no query at all", c == 2 and not S["sql"] and not deployed(), out)
    c, out = run(env_over={"SB_FN_SHAS": json.dumps({k: v for k, v in FNSHAS.items() if k != "_shared/step1-pdf.ts"})})
    ck("a needed file not pinned: STOP, no query at all", c == 2 and "not pinned" in out and not S["sql"], out)
    c, out = run(env_over={"SB_FN_SHAS": json.dumps(dict(FNSHAS, **{"step1-sign/index.ts": "0" * 64}))})
    ck("a service file that is not the reviewed build: STOP, no query at all", c == 2 and not S["sql"], out)
    c, out = run(notlive="reference-tasks")
    ck("a service not live at all: STOP before any change", c == 3 and "reference-tasks is not live at all" in out and not changed_db() and not deployed(), out)
    c, out = run(link="fail")
    ck("the Step 1 link refused: STOP, no retention SQL, no deploy", c == 5 and not any("700 · SEVEN-YEAR RETENTION" in q for q in S["sql"]) and not deployed(), out)
    c, out = run(probe="deleted")
    ck("the guard letting a delete through: reported", c == 9 and "let a signed document be deleted" in out, out)
    c, out = run(preview_v=1)
    ck("the preview showing an older form version: reported", c == 9 and "the Step 1 preview answered 200: that form is 'Permission for Background Checks and References' version 1" in out, out)
    c, out = run(open_review=True)
    ck("the Step 1 review answering a visitor: reported", c == 9 and "the Step 1 review answered a visitor with 200" in out, out)
    c, out = run(switch_flips=True)
    ck("a switch changing during the step: reported", c == 9 and "these switches changed during the step: step1_auto_live" in out, out)
finally:
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", W], capture_output=True)
    shutil.rmtree(tmp, ignore_errors=True)
failed = [r for r in res if not r[1]]
for n, ok, note in res: print(("PASS  " if ok else "FAIL  ") + n + ("" if ok else "\n      " + note))
print(f"\n{len(res) - len(failed)}/{len(res)} passed" + (" · FAIL" if failed else ""))
raise SystemExit(1 if failed else 0)
