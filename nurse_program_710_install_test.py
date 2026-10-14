#!/usr/bin/env python3
# Rehearsal of 710 (nurse_program_710.py, the nurse program in one Desktop step: was 706 + 707 + 708) against a FAKE Supabase
# (the management API for both projects, the services) and a FAKE supabase CLI. The Step 1 and offer previews are answered by
# the REAL step1-sign and offer-sign code of the build under test (imported under node; no database). Never touches a real
# project. Runs the installer from fresh detached worktrees of HEAD (never ../ sibling folders):
#   W  = HEAD exactly as reviewed: the clean run and every case
#   WX = HEAD plus a newer step1-documents.ts (a main that moved on after the review)
#   WN = HEAD with the nursing license form approved for real (this step must refuse: it approves nothing)
#   python3 nurse_program_710_install_test.py        (T710_SHOW=1 prints the clean run's report)
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil, sys, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
FNS = ["rn-review", "hub-access", "nurse-visit-check", "hire-profile", "applicant-link", "step2-handoff", "caregiver-journey", "offer-sign", "step1-sign"]
NEW = ["rn-review", "nurse-visit-check"]; OLD7 = [f for f in FNS if f not in NEW]
NURSE_SQL, LPN_SQL = "supabase/nurse-review.sql", "supabase/lpn-hiring-708.sql"; SQLS = [NURSE_SQL, LPN_SQL]
DOC_REL = "supabase/functions/_shared/step1-documents.ts"
STEP = "nurse_program_710.py"
tmp = tempfile.mkdtemp(prefix="t710-"); W = os.path.join(tmp, "wt"); WX = os.path.join(tmp, "wtx"); WN = os.path.join(tmp, "wtn")
node = None
def git(wt, *a): return subprocess.run(["git", "-C", wt, "-c", "user.name=t710", "-c", "user.email=t710@example.invalid"] + list(a), capture_output=True, text=True, check=True).stdout.strip()
try:
    subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", W, "HEAD"], check=True); MAIN_A = git(W, "rev-parse", "HEAD")
    subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WX, MAIN_A], check=True)
    open(os.path.join(WX, DOC_REL), "a").write("\n// a newer change merged after the review\n"); git(WX, "commit", "-q", "-am", "t710 newer"); MAIN_X = git(WX, "rev-parse", "HEAD")
    subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WN, MAIN_A], check=True)
    d = open(os.path.join(WN, DOC_REL)).read(); d2 = re.sub(r"(export const APPROVED_FOR_REAL[^=]*= \{.*?)\n\}", lambda m: m.group(1) + "\n  nurse_license: 1,\n}", d, count=1, flags=re.S)
    assert d2 != d; open(os.path.join(WN, DOC_REL), "w").write(d2); git(WN, "commit", "-q", "-am", "t710 approved by mistake")
    BASE_C = git(W, "merge-base", "HEAD", "origin/main")

    sys.path.insert(0, W); os.environ.setdefault("SB_REPORT", os.path.join(tmp, "unused.txt"))
    from cc_step_lib import need
    def pins(root):
        fnroot = os.path.join(root, "supabase", "functions"); nd = {fn: sorted(need(fnroot, fn)) for fn in FNS}
        return fnroot, nd, {k[len("supabase/functions/"):]: sha(os.path.join(root, k)) for k in sorted({k for fn in FNS for k in nd[fn]})}, {r: sha(os.path.join(root, r)) for r in SQLS}
    _, NEED_W, FNSHAS_W, SQLSHAS_W = pins(W)
    ck("the nine services need their own files and the shared rules, all pinned; one copy of each shared file (nurse-services.ts once, used by rn-review and nurse-visit-check)",
       "supabase/functions/_shared/nurse-services.ts" in NEED_W["rn-review"] and "supabase/functions/_shared/nurse-services.ts" in NEED_W["nurse-visit-check"] and "supabase/functions/_shared/send-problems.ts" in NEED_W["rn-review"]
       and all(f"supabase/functions/{fn}/index.ts" in NEED_W[fn] for fn in FNS), {k: len(v) for k, v in NEED_W.items()})
    # the REAL previews of the build, served by node
    FNCOPY = os.path.join(tmp, "fncopy"); shutil.copytree(os.path.join(W, "supabase", "functions"), FNCOPY)
    for fn in ("step1-sign", "offer-sign"):
        src = re.sub(r"(?m)^import \{ createClient \} from .*$", "const createClient = () => ({})", open(os.path.join(FNCOPY, fn, "index.ts")).read())
        src = re.sub(r"(?m)^import \{ requireStaff, OFFICE_ROLES \} from .*$", "const OFFICE_ROLES = []; const requireStaff = async () => ({ ok: false, status: 401, error: 'no' })", src)
        open(os.path.join(FNCOPY, fn, "_t710.ts"), "w").write(src)
    open(os.path.join(tmp, "pv.mjs"), "w").write(f"""
import http from 'http'
let h = null; globalThis.Deno = {{ env: {{ get: () => '' }}, serve: (x) => {{ h = x }} }}
const S1 = await import({json.dumps(os.path.join(FNCOPY, "step1-sign", "_t710.ts"))})
await import({json.dumps(os.path.join(FNCOPY, "offer-sign", "_t710.ts"))}); const OS = h
const s = http.createServer((req, res) => {{ let b = ''; req.on('data', (c) => b += c); req.on('end', async () => {{
  const body = JSON.parse(b || '{{}}'); let out
  if (req.url === '/step1-sign') out = await S1.preview(body)
  else {{ const r = await OS(new Request('http://x/offer-sign', {{ method: 'POST', body: JSON.stringify(body) }})); out = await r.json() }}
  res.end(JSON.stringify(out)) }}) }})
s.listen(0, '127.0.0.1', () => console.log(s.address().port))
""")
    node = subprocess.Popen(["node", os.path.join(tmp, "pv.mjs")], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    PV = f"http://127.0.0.1:{node.stdout.readline().strip()}"
    real = lambda fn, body: json.loads(urllib.request.urlopen(urllib.request.Request(PV + "/" + fn, data=json.dumps(body).encode(), method="POST"), timeout=60).read())

    S = {}; M = {}
    KINDS0 = "CHECK ((kind = ANY (ARRAY['client_created'::text, 'caregiver_status'::text, 'caregiver_level'::text])))"
    def base_ops(): return {"nurse_review_live": False, "nurse_hire_live": False, "nurse_visit_check_live": False, "ghe_watch_live": True, "visit_watch_live": False, "step1_auto_live": True, "offer_send_live": True,
                            "approve_work_axiscare_live": False, "axiscare_level_live": False, "approve_work_text_live": False, "other": {"keep": 1}}
    def reset(**m):
        S.clear(); S.update(sql=[], trn_sql=[], posts=[], patches=[], files=[], sched={}, rls=[], ops_reads=0)
        M.clear(); M.update(dict(vj={"rn-review": True, "nurse-visit-check": True, "hub-access": True, "hire-profile": True, "applicant-link": False, "step2-handoff": True, "caregiver-journey": True, "offer-sign": False, "step1-sign": False},
                                 live_new=False, notlive=set(), patched=set(), reset_gateway=False, ops=base_ops(), switch_flips=False, jobs={}, vault=1, mapped=0, tables=True, trn=True,
                                 nurse_sql_fail=False, lpn_sql_fail=False, trigger="ok", probe="refused", tables_open=None, open_fn=False, rls_rn=(0, 0), rls_cc=(31, 6), rls_fail=False,
                                 staff=[{"name": "Natasha Early", "cred": "RN", "email": "natasha@mo-care.com", "supervising_rn": True}, {"name": "Lena Park", "cred": "LPN"}],
                                 versions={"nurse_bill_check": 3}, dry_answer="ok", write_in_dry=False, preview="real", nurse_after=0, lpn_in=0, deploy_fail=None), **m)
    CLI_LOG = os.path.join(tmp, "cli.log"); STATE = os.path.join(tmp, "state.json")
    dlines = lambda: [l for l in (open(CLI_LOG).read().splitlines() if os.path.exists(CLI_LOG) else []) if l.startswith("functions deploy")]
    deployed = lambda: [l.split()[2] for l in dlines()]
    ROOT_UNDER_TEST = W
    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def _send(self, code, obj):
            b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
        def do_GET(self):
            p = self.path
            if "/api-keys" in p: return self._send(200, [{"name": "anon", "api_key": "eyJanonKEY"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
            m = re.match(r"/v1/projects/zngsgedlsxinbygwmxwn/functions/([\w-]+)$", p)
            if m:
                fn = m.group(1); dl = [l for l in dlines() if l.split()[2] == fn]
                if fn in M["patched"]: vj = M["vj"][fn]
                elif dl: vj = (not M["vj"][fn]) if M["reset_gateway"] else ("--no-verify-jwt" not in dl[-1])
                elif fn in M["notlive"] or (fn in NEW and not M["live_new"]): return self._send(404, {})
                else: vj = M["vj"].get(fn, True)
                return self._send(200, {"version": 40 + len(dl), "verify_jwt": vj})
            self._send(404, {})
        def do_PATCH(self):
            n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}")
            fn = self.path.rstrip("/").split("/")[-1]; S["patches"].append((fn, body))
            if "verify_jwt" in body: M["vj"][fn] = body["verify_jwt"]; M["patched"].add(fn)
            self._send(200, {})
        def do_POST(self):
            n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
            if p.startswith("/functions/v1/"):
                fn = p.split("/")[3].split("?")[0]; auth = self.headers.get("Authorization"); S["posts"].append((fn, auth, body, p))
                if fn in ("step1-sign", "offer-sign") and body.get("action") == "preview":
                    live = fn in deployed() and M["preview"] == "real"
                    j = real(fn, body if live else {k: v for k, v in body.items() if k != "position"})   # the old live build ignores ?position
                    if not live and fn == "step1-sign" and body.get("approval_check"): j["approval_check"] = [dict(x, accepted=x.get("form") != "nurse_license" or False) for x in j.get("approval_check", [])]
                    return self._send(200, j)
                if fn == "rn-review": return self._send(200 if M["open_fn"] else 401, {"ok": False, "error": "Sign in first."})
                if fn == "nurse-visit-check":
                    if auth != "Bearer eyJsvcKEY": return self._send(401, {"ok": False, "error": "not allowed"})
                    if M["write_in_dry"]: M["versions"]["nurse_bill_check"] += 1
                    if M["dry_answer"] == "axfail": return self._send(200, {"ok": False, "visits": {"ok": False, "dry": True, "error": "AxisCare is not set up on the server"}, "license": {"dry": True, "due": 0}})
                    return self._send(200, {"ok": True, "visits": {"ok": True, "dry": "?dry=1" in p, "clients": 12, "visits_checked": 0, "ready": 0, "not_ready": 0, "services_from": "built-in"}, "license": {"dry": "?dry=1" in p, "due": 1}})
                return self._send(404, {})
            q = body["query"]
            if "/projects/rdqujxiycycwhskyvrwa/" in p:
                S["trn_sql"].append(q)
                if "trg_job_offers_position_permanent" in q: return self._send(200, [{"col": M["trn"], "trg": M["trn"]}])
                return self._send(400, {"message": "unexpected Training query " + q[:120]})
            S["sql"].append(q)
            NSRC = open(os.path.join(ROOT_UNDER_TEST, NURSE_SQL)).read(); LSRC = open(os.path.join(ROOT_UNDER_TEST, LPN_SQL)).read()
            if q.startswith("select to_regclass('storage.objects') is not null as objs"):
                return self._send(200, [{"objs": True, "dal": True, "door": True, "ev": True, "bucket": 0, "trig": 0, "tables": 0, "mapped": M["mapped"], "rule": True, "vault": M["vault"],
                                         "sf": True, "si": True, "cat": M["tables"], "log": True, "hepb": True, "nf": M["lpn_in"] > 0}])
            if q.startswith("select jobname, schedule, active from cron.job where jobname in"):
                return self._send(200, [{"jobname": j, "schedule": s_, "active": a} for j, (s_, a) in M["jobs"].items()])
            if q == "select data, version from public.app_data where key = 'ops_settings'":
                S["ops_reads"] += 1; dd = json.loads(json.dumps(M["ops"]))
                if M["switch_flips"] and S["ops_reads"] > 1: dd["nurse_hire_live"] = True
                return self._send(200, [{"data": dd, "version": 7}])
            if q == "select data from public.app_data where key = 'nurse_staff'": return self._send(200, [{"data": M["staff"]}])
            if "jsonb_array_length" in q: return self._send(200, [{"key": "nurse_clients", "n": 14}, {"key": "medicaid_plans", "n": 20}, {"key": "nurse_staff", "n": 2}])
            if "jsonb_array_elements" in q and "ghe_watch" in q: return self._send(200, [{"month": "2026-09", "stage": "missed", "n": 2}, {"month": "2026-10", "stage": "not_booked", "n": 3}])
            if "open_real" in q: return self._send(200, [{"n": 9, "open_real": 2}])
            if q.startswith("select count(*) filter (where active)::int as active from public.client_journey_step_def"): return self._send(200, [{"active": 38}])
            if q.startswith("select key, version from public.app_data where key in"): return self._send(200, [{"key": k, "version": v} for k, v in M["versions"].items()])
            if q.startswith(NSRC[:300]):
                S["files"].append("nurse-full" if q == NSRC else "nurse-rest")
                if M["nurse_sql_fail"]: return self._send(400, {"message": "ERROR: 42P01: relation does not exist"})
                if M["trigger"] == "perm" and "create trigger nurse_documents_keep" in q: return self._send(400, {"message": "ERROR: 42501: must be owner of table objects"})
                return self._send(201, [])
            if q == LSRC:
                S["files"].append("lpn")
                if M["lpn_sql_fail"]: return self._send(400, {"message": "ERROR: 708 refused: the change log kind list was not found"})
                M["lpn_in"] += 1; return self._send(200, [])
            mm = re.match(r"select cron\.unschedule\('([\w-]+)'\)", q)
            if mm: M["jobs"].pop(mm.group(1), None); return self._send(200, [])
            mm = re.match(r"select cron\.schedule\('([\w-]+)', '([^']+)', '(.*)'\) as id$", q, re.S)
            if mm: M["jobs"][mm.group(1)] = (mm.group(2), True); S["sched"][mm.group(1)] = mm.group(3).replace("''", "'"); return self._send(200, [{"id": 9}])
            if "from unnest(array[" in q:
                ts = re.findall(r"'(\w+)'", q[q.find("unnest(array["):])
                return self._send(200, [{"t": t, "here": True, "browser": t == M["tables_open"]} for t in ts])
            if q == "select public from storage.buckets where id = 'nurse-docs'": return self._send(200, [{"public": False}])
            mm = re.search(r"raise exception '(710_RLS_RN|710_RLS_CC): % %'", q)
            if mm:
                S["rls"].append(q)
                if M["rls_fail"]: return self._send(400, {"message": "ERROR: 42501: permission denied to set role"})
                v = M["rls_rn"] if mm.group(1) == "710_RLS_RN" else M["rls_cc"]
                return self._send(400, {"message": f"ERROR: P0001: {mm.group(1)}: {v[0]} {v[1]}"})
            if "710_PROBE_RESULT" in q:
                msg = {"refused": "Signed nursing documents are kept for seven years and cannot be deleted (_710_probe/x.pdf).", "deleted": "deleted"}[M["probe"]]
                return self._send(400, {"message": f"ERROR: P0001: 710_PROBE_RESULT: {msg}"})
            if "starts_with(name, '_710_probe/')" in q: return self._send(200, [{"n": 0}])
            if "step1_forms_nurse_form_keep_t" in q:
                ok = M["lpn_in"] > 0
                return self._send(200, [{"nf": ok, "trg": ok, "idc": 2 if ok else 0, "leak": False, "kinds": KINDS0.replace("'caregiver_level'::text", "'caregiver_level'::text, 'caregiver_class'::text") if ok else KINDS0,
                                         "rows4": 4 if ok else 0, "active": 42 if ok else 38, "n": 9, "nurse": M["nurse_after"]}])
            return self._send(400, {"message": "unexpected query " + q[:160]})
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
    URL = f"http://127.0.0.1:{srv.server_address[1]}"
    FAKEBIN = os.path.join(tmp, "bin"); os.makedirs(FAKEBIN)
    open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, json
a = sys.argv[1:]; open({CLI_LOG!r}, 'a').write(' '.join(a) + '\\n')
st = json.load(open({STATE!r}))
if a[:2] == ['functions', 'deploy']: sys.exit(1 if st.get('deploy_fail') == a[2] else 0)
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
    def run(root=W, env_over=None, override=None, **mode):
        global ROOT_UNDER_TEST
        ROOT_UNDER_TEST = root; reset(**mode); rep = os.path.join(tmp, "r.txt")
        for f in (CLI_LOG, rep):
            if os.path.exists(f): os.remove(f)
        open(CLI_LOG, "w").close()
        fnroot, nd, fsh, ssh = pins(root)
        json.dump({"root": root, "need": nd, "override": override or {}, "deploy_fail": M["deploy_fail"]}, open(STATE, "w"))
        env = dict(os.environ, PATH=FAKEBIN + ":/usr/bin:/bin", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"),
                   SB_FNROOT=fnroot, SB_FN_SHAS=json.dumps(fsh), SB_SQL_SHAS=json.dumps(ssh), PYTHONPATH=root, SB_STEP="710", SB_MAIN_REF=MAIN_A)
        env.update(env_over or {})
        p = subprocess.run(["python3", os.path.join(root, STEP)], env=env, capture_output=True, text=True, timeout=900, cwd=tmp)
        return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), fsh
    changed = lambda: bool(S["files"]) or bool(deployed()) or any("cron.schedule(" in q for q in S["sql"])
    writes_app_data = lambda: any(re.search(r"(?i)update public\.app_data|insert into public\.app_data|upsert_app_data_item\(", q) for q in S["sql"])

    # ── the clean run ──
    c, out, fsh = run()
    if os.environ.get("T710_SHOW"): print(out)
    ck("clean run: exit 0, RESULT: DONE, then NEXT (merge the Hub and Owners Hub pull requests)", c == 0 and "RESULT: DONE" in out and out.strip().splitlines()[-1].startswith("NEXT: merge the Hub pull request"), out[-3000:])
    ck("the two SQL files ran once each, the reviewed files byte for byte, nurse-review.sql first, both before any deploy", S["files"] == ["nurse-full", "lpn"] and out.index("nurse-review.sql is in") < out.index("lpn-hiring-708.sql is in") < out.index("rn-review deployed"), [S["files"], out[-1500:]])
    ck("the nine services deployed in order, step1-sign last, each keeping its gateway setting (the two new ones on; applicant-link, offer-sign and step1-sign off)",
       deployed() == FNS and [("--no-verify-jwt" in l) for l in dlines()] == [False, False, False, False, True, False, False, True, True]
       and "rn-review is new (not live yet)" in out and "nurse-visit-check is new (not live yet)" in out and "hub-access is live at version 40 (gateway sign-in check on) and is already this build" in out, dlines())
    ck("PART 1: both proposed wordings unapproved; pins; main; 709 checked on the Training project (read only); the database pieces; the three visit check switches off; the RNs named; what the check reads; Step 1s; the catalog",
       all(s in out for s in ["the Your Nursing License form is in this build, proposed and NOT approved for real", "the licensed nurse offer letter is in this build, proposed and NOT approved",
                                "nurse-review.sql is the reviewed build", "lpn-hiring-708.sql is the reviewed build", "main holds no newer version", "709 has run: the Training Platform's offers carry position_key",
                                "the job secret is in the Vault", "no app_data key is mapped to rn_review", "the Step 1 tables, the readiness catalog and the AxisCare change log exist",
                                "the three nurse visit check switches are off", "nurse_review_live off", "nurse_hire_live off", "RNs on the nurse list: Natasha Early (supervising)", "nurse_clients 14",
                                "2026-09 missed 2, 2026-10 not_booked 3", "Step 1 records now: 9 (2 real under way)", "38 caregiver readiness rows are active now",
                                "rn-review-pass is new", "nurse-visit-check-pass is new"]) and all(q.lower().lstrip().startswith("select") for q in S["trn_sql"]), out)
    for job, fn, sched, words in [("rn-review-pass", "rn-review", "7 * * * *", "every hour"), ("nurse-visit-check-pass", "nurse-visit-check", "*/30 * * * *", "every 30 minutes")]:
        ck(f"the schedule {job}: POST {{\"action\": \"pass\"}} to {fn} with the Vault's x-cron-secret and the public key, {words}, proved on",
           job in S["sched"] and f"/functions/v1/{fn}'" in S["sched"][job] and "'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'hub_job_secret')" in S["sched"][job]
           and "body := '{\"action\": \"pass\"}'::jsonb" in S["sched"][job] and "Bearer eyJanonKEY" in S["sched"][job] and M["jobs"][job] == (sched, True) and f"{job} is on, {words}" in out, [S["sched"].get(job), out[-2000:]])
    ck("PART 3 RN review: live as tested, refuses a visitor and a pass without the secret, tables closed, bucket private, the keep-guard tried and rolled back, no probe left",
       all(s in out for s in ["rn-review is live as tested", "rn-review refuses a visitor who is not signed in (401)", "rn-review refuses a pass without the job secret (401)",
                                "a visitor or a signed-in page can reach none of them", "the nurse-docs bucket is private", "kept for seven years", "no probe is left in storage"]), out)
    pq = [q for q in S["sql"] if "710_PROBE_RESULT" in q]
    ck("the probe is one DO block on nurse-docs that always raises (so it always rolls back)", len(pq) == 1 and pq[0].startswith("do $p$") and "'nurse-docs'" in pq[0] and pq[0].rstrip().endswith("raise exception '710_PROBE_RESULT: %', m; end $p$"), pq)
    ck("the RN review only proof: as an rn_review sign-in and as a Care Coordinator Hub sign-in, each in one DO block that always raises (rolled back), the claims and the role set inside",
       len(S["rls"]) == 2 and all(q.startswith("do $p$") and "set local role authenticated" in q and "request.jwt.claims" in q for q in S["rls"]) and '"hub_access": ["rn_review"]' in S["rls"][0] and '"hub_access": ["care_coordinator"]' in S["rls"][1]
       and "an RN review only sign-in reads no app_data key (0 rows" in out and "a Care Coordinator Hub sign-in reads 31 keys" in out, [S["rls"], out])
    vis = [x for x in S["posts"] if x[0] == "nurse-visit-check" and x[1] == "Bearer eyJanonKEY"]; dry = [x for x in S["posts"] if x[1] == "Bearer eyJsvcKEY"]
    ck("PART 3 visit checks: a visitor refused on the pass and the report; the ONE server-key call is a dry pass; its numbers reported; it wrote nothing",
       len(vis) == 2 and {x[2]["action"] for x in vis} == {"pass", "report"} and len(dry) == 1 and dry[0][0] == "nurse-visit-check" and dry[0][3].endswith("?dry=1") and dry[0][2] == {"action": "pass"}
       and "practice run (nothing written): 12 clients read" in out and "license reminders due now: 1" in out and "the practice run wrote nothing" in out, [S["posts"], out[-2000:]])
    ck("PART 3 LPN hiring (the REAL previews): a caregiver's Step 1 and offer unchanged; an LPN's Step 1 with the license form (unapproved) and the letter alone (unapproved); the nurse tables and rows",
       all(s in out for s in ["a caregiver's Step 1 is unchanged: the preview has 14 forms, 13 to sign", "an LPN's Step 1 (preview): 15 forms, 14 to sign, Your Nursing License last (screen 17), proposed, NOT approved for real",
                                "a real applicant may still sign every caregiver Step 1 form; the nursing license form is refused for real", "a caregiver offer is unchanged: the letter and the position description, versions 2 and 2",
                                "an LPN offer (preview): the licensed nurse letter alone", "the four nurse readiness rows are active and apply only to licensed nurses", "the caregiver rows are as they were: 42 active now = 38 + the 4 nurse rows",
                                "no Step 1 record changed: 9 on file, 0 with the nursing license form", "step1_forms.nurse_form and its keep trigger are in"] + [f"{fn} is live as tested" for fn in FNS]), out)
    ck("no switch, no app_data written; the only database changes are the two SQL files and the two schedules; no switch changed",
       not writes_app_data() and "no switch changed (nurse_review_live off, nurse_visit_check_live off, nurse_bill_hold_live off, nurse_license_reminders_live off, nurse_hire_live off)" in out
       and [q[:40] for q in S["sql"] if re.match(r"(?is)\s*(--|begin|alter|update|insert|delete|create|select cron\.)", q)] == [q[:40] for q in S["sql"] if q.startswith("select cron.")]
       and sum(1 for q in S["sql"] if q in (open(os.path.join(W, NURSE_SQL)).read(), open(os.path.join(W, LPN_SQL)).read())) == 2, out)
    ck("the services are called only as a visitor (the public key), except the one practice run with the server key; only the read-only previews of step1-sign and offer-sign",
       all(a == "Bearer eyJanonKEY" for f, a, b, p in S["posts"] if not (f == "nurse-visit-check" and p.endswith("?dry=1"))) and all(b.get("action") == "preview" for f, a, b, p in S["posts"] if f in ("step1-sign", "offer-sign")), S["posts"])
    ck("no key or token printed; no em dash in the report or the step's own files; never 'plain language'", "sbp_test" not in out and "eyJanonKEY" not in out and "eyJsvcKEY" not in out and "—" not in out and "plain language" not in out.lower()
       and all("—" not in open(os.path.join(W, f)).read() for f in [STEP, NURSE_SQL, LPN_SQL]), out)

    # ── stops before anything changes ──
    c, out, _ = run(trn=False)
    ck("709 not run (no position_key on the Training offers): STOP before any change, says run 709 first", c == 3 and "run 709 (LPN hiring, the Training half) first" in out and not changed(), out)
    c, out, _ = run(root=WN, env_over={"SB_MAIN_REF": "HEAD"})
    ck("a build that approves the nursing license form: STOP, no query (this step approves nothing)", c == 2 and "not in this build as a proposed, unapproved form" in out and not S["sql"], out)
    c, out, _ = run(env_over={"SB_MAIN_REF": MAIN_X})
    ck("main changed a file these services use after the review: STOP, nothing runs", c == 2 and "main has newer versions of _shared/step1-documents.ts" in out and not changed(), out)
    c, out, _ = run(ops=dict(base_ops(), nurse_bill_hold_live=True))
    ck("a visit check switch already on: STOP before any change", c == 3 and "already on: nurse_bill_hold_live" in out and not changed(), out)
    c, out, _ = run(vault=0)
    ck("no job secret in the Vault: STOP before any change", c == 3 and "does not hold hub_job_secret" in out and not changed(), out)
    c, out, _ = run(mapped=1)
    ck("an app_data key mapped to rn_review: STOP before any change", c == 3 and "mapped to rn_review" in out and not changed(), out)
    c, out, _ = run(tables=False)
    ck("a Step 1 table or the catalog missing: STOP before any change", c == 3 and "a table this step needs is missing" in out and not changed(), out)
    c, out, _ = run(notlive={"hub-access"})
    ck("hub-access not live at all: STOP before any change", c == 3 and "hub-access is not live at all" in out and not changed(), out)
    c, out, _ = run(notlive={"step2-handoff"})
    ck("step2-handoff not live at all: STOP before any change", c == 3 and "step2-handoff is not live at all" in out and not changed(), out)
    k1 = "supabase/functions/rn-review/index.ts"
    c, out, _ = run(live_new=True, override={"rn-review": {k1: "// someone's hand deploy\n" + open(os.path.join(W, k1)).read()}})
    ck("rn-review live with a file never on main (someone's unmerged work): STOP before any change", c == 3 and "rn-review's live copy holds rn-review/index.ts in a version that was never on main" in out and not changed(), out)
    k2 = "supabase/functions/step1-sign/index.ts"
    c, out, _ = run(override={"step1-sign": {k2: "// someone's unmerged work\n" + open(os.path.join(W, k2)).read()}})
    ck("step1-sign live with a file never on main: STOP before any change", c == 3 and "in a version that was never on main" in out and not changed(), out)
    c, out, _ = run(override={"hub-access": {"supabase/functions/_shared/someones-file.ts": "export const x = 1\n"}})
    ck("a live file this build does not use and main never had: STOP before any change", c == 3 and "someones-file.ts" in out and not changed(), out)
    c, out, _ = run(env_over={"SB_FN_SHAS": json.dumps({k: v for k, v in fsh.items() if k != "_shared/nurse-services.ts"})})
    ck("a needed file not pinned (the one nurse service list): STOP, no query", c == 2 and "not pinned" in out and not S["sql"], out)
    c, out, _ = run(env_over={"SB_FN_SHAS": json.dumps(dict(fsh, **{"nurse-visit-check/index.ts": "0" * 64}))})
    ck("a service file that is not the reviewed build: STOP, no query", c == 2 and "nurse-visit-check/index.ts is not the reviewed build" in out and not S["sql"], out)
    for rel in SQLS:
        c, out, _ = run(env_over={"SB_SQL_SHAS": json.dumps(dict(SQLSHAS_W, **{rel: "0" * 64}))})
        ck(f"{rel.split('/')[-1]} not the reviewed build: STOP, no query", c == 2 and f"{rel.split('/')[-1]} is not the reviewed build" in out and not S["sql"], out)

    # ── live states ──
    old = {}
    for fn in OLD7:
        old[fn] = {}
        for k in NEED_W[fn]:
            b = subprocess.run(["git", "-C", W, "show", BASE_C + ":" + k], capture_output=True).stdout
            old[fn][k] = b.decode() if b else None
    c, out, _ = run(override=old)
    ck("the seven live services on main's build (before this PR): named older or built before, deployed, DONE", c == 0 and "older versions (from this build's own history)" in out and "built before it used" in out and deployed() == FNS, out[-3000:])
    c, out, _ = run(live_new=True, vj=dict(**{"rn-review": False, "nurse-visit-check": False, "hub-access": True, "hire-profile": True, "applicant-link": False, "step2-handoff": True, "caregiver-journey": True, "offer-sign": False, "step1-sign": False}))
    ck("rn-review and nurse-visit-check already live as this build with the gateway check off: said so, kept off", c == 0 and "rn-review is live at version 40 (gateway sign-in check off) and is already this build" in out
       and all("--no-verify-jwt" in l for l in dlines() if l.split()[2] in NEW), dlines())
    c, out, _ = run(reset_gateway=True)
    ck("a deploy that comes back with the wrong gateway setting is put back, for every service", c == 0 and sorted(f for f, _ in S["patches"]) == sorted(FNS)
       and all(b == {"verify_jwt": (f not in ("applicant-link", "offer-sign", "step1-sign"))} for f, b in S["patches"]), S["patches"])
    c, out, _ = run(jobs={"rn-review-pass": ("0 * * * *", True), "nurse-visit-check-pass": ("*/5 * * * *", False)})
    ck("existing schedules are replaced (unscheduled, then set again)", c == 0 and "rn-review-pass exists (it is replaced)" in out and M["jobs"] == {"rn-review-pass": ("7 * * * *", True), "nurse-visit-check-pass": ("*/30 * * * *", True)}
       and sum(1 for q in S["sql"] if q.startswith("select cron.unschedule(")) == 2, out)
    c, out, _ = run(staff=[{"name": "Natasha Early", "cred": "RN"}])
    ck("no supervising RN and no email on the nurse list: said, not a stop", c == 0 and "no supervising RN is marked" in out and "no email: cannot sign in" in out, out)
    c, out, _ = run(nurse_after=1)
    ck("an LPN starting Step 1 during the step is said, not an error", c == 0 and "1 Step 1 records already have the nursing license form" in out, out)

    # ── changes that go wrong ──
    c, out, _ = run(nurse_sql_fail=True)
    ck("nurse-review.sql refused: STOP, lpn-hiring-708.sql not run, nothing deployed, no schedule", c == 5 and "nurse-review.sql did not install" in out and S["files"] == ["nurse-full"] and not deployed() and not S["sched"], out)
    c, out, _ = run(lpn_sql_fail=True)
    ck("lpn-hiring-708.sql refused: STOP, nothing deployed, no schedule (nurse-review.sql is in and says so)", c == 5 and "lpn-hiring-708.sql did not install" in out and "nurse-review.sql is in (it changes nothing on its own)" in out and not deployed() and not S["sched"], out)
    c, out, _ = run(trigger="perm")
    rq = [q for q in S["sql"] if q.startswith(open(os.path.join(W, NURSE_SQL)).read()[:300]) and q != open(os.path.join(W, NURSE_SQL)).read()]
    ck("no permission for the storage trigger: reported, nurse-review.sql rerun without the trigger only, the rest carries on, RESULT not clean, the probe not tried",
       c == 9 and "NOT protected yet" in out and S["files"] == ["nurse-full", "nurse-rest", "lpn"] and len(rq) == 1 and "create trigger nurse_documents_keep" not in rq[0] and "function public.nurse_documents_keep()" in rq[0]
       and "create trigger ghe_forms_a_rn_keep_t" in rq[0] and deployed() == FNS and not any("710_PROBE_RESULT" in q for q in S["sql"]) and "the keep-guard was not tried" in out, out[-2500:])
    c, out, _ = run(deploy_fail="caregiver-journey")
    ck("a deploy that fails part way: STOP at that service, the later ones not deployed, no schedule", c == 6 and "STOPPED at caregiver-journey" in out and deployed() == FNS[:FNS.index("caregiver-journey") + 1] and not S["sched"], [deployed(), out[-800:]])
    c, out, _ = run(probe="deleted")
    ck("the keep-guard letting a delete through: reported", c == 9 and "let a signed nursing PDF be deleted" in out, out)
    c, out, _ = run(rls_rn=(2, 1))
    ck("an RN review only sign-in that can read app_data: reported loudly", c == 9 and "can read 2 app_data key(s)" in out and "Do not give anyone RN review only" in out, out)
    c, out, _ = run(rls_cc=(0, 0))
    ck("the comparison sign-in reading nothing: the check proves nothing and says so", c == 9 and "proves nothing" in out, out)
    c, out, _ = run(rls_fail=True)
    ck("the sign-in check unable to run: reported", c == 9 and "could not run as planned" in out, out)
    c, out, _ = run(open_fn=True)
    ck("rn-review answering a visitor: reported", c == 9 and "rn-review answered a visitor with 200" in out, out)
    c, out, _ = run(tables_open="nurse_flag")
    ck("an RN review table a browser can reach: reported", c == 9 and "can reach: nurse_flag" in out, out)
    c, out, _ = run(write_in_dry=True)
    ck("the practice run changed a record: reported", c == 9 and "the nurse check records changed during the practice run" in out, out)
    c, out, _ = run(dry_answer="axfail")
    ck("the practice run cannot reach AxisCare: reported", c == 9 and "could not read AxisCare: AxisCare is not set up on the server" in out, out)
    c, out, _ = run(preview="stale")
    ck("the previews not showing the new build after the deploy: reported", c == 9 and "the LPN Step 1 preview answered" in out and "the LPN offer preview answered" in out, out)
    c, out, _ = run(switch_flips=True)
    ck("a switch changing during the step: reported", c == 9 and "these switches changed during the step: nurse_hire_live" in out, out)

    # ── the Desktop file pins exactly this build ──
    cmdp = os.path.join(HERE, "..", "launch", "desktop", "710 Nurse program, the Hub project.command")
    cmdp = os.environ.get("T710_COMMAND", cmdp)
    if os.path.exists(cmdp):
        cmd = open(cmdp).read()
        pf = json.loads(re.search(r"FN_SHAS='(\{.*?\})'", cmd).group(1)); ps = json.loads(re.search(r"SQL_SHAS='(\{.*?\})'", cmd).group(1))
        ck("the Desktop file pins exactly these files and both SQL files at this build, and runs nurse_program_710.py", pf == FNSHAS_W and ps == SQLSHAS_W and "nurse_program_710.py" in cmd,
           sorted(set(pf.items()) ^ set(FNSHAS_W.items())) + sorted(set(ps.items()) ^ set(SQLSHAS_W.items())))
    else: print("SKIP  the Desktop file is not next to this folder (set T710_COMMAND), so its pins were not compared")
finally:
    if node: node.kill()
    for w in (W, WX, WN): subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", w], capture_output=True)
    shutil.rmtree(tmp, ignore_errors=True)
failed = [r for r in res if not r[1]]
for n, ok, note in res: print(("PASS  " if ok else "FAIL  ") + n + ("" if ok else "\n      " + note))
print(f"\n{len(res) - len(failed)}/{len(res)} passed" + (" · FAIL" if failed else ""))
raise SystemExit(1 if failed else 0)
