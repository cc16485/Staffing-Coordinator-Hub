#!/usr/bin/env python3
# Rehearsal of 703 (golive_hub_703.py) against a FAKE Supabase (management API, the services) and a FAKE supabase CLI.
# Never touches a real project. Runs the installer from a fresh detached worktree of HEAD (never ../ sibling folders).
#   python3 golive_hub_703_install_test.py        (T703_SHOW=1 prints the clean run's report)
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
FNS = ["step1-sign", "hire-profile", "bg-review", "reference-tasks", "caregiver-journey", "step2-handoff", "welcome-call", "reference-send",
       "offer-sign", "caregiver-export", "onboarding-permissions", "coverage-run", "coverage-shifts", "team-ask", "profile-check", "match-dark",
       "driver-compliance", "drug-test", "hepb"]
NEW = {"driver-compliance": False, "drug-test": True, "hepb": False}
OLD = [f for f in FNS if f not in NEW]
SQLS = ["supabase/step1-link-tighten.sql", "supabase/onboarding-retention-700.sql", "supabase/step1-countersign.sql", "supabase/driver-compliance.sql",
        "supabase/step1-viventium-forms.sql", "supabase/welcome-rights-explained.sql", "supabase/drug-tests.sql", "supabase/hepb-vaccination.sql"]
GUARDED = {"supabase/onboarding-retention-700.sql": "onboarding_documents_keep", "supabase/driver-compliance.sql": "driver_documents_keep",
           "supabase/drug-tests.sql": "drug_test_docs_keep", "supabase/hepb-vaccination.sql": "hepb_documents_keep"}
SWITCHES = ["offer_send_live", "offer_reminders_live", "step1_auto_live", "step2_send_live", "step2_reminders_live", "wc_auto_invite_live",
            "orient_remind_live", "approve_work_text_live", "approve_work_axiscare_live", "axiscare_hire_date_live", "axiscare_level_live",
            "driver_reminders_live", "driver_link_send_live", "driver_schedule_gate_live", "hepb_offer_live"]
FP = "ab" * 32; OLD_FPS = ["11" * 32, "22" * 32]
CK_ITEMS = ["Offer letter signed in Viventium", "I-9 Section 1", "Federal W-4", "Missouri W-4", "Direct deposit", "Employee handbook acknowledged",
            "Participant rights acknowledged", "Code of ethics acknowledged", "Confidentiality and HIPAA acknowledged", "Driver license or ID uploaded", "Social Security card uploaded"]
