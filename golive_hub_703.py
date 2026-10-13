#!/usr/bin/env python3
# 703 · ONBOARDING GO-LIVE, THE HUB PROJECT (Samantha 2026-10-13). Hub project. Staffing PR #413. SUPERSEDES 701.
# PART 1 reads only and stops before any change if anything is wrong: the reviewed build (every file the nineteen services
# need and every SQL file, pinned); for each service its live files against this build (a live file from main's own
# history is just older and is named; a live file that was never on main is someone's unmerged work: STOP); each service's
# gateway sign-in setting (read live; the three new services are expected not to be live yet); the database pieces; the
# three onboarding schedules; the job secret in the Vault; the approved match rules; the Viventium Step 2 checklist (shown);
# the switch date (must NOT be set) and the switches (shown only); Step 1 records, practice and real.
# PART 2 changes, in this order: eight SQL files (each checked against its pin right before it runs), her approval of the
# new match-rules.js fingerprint (older approvals stay), the Viventium Step 2 checklist without the three items now signed in
# Step 1 and explained at the Orientation Video Call (only when the checklist is set; a new version with a history entry, the
# way the Admin page saves it, only that one setting written), the nineteen services deployed (each existing one keeps its
# own gateway setting), and two 30-minute schedules (driver-compliance-pass, hepb-pass).
# PART 3 proves it with nothing sent and no real record changed: the retention guard is tried inside one transaction that
# always rolls back.
# This step never sets the switch date and never turns a switch on.
# ORDER: merge Staffing PR #413 (merge commit, not squash), then run this. Then merge the Hub pull request.
import os, re, json, subprocess, hashlib, datetime as dt
os.environ.setdefault("SB_STEP", "703")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FNS = ["step1-sign", "hire-profile", "bg-review", "reference-tasks", "caregiver-journey", "step2-handoff", "welcome-call", "reference-send",
       "offer-sign", "caregiver-export", "onboarding-permissions", "coverage-run", "coverage-shifts", "team-ask", "profile-check", "match-dark",
       "driver-compliance", "drug-test", "hepb"]
# the three new services and their gateway setting (driver-compliance and hepb serve a caregiver's private link page and
# check the link code or the office sign-in themselves; drug-test is office only)
NEW = {"driver-compliance": False, "drug-test": True, "hepb": False}
SQLS = ["supabase/step1-link-tighten.sql", "supabase/onboarding-retention-700.sql", "supabase/step1-countersign.sql", "supabase/driver-compliance.sql",
        "supabase/step1-viventium-forms.sql", "supabase/welcome-rights-explained.sql", "supabase/drug-tests.sql", "supabase/hepb-vaccination.sql"]
SQL_LINK, SQL_KEEP = SQLS[0], SQLS[1]
JOBS = [("caregiver-journey-sweep", "*/10 * * * *"), ("caregiver-audit-nightly", "5 11 * * *"), ("step2-handoff-pass", "*/15 * * * *")]
NEW_JOBS = [("driver-compliance-pass", "driver-compliance"), ("hepb-pass", "hepb")]; NEW_SCHED = "*/30 * * * *"; VAULT_NAME = "hub_job_secret"
SWITCHES = ["offer_send_live", "offer_reminders_live", "step1_auto_live", "step2_send_live", "step2_reminders_live", "wc_auto_invite_live",
            "orient_remind_live", "approve_work_text_live", "approve_work_axiscare_live", "axiscare_hire_date_live", "axiscare_level_live",
            "driver_reminders_live", "driver_link_send_live", "driver_schedule_gate_live", "hepb_offer_live"]
