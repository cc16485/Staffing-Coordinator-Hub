#!/usr/bin/env python3
# Rehearsal of 708 (golive_hub_708.py) against a FAKE Supabase (the management API for both projects, the services) and a FAKE
# supabase CLI. The Step 1 and offer previews are answered by the REAL step1-sign and offer-sign code of the build under test
# (imported under node; no database). Never touches a real project. Runs the installer from fresh detached worktrees of HEAD
# (never ../ sibling folders):
#   W  = HEAD exactly as reviewed: the clean run and every case
#   WX = HEAD plus a newer step1-documents.ts (a main that moved on after the review)
#   WN = HEAD with the nursing license form approved for real (this step must refuse: it approves nothing)
#   python3 golive_hub_708_install_test.py        (T708_SHOW=1 prints the clean run's report)
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil, sys, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
FNS = ["hire-profile", "applicant-link", "step2-handoff", "caregiver-journey", "offer-sign", "step1-sign"]; SQL_REL = "supabase/lpn-hiring-708.sql"
DOC_REL = "supabase/functions/_shared/step1-documents.ts"
tmp = tempfile.mkdtemp(prefix="t708-"); W = os.path.join(tmp, "wt"); WX = os.path.join(tmp, "wtx"); WN = os.path.join(tmp, "wtn")
node = None
def git(wt, *a): return subprocess.run(["git", "-C", wt, "-c", "user.name=t708", "-c", "user.email=t708@example.invalid"] + list(a), capture_output=True, text=True, check=True).stdout.strip()
try:
    subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", W, "HEAD"], check=True); MAIN_A = git(W, "rev-parse", "HEAD")
    subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WX, MAIN_A], check=True)
    NEWER_DOC = open(os.path.join(WX, DOC_REL)).read() + "\n// a newer change merged after the review\n"
    open(os.path.join(WX, DOC_REL), "w").write(NEWER_DOC); git(WX, "commit", "-q", "-am", "t708 newer"); MAIN_X = git(WX, "rev-parse", "HEAD")
    subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WN, MAIN_A], check=True)
    d = open(os.path.join(WN, DOC_REL)).read(); d2 = d.replace("  hepb_vaccination: 1,\n}", "  hepb_vaccination: 1,\n  nurse_license: 1,\n}")
    assert d2 != d; open(os.path.join(WN, DOC_REL), "w").write(d2); git(WN, "commit", "-q", "-am", "t708 approved by mistake")
    BASE_C = git(W, "merge-base", "HEAD", "origin/main")

    sys.path.insert(0, W); os.environ.setdefault("SB_REPORT", os.path.join(tmp, "unused.txt"))
    from cc_step_lib import need
    def pins(root):
        fnroot = os.path.join(root, "supabase", "functions"); nd = {fn: sorted(need(fnroot, fn)) for fn in FNS}
        return fnroot, nd, {k[len("supabase/functions/"):]: sha(os.path.join(root, k)) for k in sorted({k for fn in FNS for k in nd[fn]})}, {SQL_REL: sha(os.path.join(root, SQL_REL))}
    # the REAL previews of the build, served by node
    FNCOPY = os.path.join(tmp, "fncopy"); shutil.copytree(os.path.join(W, "supabase", "functions"), FNCOPY)
    for fn in ("step1-sign", "offer-sign"):
        src = re.sub(r"(?m)^import \{ createClient \} from .*$", "const createClient = () => ({})", open(os.path.join(FNCOPY, fn, "index.ts")).read())
        src = re.sub(r"(?m)^import \{ requireStaff, OFFICE_ROLES \} from .*$", "const OFFICE_ROLES = []; const requireStaff = async () => ({ ok: false, status: 401, error: 'no' })", src)
        open(os.path.join(FNCOPY, fn, "_t708.ts"), "w").write(src)
    open(os.path.join(tmp, "pv.mjs"), "w").write(f"""
import http from 'http'
let h = null; globalThis.Deno = {{ env: {{ get: () => '' }}, serve: (x) => {{ h = x }} }}
const S1 = await import({json.dumps(os.path.join(FNCOPY, "step1-sign", "_t708.ts"))})
await import({json.dumps(os.path.join(FNCOPY, "offer-sign", "_t708.ts"))}); const OS = h
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
    def base_ops(): return {"nurse_hire_live": False, "step1_auto_live": True, "offer_send_live": True, "approve_work_axiscare_live": False, "axiscare_level_live": False, "approve_work_text_live": False, "other": [1]}
    def reset(**m):
        S.clear(); S.update(sql=[], trn_sql=[], posts=[], patches=[], sqlfile=0, ops_reads=0)
        M.clear(); M.update(dict(vj={"hire-profile": True, "applicant-link": False, "step2-handoff": True, "caregiver-journey": True, "offer-sign": False, "step1-sign": False}, ops=base_ops(), notlive=set(), reset_gateway=False,
                                 preview="real", switch_flips=False, patched=set(), sql_fail=False, tables=True, trn=True, nurse_after=0), **m)
    CLI_LOG = os.path.join(tmp, "cli.log"); STATE = os.path.join(tmp, "state.json")
    dlines = lambda: [l for l in (open(CLI_LOG).read().splitlines() if os.path.exists(CLI_LOG) else []) if l.startswith("functions deploy")]
    deployed = lambda: [l.split()[2] for l in dlines()]
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
                elif dl: vj = True if M["reset_gateway"] else ("--no-verify-jwt" not in dl[-1])
                elif fn in M["notlive"]: return self._send(404, {})
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
                fn = p.split("/")[3]; S["posts"].append((fn, self.headers.get("Authorization"), body))
                if fn in ("step1-sign", "offer-sign") and body.get("action") == "preview":
                    live = fn in deployed() and M["preview"] == "real"
                    j = real(fn, body if live else {k: v for k, v in body.items() if k != "position"})   # the old live build ignores ?position
                    if not live and fn == "step1-sign" and body.get("approval_check"): j["approval_check"] = [dict(x, accepted=x.get("form") != "nurse_license" or False) for x in j.get("approval_check", [])]
                    return self._send(200, j)
                return self._send(404, {})
            q = body["query"]
            if "/projects/rdqujxiycycwhskyvrwa/" in p:
                S["trn_sql"].append(q)
                if "trg_job_offers_position_permanent" in q: return self._send(200, [{"col": M["trn"], "trg": M["trn"]}])
                return self._send(400, {"message": "unexpected Training query " + q[:120]})
            S["sql"].append(q)
            if q == "select data, version from public.app_data where key = 'ops_settings'":
                S["ops_reads"] += 1; dd = json.loads(json.dumps(M["ops"]))
                if M["switch_flips"] and S["ops_reads"] > 1: dd["nurse_hire_live"] = True
                return self._send(200, [{"data": dd, "version": 7}])
            if q.startswith("select to_regclass('public.step1_forms') is not null as sf"): return self._send(200, [{"sf": True, "si": True, "cat": M["tables"], "log": True, "hepb": True, "nf": S["sqlfile"] > 0}])
            if "open_real" in q: return self._send(200, [{"n": 9, "open_real": 2}])
            if q.startswith("select count(*) filter (where active)::int as active from public.client_journey_step_def"): return self._send(200, [{"active": 38}])
            if q == open(os.path.join(ROOT_UNDER_TEST, SQL_REL)).read():
                if M["sql_fail"]: return self._send(400, {"message": "ERROR: 708 refused: the change log kind list was not found"})
                S["sqlfile"] += 1; return self._send(200, [])
            if "step1_forms_nurse_form_keep_t" in q:
                ok = S["sqlfile"] > 0
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
    ROOT_UNDER_TEST = W
    def run(root=W, env_over=None, override=None, **mode):
        global ROOT_UNDER_TEST
        ROOT_UNDER_TEST = root; reset(**mode); rep = os.path.join(tmp, "r.txt")
        for f in (CLI_LOG, rep):
            if os.path.exists(f): os.remove(f)
        open(CLI_LOG, "w").close()
        fnroot, nd, fsh, ssh = pins(root)
        json.dump({"root": root, "need": nd, "override": override or {}}, open(STATE, "w"))
        env = dict(os.environ, PATH=FAKEBIN + ":/usr/bin:/bin", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"),
                   SB_FNROOT=fnroot, SB_FN_SHAS=json.dumps(fsh), SB_SQL_SHAS=json.dumps(ssh), PYTHONPATH=root, SB_STEP="708", SB_MAIN_REF=MAIN_A)
        env.update(env_over or {})
        p = subprocess.run(["python3", os.path.join(root, "golive_hub_708.py")], env=env, capture_output=True, text=True, timeout=900, cwd=tmp)
        return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), fsh
    nothing_changed = lambda: S["sqlfile"] == 0 and not deployed()

    # ── the clean run ──
    c, out, fsh = run()
    if os.environ.get("T708_SHOW"): print(out)
    ck("clean run: exit 0, RESULT: DONE", c == 0 and "RESULT: DONE" in out, out)
    ck("the SQL first, then the six services in order, step1-sign last, each keeping its gateway setting", S["sqlfile"] == 1 and deployed() == FNS
       and [("--no-verify-jwt" in l) for l in dlines()] == [False, True, False, False, True, True] and out.index("lpn-hiring-708.sql is in") < out.index("hire-profile deployed"), [dlines(), out[-2000:]])
    ck("PART 1: both proposed wordings are unapproved in the build; the pins; main; live state; 709 checked on the Training project; the tables; Step 1s stay as they are; switches shown",
       all(s in out for s in ["the Your Nursing License form is in this build, proposed and NOT approved for real", "the licensed nurse offer letter is in this build, proposed and NOT approved",
                                "lpn-hiring-708.sql is the reviewed build", "main holds no newer version", "step1-sign is live at version 40 (gateway sign-in check off) and is already this build",
                                "709 has run: the Training Platform's offers carry position_key", "Step 1 records now: 9 (2 real under way)", "38 caregiver readiness rows are active now", "nurse_hire_live off"]), out)
    ck("PART 3 (the REAL previews): a caregiver's Step 1 and offer unchanged; an LPN's Step 1 with the license form (unapproved) and the letter alone (unapproved); the approval check; no switch changed",
       all(s in out for s in ["a caregiver's Step 1 is unchanged: the preview has 14 forms, 13 to sign", "an LPN's Step 1 (preview): 15 forms, 14 to sign, Your Nursing License last (screen 17), proposed, NOT approved for real",
                                "a real applicant may still sign every caregiver Step 1 form; the nursing license form is refused for real", "a caregiver offer is unchanged: the letter and the position description, versions 2 and 2",
                                "an LPN offer (preview): the licensed nurse letter alone", "the four nurse readiness rows are active and apply only to licensed nurses", "the caregiver rows are as they were: 42 active now = 38 + the 4 nurse rows",
                                "no Step 1 record changed: 9 on file, 0 with the nursing license form", "no switch changed (nurse_hire_live is off)", "nothing was sent"] + [f"{fn} is live as tested" for fn in FNS]), out)
    writes = [q for q in S["sql"] if re.match(r"(?is)\s*(--|begin|alter|update|insert|delete|create|do )", q)]
    ck("the only database change is lpn-hiring-708.sql; the Training project is only read", writes == [open(os.path.join(W, SQL_REL)).read()] and all(q.lower().lstrip().startswith("select") for q in S["trn_sql"]), [w[:80] for w in writes])
    ck("only the read-only previews are called, as a visitor", S["posts"] and all(f in ("step1-sign", "offer-sign") and b.get("action") == "preview" and a == "Bearer eyJanonKEY" for f, a, b in S["posts"]), S["posts"])
    ck("no key or token printed; no em dash in the report or the step's files; never 'plain language'", "sbp_test" not in out and "eyJanonKEY" not in out and "—" not in out and "plain language" not in out.lower()
       and all("—" not in open(os.path.join(W, f)).read() for f in ["golive_hub_708.py", SQL_REL, "supabase/lpn-hiring-708-rollback.sql"]), out)
    # ── stops before anything changes ──
    c, out, _ = run(trn=False)
    ck("709 not run (no position_key on the Training offers): STOP before any change, says run 709 first", c == 3 and "run 709 (LPN hiring, the Training half) first" in out and nothing_changed(), out)
    c, out, _ = run(root=WN, env_over={"SB_MAIN_REF": "HEAD"})
    ck("a build that approves the nursing license form: STOP, no query (this step approves nothing)", c == 2 and "not in this build as a proposed, unapproved form" in out and not S["sql"], out)
    c, out, _ = run(override={"step1-sign": {"supabase/functions/step1-sign/index.ts": "// someone's unmerged work\n" + open(os.path.join(W, "supabase/functions/step1-sign/index.ts")).read()}})
    ck("a live file never on main: STOP before any change", c == 3 and "in a version that was never on main" in out and nothing_changed(), out)
    c, out, _ = run(env_over={"SB_MAIN_REF": MAIN_X})
    ck("main changed a file these services use after the review: STOP, nothing runs", c == 2 and "main has newer versions of _shared/step1-documents.ts" in out and nothing_changed(), out)
    c, out, _ = run(notlive={"step2-handoff"})
    ck("a service not live at all: STOP", c == 3 and "step2-handoff is not live at all" in out and nothing_changed(), out)
    c, out, _ = run(tables=False)
    ck("a table missing: STOP", c == 3 and "a table this step needs is missing" in out and nothing_changed(), out)
    c, out, _ = run(env_over={"SB_FN_SHAS": json.dumps({k: v for k, v in fsh.items() if k != "_shared/positions.ts"})})
    ck("a needed file not pinned: STOP, no query", c == 2 and "not pinned" in out and not S["sql"], out)
    c, out, _ = run(env_over={"SB_SQL_SHAS": json.dumps({SQL_REL: "0" * 64})})
    ck("the SQL not the reviewed build: STOP, no query", c == 2 and "lpn-hiring-708.sql is not the reviewed build" in out and not S["sql"], out)
    # ── older live files are brought up to date (main before this PR) ──
    old = {}
    for fn in FNS:
        old[fn] = {}
        for k in pins(W)[1][fn]:
            b = subprocess.run(["git", "-C", W, "show", BASE_C + ":" + k], capture_output=True).stdout
            old[fn][k] = b.decode() if b else None
    c, out, _ = run(override=old)
    ck("every service live on main's build (before this PR): named older or built before, deployed, DONE", c == 0 and "older versions (from this build's own history)" in out and "built before it used _shared/positions.ts" in out and deployed() == FNS, out)
    # ── changes that go wrong ──
    c, out, _ = run(sql_fail=True)
    ck("the SQL refused: STOPPED, no service deployed", c == 5 and "lpn-hiring-708.sql did not install" in out and not deployed(), out)
    c, out, _ = run(reset_gateway=True)
    ck("a deploy that turns the gateway on is put back to off for the three that were off (applicant-link, offer-sign, step1-sign)", c == 0 and sorted(f for f, _ in S["patches"]) == ["applicant-link", "offer-sign", "step1-sign"] and all(b == {"verify_jwt": False} for _, b in S["patches"]), S["patches"])
    c, out, _ = run(preview="stale")
    ck("the previews not showing the new build after the deploy: reported", c == 9 and "the LPN Step 1 preview answered" in out and "the LPN offer preview answered" in out, out)
    c, out, _ = run(switch_flips=True)
    ck("a switch changing during the step: reported", c == 9 and "these switches changed during the step: nurse_hire_live" in out, out)
    c, out, _ = run(nurse_after=1)
    ck("an LPN starting Step 1 during the step is said, not an error", c == 0 and "1 Step 1 records already have the nursing license form" in out, out)
finally:
    if node: node.kill()
    for w in (W, WX, WN): subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", w], capture_output=True)
    shutil.rmtree(tmp, ignore_errors=True)
failed = [r for r in res if not r[1]]
for n, ok, note in res: print(("PASS  " if ok else "FAIL  ") + n + ("" if ok else "\n      " + note))
print(f"\n{len(res) - len(failed)}/{len(res)} passed" + (" · FAIL" if failed else ""))
raise SystemExit(1 if failed else 0)
