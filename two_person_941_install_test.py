#!/usr/bin/env python3
# Rehearsal of 941 (two_person_941.py) against a FAKE Supabase, a FAKE supabase CLI and a FAKE Hub site, from a fresh worktree
# of this commit (as the Desktop step runs it). Never touches a real project. The Hub copy is the reviewed Hub commit,
# downloaded from GitHub (public) the way the Desktop step does it.
#   python3 two_person_941_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
BASE_SHA = subprocess.run(["git", "-C", HERE, "rev-parse", "9c6fbddebe88c52170c2bae5b0cb34d78bbf4024"], capture_output=True, text=True).stdout.strip()   # origin/main before 941
HUB_COMMIT = os.environ.get("TP_HUB_COMMIT", "84b3b1ce884ac263ab3ad9f5f2dca641678433c4")   # care-coordinator-hub no-two-person
HUB_BASE = os.environ.get("TP_HUB_BASE", "64d6fa8496b04237a7daadcbc5092f292b551512")      # its base (today's rulebook)
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
S = {}; M = {}
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
TMP = tempfile.mkdtemp(prefix="t941-")
def raw(commit, path):
    return urllib.request.urlopen(f"https://raw.githubusercontent.com/cc16485/care-coordinator-hub/{commit}/{path}", timeout=60).read()
HUBDIR = os.path.join(TMP, "hub"); os.makedirs(os.path.join(HUBDIR, "tests"))
for p in ("match-rules.js", "tests/match-rules-test.js"): open(os.path.join(HUBDIR, p), "wb").write(raw(HUB_COMMIT, p))
NEW_RULES = open(os.path.join(HUBDIR, "match-rules.js"), "rb").read(); OLD_RULES = raw(HUB_BASE, "match-rules.js")
FP_NEW = hashlib.sha256(NEW_RULES).hexdigest(); FP_OLD = hashlib.sha256(OLD_RULES).hexdigest()
def reset(**m):
    S.clear(); S.update(sql=[], posts=[]); M.clear()
    M.update(dict(approved=[FP_OLD, "b" * 64], served="old", used=0, old_active=True, new_row=None, preview_ok=True), **m)