RULES_FILE = "match-rules.js"; RULES_FP = os.environ.get("SB_RULES_FP", "").strip().lower()
CK_KEY = "viventium_step2_checklist"
# her ruling 2026-10-13: these are signed in Step 1 and explained at the Orientation Video Call, so Viventium no longer asks
CK_DROP = [re.compile(r"ethic", re.I), re.compile(r"confidential|hipaa|privacy", re.I), re.compile(r"participant rights|client rights", re.I)]
CK_BY = "703 Desktop step (her ruling 2026-10-13: signed in Step 1, explained at the Orientation Video Call)"
TABLES = ["driver_compliance", "driver_compliance_event", "driver_document", "drug_test_entry", "hepb_record", "hepb_event", "hepb_document", "step1_forms"]
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
PROBE = "_703_probe/x.pdf"
_HIST = {}
def in_history(rel, live_sha):
    """True when this exact file content was committed on main at some point (the live copy is just older than main)"""
    if not live_sha: return False
    if rel not in _HIST:
        shas = set()
        try:
            commits = subprocess.run(["git", "-C", ROOT, "log", MAIN, "--format=%H", "--", rel], capture_output=True, text=True, timeout=120).stdout.split()
            for c in commits:
                b = subprocess.run(["git", "-C", ROOT, "show", f"{c}:{rel}"], capture_output=True, timeout=60).stdout
                if b: shas.add(hashlib.sha256(b).hexdigest())
        except Exception: pass
        _HIST[rel] = shas
    return live_sha in _HIST[rel]
short = lambda ks: ", ".join(k.split("/")[-2] + "/" + k.split("/")[-1] for k in ks[:4]) + (f" and {len(ks) - 4} more" if len(ks) > 4 else "")
def onb():
    """(ops_settings data, version) or (None, None)"""
    ok_, r = sql(REF, "select data, version from public.app_data where key = 'ops_settings'")
    if not ok_: return None, None
    if not r: return {}, 0
    d = r[0].get("data")
    return (d if isinstance(d, dict) else {}), int(r[0].get("version") or 0)
def is_on(v): return v is True or str(v).lower() == "true"
def ck_of(st):
    """the checklist as stored (None when it is not set and the code's own list is used); the same test step2-handoff makes"""
    c = (st or {}).get(CK_KEY)
    if not (isinstance(c, dict) and isinstance(c.get("items"), list) and c["items"]): return None
    try: v = int(c.get("version") or 0)
    except Exception: v = 0
    return {"version": v, "items": list(c["items"]), "changed_at": c.get("changed_at"), "changed_by": c.get("changed_by"),
            "history": c["history"] if isinstance(c.get("history"), list) else []}
dropped = lambda it: any(p.search(str(it)) for p in CK_DROP)
def ck_next(cur):
    """the Admin page's save (team-hub admin.html onbSaveChecklist): version + 1, the old version into history (kept to 50)"""
    items = [x for x in cur["items"] if not dropped(x)]
    hist = (cur["history"] + ([{"version": cur["version"], "items": cur["items"], "changed_at": cur["changed_at"], "changed_by": cur["changed_by"]}] if cur["version"] else []))[-50:]
    return {"version": cur["version"] + 1, "items": items, "changed_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
            "changed_by": CK_BY, "history": hist}
STORAGE_PERM = re.compile(r"must be owner|permission denied|42501|insufficient_privilege", re.I)
def storage_triggers(src): return re.findall(r"create trigger (\w+) before [^;]*? on storage\.objects", src, re.I)
def without_storage_triggers(src):
    """the same reviewed file without its storage.objects trigger statements (the guard functions still go in)"""
    for n in storage_triggers(src):
        src = re.sub(rf"drop trigger if exists {n} on storage\.objects;\s*", "", src)
        src = re.sub(rf"create trigger {n} before [^;]*? on storage\.objects\s.*?execute function [\w.]+\(\);\s*", "", src, flags=re.S | re.I)
    return src

start("ONBOARDING GO-LIVE, THE HUB PROJECT")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
FN_SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))
check_build(FNROOT, FN_SHAS)
NEED = {fn: need(FNROOT, fn) for fn in FNS}
missing_fn = [fn for fn in FNS if not NEED[fn]]
if missing_fn: bad("these services are not in the reviewed build: " + ", ".join(missing_fn) + ". Nothing runs."); done(2)
unpinned = sorted({k for fn in FNS for k in NEED[fn]} - {"supabase/functions/" + k for k in FN_SHAS})
if unpinned: bad("these files the services need are not pinned to the reviewed build: " + short(unpinned) + ". Nothing runs."); done(2)
SQL_SHAS = json.loads(os.environ.get("SB_SQL_SHAS", "{}"))
def sql_reviewed(rel):
    p_ = os.path.join(ROOT, rel)
    return os.path.exists(p_) and SQL_SHAS.get(rel) and sha(p_) == SQL_SHAS.get(rel)
