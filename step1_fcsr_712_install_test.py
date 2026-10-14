#!/usr/bin/env python3
# Rehearsal of 712 (step1_fcsr_712.py) against a FAKE Supabase (management API, the services) and a FAKE supabase CLI. The Step 1
# preview is answered by the REAL step1-sign code of the build under test (imported under node; no database). Never touches a
# real project. Runs the installer from fresh detached worktrees of HEAD (never ../ sibling folders):
#   WA  = HEAD exactly as reviewed (her approval of 5b v5 in APPROVED_FOR_REAL): the clean run and every case
#   W   = HEAD plus one commit taking that approval out (as the PR was before she approved): 712 must refuse and change nothing
#   python3 step1_fcsr_712_install_test.py        (T712_SHOW=1 prints the clean run's report)
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil, sys, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
FNS = ["applicant-text", "step1-sign"]; DOC_REL = "supabase/functions/_shared/step1-documents.ts"; REC_REL = "supabase/step1-approved-2026-10-14.json"
tmp = tempfile.mkdtemp(prefix="t712-"); W = os.path.join(tmp, "wt"); WA = os.path.join(tmp, "wta"); WX = os.path.join(tmp, "wtx")
node = None
def git(wt, *a): return subprocess.run(["git", "-C", wt, "-c", "user.name=t712", "-c", "user.email=t712@example.invalid"] + list(a), capture_output=True, text=True, check=True).stdout.strip()
try:
    subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WA, "HEAD"], check=True); MAIN_A = git(WA, "rev-parse", "HEAD")
    subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", W, "HEAD"], check=True)
    d = open(os.path.join(W, DOC_REL)).read()
    d2 = d.replace("\n  edl_fcsr_consent: 5,", "\n  edl_fcsr_consent: 4,", 1).replace("key: 'edl_fcsr_consent', screen: '5b', title: 'Your Details for the Background Checks', version: 5, status: 'approved'",
                                                                                "key: 'edl_fcsr_consent', screen: '5b', title: 'Your Details for the Background Checks', version: 5, status: 'proposed'", 1)
    assert d2.count("status: 'proposed'") == d.count("status: 'proposed'") + 1 and "edl_fcsr_consent: 4," in d2
    open(os.path.join(W, DOC_REL), "w").write(d2); git(W, "commit", "-q", "-am", "t712: before her approval")
    # a main that moved on after the review (a newer step1-documents.ts)
    subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WX, MAIN_A], check=True)
    NEWER_DOC = open(os.path.join(WX, DOC_REL)).read() + "\n// a newer change merged after the review\n"
    open(os.path.join(WX, DOC_REL), "w").write(NEWER_DOC); git(WX, "commit", "-q", "-am", "t712 newer"); MAIN_X = git(WX, "rev-parse", "HEAD")
    BASE_C = git(WA, "merge-base", "HEAD", "origin/main")
    OLD = {k: subprocess.run(["git", "-C", WA, "show", BASE_C + ":" + k], capture_output=True).stdout.decode() for k in [DOC_REL, "supabase/functions/applicant-text/index.ts"]}   # main before this PR

    sys.path.insert(0, W); os.environ.setdefault("SB_REPORT", os.path.join(tmp, "unused.txt"))
    from cc_step_lib import need
    def pins(root):
        fnroot = os.path.join(root, "supabase", "functions"); nd = {fn: sorted(need(fnroot, fn)) for fn in FNS}
        return fnroot, nd, {k[len("supabase/functions/"):]: sha(os.path.join(root, k)) for k in sorted({k for fn in FNS for k in nd[fn]})}
    # the REAL step1-sign preview of the approved build, served by node
    FNCOPY = os.path.join(tmp, "fncopy"); shutil.copytree(os.path.join(WA, "supabase", "functions"), FNCOPY)
    src = re.sub(r"(?m)^import \{ createClient \} from .*$", "const createClient = () => { throw new Error('no database in the preview') }", open(os.path.join(FNCOPY, "step1-sign", "index.ts")).read())
    open(os.path.join(FNCOPY, "step1-sign", "_t712.ts"), "w").write(src)
    open(os.path.join(tmp, "pv.mjs"), "w").write(f"""
import http from 'http'
globalThis.Deno = {{ env: {{ get: () => '' }}, serve: () => {{}} }}
const M = await import({json.dumps(os.path.join(FNCOPY, "step1-sign", "_t712.ts"))})
const s = http.createServer((req, res) => {{ let b = ''; req.on('data', (c) => b += c); req.on('end', async () => {{
  res.end(JSON.stringify(await M.preview(JSON.parse(b || '{{}}')))) }}) }})
s.listen(0, '127.0.0.1', () => console.log(s.address().port))
""")
    node = subprocess.Popen(["node", os.path.join(tmp, "pv.mjs")], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    PV = f"http://127.0.0.1:{node.stdout.readline().strip()}"
    real_preview = lambda body: json.loads(urllib.request.urlopen(urllib.request.Request(PV, data=json.dumps(body).encode(), method="POST"), timeout=60).read())

    S = {}; M = {}
    def reset(**m):
        S.clear(); S.update(sql=[], posts=[], patches=[], options=[])
        M.clear(); M.update(dict(vj={"applicant-text": True, "step1-sign": False}, notlive=set(), reset_gateway=False, preview="real", tables=True, stranger=401, patched=set()), **m)
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
        def do_OPTIONS(self):
            S["options"].append(self.path); self.send_response(200); self.end_headers(); self.wfile.write(b"ok")
        def do_PATCH(self):
            n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}")
            fn = self.path.rstrip("/").split("/")[-1]; S["patches"].append((fn, body))
            if "verify_jwt" in body: M["vj"][fn] = body["verify_jwt"]; M["patched"].add(fn)
            self._send(200, {})
        def do_POST(self):
            n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
            if p.startswith("/functions/v1/"):
                fn = p.split("/")[3].split("?")[0]; S["posts"].append((fn, self.headers.get("Authorization"), body))
                if fn == "step1-sign" and body.get("action") == "preview":
                    j = real_preview({k: v for k, v in body.items() if k != "action"})
                    if (M["preview"] == "stale" or "step1-sign" not in deployed()) and isinstance(j.get("forms"), list):   # the old live build: 5b at version 4
                        for f in j["forms"]:
                            if f["key"] == "edl_fcsr_consent": f["version"] = 4; f["fingerprint"] = "da180e453331f749129ce908a89080916c6e1f21587f0f7a35c39a60a3902053"
                    return self._send(200, j)
                if body.get("action") in ("draft", "screening"): return self._send(M["stranger"], {"error": "Sign in first."})
                return self._send(404, {})
            q = body["query"]; S["sql"].append(q)
            if q.startswith("select to_regclass('public.applicant_texts')"): return self._send(200, [{"at": M["tables"], "sf": True}])
            if "open_unsigned" in q: return self._send(200, [{"open_unsigned": 2, "signed_real": 3}])
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
    def run(root=WA, env_over=None, override=None, **mode):
        reset(**mode); rep = os.path.join(tmp, "r.txt")
        for f in (CLI_LOG, rep):
            if os.path.exists(f): os.remove(f)
        open(CLI_LOG, "w").close()
        fnroot, nd, fsh = pins(root)
        json.dump({"root": root, "need": nd, "override": override or {}}, open(STATE, "w"))
        env = dict(os.environ, PATH=FAKEBIN + ":/usr/bin:/bin", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"),
                   SB_FNROOT=fnroot, SB_FN_SHAS=json.dumps(fsh), SB_REC_SHA=sha(os.path.join(root, REC_REL)), PYTHONPATH=root, SB_STEP="712", SB_MAIN_REF=MAIN_A)
        env.update(env_over or {})
        p = subprocess.run(["python3", os.path.join(root, "step1_fcsr_712.py")], env=env, capture_output=True, text=True, timeout=900, cwd=tmp)
        return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), fsh
    nothing = lambda: not S["sql"] and not deployed() and not S["posts"]
    nothing_changed = lambda: not deployed()

    # ── the gate: before her approval, 712 refuses and touches nothing ──
    c, out, _ = run(root=W, env_over={"SB_MAIN_REF": "HEAD"})
    ck("NOT approved (the build before her approval): STOP in PART 1, no query, no deploy, no call; her next step is said", c == 2 and "is NOT approved for real applicants in this build" in out
       and "(approved: version 4)" in out and "Samantha approves its wording first" in out and nothing(), out)
    # ── the record: what she approved, pinned ──
    REC = json.load(open(os.path.join(WA, REC_REL)))
    ck("the approval record: Samantha, 2026-10-14 14:38:26 UTC, \"ok great, approved!\", the page and its version, 14 forms, 5b at version 5", REC["approved_by"] == "Samantha" and REC["approved_at"] == "2026-10-14T14:38:26Z"
       and REC["her_words"] == "ok great, approved!" and "Gj2NFJSbr2DFVR6m6K7LFf" in REC["page"] and "1791988544-e4d9" in REC["page"] and len(REC["forms"]) == 14 and REC["step1_version"] == 6
       and [f for f in REC["forms"] if f["key"] == "edl_fcsr_consent"][0]["version"] == 5, REC)

    # ── the clean run ──
    c, out, fsh = run()
    if os.environ.get("T712_SHOW"): print(out)
    ck("clean run (approved build): exit 0, RESULT: DONE", c == 0 and "RESULT: DONE" in out, out)
    ck("applicant-text, then step1-sign (last), each keeping its gateway setting; nothing else deployed", deployed() == FNS and [("--no-verify-jwt" in l) for l in dlines()] == [False, True], dlines())
    ck("the pins cover step1-sign, applicant-text and every _shared file they import (incl. step1-documents, outreach, send-problems, text-consent)",
       all(k in fsh for k in ["step1-sign/index.ts", "applicant-text/index.ts", "_shared/step1-documents.ts", "_shared/step1-pdf.ts", "_shared/outreach.ts", "_shared/send-problems.ts", "_shared/text-consent.ts"]), sorted(fsh))
    ck("PART 1: the gate, the record, the pins, main, live state, the tables, the Step 1s under way",
       all(s in out for s in ["the details form (screen 5b) is approved for real applicants at exactly its version (5)", "the approval record is the reviewed build: Samantha", "14 forms, each at the version APPROVED_FOR_REAL holds; Step 1 version 6",
                                "main holds no newer version", "step1-sign is live at version 40 (gateway sign-in check off) and is already this build", "the texts table (applicant_texts",
                                "3 real ones already signed screen 5b", "2 real ones under way have not signed it yet"]), out)
    ck("PART 3: live as tested, both answer, a stranger gets 401 from both, 5b at version 5 with the new questions, every form at the record's fingerprint, the approval check",
       all(s in out for s in ["applicant-text is live as tested", "step1-sign is live as tested", "applicant-text answers", "step1-sign answers", "a stranger (the public key, no office sign-in) gets 401 from applicant-text",
                                "a stranger gets 401 from step1-sign's screening desk", "shows the details form (screen 5b) at version 5, approved, approved for real, with middle name, suffix, birth name, gender and county",
                                "every form (14) is live at the version and wording fingerprint in the approval record", "the next version of every form is refused", "nothing was sent"]), out)
    acq = [b for f, _, b in S["posts"] if b.get("approval_check")]
    ck("the approval check asks all 14 forms at their versions and the next ones", len(acq) == 1 and len(acq[0]["approval_check"]) == 28 and {"form": "edl_fcsr_consent", "version": 5} in acq[0]["approval_check"], acq)
    writes = [q for q in S["sql"] if re.match(r"(?is)\s*(--|begin|alter|update|insert|delete|create|drop|grant|revoke)", q)]
    ck("no database change at all (reads only)", not writes, writes)
    ck("only reads and refusals are called, as a visitor: the preview, and the two office-only doors with a made-up id", S["posts"] and all(a == "Bearer eyJanonKEY" and ((f == "step1-sign" and b.get("action") in ("preview", "screening")) or (f == "applicant-text" and b.get("action") == "draft")) for f, a, b in S["posts"]), S["posts"])
    ck("no key or token printed; no em dash in the report or the step's files; never 'plain language'", "sbp_test" not in out and "eyJanonKEY" not in out and "—" not in out and "plain language" not in out.lower()
       and all("—" not in open(os.path.join(WA, f)).read() for f in ["step1_fcsr_712.py", REC_REL]), out)

    # ── stops before anything changes ──
    c, out, _ = run(override={"step1-sign": {"supabase/functions/step1-sign/index.ts": "// someone's unmerged work\n" + open(os.path.join(WA, "supabase/functions/step1-sign/index.ts")).read()}})
    ck("a live file never on main: STOP before any change", c == 3 and "in a version that was never on main" in out and nothing_changed(), out)
    c, out, _ = run(override={"applicant-text": {"supabase/functions/_shared/someones-new-file.ts": "export const x = 1\n"}})
    ck("a live file this build does not use and main never had: STOP", c == 3 and "someones-new-file.ts" in out and nothing_changed(), out)
    c, out, _ = run(env_over={"SB_MAIN_REF": MAIN_X})
    ck("main changed a file these services use after the review: STOP, nothing runs", c == 2 and "main has newer versions of _shared/step1-documents.ts" in out and nothing_changed(), out)
    c, out, _ = run(notlive={"applicant-text"})
    ck("a service not live at all: STOP", c == 3 and "applicant-text is not live at all" in out and nothing_changed(), out)
    c, out, _ = run(tables=False)
    ck("the texts table missing: STOP", c == 3 and "applicant_texts or step1_forms does not exist" in out and nothing_changed(), out)
    _, _, fsh = run()
    c, out, _ = run(env_over={"SB_FN_SHAS": json.dumps({k: v for k, v in fsh.items() if k != "_shared/text-consent.ts"})})
    ck("a needed file not pinned: STOP, no query", c == 2 and "not pinned" in out and not S["sql"], out)
    c, out, _ = run(env_over={"SB_FN_SHAS": json.dumps(dict(fsh, **{"_shared/step1-documents.ts": "0" * 64}))})
    ck("a pinned file not the reviewed build: STOP, no query", c == 2 and "_shared/step1-documents.ts is not the reviewed build" in out and not S["sql"], out)
    c, out, _ = run(env_over={"SB_REC_SHA": "0" * 64})
    ck("the approval record not the reviewed one: STOP, no query", c == 2 and "approval record (step1-approved-2026-10-14.json) is not the reviewed build" in out and not S["sql"], out)
    # a record that disagrees with APPROVED_FOR_REAL
    WB = os.path.join(tmp, "wtb"); subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WB, MAIN_A], check=True)
    rb = json.load(open(os.path.join(WB, REC_REL))); [f for f in rb["forms"] if f["key"] == "edl_fcsr_consent"][0]["version"] = 4
    open(os.path.join(WB, REC_REL), "w").write(json.dumps(rb, indent=1) + "\n"); git(WB, "commit", "-q", "-am", "t712 record off")
    c, out, _ = run(root=WB, env_over={"SB_MAIN_REF": "HEAD"})
    ck("a record whose versions disagree with APPROVED_FOR_REAL: STOP, nothing runs", c == 2 and "does not list every form at the version APPROVED_FOR_REAL holds (edl_fcsr_consent)" in out and nothing_changed(), out)
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", WB], capture_output=True)
    # ── older live files are brought up to date (main before this PR) ──
    c, out, _ = run(override={"step1-sign": {DOC_REL: OLD[DOC_REL]}, "applicant-text": {"supabase/functions/applicant-text/index.ts": OLD["supabase/functions/applicant-text/index.ts"]}})
    ck("live services on main's build before this PR: named as older, deployed, DONE",
       c == 0 and "older versions (from this build's own history) of _shared/step1-documents.ts" in out and "older versions (from this build's own history) of applicant-text/index.ts" in out and deployed() == FNS, out)
    # ── things that go wrong after the deploy ──
    c, out, _ = run(reset_gateway=True)
    ck("a deploy that turns the gateway on is put back to off for step1-sign only (applicant-text is on and stays on)", c == 0 and S["patches"] == [("step1-sign", {"verify_jwt": False})], S["patches"])
    c, out, _ = run(preview="stale")
    ck("the preview still showing 5b at version 4 after the deploy: reported", c == 9 and "the Step 1 preview answered 200: the details form at version 4" in out and "edl_fcsr_consent" in out, out)
    c, out, _ = run(stranger=200)
    ck("a stranger NOT refused: reported", c == 9 and "applicant-text answered a stranger 200, not 401" in out and "step1-sign's screening desk answered a stranger 200, not 401" in out, out)
finally:
    if node: node.kill()
    for w in (W, WA, WX): subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", w], capture_output=True)
    shutil.rmtree(tmp, ignore_errors=True)
failed = [r for r in res if not r[1]]
for n, ok, note in res: print(("PASS  " if ok else "FAIL  ") + n + ("" if ok else "\n      " + note))
print(f"\n{len(res) - len(failed)}/{len(res)} passed" + (" · FAIL" if failed else ""))
raise SystemExit(1 if failed else 0)