CK_KEEP = [x for x in CK_ITEMS if x not in ("Participant rights acknowledged", "Code of ethics acknowledged", "Confidentiality and HIPAA acknowledged")]
CK_HIST = [{"version": 1, "items": ["Offer letter signed in Viventium", "I-9 Section 1"], "changed_at": "2026-10-01T10:00:00.000Z", "changed_by": "katlin@mo-care.com"}]
tmp = tempfile.mkdtemp(prefix="t703-"); W = os.path.join(tmp, "wt")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", W, "HEAD"], check=True)
try:
    sys.path.insert(0, W); os.environ.setdefault("SB_REPORT", os.path.join(tmp, "unused.txt"))
    from cc_step_lib import need
    FNROOT = os.path.join(W, "supabase", "functions")
    NEED = {fn: sorted(need(FNROOT, fn)) for fn in FNS}
    ALL = sorted({k for v in NEED.values() for k in v})
    FNSHAS = {k[len("supabase/functions/"):]: sha(os.path.join(W, k)) for k in ALL}
    SQLSHAS = {r: sha(os.path.join(W, r)) for r in SQLS}
    SRC = {r: open(os.path.join(W, r)).read() for r in SQLS}
    HEAD = {r: SRC[r][:300] for r in SQLS}
    assert len(set(HEAD.values())) == len(SQLS)
    OLDER = None
    for fn in OLD:
        for k in NEED[fn]:
            b = subprocess.run(["git", "-C", W, "show", f"origin/main:{k}"], capture_output=True).stdout
            if b and hashlib.sha256(b).hexdigest() != sha(os.path.join(W, k)): OLDER = (fn, k, b.decode()); break
        if OLDER: break
    S = {}; M = {}
    def base_ops(**extra):
        ops = {k: False for k in SWITCHES}; ops["orient_remind_live"] = True
        ops["other_setting"] = {"keep": [1, 2, 3]}; ops["company_holidays"] = [{"date": "2026-11-26", "name": "Thanksgiving"}]
        ops["viventium_step2_checklist"] = {"version": 2, "items": list(CK_ITEMS), "changed_at": "2026-10-05T15:00:00.000Z", "changed_by": "samantha@mo-care.com", "history": list(CK_HIST)}
        ops.update(extra); return ops
    def reset(**m):
        S.clear(); S.update(sql=[], posts=[], patches=[], files=[], ops_reads=0, ck_writes=0, sched={})
        M.clear(); M.update(dict(vj={fn: fn != "step1-sign" for fn in OLD}, ops=base_ops(), ver=7, rules=list(OLD_FPS),
                                 jobs={"caregiver-journey-sweep": ("*/10 * * * *", True), "caregiver-audit-nightly": ("5 11 * * *", True), "step2-handoff-pass": ("*/15 * * * *", True)},
                                 trigger="ok", sqlfail=None, real_started=0, notlive=set(NEW), reset_gateway=False, probe="refused", preview_v=2, preview_forms=13,
                                 open_review=False, switch_flips=False, patched=set(), ck_conflicts=0, tables_open=None, new_open=None, vault=1, other_saves=False), **m)
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
            m = re.match(r"/v1/projects/\w+/functions/([\w-]+)$", p)
            if m:
                fn = m.group(1); dl = [l for l in dlines() if l.split()[2] == fn]
                if fn in M["patched"]: vj = M["vj"][fn]
                elif dl: vj = True if M["reset_gateway"] else ("--no-verify-jwt" not in dl[-1])
                elif fn in M["notlive"]: return self._send(404, {})
                else: vj = M["vj"][fn]
                return self._send(200, {"version": 10 + len(dl), "verify_jwt": vj})
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
                    forms = [{"key": f"form_{i}", "title": f"Form {i}", "version": 1, "layout": None} for i in range(M["preview_forms"] - 4)]
                    forms += [{"key": "fcra_disclosure", "title": "Permission for Background Checks and References", "version": M["preview_v"], "layout": None},
                              {"key": "employment_agreement", "title": "Employment Agreement", "version": 1, "layout": "document"},
                              {"key": "hipaa_privacy", "title": "HIPAA & the Privacy Rule", "version": 1, "layout": None},
                              {"key": "client_rights", "title": "Client Rights", "version": 1, "layout": None}]
                    return self._send(200, {"ok": True, "preview": True, "forms": forms, "form_count": M["preview_forms"] - 1})
                if fn == "step1-sign" and body.get("action") == "review": return self._send(200 if M["open_review"] else 401, {"ok": False, "error": "Sign in first."})
                if fn == "hire-profile": return self._send(401, {"error": "Sign in first."})
                if fn in NEW: return self._send(200 if M["new_open"] == fn else 401, {"ok": False, "error": "Sign in first."})
                return self._send(404, {})
            q = body["query"]; S["sql"].append(q)
            if "to_regprocedure('public.step1_candidate_create(text,jsonb)')" in q:
                return self._send(200, [{"fn": True, "forms": True, "objs": True, "bucket": 1, "view": False, "trig": 0, "rules": True, "defs": True, "wc": True, "vault": M["vault"]}])
            if q.startswith("select sha256 from public.rules_approved where file = 'match-rules.js'"): return self._send(200, [{"sha256": s_} for s_ in sorted(M["rules"])])
            if q.startswith("insert into public.rules_approved"):
                mm = re.search(r"values \('match-rules\.js', '([0-9a-f]{64})'", q)
                if mm and mm.group(1) not in M["rules"]: M["rules"].append(mm.group(1))
                return self._send(201, [])
            if "from cron.job j where j.jobname in" in q:
                return self._send(200, [{"jobname": j, "schedule": s_, "active": a, "last_status": "succeeded", "last_at": "2026-10-13 09:50:00+00"} for j, (s_, a) in M["jobs"].items()])
            mm = re.match(r"select cron\.unschedule\('([\w-]+)'\)", q)
            if mm: M["jobs"].pop(mm.group(1), None); return self._send(200, [])
            mm = re.match(r"select cron\.schedule\('([\w-]+)', '([^']+)', '(.*)'\) as id$", q, re.S)
            if mm: M["jobs"][mm.group(1)] = (mm.group(2), True); S["sched"][mm.group(1)] = mm.group(3).replace("''", "'"); return self._send(200, [{"id": 99}])
            if q.startswith("select jobname, schedule, active from cron.job where jobname in"):
                return self._send(200, [{"jobname": j, "schedule": s_, "active": a} for j, (s_, a) in M["jobs"].items() if j in ("driver-compliance-pass", "hepb-pass")])
            if q == "select data, version from public.app_data where key = 'ops_settings'":
                S["ops_reads"] += 1; d = json.loads(json.dumps(M["ops"]))
                if M["switch_flips"] and S["ops_reads"] > 1: d["step1_auto_live"] = True
                return self._send(200, [{"data": d, "version": M["ver"]}])
            mm = re.match(r"update public\.app_data set data = jsonb_set\(data, '\{viventium_step2_checklist\}', '(.*)'::jsonb, true\) where key = 'ops_settings' and version = (\d+) returning version$", q, re.S)
            if mm:
                if M["ck_conflicts"] > 0:
                    M["ck_conflicts"] -= 1; M["ver"] += 1; M["ops"]["someone_else"] = M["ver"]; return self._send(200, [])  # someone saved in between
                if int(mm.group(2)) != M["ver"]: return self._send(200, [])
                M["ops"]["viventium_step2_checklist"] = json.loads(mm.group(1).replace("''", "'")); M["ver"] += 1; S["ck_writes"] += 1
                return self._send(200, [{"version": M["ver"]}])
            if "from public.step1_forms" in q and "real_started" in q: return self._send(200, [{"practice": 3, "real": M["real_started"], "real_started": M["real_started"]}])
            for r in SQLS:
                if q.startswith(HEAD[r]):
                    full = q == SRC[r]; S["files"].append((r, "full" if full else "rest"))
                    if M["sqlfail"] == r: return self._send(400, {"message": "ERROR: 42P01: relation \"public.something\" does not exist"})
                    if M["trigger"] == "perm" and re.search(r"create trigger \w+ before [^;]*? on storage\.objects", q):
                        return self._send(400, {"message": "ERROR: 42501: must be owner of table objects"})
                    return self._send(201, [])
            if "703_PROBE_RESULT" in q:
                msg = {"refused": "Signed onboarding documents are kept for seven years and cannot be deleted (_703_probe/x.pdf).", "deleted": "deleted"}[M["probe"]]
                return self._send(400, {"message": f"ERROR: P0001: 703_PROBE_RESULT: {msg}"})
            if "starts_with(name, '_703_probe/')" in q: return self._send(200, [{"n": 0}])
            if "has_function_privilege" in q: return self._send(200, [{"a": False, "b": False}])
            if "from public.onboarding_retention" in q: return self._send(200, [{"n": 3, "dated": 3}])
            if "from unnest(array[" in q:
                ts = re.findall(r"'(\w+)'", q[q.find("unnest(array["):])
                return self._send(200, [{"t": t, "here": True, "browser": t == M["tables_open"], "cs": 2} for t in ts])
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
                   SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(FNSHAS), SB_SQL_SHAS=json.dumps(SQLSHAS), SB_RULES_FP=FP, PYTHONPATH=W, SB_STEP="703")
        env.update(env_over or {})
        p = subprocess.run(["python3", os.path.join(W, "golive_hub_703.py")], env=env, capture_output=True, text=True, timeout=900, cwd=tmp)
        return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
    changed_db = lambda: bool(S["files"]) or any(q.startswith("insert into public.rules_approved") or "cron.schedule(" in q or q.startswith("update public.app_data") for q in S["sql"])
    nothing_changed = lambda: not changed_db() and not deployed() and S["ck_writes"] == 0
    writes_switch = lambda: any(re.search(r"(?i)update public\.app_data|insert into public\.app_data|upsert_app_data_item", q) and "ops_settings" in q and "viventium_step2_checklist" not in q for q in S["sql"])

    # ── the clean run ──
    c, out = run()
    if os.environ.get("T703_SHOW"): print(out)
    ck("clean run: exit 0, ends with RESULT: DONE then NEXT: merge the Hub pull request", c == 0 and "RESULT: DONE" in out and out.strip().splitlines()[-1] == "NEXT: merge the Hub pull request.", out)
    ck("the eight SQL files ran in order, each the reviewed file byte for byte", S["files"] == [(r, "full") for r in SQLS] and all(any(q == SRC[r] for q in S["sql"]) for r in SQLS), S["files"])
    order = [("sql" if any(q.startswith(HEAD[r]) for r in SQLS) else "rules" if q.startswith("insert into public.rules_approved") else "ck" if q.startswith("update public.app_data") else "cron" if "cron.schedule(" in q else None) for q in S["sql"]]
    order = [o for o in order if o]
    ck("order: SQL, then the rules approval, then the checklist, then (after the deploys) the two schedules", order == ["sql"] * 8 + ["rules", "ck", "cron", "cron"] and deployed() == FNS, [order, deployed()])
    ck("all nineteen services deploy, in the given order", deployed() == FNS, deployed())
    ck("the three new services are allowed to be not live yet (404) and are named new", all(f"{fn} is new (not live yet)" in out for fn in NEW), out)
    dl = dlines()
    ck("verify_jwt: step1-sign (live off) and the new driver-compliance and hepb deploy with --no-verify-jwt; drug-test and every other service (live on) without",
       {l.split()[2] for l in dl if "--no-verify-jwt" in l} == {"step1-sign", "driver-compliance", "hepb"} and len(dl) == 19, dl)
    ck("the proofs say each service is live as tested with its gateway setting (as before / as designed)",
       "step1-sign is live as tested (version 11, gateway sign-in check off, as before)" in out and "drug-test is live as tested (version 11, gateway sign-in check on, as designed)" in out
       and "driver-compliance is live as tested (version 11, gateway sign-in check off, as designed)" in out and "hepb is live as tested (version 11, gateway sign-in check off, as designed)" in out, out)
    ck("the match rules approval: the new fingerprint inserted for match-rules.js, the two older ones kept and proved",
       FP in M["rules"] and all(f in M["rules"] for f in OLD_FPS) and any(f"('match-rules.js', '{FP}'" in q and "on conflict (file, sha256) do update" in q for q in S["sql"])
       and "2 match-rules.js fingerprint(s) already approved" in out and f"hold the new fingerprint ({FP[:12]}) and the 2 older one(s)" in out, [M["rules"], out])
    ck_now = M["ops"]["viventium_step2_checklist"]
    ck("the checklist is rewritten: version 3, the three items out, every other item exactly and in order", ck_now["version"] == 3 and ck_now["items"] == CK_KEEP, ck_now)
    ck("the checklist history mirrors the Admin page: the old history plus version 2 as it was, changed_at as an ISO time, changed_by named",
       ck_now["history"] == CK_HIST + [{"version": 2, "items": CK_ITEMS, "changed_at": "2026-10-05T15:00:00.000Z", "changed_by": "samantha@mo-care.com"}]
       and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", ck_now["changed_at"]) and ck_now["changed_by"].startswith("703") and set(ck_now) == {"version", "items", "changed_at", "changed_by", "history"}, ck_now)
    ck("only that one setting is written (jsonb_set on viventium_step2_checklist, compare-and-save on the version); every other ops_settings key is untouched",
       S["ck_writes"] == 1 and M["ops"]["other_setting"] == {"keep": [1, 2, 3]} and M["ops"]["company_holidays"] == [{"date": "2026-11-26", "name": "Thanksgiving"}]
       and all(M["ops"][k] == base_ops()[k] for k in SWITCHES) and not writes_switch(), M["ops"])
    ck("PART 1 prints the checklist and marks what comes out; PART 3 proves the new version",
       "the Viventium Step 2 checklist, version 2 (11 items):" in out and "(comes out) Code of ethics acknowledged" in out and "      I-9 Section 1" in out
       and "the Viventium Step 2 checklist reads version 3 with 8 items" in out, out)
    sc = S["sched"]
    ck("the two schedules: every 30 minutes, POST {\"action\": \"pass\"} to their own service with the Vault's x-cron-secret; proved on",
       set(sc) == {"driver-compliance-pass", "hepb-pass"} and all(f"/functions/v1/{fn}'" in sc[j] and "'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'hub_job_secret')" in sc[j]
                                                                 and "body := '{\"action\": \"pass\"}'::jsonb" in sc[j] for j, fn in [("driver-compliance-pass", "driver-compliance"), ("hepb-pass", "hepb")])
       and M["jobs"]["driver-compliance-pass"] == ("*/30 * * * *", True) and "driver-compliance-pass is on, every */30 * * * *" in out and "hepb-pass is on, every */30 * * * *" in out, [sc, out])
    pq = [q for q in S["sql"] if "703_PROBE_RESULT" in q]
    ck("the retention probe: one DO block on onboarding-documents/_703_probe/x.pdf that always raises (so it always rolls back), then a check that no probe is left",
       len(pq) == 1 and pq[0].startswith("do $p$") and "'onboarding-documents'" in pq[0] and "'_703_probe/x.pdf'" in pq[0] and pq[0].rstrip().endswith("raise exception '703_PROBE_RESULT: %', m; end $p$")
       and "kept for seven years" in out and "no probe is left in storage" in out, pq)
    ck("the proofs: server only, the view reads, the preview (13 forms, 12 to sign, background form v2, Client Rights, Employment Agreement as a document), review and hire profile refuse a visitor",
       all(s in out for s in ["step1_candidate_create is server only", "the retention view reads (3 Step 1 records", "the Step 1 preview answers with 13 forms (12 to sign",
                                "\"Permission for Background Checks and References\" version 2", "Step 1 review refuses a visitor", "hire profile refuses a visitor"]), out)
    ck("driver-compliance, drug-test and hepb each refuse a visitor's office call (401)", all(f"{fn} refuses an office call from a visitor who is not signed in (401)" in out for fn in NEW)
       and all(any(f_ == fn and b_ == {"action": "get"} for f_, _, b_ in S["posts"]) for fn in NEW), out)
    ck("the new tables and the company signature columns are proved in and closed to browsers", "the driver, drug test and hepatitis B tables and the company signature columns are in; a visitor or a signed-in page can reach none of them" in out, out)
    ck("the services are called as a visitor (the public key), never the server key", S["posts"] and all(a == "Bearer eyJanonKEY" for _, a, _ in S["posts"]), S["posts"])
    ck("the onboarding cron jobs are reported with their last run", "caregiver-journey-sweep is on, every */10 * * * *; last run 2026-10-13 09:50 (succeeded)" in out and "step2-handoff-pass is on" in out and "caregiver-audit-nightly is on, every 5 11 * * *" in out, out)
    ck("all fifteen switches are shown (driver and hepatitis B ones too), the switch date stays unset, no switch changed",
       "orient_remind_live on" in out and "driver_schedule_gate_live off" in out and "hepb_offer_live off" in out and "driver_reminders_live off" in out and "driver_link_send_live off" in out
       and "the switch date is still not set" in out and "no switch changed" in out and "onboarding_switch_date" not in M["ops"], out)
    ck("other services sharing a changed helper are named as not redeployed", "are NOT redeployed by this step" in out, out)
    ck("no key or token is printed (the cron command holds the public key; never shown); no em dash in the report or in the step's own files",
       "sbp_test" not in out and "eyJanonKEY" not in out and "eyJsvcKEY" not in out and "—" not in out
       and "—" not in open(os.path.join(W, "golive_hub_703.py")).read(), out)

    # ── the live-vs-history guard ──
    if OLDER:
        fn, k, b = OLDER
        c, out = run(override={fn: {k: b}})
        ck(f"a live file from main's own history ({k.split('/')[-1]} in {fn}) is just older: named, deployed, DONE", c == 0 and "RESULT: DONE" in out and "older versions (from main's own history) of " + "/".join(k.split("/")[-2:]) in out and fn in deployed(), out)
    else: ck("an older-from-main live file case was found to rehearse", False, "no function file differs from origin/main")
    k0 = NEED["match-dark"][0]
    c, out = run(override={"match-dark": {k0: None}})
    ck("a file missing from the live copy counts as older: named, deployed, DONE", c == 0 and "built before it used " + "/".join(k0.split("/")[-2:]) in out and "match-dark" in deployed(), out)
    k1 = "supabase/functions/step1-sign/index.ts"
    c, out = run(override={"step1-sign": {k1: "// someone's unmerged work\n" + open(os.path.join(W, k1)).read()}})
    ck("a live file in NO main history (someone's unmerged work): STOP before any change, names the service and the file; no SQL, no rules, no checklist, no deploy",
       c == 3 and "step1-sign's live copy holds step1-sign/index.ts in a version that was never on main" in out and "STOPPED before anything changed" in out and nothing_changed(), out)
    c, out = run(override={"team-ask": {"supabase/functions/_shared/someones-new-file.ts": "export const x = 1\n"}})
    ck("a live file this build does not use and main never had: STOP before any change", c == 3 and "someones-new-file.ts" in out and nothing_changed(), out)
    kh = "supabase/functions/hepb/index.ts"
    c, out = run(notlive={"driver-compliance", "drug-test"}, vj=dict({fn: fn != "step1-sign" for fn in OLD}, hepb=False), override={"hepb": {kh: "// a hand deploy\n" + open(os.path.join(W, kh)).read()}})
    ck("a 'new' service already live with code that was never on main: STOP before any change", c == 3 and "hepb's live copy holds hepb/index.ts in a version that was never on main" in out and nothing_changed(), out)
    c, out = run(notlive={"driver-compliance", "hepb"}, vj=dict({fn: fn != "step1-sign" for fn in OLD}, **{"drug-test": False}))
    ck("a 'new' service already live with the other gateway setting: STOP before any change", c == 3 and "drug-test is already live with the gateway sign-in check off, not as designed (on)" in out and nothing_changed(), out)
    c, out = run(notlive=set(NEW) | {"coverage-shifts"})
    ck("an existing service not live at all (404): STOP before any change, while the three new ones may be 404",
       c == 3 and "coverage-shifts is not live at all" in out and "driver-compliance is new (not live yet)" in out and nothing_changed(), out)

    # ── switches, schedules, vault ──
    c, out = run(ops=base_ops(onboarding_switch_date="2026-10-20"))
    ck("the switch date already set: STOP before any change", c == 3 and "the switch date is already set (2026-10-20)" in out and nothing_changed(), out)
    c, out = run(jobs={"caregiver-audit-nightly": ("5 11 * * *", True), "step2-handoff-pass": ("*/15 * * * *", True)})
    ck("a missing cron job (caregiver-journey-sweep): STOP before any change", c == 3 and "the schedule caregiver-journey-sweep does not exist" in out and nothing_changed(), out)
    c, out = run(jobs={"caregiver-journey-sweep": ("*/10 * * * *", True), "caregiver-audit-nightly": ("5 11 * * *", False), "step2-handoff-pass": ("*/15 * * * *", True)})
    ck("an inactive cron job: STOP before any change", c == 3 and "the schedule caregiver-audit-nightly is turned off" in out and nothing_changed(), out)
    c, out = run(jobs={"caregiver-journey-sweep": ("*/10 * * * *", True), "caregiver-audit-nightly": ("5 11 * * *", True), "step2-handoff-pass": ("*/15 * * * *", True), "hepb-pass": ("0 * * * *", True)})
    ck("an existing hepb-pass is replaced (unscheduled, then scheduled every 30 minutes)", c == 0 and "the schedule hepb-pass exists (it is replaced)" in out and M["jobs"]["hepb-pass"] == ("*/30 * * * *", True)
       and any(q.startswith("select cron.unschedule('hepb-pass')") for q in S["sql"]), out)
    c, out = run(vault=0)
    ck("no job secret in the Vault: STOP before any change", c == 3 and "the Vault does not hold hub_job_secret" in out and nothing_changed(), out)

    # ── SQL ──
    c, out = run(sqlfail="supabase/driver-compliance.sql")
    ck("a SQL error (driver-compliance.sql): STOP before any deploy; the files after it, the rules approval and the checklist are not run",
       c == 5 and "driver-compliance.sql did not install" in out and "STOPPED at driver-compliance.sql" in out and [r for r, _ in S["files"]] == SQLS[:4] and not deployed()
       and not any(q.startswith("insert into public.rules_approved") for q in S["sql"]) and S["ck_writes"] == 0 and not S["sched"], out)
    c, out = run(sqlfail="supabase/step1-link-tighten.sql")
    ck("the first SQL file refused: nothing else runs", c == 5 and [r for r, _ in S["files"]] == SQLS[:1] and not deployed(), out)
    c, out = run(trigger="perm")
    rest = [(r, k) for r, k in S["files"]]
    rq = {r: q for q in S["sql"] for r in SQLS if q.startswith(HEAD[r]) and q != SRC[r]}
    ck("no permission for storage triggers: each of the four guarded files is reported, rerun without its trigger statements only, the rest still go in, all nineteen deploy, RESULT not clean",
       c == 9 and all(f"({GUARDED[r]}) could NOT be added" in out for r in GUARDED) and "must be owner of table objects" in out and "are NOT protected yet" in out
       and set(rq) == set(GUARDED) and all(f"drop trigger if exists {GUARDED[r]} on storage.objects" not in rq[r]
                                            and f"create trigger {GUARDED[r]}" not in rq[r] and f"function public.{GUARDED[r]}()" in rq[r] for r in GUARDED)
       and all(f"create trigger {t}" in SRC[r] for r, t in GUARDED.items())
       and "create or replace view public.onboarding_retention" in rq["supabase/onboarding-retention-700.sql"]
       and "create trigger drug_test_entry_no_change" in rq["supabase/drug-tests.sql"] and "create trigger hepb_record_touch_t" in rq["supabase/hepb-vaccination.sql"]
       and deployed() == FNS and not any("703_PROBE_RESULT" in q for q in S["sql"]) and "the retention guard was not tried" in out and "RESULT: CHECK THE ✗ LINES ABOVE" in out and "RESULT: DONE" not in out, [rest, out])
    c, out = run(env_over={"SB_SQL_SHAS": json.dumps(dict(SQLSHAS, **{"supabase/hepb-vaccination.sql": "0" * 64}))})
    ck("a SQL file that is not the reviewed build: STOP, no query at all", c == 2 and not S["sql"] and not deployed() and "hepb-vaccination.sql is not the reviewed build" in out, out)
    c, out = run(env_over={"SB_SQL_SHAS": json.dumps({k: v for k, v in SQLSHAS.items() if k != "supabase/welcome-rights-explained.sql"})})
    ck("a SQL file with no pin: STOP, no query at all", c == 2 and not S["sql"], out)

    # ── the checklist ──
    c, out = run(ops={k: v for k, v in base_ops().items() if k != "viventium_step2_checklist"})
    ck("the checklist not set (the code's starting list): nothing written, said so, DONE", c == 0 and S["ck_writes"] == 0 and "viventium_step2_checklist" not in M["ops"]
       and "the Viventium Step 2 checklist is not set" in out and not any(q.startswith("update public.app_data") for q in S["sql"]) and "RESULT: DONE" in out, out)
    c, out = run(ops=base_ops(viventium_step2_checklist={"version": 4, "items": CK_KEEP, "history": []}))
    ck("the checklist already without those items: nothing written", c == 0 and S["ck_writes"] == 0 and "none of them is the Code of Ethics" in out and "needs no change" in out, out)
    c, out = run(ck_conflicts=2)
    ck("someone saving the settings at the same moment: read again and saved on the fresh version, their change kept", c == 0 and S["ck_writes"] == 1 and M["ops"]["viventium_step2_checklist"]["version"] == 3
       and M["ops"].get("someone_else") == 9 and M["ops"]["viventium_step2_checklist"]["items"] == CK_KEEP, [M["ops"], out])
    c, out = run(ck_conflicts=9)
    ck("the settings never settling: the checklist is not changed, reported, the rest carries on", c == 9 and S["ck_writes"] == 0 and "was not changed" in out and deployed() == FNS, out)
    c, out = run(ops=base_ops(viventium_step2_checklist={"version": 1, "items": ["Code of ethics acknowledged", "HIPAA privacy"], "history": []}))
    ck("a checklist that would be left empty: STOP before any change", c == 3 and "leaving it empty" in out and nothing_changed(), out)
    c, out = run(ops=base_ops(viventium_step2_checklist={"version": 0, "items": ["I-9 Section 1", "Client rights acknowledged"]}))
    ck("a stored checklist at version 0: saved as version 1 with no history entry (as the Admin page does)", c == 0 and M["ops"]["viventium_step2_checklist"]["version"] == 1
       and M["ops"]["viventium_step2_checklist"]["items"] == ["I-9 Section 1"] and M["ops"]["viventium_step2_checklist"]["history"] == [], M["ops"])

    # ── the gateway ──
    c, out = run(reset_gateway=True)
    ck("a deploy that turns the gateway back on is put back to off for step1-sign, driver-compliance and hepb, and only for them",
       c == 0 and sorted(S["patches"]) == sorted([("step1-sign", {"verify_jwt": False}), ("driver-compliance", {"verify_jwt": False}), ("hepb", {"verify_jwt": False})]), [S["patches"], out])
    c, out = run(vj=dict({fn: True for fn in OLD}, **{"step1-sign": False, "team-ask": False}))
    dl = dlines()
    ck("verify_jwt read per service, never assumed: two existing services live off both keep off", c == 0 and {l.split()[2] for l in dl if "--no-verify-jwt" in l} == {"step1-sign", "team-ask", "driver-compliance", "hepb"}, dl)

    # ── pins ──
    c, out = run(env_over={"SB_FN_SHAS": json.dumps({k: v for k, v in FNSHAS.items() if k != "_shared/driver.ts"})})
    ck("a needed file not pinned (_shared/driver.ts): STOP, no query at all", c == 2 and "not pinned" in out and not S["sql"], out)
    c, out = run(env_over={"SB_FN_SHAS": json.dumps(dict(FNSHAS, **{"drug-test/index.ts": "0" * 64}))})
    ck("a service file that is not the reviewed build: STOP, no query at all", c == 2 and not S["sql"], out)
    c, out = run(env_over={"SB_RULES_FP": ""})
    ck("no reviewed rules fingerprint: STOP, no query at all", c == 2 and "fingerprint is missing" in out and not S["sql"], out)

    # ── reported, not clean ──
    c, out = run(real_started=2)
    ck("real Step 1 records before the switch date: reported, not a stop", c == 0 and "2 real Step 1 record(s) already started" in out and "RESULT: DONE" in out, out)
    c, out = run(probe="deleted")
    ck("the guard letting a delete through: reported", c == 9 and "let a signed document be deleted" in out, out)
    c, out = run(preview_v=1)
    ck("the preview showing an older form version: reported", c == 9 and "background form 'Permission for Background Checks and References' version 1" in out, out)
    c, out = run(preview_forms=12)
    ck("the preview with 12 forms (an older build): reported", c == 9 and "12 forms, form_count 11" in out, out)
    c, out = run(open_review=True)
    ck("the Step 1 review answering a visitor: reported", c == 9 and "the Step 1 review answered a visitor with 200" in out, out)
    c, out = run(new_open="drug-test")
    ck("a new service answering a visitor's office call: reported", c == 9 and "drug-test answered a visitor's office call with 200" in out, out)
    c, out = run(tables_open="hepb_record")
    ck("a new table a browser can reach: reported", c == 9 and "a visitor or a signed-in page can reach: hepb_record" in out, out)
    c, out = run(switch_flips=True)
    ck("a switch changing during the step: reported", c == 9 and "these switches changed during the step: step1_auto_live" in out, out)
finally:
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", W], capture_output=True)
    shutil.rmtree(tmp, ignore_errors=True)
failed = [r for r in res if not r[1]]
for n, ok, note in res: print(("PASS  " if ok else "FAIL  ") + n + ("" if ok else "\n      " + note))
print(f"\n{len(res) - len(failed)}/{len(res)} passed" + (" · FAIL" if failed else ""))
raise SystemExit(1 if failed else 0)