for rel in SQLS:
    say(f"  ✓ {rel.split('/')[-1]} is the reviewed build") if sql_reviewed(rel) else bad(f"{rel.split('/')[-1]} is not the reviewed build: nothing runs")
if not re.fullmatch(r"[0-9a-f]{64}", RULES_FP): bad("the reviewed match rules fingerprint is missing: nothing runs")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(2)

VJ = {}
for fn in FNS:
    sx, mx = fmeta(REF, fn)
    if sx == 404 and fn in NEW:
        VJ[fn] = NEW[fn]; say(f"  ✓ {fn} is new (not live yet); it goes in with the gateway sign-in check {'on' if NEW[fn] else 'off'}"); continue
    if sx == 404: bad(f"{fn} is not live at all; this step only brings live services up to date. Tell Claude."); continue
    if not (sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool)): bad(f"could not read {fn} ({sx})"); continue
    if fn in NEW and mx["verify_jwt"] != NEW[fn]:
        bad(f"{fn} is already live with the gateway sign-in check {'on' if mx['verify_jwt'] else 'off'}, not as designed ({'on' if NEW[fn] else 'off'}). Tell Claude."); continue
    VJ[fn] = mx["verify_jwt"]
    okl, livef = live_files(REF, fn)
    if not okl: bad(f"could not read {fn}'s live files"); continue
    mine = {k: sha(os.path.join(ROOT, k)) for k in NEED[fn]}
    differ = [k for k in sorted(mine) if livef.get(k) != mine[k]]
    missing = [k for k in differ if livef.get(k) is None]
    older = [k for k in differ if k not in missing and in_history(k, livef.get(k))]
    unknown = [k for k in differ if k not in missing and k not in older]
    # a live file this build no longer uses: fine when main once had it in that version; otherwise it is someone's work
    unknown += [k for k in sorted(livef) if k not in mine and not in_history(k, livef[k])]
    gw = f"gateway sign-in check {'on' if VJ[fn] else 'off'}"
    if unknown: bad(f"{fn}'s live copy holds {short(unknown)} in a version that was never on main (someone's unmerged work); deploying would overwrite it. Tell Claude.")
    elif differ: say(f"  ✓ {fn} is live at version {mx.get('version', '?')} ({gw}): "
                     + "; ".join(x for x in [f"older versions (from main's own history) of {short(older)}" if older else "",
                                              f"built before it used {short(missing)}" if missing else ""] if x) + ". This deploy brings it up to date.")
    else: say(f"  ✓ {fn} is live at version {mx.get('version', '?')} ({gw}) and is already this build")

ok_, r = sql(REF, "select to_regprocedure('public.step1_candidate_create(text,jsonb)') is not null as fn, to_regclass('public.step1_forms') is not null as forms, "
                  "to_regclass('storage.objects') is not null as objs, "
                  "(select count(*)::int from storage.buckets where id = 'onboarding-documents') as bucket, "
                  "to_regclass('public.onboarding_retention') is not null as view, "
                  "(select count(*)::int from pg_trigger where tgname = 'onboarding_documents_keep' and not tgisinternal) as trig, "
                  "to_regclass('public.rules_approved') is not null as rules, "
                  "to_regclass('public.client_journey_step_def') is not null as defs, "
                  "to_regclass('public.welcome_calls') is not null as wc, "
                  f"(select count(*)::int from vault.decrypted_secrets where name = {lit(VAULT_NAME)}) as vault")
