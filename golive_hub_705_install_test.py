#!/usr/bin/env python3
# Rehearsal of 705 (golive_hub_705.py) against a FAKE Supabase (management API for the Hub and the Training Platform, the
# services) and a FAKE supabase CLI. The Step 1 preview is answered by the REAL step1-sign code of this build (imported
# under node with a fake database it never touches). Never touches a real project. Runs the installer from a fresh detached
# worktree of HEAD (never ../ sibling folders).
#   python3 golive_hub_705_install_test.py        (T705_SHOW=1 prints the clean run's report)
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil, sys, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
FNS = ["step1-sign", "driver-compliance"]
SWITCHES = ["offer_send_live", "offer_reminders_live", "step1_auto_live", "step2_send_live", "step2_reminders_live", "wc_auto_invite_live",
            "orient_remind_live", "approve_work_text_live", "approve_work_axiscare_live", "axiscare_hire_date_live", "axiscare_level_live",
            "driver_reminders_live", "driver_link_send_live", "driver_schedule_gate_live", "hepb_offer_live"]
REC_REL = "supabase/step1-approved-2026-10-13.json"; OUT_REL = "supabase/functions/outreach-check/index.ts"; DOC_REL = "supabase/functions/_shared/step1-documents.ts"
TODAY, TOMORROW = "2026-10-13", "2026-10-14"
tmp = tempfile.mkdtemp(prefix="t705-"); W = os.path.join(tmp, "wt"); W2 = os.path.join(tmp, "wt2")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", W, "HEAD"], check=True)
node = None
try:
    sys.path.insert(0, W); os.environ.setdefault("SB_REPORT", os.path.join(tmp, "unused.txt"))
    from cc_step_lib import need
    FNROOT = os.path.join(W, "supabase", "functions")
    NEED = {fn: sorted(need(FNROOT, fn)) for fn in FNS + ["outreach-check"]}
    ALL = sorted({k for fn in FNS for k in NEED[fn]})
    FNSHAS = {k[len("supabase/functions/"):]: sha(os.path.join(W, k)) for k in ALL}
    REC_SHA = sha(os.path.join(W, REC_REL)); REC = json.load(open(os.path.join(W, REC_REL)))
    OLD_DOC = subprocess.run(["git", "-C", W, "show", f"origin/main:{DOC_REL}"], capture_output=True).stdout.decode()
    # a main that moved on after the review (X changes step1-documents.ts) and one whose history has it but whose tip does not (Y reverts X)
    subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", W2, "HEAD"], check=True)
    NEWER_DOC = open(os.path.join(W2, DOC_REL)).read() + "\n// 704: a newer change merged after the review\n"
    open(os.path.join(W2, DOC_REL), "w").write(NEWER_DOC)
    g = lambda *a: subprocess.run(["git", "-C", W2, "-c", "user.name=t705", "-c", "user.email=t705@example.invalid"] + list(a), capture_output=True, text=True, check=True).stdout.strip()
    g("commit", "-q", "-am", "t705 newer"); MAIN_X = g("rev-parse", "HEAD")
    g("revert", "--no-edit", "HEAD"); MAIN_Y = g("rev-parse", "HEAD")

    # the REAL step1-sign preview, served by node from a copy of this build (a fake database it never reads)
    FNCOPY = os.path.join(tmp, "fncopy"); shutil.copytree(FNROOT, FNCOPY)
    src = open(os.path.join(FNCOPY, "step1-sign", "index.ts")).read()
    src = re.sub(r"(?m)^import \{ createClient \} from .*$", "const createClient = () => { throw new Error('no database in the preview') }", src)
    open(os.path.join(FNCOPY, "step1-sign", "_t705.ts"), "w").write(src)
    open(os.path.join(tmp, "pv.mjs"), "w").write(f"""
import http from 'http'
globalThis.Deno = {{ env: {{ get: () => '' }}, serve: () => {{}} }}
const M = await import({json.dumps(os.path.join(FNCOPY, "step1-sign", "_t705.ts"))})
const D = await import({json.dumps(os.path.join(FNCOPY, "_shared", "step1-documents.ts"))})
const s = http.createServer((req, res) => {{ let b = ''; req.on('data', (c) => b += c); req.on('end', async () => {{
  const body = JSON.parse(b || '{{}}'); let out
  if (body.__rules) {{ const C = await import({json.dumps(os.path.join(FNCOPY, "_shared", "step1-crypto.ts"))}); const O = await import({json.dumps(os.path.join(FNCOPY, "_shared", "optout.ts"))}); const T = await import({json.dumps(os.path.join(FNCOPY, "_shared", "test-people.ts"))})
    out = body.__rules.map((x) => ({{ practice: C.practiceOffer(x.o) || O.practicePerson(x.o.phone, x.o.email), test: T.testPerson(x.st, x.o) }})) }}
  else out = await M.preview(body)
  res.end(JSON.stringify(out)) }}) }})
s.listen(0, '127.0.0.1', () => console.log(s.address().port))
""")
    node = subprocess.Popen(["node", os.path.join(tmp, "pv.mjs")], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    PV = f"http://127.0.0.1:{node.stdout.readline().strip()}"
    def real_preview(body):
        r = urllib.request.urlopen(urllib.request.Request(PV, data=json.dumps(body).encode(), method="POST"), timeout=60); return json.loads(r.read())

    S = {}; M = {}
    def base_ops(**extra):
        ops = {k: False for k in SWITCHES}; ops["orient_remind_live"] = True
        ops["other_setting"] = {"keep": [1, 2, 3]}; ops["company_holidays"] = [{"date": "2026-11-26", "name": "Thanksgiving"}]
        ops["test_people"] = {"phones": ["(417) 555-7777"], "emails": ["owner@mo-care.com"]}
        ops.update(extra); return ops
    REAL = {"offered_by": "Katlin", "last_name": "Lee", "phone": "4175550101", "email": "ava@example.com", "path": "old"}
    PRACT = [{"offered_by": "Slice 10 practice run", "last_name": "Practice", "phone": "4175550101", "email": "x@example.com", "path": "old"},
             {"offered_by": "Katlin", "last_name": "Doe (TRAINING)", "phone": "4175550102", "email": "y@example.com", "path": "old"},
             {"offered_by": "Katlin", "last_name": "Practice", "phone": "(417) 555-0183", "email": "pat@practice.invalid", "path": "old"},
             {"offered_by": "Katlin", "last_name": "Owner", "phone": "417-555-7777", "email": "OWNER@mo-care.com", "path": "old"}]
    def reset(**m):
        S.clear(); S.update(sql=[], trn=[], posts=[], patches=[], ops_reads=0, sd_writes=0, offer_reads=0, autolog=[])
        M.clear(); M.update(dict(vj={"step1-sign": False, "driver-compliance": False}, ops=base_ops(), ver=7, offers=[], offers_later=None, trigger=1, trn_fail=False,
                                 real_started=0, notlive=set(), reset_gateway=False, preview="real", switch_flips=False, patched=set(), conflicts=0,
                                 sd_by_other=False, upsert_fail=False, log_fail=False), **m)
    CLI_LOG = os.path.join(tmp, "cli.log"); STATE = os.path.join(tmp, "state.json")
    dlines = lambda: [l for l in (open(CLI_LOG).read().splitlines() if os.path.exists(CLI_LOG) else []) if l.startswith("functions deploy")]
    deployed = lambda: [l.split()[2] for l in dlines()]
    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def _send(self, code, obj):
            b = obj if isinstance(obj, bytes) else json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
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
                return self._send(200, {"version": 20 + len(dl), "verify_jwt": vj})
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
                    live = "step1-sign" in deployed()
                    if M["preview"] == "stale" or not live:   # the old live build: nothing approved for real, no approval check (it answers the whole preview)
                        j = real_preview({})
                        for f in j.get("forms") or []: f["approved_for_real"] = False
                    return self._send(200, j)
                return self._send(404, {})
            q = body["query"]
            if "/projects/rdqujxiycycwhskyvrwa/" in p:
                S["trn"].append(q)
                if M["trn_fail"]: return self._send(400, {"message": "ERROR: could not connect"})
                if "trg_job_offers_path_permanent" in q: return self._send(200, [{"n": M["trigger"]}])
                if "from public.job_offers o" in q:
                    S["offer_reads"] += 1
                    rows = M["offers"] if (S["offer_reads"] == 1 or M["offers_later"] is None) else M["offers_later"]
                    return self._send(200, [{"today": TODAY, "tomorrow": TOMORROW, "offers_json": [dict(o, id=f"o{i}") for i, o in enumerate(rows)]}])
                return self._send(400, {"message": "unexpected Training query " + q[:120]})
            S["sql"].append(q)
            if q == "select data, version from public.app_data where key = 'ops_settings'":
                S["ops_reads"] += 1; d = json.loads(json.dumps(M["ops"]))
                if M["switch_flips"] and S["ops_reads"] > 2: d["step1_auto_live"] = True
                if M["sd_by_other"] and S["ops_reads"] > 1: M["ops"]["onboarding_switch_date"] = "2026-10-20"; d["onboarding_switch_date"] = "2026-10-20"
                return self._send(200, [{"data": d, "version": M["ver"]}])
            mm = re.match(r"update public\.app_data set data = jsonb_set\(data, '\{onboarding_switch_date\}', to_jsonb\('(\d{4}-\d\d-\d\d)'::text\), true\) where key = 'ops_settings' and version = (\d+) and jsonb_typeof\(data\) = 'object' and coalesce\(data->>'onboarding_switch_date', ''\) = '' returning version, data->>'onboarding_switch_date' as sd, to_char\(clock_timestamp\(\) at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\.MS\"Z\"'\) as written_at$", q)
            if mm:
                if M["conflicts"] > 0: M["conflicts"] -= 1; M["ver"] += 1; M["ops"]["someone_else"] = M["ver"]; return self._send(200, [])
                if int(mm.group(2)) != M["ver"] or M["ops"].get("onboarding_switch_date"): return self._send(200, [])
                M["ops"]["onboarding_switch_date"] = mm.group(1); M["ver"] += 1; S["sd_writes"] += 1
                return self._send(200, [{"version": M["ver"], "sd": mm.group(1), "written_at": "2026-10-13T21:04:05.678Z"}])
            mm = re.match(r"select public\.upsert_app_data_item\('automation_log', '(.*)'::jsonb\)$", q, re.S)
            if mm:
                if M["upsert_fail"]: return self._send(400, {"message": "ERROR: permission denied"})
                S["autolog"].append(json.loads(mm.group(1).replace("''", "'"))); return self._send(200, [{"upsert_app_data_item": None}])
            mm = re.match(r"update public\.app_data set data = coalesce\(data, '\[\]'::jsonb\) \|\| jsonb_build_array\('(.*)'::jsonb\) where key = 'automation_log'", q, re.S)
            if mm:
                if M["log_fail"]: return self._send(400, {"message": "ERROR: nope"})
                S["autolog"].append(json.loads(mm.group(1).replace("''", "'"))); return self._send(200, [{"key": "automation_log"}])
            if "from public.step1_forms" in q and "real_started" in q: return self._send(200, [{"practice": 3, "real": M["real_started"], "real_started": M["real_started"]}])
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
    def run(env_over=None, override=None, **mode):
        reset(**mode); rep = os.path.join(tmp, "r.txt")
        for f in (CLI_LOG, rep):
            if os.path.exists(f): os.remove(f)
        open(CLI_LOG, "w").close()
        json.dump({"root": W, "need": NEED, "override": override or {}}, open(STATE, "w"))
        env = dict(os.environ, PATH=FAKEBIN + ":/usr/bin:/bin", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"),
                   SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(FNSHAS), SB_REC_SHA=REC_SHA, PYTHONPATH=W, SB_STEP="705")
        env.update(env_over or {})
        p = subprocess.run(["python3", os.path.join(W, "golive_hub_705.py")], env=env, capture_output=True, text=True, timeout=900, cwd=tmp)
        return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
    writes = lambda: [q for q in S["sql"] if re.match(r"(?i)\s*(update|insert|delete|select public\.upsert)", q)]
    nothing_changed = lambda: not writes() and not deployed() and S["sd_writes"] == 0 and not S["autolog"]

    # ── what the step deploys, and the rules it copies ──
    g_ = subprocess.run(["git", "-C", W, "grep", "-l", "-E", "APPROVED_FOR_REAL|approvedForReal|allApprovedForReal|approvedAt", "--", "supabase/functions"], capture_output=True, text=True).stdout.split()
    users = sorted({x.split("/")[2] for x in g_ if not x.startswith("supabase/functions/_shared/")})
    shared_users = sorted(x for x in g_ if x.startswith("supabase/functions/_shared/") and not x.endswith("step1-documents.ts"))
    ck("the step deploys exactly the services that use the approval (git grep): step1-sign and driver-compliance; no shared helper uses it",
       users == sorted(FNS) and not shared_users and re.search(r'FNS = \["step1-sign", "driver-compliance"\]', open(os.path.join(W, "golive_hub_705.py")).read()), [users, shared_users])
    cases = [{"o": dict(REAL), "st": base_ops()}] + [{"o": dict(o), "st": base_ops()} for o in PRACT] + [
        {"o": {"offered_by": "Training walkthrough", "last_name": "X", "phone": "", "email": ""}, "st": {}},
        {"o": {"offered_by": "K", "last_name": "X", "phone": "4175550189", "email": "a@example.com"}, "st": {}},
        {"o": {"offered_by": "K", "last_name": "X", "phone": "", "email": "a@sub.practice.invalid"}, "st": {}},
        {"o": {"offered_by": "K", "last_name": "X", "phone": "4175557777", "email": ""}, "st": base_ops()},
        {"o": {"offered_by": "K", "last_name": "X", "phone": "4175557777", "email": "other@example.com"}, "st": base_ops()},
        {"o": {"offered_by": "K", "last_name": "X", "phone": "", "email": ""}, "st": base_ops()}]
    ts = real_preview({"__rules": cases})
    os.environ["SB_REPORT"] = os.path.join(tmp, "unused.txt"); os.environ["SB_FNROOT"] = FNROOT
    lib = open(os.path.join(W, "golive_hub_705.py")).read(); body = lib[lib.index("PRACTICE_OFFERS = "):lib.index("def hist_shas")]
    ns = {"re": re}; exec(body, ns)
    py = [{"practice": ns["practice_offer"](c["o"]) or ns["practice_person"](c["o"].get("phone"), c["o"].get("email")), "test": ns["test_person"](c["st"], c["o"].get("phone"), c["o"].get("email"))} for c in cases]
    ck("the step's practice, training and test-people rules give the same answer as the TypeScript (practiceOffer, practicePerson, testPerson) on every case", py == ts, [py, ts])

    # ── the clean run: no real offer today ──
    c, out = run(offers=list(PRACT))
    if os.environ.get("T705_SHOW"): print(out)
    ck("clean run: exit 0, RESULT: DONE", c == 0 and "RESULT: DONE" in out, out)
    ck("only step1-sign and driver-compliance deploy, in that order, each keeping its gateway setting (both off)", deployed() == FNS and all("--no-verify-jwt" in l for l in dlines()), dlines())
    ck("no real offer today (practice, training and test people only): the switch date is TODAY in Central time, and the report says why",
       M["ops"].get("onboarding_switch_date") == TODAY and f"the switch date is {TODAY} (today: no real offer was saved today); written at 2026-10-13T21:04:05.678Z (UTC)" in out
       and f"offers saved today ({TODAY}, Central time): 4 (0 real, 3 practice or training, 1 from your test list)" in out, [M["ops"].get("onboarding_switch_date"), out])
    sdq = [q for q in S["sql"] if "onboarding_switch_date" in q and q.startswith("update")]
    ck("the date is one compare-and-save write of that one key (jsonb_set on onboarding_switch_date, on the version read, only while it is blank); every other key untouched",
       S["sd_writes"] == 1 and len(sdq) == 1 and "where key = 'ops_settings' and version = 7" in sdq[0] and {k: v for k, v in M["ops"].items() if k != "onboarding_switch_date"} == base_ops(), [sdq, M["ops"]])
    ck("the only database writes: the date and one automation log line (no other key, no table, no switch)",
       len(writes()) == 2 and writes()[0] == sdq[0] and writes()[1].startswith("select public.upsert_app_data_item('automation_log'"), writes())
    al = S["autolog"][0] if S["autolog"] else {}
    ck("the go-live moment is in the automation log: onboarding_go_live, the exact UTC time, the date, the rule, the approval",
       len(S["autolog"]) == 1 and al.get("automation") == "onboarding_go_live" and al.get("at") == "2026-10-13T21:04:05.678Z" and al["summary"]["switch_date"] == TODAY
       and al["summary"]["real_offers_today"] == 0 and "approve step 1 forms" in al["summary"]["approval"] and al["summary"]["forms_approved"] == 13
       and "the go-live moment is in the automation log (onboarding_go_live, 2026-10-13T21:04:05.678Z)" in out, [al, out])
    ck("PART 1: the record, the live version and gateway, the live Step 1 today (0 approved), the date not set, the switches, the Training guard, the Step 1 records",
       all(s in out for s in ["the approval record is the reviewed build: Samantha, 2026-10-13 3:09 pm Central, \"approve step 1 forms\", wording page v5, 13 forms",
                                "step1-sign is live at version 20 (gateway sign-in check off) and is already this build", "the live Step 1 today: 13 forms, 0 approved for real applicants",
                                "the switch date is not set yet", "orient_remind_live on", "hepb_offer_live off", "trg_job_offers_path_permanent is on",
                                "Step 1 records: 3 practice, 0 real", "main holds no newer version"]), out)
    ck("PART 3 (the real step1-sign preview code): 13 forms, 12 to sign, every form at the approved version and fingerprint, approved versions accepted and next versions refused",
       all(s in out for s in ["the Step 1 preview answers with 13 forms, 12 to sign", "every form is approved for real at the version and wording fingerprint Samantha approved",
                                "a real applicant may sign each approved version, and the next version of every form is refused"]), out)
    acq = [b for f, _, b in S["posts"] if b.get("approval_check")]
    ck("the approval check asks the 13 approved versions and the 13 next versions", len(acq) == 1 and len(acq[0]["approval_check"]) == 26
       and all(x["version"] == {f["key"]: f["version"] for f in REC["forms"]}[x["form"]] for x in acq[0]["approval_check"][:13]), acq)
    ck("PART 3: the live outreach-check rule on the stored date: 'old' the day before, 'new' on and after; both services live as tested; no switch changed; nothing sent",
       all(s in out for s in [f"answers path 'old' for an offer dated 2026-10-12 and 'new' for {TODAY} and {TOMORROW}", "step1-sign is live as tested (version 21, gateway sign-in check off, as before)",
                                "driver-compliance is live as tested (version 21, gateway sign-in check off, as before)", "no switch changed", "nothing was sent"]), out)
    ck("her lines: real applicants can sign the 12 approved forms; new offers from the date use the new path, offers already sent keep the old path",
       "✓ real applicants can now sign the 12 approved forms" in out and f"✓ new offers from {TODAY} use the new path; offers already sent keep the old path" in out
       and "still off (practice until you turn them on, Owners Hub Admin page): offer_send_live" in out, out)
    ck("only the read-only Step 1 preview is called, as a visitor (the public key); never any other service", S["posts"] and all(f == "step1-sign" and b.get("action") == "preview" and a == "Bearer eyJanonKEY" for f, a, b in S["posts"]), S["posts"])
    ck("no key or token printed; no em dash in the report or the step's files; never 'plain language'",
       "sbp_test" not in out and "eyJanonKEY" not in out and "eyJsvcKEY" not in out and "—" not in out and "plain language" not in out.lower()
       and all("—" not in open(os.path.join(W, f)).read() for f in ["golive_hub_705.py", REC_REL]), out)
    ck("the offers are read from the Training Platform (the set-once guard and today's offers), never written", S["trn"] and all(q.lstrip().lower().startswith(("select", "with")) for q in S["trn"]), S["trn"])

    # ── the date rule ──
    c, out = run(offers=[dict(REAL)] + PRACT)
    ck("a real offer already saved today: the switch date is TOMORROW, and the report says why", c == 0 and M["ops"].get("onboarding_switch_date") == TOMORROW
       and f"the switch date is {TOMORROW} (tomorrow: 1 real offer(s) were already saved today)" in out and f"✓ new offers from {TOMORROW} use the new path" in out
       and f"answers path 'old' for an offer dated {TODAY} and 'new' for {TOMORROW}" in out, out)
    c, out = run(offers=[], offers_later=[dict(REAL)])
    ck("a real offer saved between PART 1 and the write: decided again right before writing, so TOMORROW", c == 0 and M["ops"].get("onboarding_switch_date") == TOMORROW
       and f"the switch date will be {TODAY}" in out and f"the switch date is {TOMORROW}" in out, out)
    c, out = run(offers=[dict(REAL, path="new")])
    ck("a real offer already on the new path before the date: reported, not a stop", c == 0 and "already on the new path, before the switch date" in out, out)

    # ── stops before anything changes ──
    c, out = run(ops=base_ops(onboarding_switch_date="2026-10-20"))
    ck("the switch date already set: STOP before any change", c == 3 and "the switch date is already set (2026-10-20)" in out and nothing_changed(), out)
    c, out = run(trigger=0)
    ck("the Training Platform's set-once path guard missing: STOP before any change", c == 3 and "trg_job_offers_path_permanent) is missing or off" in out and nothing_changed(), out)
    c, out = run(trn_fail=True)
    ck("the Training Platform's offers cannot be read: STOP before any change", c == 3 and "could not read" in out and nothing_changed(), out)
    c, out = run(override={"step1-sign": {"supabase/functions/step1-sign/index.ts": "// someone's unmerged work\n" + open(os.path.join(W, "supabase/functions/step1-sign/index.ts")).read()}})
    ck("a live file never on main: STOP before any change", c == 3 and "step1-sign's live copy holds step1-sign/index.ts in a version that was never on main" in out and nothing_changed(), out)
    c, out = run(override={"driver-compliance": {"supabase/functions/_shared/someones-new-file.ts": "export const x = 1\n"}})
    ck("a live file this build does not use and main never had: STOP before any change", c == 3 and "someones-new-file.ts" in out and nothing_changed(), out)
    c, out = run(env_over={"SB_MAIN_REF": MAIN_X})
    ck("main changed a file these services use after the review (for example 704 merged first): STOP, nothing runs", c == 2 and "main has newer versions of _shared/step1-documents.ts" in out and nothing_changed() and not S["sql"], out)
    c, out = run(env_over={"SB_MAIN_REF": MAIN_Y}, override={"step1-sign": {DOC_REL: NEWER_DOC}})
    ck("a live file NEWER than this build (deployed from main after the review): STOP before any change, it would be rolled back",
       c == 3 and "step1-sign's live copy holds _shared/step1-documents.ts in a version newer than this build" in out and nothing_changed(), out)
    c, out = run(notlive={"driver-compliance"})
    ck("a service not live at all: STOP before any change", c == 3 and "driver-compliance is not live at all" in out and nothing_changed(), out)

    # ── older live files are brought up to date ──
    c, out = run(override={"step1-sign": {DOC_REL: OLD_DOC}, "driver-compliance": {DOC_REL: OLD_DOC}})
    ck("the live services hold the pre-approval step1-documents.ts (main before this PR): named as older, deployed, DONE",
       c == 0 and "older versions (from this build's own history) of _shared/step1-documents.ts" in out and deployed() == FNS and "RESULT: DONE" in out, out)
    k0 = NEED["driver-compliance"][-1]
    c, out = run(override={"driver-compliance": {k0: None}})
    ck("a file missing from the live copy: built before it used it, deployed, DONE", c == 0 and "built before it used " + "/".join(k0.split("/")[-2:]) in out and deployed() == FNS, out)

    # ── pins ──
    c, out = run(env_over={"SB_FN_SHAS": json.dumps({k: v for k, v in FNSHAS.items() if k != "_shared/step1-documents.ts"})})
    ck("a needed file not pinned: STOP, no query at all", c == 2 and "not pinned" in out and not S["sql"] and not S["trn"], out)
    c, out = run(env_over={"SB_FN_SHAS": json.dumps(dict(FNSHAS, **{"step1-sign/index.ts": "0" * 64}))})
    ck("a service file that is not the reviewed build: STOP, no query at all", c == 2 and not S["sql"], out)
    c, out = run(env_over={"SB_REC_SHA": "0" * 64})
    ck("the approval record not the reviewed build: STOP, no query at all", c == 2 and "approval record" in out and not S["sql"], out)

    # ── the write ──
    c, out = run(conflicts=2)
    ck("someone saving the settings at the same moment: read again, saved on the fresh version, their change kept", c == 0 and S["sd_writes"] == 1 and M["ops"].get("someone_else") == 9 and M["ops"]["onboarding_switch_date"] == TODAY, [M["ops"], out])
    c, out = run(conflicts=9)
    ck("the settings never settling: the date is NOT set, reported, no log line", c == 7 and S["sd_writes"] == 0 and "the switch date was not set" in out and "switch date is NOT set" in out and not S["autolog"], out)
    c, out = run(sd_by_other=True)
    ck("someone sets the date between PART 1 and the write: left alone, reported", c == 7 and M["ops"]["onboarding_switch_date"] == "2026-10-20" and S["sd_writes"] == 0 and "set by someone else meanwhile (2026-10-20)" in out, out)
    c, out = run(upsert_fail=True)
    ck("the log helper refused: the line goes straight onto the automation log list instead, DONE", c == 0 and len(S["autolog"]) == 1 and "go-live moment is in the automation log" in out, out)
    c, out = run(upsert_fail=True, log_fail=True)
    ck("the log cannot be written at all: reported with the exact time (never silent); the date stays set", c == 9 and "could not be added to the automation log" in out and "2026-10-13T21:04:05.678Z UTC" in out and M["ops"]["onboarding_switch_date"] == TODAY, out)

    # ── the gateway ──
    c, out = run(reset_gateway=True)
    ck("a deploy that turns the gateway back on is put back to off, for these two only", c == 0 and sorted(S["patches"]) == [("driver-compliance", {"verify_jwt": False}), ("step1-sign", {"verify_jwt": False})], [S["patches"], out])
    c, out = run(vj={"step1-sign": False, "driver-compliance": True})
    ck("the gateway setting is read per service, never assumed", c == 0 and [("--no-verify-jwt" in l) for l in dlines()] == [True, False], dlines())

    # ── reported, not clean ──
    c, out = run(preview="stale")
    ck("the preview not showing the approval after the deploy: reported", c == 9 and "not live at the approved version and wording" in out and "approval check answered" in out, out)
    c, out = run(override={"outreach-check": {OUT_REL: "// a hand deploy\n" + open(os.path.join(W, OUT_REL)).read()}})
    ck("the live outreach-check not main's code: reported (the path proof cannot be trusted)", c == 9 and "the live outreach-check is not main's code" in out, out)
    c, out = run(switch_flips=True)
    ck("a switch changing during the step: reported", c == 9 and "these switches changed during the step: step1_auto_live" in out, out)
    c, out = run(real_started=2)
    ck("real Step 1 records before the switch date: reported, not a stop", c == 0 and "2 real Step 1 record(s) already started" in out, out)
finally:
    if node: node.kill()
    for w in (W, W2): subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", w], capture_output=True)
    shutil.rmtree(tmp, ignore_errors=True)
failed = [r for r in res if not r[1]]
for n, ok, note in res: print(("PASS  " if ok else "FAIL  ") + n + ("" if ok else "\n      " + note))
print(f"\n{len(res) - len(failed)}/{len(res)} passed" + (" · FAIL" if failed else ""))
raise SystemExit(1 if failed else 0)