def deployed(): return os.path.exists(os.path.join(TMP, "deployed")) or os.path.exists(os.path.join(TMP, "already"))
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj, raw_=None):
        b = raw_ if raw_ is not None else json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if p.startswith("/match-rules.js"): return self._send(200, None, NEW_RULES if M["served"] == "new" else OLD_RULES if M["served"] == "old" else b"// someone else")
        if "/api-keys" in p: return self._send(200, [{"name": "anon", "api_key": "eyJanonKEY"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
        if re.match(r"/v1/projects/\w+/functions/[\w-]+$", p): return self._send(200, {"version": 7, "verify_jwt": not p.endswith(("step1-sign", "reference-tasks"))})
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if p.startswith("/functions/v1/"):
            S["posts"].append((p, self.headers.get("Authorization"), body))
            if p.startswith("/functions/v1/match-dark"): return self._send(200, {"ok": True, "all_approved": True})
            new = deployed() and M["preview_ok"]
            if body.get("approval_check"):
                ok = lambda f, v: (v == (5 if f == "employee_application" else 3)) if new else (v == (4 if f == "employee_application" else 2))
                return self._send(200, {"ok": True, "approval_check": [dict(x, accepted=ok(x["form"], x["version"])) for x in body["approval_check"]]})
            l3 = "complex mobility assistance." + (" One caregiver per visit: a client who needs more than one person to transfer must have a lift." if new else "")
            return self._send(200, {"ok": True, "forms": [{"key": "employee_application", "version": 5 if new else 4}, {"key": "experience", "version": 3 if new else 2, "sections": [{"p": [l3 + ("" if new else " two-person transfers (when scheduled)")]}]}],
                                    "skill_groups": [{"h": "Higher-need care", "skills": [["hoyer_lift", "A Hoyer"]] + ([] if new else [["two_person_transfers", "Two-person transfers"]])}]})
        q = body["query"]; S["sql"].append(q)
        if q.startswith("select sha256 from public.rules_approved where file = 'match-rules.js' order by"): return self._send(200, [{"sha256": h} for h in M["approved"]])
        if q.startswith("select sha256 from public.rules_approved"): return self._send(200, [{"sha256": h} for h in M["approved"]])
        if q.startswith("insert into public.rules_approved"):
            h = re.search(r"'match-rules\.js', '([0-9a-f]{64})'", q).group(1)
            if h not in M["approved"]: M["approved"].insert(0, h)
            return self._send(201, [])
        if q.startswith("select (select count(*) from public.client_fact"): return self._send(200, [{"used": M["used"], "old_active": M["old_active"], "new_row": M["new_row"]}])
        if q.startswith("begin;"):
            if M["used"]: return self._send(400, {"message": "a client record uses the old label"})
            M["old_active"] = False
            if not M["new_row"]: M["new_row"] = {"label": "Needs more than one person to transfer", "fact_group": "care_needs", "value_shape": "choice", "choices": ["yes", "no"], "layers": ["intake", "assessment", "plan", "current"], "active": True}
            return self._send(201, [])
        if q.startswith("select kind, active from public.fact_kind"):
            return self._send(200, [{"kind": "need_more_than_one_to_transfer", "active": bool(M["new_row"])}, {"kind": "need_two_person_transfers", "active": M["old_active"]}])
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
WT = os.path.join(TMP, "wt"); BASEWT = os.path.join(TMP, "base")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WT, "HEAD"], check=True)
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", BASEWT, BASE_SHA], check=True)
FAKEBIN = os.path.join(TMP, "bin"); os.makedirs(FAKEBIN); LOG = os.path.join(TMP, "cli.log")
open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil
a = sys.argv[1:]; open({LOG!r}, 'a').write(' '.join(a) + '\\n')
if a[:2] == ['functions', 'deploy']: open(os.path.join({TMP!r}, 'deployed'), 'w').write('x'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    fn = a[2]; src = {WT!r} if (os.path.exists(os.path.join({TMP!r}, 'deployed')) or os.path.exists(os.path.join({TMP!r}, 'already'))) else {BASEWT!r}
    root = os.path.join(src, 'supabase', 'functions'); dst = os.path.join(os.getcwd(), 'supabase', 'functions')
    shutil.copytree(os.path.join(root, fn), os.path.join(dst, fn), dirs_exist_ok=True)
    shutil.copytree(os.path.join(root, '_shared'), os.path.join(dst, '_shared'), dirs_exist_ok=True)
    if os.path.exists(os.path.join({TMP!r}, 'drift')) and fn == 'hire-profile': open(os.path.join(dst, 'hire-profile', 'index.ts'), 'a').write('// someone else')
    if os.path.exists(os.path.join({TMP!r}, 'behind')) and fn == 'welcome-call':
        import subprocess; old = subprocess.run(['git', '-C', {HERE!r}, 'log', '--format=%H', '-2', '{BASE_SHA}', '--', 'supabase/functions/welcome-call/index.ts'], capture_output=True, text=True).stdout.split()
        b = subprocess.run(['git', '-C', {HERE!r}, 'show', old[-1] + ':supabase/functions/welcome-call/index.ts'], capture_output=True).stdout
        open(os.path.join(dst, 'welcome-call', 'index.ts'), 'wb').write(b)
    sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
PIN = {"supabase/functions/_shared/step1-documents.ts": sha(os.path.join(WT, "supabase/functions/_shared/step1-documents.ts"))}
def run(env_over=None, already=False, drift=False, behind=False, **mode):
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    for f in (LOG, rep, os.path.join(TMP, "deployed")): os.path.exists(f) and os.remove(f)
    for flag, on in (("already", already), ("drift", drift), ("behind", behind)):
        fp = os.path.join(TMP, flag); (open(fp, "w").write("x") if on else (os.path.exists(fp) and os.remove(fp)))
    env = dict(os.environ, PATH=FAKEBIN + ":/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_HUB_SITE=URL,
               SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"), SB_REPO=WT, SB_BASE=BASE_SHA, SB_SHAS=json.dumps(PIN), SB_HUB=HUBDIR, SB_RULES_FP=FP_NEW, SB_SETTLE="0", SB_POLL="0.05")
    env.update(env_over or {})
    p = subprocess.run(["python3", os.path.join(WT, "two_person_941.py")], env=env, capture_output=True, text=True, timeout=1800)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
cli = lambda: open(LOG).read() if os.path.exists(LOG) else ""
deploys = lambda: re.findall(r"functions deploy ([\w-]+)", cli())
writes = lambda: [q for q in S["sql"] if not q.lstrip().lower().startswith("select")]
FNS = ["caregiver-export", "caregiver-journey", "driver-compliance", "hire-profile", "match-dark", "offer-sign", "reference-send", "reference-tasks", "step1-sign", "step2-handoff", "welcome-call"]
try:
    c, out = run()
    ck("clean run from a fresh copy: exit 0, RESULT: DONE", c == 0 and "RESULT: DONE" in out, out[-2500:])
    ck("Part 1 re-runs the Hub rulebook test and the six Step 1 tests", re.search(r"match-rules-test\.js: \d+ passed, 0 failed", out) and all(re.search(re.escape(t) + r": \d+/\d+ passed", out) for t in ["step1_two_person_test.mjs", "step1_documents_558_test.mjs", "step1_experience_test.mjs", "step1_sign_2b_test.mjs", "lpn_hiring_708_test.mjs", "practice_scenarios_test.mjs"]), out[:3000])
    ck("Part 1: today's rulebook is served and approved; nobody uses the old label", "the Hub serves today's rulebook" in out and "nobody is recorded with" in out, out[:3000])
    ck("approves the new rulebook and keeps today's (no delete)", FP_NEW in M["approved"] and FP_OLD in M["approved"] and not any("delete" in q.lower() for q in S["sql"]), M["approved"])
    ck("the labels: old off (an update, never a delete), new added, in one transaction that refuses if anyone uses the old one", M["old_active"] is False and M["new_row"] and any(q.startswith("begin;") and "raise exception" in q and "update public.fact_kind set active = false" in q for q in S["sql"]))
    ck("deploys all eleven services, each keeping its gateway setting", sorted(deploys()) == sorted(FNS) and len(re.findall(r"--no-verify-jwt", cli())) == 2 and all(f"deploy {f} --project-ref zngsgedlsxinbygwmxwn --use-api --no-verify-jwt" in cli() for f in ("step1-sign", "reference-tasks")), cli()[-1500:])
    ck("proof lines all pass (rulebooks, labels, live copies, preview, approval check, matching report)", out.count("the live copy is exactly the reviewed build") == 11 and "no pause either way" in out and "real applicants can sign the new versions" in out and "the Step 1 preview shows the application v5" in out and "the matching report accepts" in out, out[-2500:])
    ck("the database writes are exactly two (the approval, the labels)", len(writes()) == 2, writes())
    ck("no key, token or email in the report", not re.search(r"eyJ\w|sbp_\w|@mo-care", out), out)
    c, out = run(already=True, old_active=False, new_row={"label": "Needs more than one person to transfer", "fact_group": "care_needs", "value_shape": "choice", "choices": ["yes", "no"], "layers": ["intake", "assessment", "plan", "current"], "active": True}, approved=[FP_NEW, FP_OLD])
    ck("run again: nothing deployed again, still DONE", c == 0 and not deploys() and out.count("already this build") == 11 and "RESULT: DONE" in out, out[-1500:])
    c, out = run(used=2)
    ck("a client record uses the old label: STOPS before any change", c == 3 and not writes() and not deploys() and "2 client record(s)" in out, out[-600:])
    c, out = run(served="other")
    ck("the Hub serves a rulebook nobody approved: STOPS before any change", c == 3 and not writes() and not deploys(), out[-600:])
    c, out = run(served="new")
    ck("the Hub change merged too early: says the jobs are paused, approves it, DONE", c == 0 and "NOT approved yet" in out and FP_NEW in M["approved"] and "RESULT: DONE" in out, out[-1200:])
    c, out = run(new_row={"label": "Something else", "fact_group": "care_needs", "value_shape": "choice", "choices": ["yes", "no"], "layers": ["plan"], "active": True})
    ck("a different label already exists under the new name: STOPS", c == 3 and not writes() and not deploys(), out[-600:])
    c, out = run(drift=True)
    ck("a service live with a change not from GitHub: STOPS before any change", c == 3 and not writes() and not deploys() and "hire-profile" in out, out[-600:])
    c, out = run(behind=True)
    ck("a service whose live copy is behind on something else: STOPS (this step only changes the wording)", c == 3 and not writes() and not deploys() and "would also change" in out, out[-600:])
    c, out = run(env_over={"SB_SHAS": json.dumps({"supabase/functions/_shared/step1-documents.ts": "0" * 64})})
    ck("not the reviewed server build: nothing runs", c == 2 and not S["sql"] and not deploys(), out[-400:])
    c, out = run(env_over={"SB_RULES_FP": "0" * 64})
    ck("not the reviewed Hub rulebook: nothing runs", c == 2 and not S["sql"] and not deploys(), out[-400:])
    c, out = run(preview_ok=False)
    ck("the Step 1 preview not showing the new words is caught", c == 8 and "PARTLY DONE" in out, out[-900:])
finally:
    for w in (WT, BASEWT): subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", w])
    shutil.rmtree(TMP, ignore_errors=True)
for n, o, d in res: print(("PASS" if o else "FAIL") + " · " + n + ("" if o else "\n     " + d))
print(f"{sum(1 for r in res if r[1])}/{len(res)}")
raise SystemExit(0 if all(r[1] for r in res) else 1)