if not ok_: bad(f"could not read the database pieces: {r}")
else:
    x = r[0]
    say("  ✓ step1_candidate_create exists (it is replaced by the tightened version)") if x["fn"] is True else bad("step1_candidate_create does not exist. Tell Claude.")
    say("  ✓ step1_forms exists (the company signature columns are added to it)") if x["forms"] is True else bad("step1_forms does not exist. Tell Claude.")
    say("  ✓ storage.objects exists") if x["objs"] is True else bad("storage.objects does not exist. Tell Claude.")
    say("  ✓ the readiness rows table and welcome_calls exist") if x["defs"] is True and x["wc"] is True else bad("client_journey_step_def or welcome_calls does not exist. Tell Claude.")
    say("  ✓ the approved rules list exists") if x["rules"] is True else bad("rules_approved does not exist. Tell Claude.")
    say("  ✓ the job secret is in the Vault (the two new schedules use it)") if int(x["vault"]) == 1 else bad("the Vault does not hold hub_job_secret. Tell Claude.")
    say("  · the onboarding-documents storage bucket " + ("exists" if int(x["bucket"]) else "does not exist yet (the retention proof needs it)"))
    say("  · the seven-year retention guard is " + ("already in (it is replaced by the same file)" if int(x["trig"]) else "new") + "; the retention view is " + ("already in" if x["view"] is True else "new"))
RULES_OLD = []
ok_, rr = sql(REF, f"select sha256 from public.rules_approved where file = {lit(RULES_FILE)} order by sha256")
if not ok_: bad(f"could not read the approved match rules: {rr}")
else:
    RULES_OLD = [str(x["sha256"]) for x in rr]
    say(f"  · {len(RULES_OLD)} {RULES_FILE} fingerprint(s) already approved; they all stay. The new one ({RULES_FP[:12]}) is "
        + ("already approved" if RULES_FP in RULES_OLD else "not approved yet (this step approves it)"))
jn = ", ".join(lit(j) for j, _ in JOBS + NEW_JOBS)
ok_, jr = sql(REF, f"select j.jobname, j.schedule, j.active, (select d.status from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1) as last_status, "
                   f"(select d.start_time from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1) as last_at from cron.job j where j.jobname in ({jn})")
if not ok_: bad(f"could not read the schedules: {jr}")
else:
    have = {row["jobname"]: row for row in jr}
    for j, want in JOBS:
        row = have.get(j)
        if not row: bad(f"the schedule {j} does not exist. Tell Claude."); continue
        last = f"last run {str(row.get('last_at') or 'never')[:16]} ({row.get('last_status') or 'no run yet'})"
        sched = f"every {row['schedule']}" + ("" if row["schedule"] == want else f" (expected {want})")
        if row["active"] is not True: bad(f"the schedule {j} is turned off ({sched}; {last}). Tell Claude.")
        else: say(f"  ✓ {j} is on, {sched}; {last}")
    for j, _ in NEW_JOBS: say(f"  · the schedule {j} " + ("exists (it is replaced)" if j in have else "is new"))
st0, ver0 = onb()
CK0 = None
if st0 is None: bad("could not read the Hub switches (ops_settings)")
else:
    sd = str(st0.get("onboarding_switch_date") or "")
    if sd: bad(f"the switch date is already set ({sd}). Tell Claude before this runs.")
    else: say("  ✓ the switch date is not set (this step does not set it)")
    say("  · the switches (shown only; this step changes none): " + ", ".join(f"{k} {'on' if is_on(st0.get(k)) else 'off'}" for k in SWITCHES))
    CK0 = ck_of(st0)
    if CK0 is None: say("  · the Viventium Step 2 checklist is not set (the Hub uses its own starting list); this step leaves it alone")
    else:
        say(f"  · the Viventium Step 2 checklist, version {CK0['version']} ({len(CK0['items'])} items):")
        for it in CK0["items"]: say(f"      {'(comes out) ' if dropped(it) else ''}{it}")
        if not any(dropped(it) for it in CK0["items"]): say("    none of them is the Code of Ethics, confidentiality/HIPAA or participant/client rights; this step leaves it alone")
        elif all(dropped(it) for it in CK0["items"]): bad("every item on the Viventium Step 2 checklist would come out, leaving it empty. Tell Claude.")
        else: say(f"    this step saves version {CK0['version'] + 1} without the items marked (comes out); every other item stays exactly")
