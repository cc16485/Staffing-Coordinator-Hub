#!/usr/bin/env python3
# Rehearsal of 704 (golive_hub_704.py) against a FAKE Supabase (management API, the services) and a FAKE supabase CLI. The Step 1
# preview is answered by the REAL step1-sign code of the build under test (imported under node; no database). Never touches a
# real project. Runs the installer from fresh detached worktrees of HEAD (never ../ sibling folders):
#   W   = HEAD exactly as reviewed (the Hepatitis B form PROPOSED, not approved): 704 must refuse and change nothing
#   WA  = HEAD plus one commit adding hepb_vaccination to APPROVED_FOR_REAL (what the PR looks like after her approval)
#   python3 golive_hub_704_install_test.py        (T704_SHOW=1 prints the clean run's report)
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil, sys, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
FNS = ["hepb", "hire-profile", "step1-sign"]; SQL_REL = "supabase/hepb-step1.sql"; DOC_REL = "supabase/functions/_shared/step1-documents.ts"
SWITCHES = ["hepb_offer_live", "step1_auto_live", "offer_send_live", "driver_reminders_live", "driver_link_send_live"]
tmp = tempfile.mkdtemp(prefix="t704-"); W = os.path.join(tmp, "wt"); WA = os.path.join(tmp, "wta"); WX = os.path.join(tmp, "wtx")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", W, "HEAD"], check=True)
node = None
def git(wt, *a): return subprocess.run(["git", "-C", wt, "-c", "user.name=t704", "-c", "user.email=t704@example.invalid"] + list(a), capture_output=True, text=True, check=True).stdout.strip()
try:
    # the approved build: the one-line change Claude makes after her approval
    subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WA, "HEAD"], check=True)
    d = open(os.path.join(WA, DOC_REL)).read()
    d2 = re.sub(r"(export const APPROVED_FOR_REAL[^=]*= \{.*?)(\n\})", lambda m: m.group(1) + "\n  hepb_vaccination: 1," + m.group(2), d, count=1, flags=re.S)
    assert d2 != d; open(os.path.join(WA, DOC_REL), "w").write(d2); git(WA, "commit", "-q", "-am", "t704: her approval of the Hepatitis B form"); MAIN_A = git(WA, "rev-parse", "HEAD")
    # a main that moved on after the review (a newer step1-documents.ts)
    subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WX, MAIN_A], check=True)
    NEWER_DOC = open(os.path.join(WX, DOC_REL)).read() + "\n// a newer change merged after the review\n"
    open(os.path.join(WX, DOC_REL), "w").write(NEWER_DOC); git(WX, "commit", "-q", "-am", "t704 newer"); MAIN_X = git(WX, "rev-parse", "HEAD")
    OLD_DOC = subprocess.run(["git", "-C", WA, "show", "HEAD~2:" + DOC_REL], capture_output=True).stdout.decode()   # the build before this PR (705)

    sys.path.insert(0, W); os.environ.setdefault("SB_REPORT", os.path.join(tmp, "unused.txt"))
    from cc_step_lib import need
    def pins(root):
        fnroot = os.path.join(root, "supabase", "functions"); nd = {fn: sorted(need(fnroot, fn)) for fn in FNS}
        return fnroot, nd, {k[len("supabase/functions/"):]: sha(os.path.join(root, k)) for k in sorted({k for fn in FNS for k in nd[fn]})}, {SQL_REL: sha(os.path.join(root, SQL_REL))}
    # the REAL step1-sign preview of the approved build, served by node
    FNCOPY = os.path.join(tmp, "fncopy"); shutil.copytree(os.path.join(WA, "supabase", "functions"), FNCOPY)
    src = re.sub(r"(?m)^import \{ createClient \} from .*$", "const createClient = () => { throw new Error('no database in the preview') }", open(os.path.join(FNCOPY, "step1-sign", "index.ts")).read())
    open(os.path.join(FNCOPY, "step1-sign", "_t704.ts"), "w").write(src)
    open(os.path.join(tmp, "pv.mjs"), "w").write(f"""
import http from 'http'
globalThis.Deno = {{ env: {{ get: () => '' }}, serve: () => {{}} }}
const M = await import({json.dumps(os.path.join(FNCOPY, "step1-sign", "_t704.ts"))})
const D = await import({json.dumps(os.path.join(FNCOPY, "_shared", "step1-documents.ts"))})
const s = http.createServer((req, res) => {{ let b = ''; req.on('data', (c) => b += c); req.on('end', async () => {{
  const body = JSON.parse(b || '{{}}'); const out = body.__fp ? await D.formFingerprint('hepb_vaccination') : await M.preview(body)
  res.end(JSON.stringify(out)) }}) }})
s.listen(0, '127.0.0.1', () => console.log(s.address().port))
""")
    node = subprocess.Popen(["node", os.path.join(tmp, "pv.mjs")], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    PV = f"http://127.0.0.1:{node.stdout.readline().strip()}"
    real_preview = lambda body: json.loads(urllib.request.urlopen(urllib.request.Request(PV, data=json.dumps(body).encode(), method="POST"), timeout=60).read())
    HEPB_FP = real_preview({"__fp": True})

    S = {}; M = {}
    def base_ops(): return {"hepb_offer_live": False, "step1_auto_live": True, "offer_send_live": True, "driver_reminders_live": False, "driver_link_send_live": False, "onboarding_switch_date": "2026-10-13", "other": [1, 2]}
    def reset(**m):
        S.clear(); S.update(sql=[], posts=[], patches=[], sqlfile=0, ops_reads=0)
        M.clear(); M.update(dict(vj={"hepb": True, "hire-profile": True, "step1-sign": False}, ops=base_ops(), notlive=set(), reset_gateway=False, preview="real",
                                 switch_flips=False, patched=set(), sql_fail=False, tables=True, cols_after=True, sd=True), **m)
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
                return self._send(200, {"version": 30 + len(dl), "verify_jwt": vj})
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
                    j = real_preview({k: v for k, v in body.items() if k != "action"})
                    if M["preview"] == "stale" or "step1-sign" not in deployed():   # the old live build: no Hepatitis B form
                        j = real_preview({}); j["forms"] = [f for f in j["forms"] if f["key"] != "hepb_vaccination"]; j["form_count"] = 12
                    return self._send(200, j)
                return self._send(404, {})
            q = body["query"]; S["sql"].append(q)
            if q == "select data, version from public.app_data where key = 'ops_settings'":
                S["ops_reads"] += 1; dd = json.loads(json.dumps(M["ops"]))
                if not M["sd"]: dd.pop("onboarding_switch_date", None)
                if M["switch_flips"] and S["ops_reads"] > 1: dd["hepb_offer_live"] = True
                return self._send(200, [{"data": dd, "version": 7}])
            if q.startswith("select to_regclass('public.hepb_record')"): return self._send(200, [{"hr": M["tables"], "sf": True, "col": False}])
            if "open_real" in q: return self._send(200, [{"open_real": 2, "done_real": 1, "practice": 4}])
            if q == open(os.path.join(ROOT_UNDER_TEST, SQL_REL)).read():
                if M["sql_fail"]: return self._send(400, {"message": "ERROR: permission denied for table step1_forms"})
                S["sqlfile"] += 1; return self._send(200, [])
            if "hepb_record_step1_keep_t" in q: return self._send(200, [{"a": M["cols_after"], "b": True, "c": True, "leak": False}])
            if "filter (where hepb_form)" in q: return self._send(200, [{"with_form": 0, "n": 7}])
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
    ROOT_UNDER_TEST = WA
    def run(root=WA, env_over=None, override=None, **mode):
        global ROOT_UNDER_TEST
        ROOT_UNDER_TEST = root; reset(**mode); rep = os.path.join(tmp, "r.txt")
        for f in (CLI_LOG, rep):
            if os.path.exists(f): os.remove(f)
        open(CLI_LOG, "w").close()
        fnroot, nd, fsh, ssh = pins(root)
        json.dump({"root": root, "need": nd, "override": override or {}}, open(STATE, "w"))
        env = dict(os.environ, PATH=FAKEBIN + ":/usr/bin:/bin", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"),
                   SB_FNROOT=fnroot, SB_FN_SHAS=json.dumps(fsh), SB_SQL_SHAS=json.dumps(ssh), SB_HEPB_FP=HEPB_FP, PYTHONPATH=root, SB_STEP="704", SB_MAIN_REF=MAIN_A)
        env.update(env_over or {})
        p = subprocess.run(["python3", os.path.join(root, "golive_hub_704.py")], env=env, capture_output=True, text=True, timeout=900, cwd=tmp)
        return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), fsh
    nothing = lambda: not S["sql"] and not deployed() and not S["posts"]
    nothing_changed = lambda: S["sqlfile"] == 0 and not deployed()

    # ── the gate: as reviewed (not approved), 704 refuses and touches nothing ──
    c, out, _ = run(root=W, env_over={"SB_MAIN_REF": "HEAD"})
    ck("NOT approved (the build as reviewed): STOP in PART 1, no query, no deploy, no call; her next step is said", c == 2 and "is NOT approved for real applicants in this build" in out
       and "Samantha approves its wording first" in out and "Nothing ran; nothing changed." in out and nothing(), out)
    fnroot_w = os.path.join(W, "supabase", "functions")
    ck("the reviewed build itself has the form PROPOSED and NOT in APPROVED_FOR_REAL (705's 13 untouched)",
       "hepb_vaccination:" not in re.search(r"export const APPROVED_FOR_REAL[^=]*= \{(.*?)\n\}", open(os.path.join(W, DOC_REL)).read(), re.S).group(1)
       and re.search(r"key: 'hepb_vaccination',[^\n]*status: 'proposed'", open(os.path.join(W, DOC_REL)).read()), "")
    d_bad = re.sub(r"hepb_vaccination: 1,", "hepb_vaccination: 2,", open(os.path.join(WA, DOC_REL)).read())
    WB = os.path.join(tmp, "wtb"); subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WB, MAIN_A], check=True)
    open(os.path.join(WB, DOC_REL), "w").write(d_bad); git(WB, "commit", "-q", "-am", "t704 wrong version")
    c, out, _ = run(root=WB, env_over={"SB_MAIN_REF": "HEAD"})
    ck("approved at a DIFFERENT version than the form in force: STOP, nothing changed", c == 2 and "(approved: version 2)" in out and nothing(), out)
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", WB], capture_output=True)

    # ── the clean run (approved) ──
    c, out, fsh = run()
    if os.environ.get("T704_SHOW"): print(out)
    ck("clean run (approved build): exit 0, RESULT: DONE", c == 0 and "RESULT: DONE" in out, out)
    ck("the SQL first, then hepb, hire-profile, step1-sign (step1-sign last), each keeping its gateway setting",
       S["sqlfile"] == 1 and deployed() == FNS and [("--no-verify-jwt" in l) for l in dlines()] == [False, False, True]
       and S["sql"].index(open(os.path.join(WA, SQL_REL)).read()) < len(S["sql"]) and out.index("hepb-step1.sql is in") < out.index("hepb deployed"), [dlines(), out])
    ck("exactly the services whose behavior changed are deployed (and the step names them): those that read the form count or the hepatitis B record",
       set(FNS) == {"hepb", "hire-profile", "step1-sign"} and "Other services that read the form list keep their current live copy" in out, out)
    ck("PART 1: the gate, the pins, main, live state, tables, the Step 1s under way keep 12 forms, switches shown",
       all(s in out for s in ["the Hepatitis B form is approved for real applicants at exactly its version (1)", "hepb-step1.sql is the reviewed build", "main holds no newer version",
                                "step1-sign is live at version 30 (gateway sign-in check off) and is already this build", "the hepatitis B tables and the Step 1 table exist",
                                "2 real under way, 1 real complete, 4 practice. Every one of them keeps its 12 forms", "hepb_offer_live off", "the onboarding switch date (705): 2026-10-13"]), out)
    ck("PART 3 (the real step1-sign preview): 14 forms, 13 to sign, the Hepatitis B form last at the reviewed fingerprint, approved; every form accepted by the approval check",
       all(s in out for s in ["the Step 1 preview answers with 14 forms, 13 to sign, the Hepatitis B form last (screen 16)", "the Hepatitis B form is live at version 1 with the reviewed wording fingerprint, approved for real, with its five choices",
                                "a real applicant may sign every form a new Step 1 has, the Hepatitis B form included", "the Step 1 column, the hepatitis B Step 1 columns and the keep-guard are in",
                                "hepb is live as tested", "hire-profile is live as tested", "step1-sign is live as tested", "no switch changed", "nothing was sent"]), out)
    acq = [b for f, _, b in S["posts"] if b.get("approval_check")]
    ck("the approval check asks all 14 forms at their versions", len(acq) == 1 and len(acq[0]["approval_check"]) == 14 and acq[0]["approval_check"][-1] == {"form": "hepb_vaccination", "version": 1}, acq)
    writes = [q for q in S["sql"] if re.match(r"(?is)\s*(--|begin|alter|update|insert|delete|create)", q)]
    ck("the only database change is hepb-step1.sql (no switch, no person's record)", writes == [open(os.path.join(WA, SQL_REL)).read()], [w[:80] for w in writes])
    ck("only the read-only Step 1 preview is called, as a visitor", S["posts"] and all(f == "step1-sign" and b.get("action") == "preview" and a == "Bearer eyJanonKEY" for f, a, b in S["posts"]), S["posts"])
    ck("her lines: new Step 1s get the form; ones under way keep 12; confidential", "every Step 1 that starts from now has the Hepatitis B form last" in out and "Step 1s already under way keep their 12 forms" in out and "owners only" in out, out)
    ck("no key or token printed; no em dash in the report or the step's files; never 'plain language'", "sbp_test" not in out and "eyJanonKEY" not in out and "—" not in out and "plain language" not in out.lower()
       and all("—" not in open(os.path.join(WA, f)).read() for f in ["golive_hub_704.py", SQL_REL]), out)

    # ── stops before anything changes ──
    c, out, fsh = run(override={"step1-sign": {"supabase/functions/step1-sign/index.ts": "// someone's unmerged work\n" + open(os.path.join(WA, "supabase/functions/step1-sign/index.ts")).read()}})
    ck("a live file never on main: STOP before any change", c == 3 and "in a version that was never on main" in out and nothing_changed(), out)
    c, out, _ = run(override={"hepb": {"supabase/functions/_shared/someones-new-file.ts": "export const x = 1\n"}})
    ck("a live file this build does not use and main never had: STOP", c == 3 and "someones-new-file.ts" in out and nothing_changed(), out)
    c, out, _ = run(env_over={"SB_MAIN_REF": MAIN_X})
    ck("main changed a file these services use after the review: STOP, nothing runs", c == 2 and "main has newer versions of _shared/step1-documents.ts" in out and nothing_changed(), out)
    c, out, _ = run(env_over={"SB_MAIN_REF": MAIN_X}, override={"step1-sign": {DOC_REL: NEWER_DOC}})
    ck("a live file NEWER than this build: STOP", c in (2, 3) and nothing_changed(), out)
    c, out, _ = run(notlive={"hire-profile"})
    ck("a service not live at all: STOP", c == 3 and "hire-profile is not live at all" in out and nothing_changed(), out)
    c, out, _ = run(tables=False)
    ck("the hepatitis B tables missing (703 not in): STOP", c == 3 and "hepb_record or step1_forms does not exist" in out and nothing_changed(), out)
    _, _, fsh = run()
    c, out, _ = run(env_over={"SB_FN_SHAS": json.dumps({k: v for k, v in fsh.items() if k != "_shared/hepb.ts"})})
    ck("a needed file not pinned: STOP, no query", c == 2 and "not pinned" in out and not S["sql"], out)
    c, out, _ = run(env_over={"SB_SQL_SHAS": json.dumps({SQL_REL: "0" * 64})})
    ck("the SQL not the reviewed build: STOP, no query", c == 2 and "hepb-step1.sql is not the reviewed build" in out and not S["sql"], out)
    c, out, _ = run(env_over={"SB_HEPB_FP": ""})
    ck("the wording fingerprint pin missing: STOP, no query", c == 2 and not S["sql"], out)
    # ── older live files are brought up to date (705's build of step1-documents) ──
    c, out, _ = run(override={"step1-sign": {DOC_REL: OLD_DOC}, "hire-profile": {DOC_REL: OLD_DOC}, "hepb": {"supabase/functions/_shared/hepb-appendix-a.ts": None}})
    ck("live services on the 705 build (older step1-documents, no Appendix A file yet): named as older or built before, deployed, DONE",
       c == 0 and "older versions (from this build's own history) of _shared/step1-documents.ts" in out and "built before it used _shared/hepb-appendix-a.ts" in out and deployed() == FNS, out)
    # ── changes that go wrong ──
    c, out, _ = run(sql_fail=True)
    ck("the SQL refused: STOPPED, no service deployed", c == 5 and "hepb-step1.sql did not install" in out and not deployed(), out)
    c, out, _ = run(reset_gateway=True)
    ck("a deploy that turns the gateway on is put back to off for step1-sign only (hepb and hire-profile are on and stay on)", c == 0 and S["patches"] == [("step1-sign", {"verify_jwt": False})], S["patches"])
    c, out, _ = run(preview="stale")
    ck("the preview not showing the form after the deploy: reported", c == 9 and "the Step 1 preview answered" in out, out)
    c, out, _ = run(env_over={"SB_HEPB_FP": "f" * 64})
    ck("the live wording not the reviewed fingerprint: reported", c == 9 and "is not live as reviewed" in out, out)
    c, out, _ = run(switch_flips=True)
    ck("a switch changing during the step: reported", c == 9 and "these switches changed during the step: hepb_offer_live" in out, out)
    c, out, _ = run(sd=False)
    ck("705 not run yet (no switch date): reported, not a stop", c == 0 and "the onboarding switch date is not set (705 has not run)" in out, out)
finally:
    if node: node.kill()
    for w in (W, WA, WX): subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", w], capture_output=True)
    shutil.rmtree(tmp, ignore_errors=True)
failed = [r for r in res if not r[1]]
for n, ok, note in res: print(("PASS  " if ok else "FAIL  ") + n + ("" if ok else "\n      " + note))
print(f"\n{len(res) - len(failed)}/{len(res)} passed" + (" · FAIL" if failed else ""))
raise SystemExit(1 if failed else 0)