ok_, fr = sql(REF, "select count(*) filter (where coalesce(practice, false))::int as practice, count(*) filter (where not coalesce(practice, false))::int as real, "
                   "count(*) filter (where not coalesce(practice, false) and started_at is not null)::int as real_started from public.step1_forms")
if not ok_: bad(f"could not count the Step 1 records: {fr}")
else:
    f0 = fr[0]
    say(f"  · Step 1 records: {f0['practice']} practice, {f0['real']} real")
    if int(f0["real_started"]): say(f"  ! {f0['real_started']} real Step 1 record(s) already started before the switch date. Not stopping; tell Claude who they are.")
    else: say("  ✓ no real Step 1 has started (expected before the switch date)")
ok_, ks = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG()); ANON = ""
try:
    arr = json.loads(ks) if ok_ == 200 else []
    if isinstance(arr, dict): arr = arr.get("keys") or []
    for k in arr:
        v = str(k.get("api_key", "")) if isinstance(k, dict) else ""
        if k.get("name") == "anon" and v.startswith("eyJ"): ANON = v
except Exception: pass
HIDE.append(ANON)
say("  ✓ the project's public key is readable (the proofs call the services as a visitor)") if ANON else bad("could not read the project's public key")
say("  · what changes: the tightened Step 1 link, seven-year retention for signed onboarding documents, the company signature on Step 1, "
    "driver compliance, the Viventium forms moved into Step 1, rights explained at the Orientation Video Call, the drug test record, "
    "the hepatitis B record, your approval of the new match rules, the Viventium Step 2 checklist (if set), nineteen services and two 30-minute schedules. "
    "No switch, no switch date, no person's record. Nothing is sent.")
say("  · other services that share a changed helper file (for example the texting helpers) are NOT redeployed by this step; they keep running their current live copy.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
GUARDS_OUT = []   # storage guards the database would not let in
for rel in SQLS:
    name = rel.split("/")[-1]
    if not sql_reviewed(rel): bad(f"{name} changed since it was checked"); say("  RESULT: STOPPED. No service was deployed. Tell Claude."); done(5)
    src = open(os.path.join(ROOT, rel)).read()
    ok_, r_ = sql(REF, src)
    if ok_: say(f"  ✓ {name} is in"); continue
    trig = storage_triggers(src)
    if trig and STORAGE_PERM.search(str(r_)):
        bad(f"{name}: the keep-guard on stored documents ({', '.join(trig)}) could NOT be added: the database did not allow a trigger on storage.objects ("
            + str(r_)[:160] + "). Those documents are NOT protected yet. Tell Claude. The rest carries on.")
        ok2, r2 = sql(REF, without_storage_triggers(src))
        if ok2: GUARDS_OUT += trig; say(f"  ✓ the rest of {name} is in (the guard function is in, but nothing calls it until the trigger is added)"); continue
        bad(f"the rest of {name} did not install either: {r2}")
    else: bad(f"{name} did not install: {r_}")
    say(f"  RESULT: STOPPED at {name}. The SQL files above it are in; no service was deployed. Tell Claude."); done(5)
TRIGGER_IN = "onboarding_documents_keep" not in GUARDS_OUT
ok_, r_ = sql(REF, f"insert into public.rules_approved (file, sha256, note) values ({lit(RULES_FILE)}, {lit(RULES_FP)}, '703 match rules with Driver Compliance (transportEligible, driver_schedule_gate_live)') "
                   "on conflict (file, sha256) do update set approved_at = now(), note = excluded.note")
if not ok_: bad(f"your approval of the new match rules could not be recorded: {r_}"); say("  RESULT: STOPPED. The SQL files are in; no service was deployed. Tell Claude."); done(5)
say("  ✓ your approval of the new match rules fingerprint is recorded (the older approved ones stay, so nothing stops while the Hub pull request is merged)")
CK_NEW = None
if CK0 is None: say("  · the Viventium Step 2 checklist is not set; nothing to change")
else:
    for i in range(5):
        stc, verc = onb()
        cur = ck_of(stc) if stc is not None else None
        if stc is None: bad("could not read the Viventium Step 2 checklist again; it was not changed. Tell Claude."); break
        if cur is None or not any(dropped(x) for x in cur["items"]): say("  · the Viventium Step 2 checklist needs no change (nothing to take out)"); break
        nxt = ck_next(cur)
        if not nxt["items"]: bad("the Viventium Step 2 checklist would be left empty; it was not changed. Tell Claude."); break
        # only this one setting is written, and only if nobody saved ops_settings since it was read (the Admin page's rule)
        ok_, w = sql(REF, f"update public.app_data set data = jsonb_set(data, '{{{CK_KEY}}}', {lit(json.dumps(nxt))}::jsonb, true) "
                          f"where key = 'ops_settings' and version = {int(verc)} returning version")
        if not ok_: bad(f"the Viventium Step 2 checklist could not be saved: {w}"); break
        if w:
            CK_NEW = nxt
            say(f"  ✓ the Viventium Step 2 checklist is version {nxt['version']} ({len(nxt['items'])} items; out: "
                + "; ".join(str(x) for x in cur["items"] if dropped(x)) + "); version " + str(cur["version"]) + " is kept in its history"); break
    else: bad("someone kept saving the Hub settings at the same moment, so the Viventium Step 2 checklist was not changed. Tell Claude.")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, VJ[fn]): say("  RESULT: STOPPED. The services above this line are deployed; tell Claude."); done(6)
for job, fn in NEW_JOBS:
    command = ("select net.http_post(url := " + lit(f"https://{REF}.supabase.co/functions/v1/{fn}") + ", headers := jsonb_build_object('Content-Type', 'application/json', "
               "'Authorization', " + lit("Bearer " + ANON) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
               "body := '{\"action\": \"pass\"}'::jsonb, timeout_milliseconds := 120000);")
    sql(REF, f"select cron.unschedule({lit(job)}) where exists (select 1 from cron.job where jobname = {lit(job)})")
    ok_, r_ = sql(REF, f"select cron.schedule({lit(job)}, {lit(NEW_SCHED)}, {lit(command)}) as id")
    say(f"  ✓ {job} scheduled every 30 minutes (practice until its switch is on)") if ok_ else bad(f"the schedule {job} did not install: {r_}")

say(); say("PART 3 · PROOF (nothing is sent; no real record changes)")
for fn in FNS:
    okl, livef = live_files(REF, fn); s_, m_ = fmeta(REF, fn)
    good = okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in NEED[fn])
    same_gw = (m_ or {}).get("verify_jwt") == VJ[fn]
    if good and same_gw: say(f"  ✓ {fn} is live as tested (version {(m_ or {}).get('version', '?')}, gateway sign-in check {'on' if VJ[fn] else 'off'}" + (", as designed)" if fn in NEW else ", as before)"))
    elif not good: bad(f"{fn}'s live copy is not this build")
    else: bad(f"{fn}'s gateway setting changed (should be {'on' if VJ[fn] else 'off'})")
if TRIGGER_IN:
    probe = ("do $p$ declare m text := 'deleted'; begin "
             "perform set_config('storage.allow_delete_query', 'true', true); "
             f"insert into storage.objects (bucket_id, name) values ('onboarding-documents', {lit(PROBE)}); "
             f"begin delete from storage.objects where bucket_id = 'onboarding-documents' and name = {lit(PROBE)}; "
             "exception when others then m := sqlerrm; end; "
             "raise exception '703_PROBE_RESULT: %', m; end $p$")
    ok_, pr = sql(REF, probe)
    pr = str(pr)
    if ok_: bad("the retention probe did not roll back as planned. Tell Claude.")
    elif "703_PROBE_RESULT" in pr and "kept for seven years" in pr: say("  ✓ a signed document cannot be deleted: the database answered \"kept for seven years\" (tried on a probe inside one transaction that was rolled back)")
    elif "703_PROBE_RESULT: deleted" in pr: bad("the retention guard let a signed document be deleted (on the probe, rolled back). Tell Claude.")
    elif "703_PROBE_RESULT" in pr: bad("the probe's delete was refused, but not by the seven-year guard (" + pr[pr.find("703_PROBE_RESULT") + 18:][:160] + "). Tell Claude.")
    else: bad("the retention probe could not run: " + pr[:200])
else: say("  · the retention guard was not tried (it could not be added; see the ✗ line above)")
ok_, pz = sql(REF, "select count(*)::int as n from storage.objects where starts_with(name, '_703_probe/')")
say("  ✓ no probe is left in storage") if ok_ and int(pz[0]["n"]) == 0 else bad(f"a probe row is left in storage: {pz}. Tell Claude.")
ok_, pv = sql(REF, "select has_function_privilege('anon', 'public.step1_candidate_create(text, jsonb)', 'execute') as a, has_function_privilege('authenticated', 'public.step1_candidate_create(text, jsonb)', 'execute') as b")
say("  ✓ step1_candidate_create is server only (a visitor or a signed-in page cannot call it)") if ok_ and pv[0]["a"] is False and pv[0]["b"] is False else bad(f"step1_candidate_create privileges: {pv}")
ok_, rv = sql(REF, "select count(*)::int as n, count(*) filter (where earliest_removal_if_never_hired is not null)::int as dated from public.onboarding_retention")
say(f"  ✓ the retention view reads ({rv[0]['n']} Step 1 records, each with its earliest removal date)") if ok_ and int(rv[0]["n"]) == int(rv[0]["dated"]) else bad(f"the retention view: {rv}")
tl = "array[" + ", ".join(lit(t) for t in TABLES) + "]"
ALLP = "'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'"
ok_, tr = sql(REF, f"select t, to_regclass('public.' || t) is not null as here, case when to_regclass('public.' || t) is null then null else "
                   f"has_table_privilege('anon', 'public.' || t, {ALLP}) or has_table_privilege('authenticated', 'public.' || t, {ALLP}) end as browser, "
                   "(select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'step1_forms' and column_name in ('countersignatures', 'countersigned_pdfs')) as cs "
                   f"from unnest({tl}) t")
if not ok_: bad(f"could not read the new tables: {tr}")
else:
    absent = [x["t"] for x in tr if x["here"] is not True]; opened = [x["t"] for x in tr if x["browser"] is not False and x["here"] is True]
    cs = int(tr[0]["cs"]) if tr else 0
    if absent: bad("these tables are missing: " + ", ".join(absent))
    if opened: bad("a visitor or a signed-in page can reach: " + ", ".join(opened) + ". Tell Claude.")
    if cs != 2: bad("step1_forms is missing the company signature columns")
    if not absent and not opened and cs == 2: say("  ✓ the driver, drug test and hepatitis B tables and the company signature columns are in; a visitor or a signed-in page can reach none of them")
ok_, rr2 = sql(REF, f"select sha256 from public.rules_approved where file = {lit(RULES_FILE)} order by sha256")
if ok_:
    now_ = {str(x["sha256"]) for x in rr2}; lost = [s for s in RULES_OLD if s not in now_]
    if RULES_FP in now_ and not lost: say(f"  ✓ the approved match rules hold the new fingerprint ({RULES_FP[:12]}) and the {len(RULES_OLD)} older one(s)")
    else: bad("the approved match rules: " + ("the new fingerprint is missing" if RULES_FP not in now_ else "") + (f" {len(lost)} older fingerprint(s) are gone" if lost else ""))
else: bad(f"could not read the approved match rules again: {rr2}")
ok_, jr2 = sql(REF, "select jobname, schedule, active from cron.job where jobname in (" + ", ".join(lit(j) for j, _ in NEW_JOBS) + ")")
if ok_:
    hv = {x["jobname"]: x for x in jr2}
    for j, _ in NEW_JOBS:
        x = hv.get(j)
        say(f"  ✓ {j} is on, every {x['schedule']}") if x and x["active"] is True and x["schedule"] == NEW_SCHED else bad(f"the schedule {j}: {x or 'missing'}")
else: bad(f"could not read the new schedules: {jr2}")
vis = {"apikey": ANON, "Authorization": "Bearer " + ANON}
s1, b1 = http("POST", f"{FNB}/functions/v1/step1-sign", {"action": "preview"}, vis)
try: j1 = json.loads(b1)
except Exception: j1 = {}
forms = [f for f in (j1.get("forms") or []) if isinstance(f, dict)]
byk = {f.get("key"): f for f in forms}; titles = {f.get("title") for f in forms}
fc = byk.get("fcra_disclosure"); ea = byk.get("employment_agreement")
pv_ok = (s1 == 200 and j1.get("preview") is True and len(forms) == 13 and j1.get("form_count") == 12 and fc and fc.get("title") == "Permission for Background Checks and References"
         and fc.get("version") == 2 and "Client Rights" in titles and ea and ea.get("title") == "Employment Agreement" and ea.get("layout") == "document")
if pv_ok: say("  ✓ the Step 1 preview answers with 13 forms (12 to sign: the driver or the non-driver agreement), \"Permission for Background Checks and References\" version 2, \"Client Rights\" and the \"Employment Agreement\" as a document among them")
else: bad(f"the Step 1 preview answered {s1}: " + (f"{len(forms)} forms, form_count {j1.get('form_count')}, background form {fc.get('title')!r} version {fc.get('version')}, "
                                                   f"Client Rights {'there' if 'Client Rights' in titles else 'missing'}, Employment Agreement layout {(ea or {}).get('layout')!r}" if fc else str(b1)[:200]))
s2, b2 = http("POST", f"{FNB}/functions/v1/step1-sign", {"action": "review", "offer_id": "00000000-0000-0000-0000-000000000000"}, vis)
say("  ✓ the Step 1 review refuses a visitor who is not signed in (401)") if s2 == 401 else bad(f"the Step 1 review answered a visitor with {s2}")
s3, b3 = http("POST", f"{FNB}/functions/v1/hire-profile", {"action": "get"}, vis)
say("  ✓ the hire profile refuses a visitor who is not signed in (401)") if s3 == 401 else bad(f"the hire profile answered a visitor with {s3}")
for fn in NEW:
    s4, _ = http("POST", f"{FNB}/functions/v1/{fn}", {"action": "get"}, vis)
    say(f"  ✓ {fn} refuses an office call from a visitor who is not signed in ({s4})") if s4 in (401, 403) else bad(f"{fn} answered a visitor's office call with {s4}")
st1, _v1 = onb()
if st1 is None: bad("could not read the Hub switches again")
else:
    sd = str(st1.get("onboarding_switch_date") or "")
    say("  ✓ the switch date is still not set") if not sd else bad(f"the switch date is now set ({sd})")
    moved = [k for k in SWITCHES if st1.get(k) != (st0 or {}).get(k)]
    say("  ✓ no switch changed") if not moved else bad("these switches changed during the step: " + ", ".join(moved))
    if CK_NEW is not None:
        c1 = ck_of(st1)
        say(f"  ✓ the Viventium Step 2 checklist reads version {CK_NEW['version']} with {len(CK_NEW['items'])} items") if c1 and c1["version"] == CK_NEW["version"] and c1["items"] == CK_NEW["items"] else bad(f"the Viventium Step 2 checklist reads {c1 and c1['version']}, not version {CK_NEW['version']}")
    others0 = {k: v for k, v in (st0 or {}).items() if k != CK_KEY}; others1 = {k: v for k, v in st1.items() if k != CK_KEY}
    changed_other = sorted(k for k in set(others0) | set(others1) if others0.get(k) != others1.get(k))
    if changed_other: say("  · other Hub settings changed while this ran (not by this step): " + ", ".join(changed_other[:8]))
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · onboarding is live on the Hub project: eight SQL files, the new match rules approved, nineteen services and two 30-minute schedules. "
    "No switch changed and the switch date is not set. Nothing was sent; no real record changed.")
say("NEXT: merge the Hub pull request."); done(0)
