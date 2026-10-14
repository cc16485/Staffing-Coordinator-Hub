#!/usr/bin/env python3
# 710 · NURSE PROGRAM, THE HUB PROJECT (the LPN nurse visit plan, Samantha approved "approve nursing plan" 2026-10-14; Natasha
# Early is our W-2 RN). ONE step for the Hub project that replaces 706 (RN review), 707 (nurse visit checks) and 708 (LPN
# hiring): the three builds are one Staffing pull request ("Nurse program: RN review, nurse visit checks, LPN hiring (all off)"),
# so their pins can never invalidate each other. ORDER: Training #37, then 709 (this step STOPS if 709 has not run), then the
# Staffing pull request (merge commit), then this, then the Hub and Owners Hub pull requests.
# PART 1 reads only and stops before any change if anything is wrong: both proposed wordings (the Your Nursing License form and
# the licensed nurse letter) are still unapproved in this build; every file the nine services need, and both SQL files, pinned;
# main has not moved on in any of them; each service's live copy (rn-review and nurse-visit-check may be new; the other seven
# must be live; a live file newer than this build or never on main STOPS) and its gateway setting; 709 has run (the Training
# Platform's offers carry position_key); the database pieces (storage, the document access log, the app_data door and access
# rule, the Step 1 tables, the readiness catalog, the AxisCare change log, the job secret in the Vault); no app_data key mapped
# to rn_review; the two schedules; the three visit check switches must be OFF; the other switches shown only; the RNs on the
# nurse list; what the visit check reads; the GHE watch as it stands; the Step 1 records and readiness rows now.
# PART 2 changes, in this order: nurse-review.sql (the LPN marks, the RN's write-once signatures, their history, the private
# nurse-docs bucket with its seven-year keep-guard, the keeper of the RN's signature on a GHE form); lpn-hiring-708.sql
# (step1_forms.nurse_form, the sealed nursing license columns, the change log kind, the four nurse readiness rows); the nine
# services, each keeping its gateway setting (rn-review and nurse-visit-check new with the gateway sign-in check on;
# hub-access, hire-profile, applicant-link, step2-handoff, caregiver-journey, offer-sign, and step1-sign last); the hourly
# schedule rn-review-pass and the 30-minute schedule nurse-visit-check-pass.
# PART 3 proves it with nothing sent, nothing written to AxisCare and no real record changed: every service live as tested;
# rn-review refuses a visitor and a pass without the job secret; the RN review tables closed to browsers; the bucket private;
# the keep-guard tried on a probe inside one transaction that always rolls back; no probe left; an "RN review only" sign-in
# reads no app_data key (beside a Care Coordinator Hub sign-in that does), each inside one transaction that always rolls back;
# both schedules on; nurse-visit-check refuses a visitor and one PRACTICE run (?dry=1) writes nothing; the Hub project's
# nurse tables and readiness rows; the REAL read-only previews show a caregiver's Step 1 and offer unchanged and an LPN's with
# the proposed form and letter; no switch changed.
# This step changes no switch and creates no account (Natasha's "RN review only" sign-in is yours, on the Owners Hub Admin page).
import os, re, json, subprocess, hashlib
os.environ.setdefault("SB_STEP", "710")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; TRN = "rdqujxiycycwhskyvrwa"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
NEW_OK = ["rn-review", "nurse-visit-check"]          # may be new (not live yet): they go in with the gateway sign-in check on
FNS = ["rn-review", "hub-access", "nurse-visit-check", "hire-profile", "applicant-link", "step2-handoff", "caregiver-journey", "offer-sign", "step1-sign"]
SQLS = ["supabase/nurse-review.sql", "supabase/lpn-hiring-708.sql"]
NURSE_SQL, LPN_SQL = SQLS
JOBS = {"rn-review-pass": ("rn-review", "7 * * * *", 120000, "every hour"), "nurse-visit-check-pass": ("nurse-visit-check", "*/30 * * * *", 300000, "every 30 minutes")}
VAULT_NAME = "hub_job_secret"
MUST_BE_OFF = ["nurse_visit_check_live", "nurse_bill_hold_live", "nurse_license_reminders_live"]
SHOWN = ["nurse_review_live", "nurse_hire_live", "ghe_watch_live", "visit_watch_live", "step1_auto_live", "offer_send_live", "approve_work_axiscare_live", "axiscare_level_live", "approve_work_text_live"]
ALL_SW = MUST_BE_OFF + SHOWN
RN_TABLES = ["nurse_flag", "rn_ghe_signature", "rn_review_event"]
WATCH_KEYS = ["nurse_bill_check", "nurse_license_reminders"]
DOC_REL = "supabase/functions/_shared/step1-documents.ts"; OFFER_REL = "supabase/functions/_shared/offer-documents.ts"
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
PROBE = "_710_probe/x.pdf"; TRIG = "nurse_documents_keep"
STORAGE_PERM = re.compile(r"must be owner|permission denied|42501|insufficient_privilege", re.I)

_H = {}
def in_hist(ref, rel, s):
    if (ref, rel) not in _H:
        out = set()
        try:
            for c in subprocess.run(["git", "-C", ROOT, "log", ref, "--format=%H", "--", rel], capture_output=True, text=True, timeout=120).stdout.split():
                b = subprocess.run(["git", "-C", ROOT, "show", f"{c}:{rel}"], capture_output=True, timeout=60).stdout
                if b: out.add(hashlib.sha256(b).hexdigest())
        except Exception: pass
        _H[(ref, rel)] = out
    return bool(s) and s in _H[(ref, rel)]
short = lambda ks: ", ".join(k.split("/")[-2] + "/" + k.split("/")[-1] for k in ks[:4]) + (f" and {len(ks) - 4} more" if len(ks) > 4 else "")
is_on = lambda v: v is True or str(v).lower() == "true"
def onb():
    ok_, r = sql(REF, "select data, version from public.app_data where key = 'ops_settings'")
    if not ok_ or not r: return None
    d = r[0].get("data"); return d if isinstance(d, dict) else None
def versions():
    ok_, r = sql(REF, "select key, version from public.app_data where key in (" + ", ".join(lit(k) for k in WATCH_KEYS) + ")")
    return {x["key"]: int(x["version"] or 0) for x in r} if ok_ else None
def without_trigger(src):
    src = re.sub(rf"drop trigger if exists {TRIG} on storage\.objects;\s*", "", src)
    return re.sub(rf"create trigger {TRIG} before [^;]*? on storage\.objects\s.*?execute function [\w.]+\(\);\s*", "", src, flags=re.S | re.I)

start("NURSE PROGRAM, THE HUB PROJECT")
say("  RN review, nurse visit checks and LPN hiring, in one step (it replaces 706, 707 and 708). Every switch stays as it is;")
say("  nothing is sent; nothing is written to AxisCare; the caregiver offer, Step 1 and readiness card stay exactly as they are.")
say()
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
# the two proposed wordings must still be UNAPPROVED in this build (this step approves nothing)
docs = open(os.path.join(ROOT, DOC_REL)).read() if os.path.exists(os.path.join(ROOT, DOC_REL)) else ""
ap = re.search(r"export const APPROVED_FOR_REAL[^=]*= \{(.*?)\n\}", docs, re.S)
if not re.search(r"key: 'nurse_license',[^\n]*step1Gate: 'nurse',[^\n]*status: 'proposed'", docs) or not ap or re.search(r"\bnurse_license:", ap.group(1)):
    bad("the Your Nursing License form is not in this build as a proposed, unapproved form. Nothing runs. Tell Claude."); done(2)
say("  ✓ the Your Nursing License form is in this build, proposed and NOT approved for real (a real nurse's Step 1 cannot complete until Samantha approves it)")
offer = open(os.path.join(ROOT, OFFER_REL)).read() if os.path.exists(os.path.join(ROOT, OFFER_REL)) else ""
if not re.search(r"export const NURSE_LETTER_APPROVED = 0\b", offer): bad("the licensed nurse offer letter is not in this build as unapproved. Nothing runs. Tell Claude."); done(2)
say("  ✓ the licensed nurse offer letter is in this build, proposed and NOT approved (a real LPN or RN offer cannot be signed until she approves it)")
FN_SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))
check_build(FNROOT, FN_SHAS)
NEED = {fn: need(FNROOT, fn) for fn in FNS}
missing_fn = [fn for fn in FNS if not NEED[fn]]
if missing_fn: bad("these services are not in the reviewed build: " + ", ".join(missing_fn) + ". Nothing runs."); done(2)
ALLNEED = set().union(*NEED.values())
unpinned = sorted(ALLNEED - {"supabase/functions/" + k for k in FN_SHAS})
if unpinned: bad("these files the services need are not pinned to the reviewed build: " + short(unpinned) + ". Nothing runs."); done(2)
SQL_SHAS = json.loads(os.environ.get("SB_SQL_SHAS", "{}"))
def sql_reviewed(rel):
    p_ = os.path.join(ROOT, rel); return os.path.exists(p_) and SQL_SHAS.get(rel) and sha(p_) == SQL_SHAS.get(rel)
for rel in SQLS:
    say(f"  ✓ {rel.split('/')[-1]} is the reviewed build") if sql_reviewed(rel) else bad(f"{rel.split('/')[-1]} is not the reviewed build: nothing runs")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(2)
moved = []
for k in sorted(ALLNEED | set(SQLS)):
    b = subprocess.run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"], capture_output=True).stdout
    if b and hashlib.sha256(b).hexdigest() != sha(os.path.join(ROOT, k)) and not in_hist("HEAD", k, hashlib.sha256(b).hexdigest()): moved.append(k)
if moved: bad("main has newer versions of " + short(moved) + " than this reviewed build (merged after the review); deploying would roll them back. Tell Claude. Nothing runs."); done(2)
say(f"  ✓ main holds no newer version of any of the {len(ALLNEED)} files the nine services use, or of the two SQL files")

VJ = {}
for fn in FNS:
    sx, mx = fmeta(REF, fn)
    if sx == 404 and fn in NEW_OK: VJ[fn] = True; say(f"  ✓ {fn} is new (not live yet); it goes in with the gateway sign-in check on"); continue
    if sx == 404: bad(f"{fn} is not live at all; this step only brings it up to date. Tell Claude."); continue
    if not (sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool)): bad(f"could not read {fn} ({sx})"); continue
    VJ[fn] = mx["verify_jwt"]
    okl, livef = live_files(REF, fn)
    if not okl: bad(f"could not read {fn}'s live files"); continue
    mine = {k: sha(os.path.join(ROOT, k)) for k in NEED[fn]}
    differ = [k for k in sorted(mine) if livef.get(k) != mine[k]]
    missing = [k for k in differ if livef.get(k) is None]
    older = [k for k in differ if k not in missing and in_hist("HEAD", k, livef.get(k))]
    newer = [k for k in differ if k not in missing and k not in older and in_hist(MAIN, k, livef.get(k))]
    unknown = [k for k in differ if k not in missing and k not in older and k not in newer]
    unknown += [k for k in sorted(livef) if k not in mine and not in_hist(MAIN, k, livef[k]) and not in_hist("HEAD", k, livef[k])]
    gw = f"gateway sign-in check {'on' if VJ[fn] else 'off'}"
    if newer: bad(f"{fn}'s live copy holds {short(newer)} in a version newer than this build (from main, after the review); deploying would roll it back. Tell Claude.")
    elif unknown: bad(f"{fn}'s live copy holds {short(unknown)} in a version that was never on main (someone's unmerged work); deploying would overwrite it. Tell Claude.")
    elif differ: say(f"  ✓ {fn} is live at version {mx.get('version', '?')} ({gw}): "
                     + "; ".join(x for x in [f"older versions (from this build's own history) of {short(older)}" if older else "",
                                              f"built before it used {short(missing)}" if missing else ""] if x) + ". This deploy brings it up to date.")
    else: say(f"  ✓ {fn} is live at version {mx.get('version', '?')} ({gw}) and is already this build")
# 709 first: the Training Platform's offers carry the position key
ok_, tk = sql(TRN, "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'job_offers' and column_name = 'position_key') as col, "
                   "exists (select 1 from pg_trigger where tgname = 'trg_job_offers_position_permanent' and not tgisinternal) as trg")
if not ok_ or not tk: bad(f"could not read the Training Platform's offers table: {tk}")
elif not (tk[0]["col"] is True and tk[0]["trg"] is True): bad("the Training Platform has no job_offers.position_key yet: run 709 (LPN hiring, the Training half) first. Nothing runs."); done(3)
else: say("  ✓ 709 has run: the Training Platform's offers carry position_key, set once")
ok_, r = sql(REF, "select to_regclass('storage.objects') is not null as objs, to_regclass('public.document_access_log') is not null as dal, "
                  "to_regprocedure('public.upsert_app_data_item(text,jsonb)') is not null as door, to_regclass('public.evidence_history') is not null as ev, "
                  "(select count(*)::int from storage.buckets where id = 'nurse-docs') as bucket, "
                  "(select count(*)::int from pg_trigger where tgname = 'nurse_documents_keep' and not tgisinternal) as trig, "
                  "(select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('nurse_flag', 'rn_ghe_signature', 'rn_review_event')) as tables, "
                  "(select count(*)::int from public.app_data_key_hub_map where hub_slug = 'rn_review') as mapped, "
                  "to_regprocedure('public.can_access_data_key(text)') is not null as rule, "
                  f"(select count(*)::int from vault.decrypted_secrets where name = {lit(VAULT_NAME)}) as vault, "
                  "to_regclass('public.step1_forms') is not null as sf, to_regclass('public.step1_identity') is not null as si, to_regclass('public.client_journey_step_def') is not null as cat, "
                  "to_regclass('public.axiscare_change_log') is not null as log, exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'step1_forms' and column_name = 'hepb_form') as hepb, "
                  "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'step1_forms' and column_name = 'nurse_form') as nf")
if not ok_ or not r: bad(f"could not read the database pieces: {r}")
else:
    x = r[0]
    say("  ✓ storage, the document access log and the shared app_data door exist") if x["objs"] is True and x["dal"] is True and x["door"] is True else bad("storage.objects, document_access_log or upsert_app_data_item is missing. Tell Claude.")
    say("  ✓ the job secret is in the Vault (both schedules use it)") if int(x["vault"]) == 1 else bad("the Vault does not hold hub_job_secret. Tell Claude.")
    say("  ✓ the app_data access rule is there and no app_data key is mapped to rn_review (an RN review only sign-in will read none)") if x["rule"] is True and int(x["mapped"]) == 0 \
        else bad("can_access_data_key is missing, or an app_data key is mapped to rn_review (that would let an RN review only sign-in read it). Tell Claude.")
    say("  ✓ the Step 1 tables, the readiness catalog and the AxisCare change log exist (the Hepatitis B column too)") if all(x[k] is True for k in ["sf", "si", "cat", "log", "hepb"]) else bad("a table this step needs is missing (704 and the Step 1 tables first). Tell Claude.")
    say("  · the value history (slice 9) is " + ("in: waiting time on Natasha counts from when a form went to RN review" if x["ev"] is True else "not in: waiting time counts from each form's last save"))
    say(f"  · the RN review tables: {int(x['tables'])} of 3 already in; the nurse-docs bucket " + ("exists" if int(x["bucket"]) else "is new") + "; its keep-guard " + ("is in (replaced by the same file)" if int(x["trig"]) else "is new"))
    if x["nf"] is True: say("  · step1_forms.nurse_form is already there (a re-run): lpn-hiring-708.sql is safe to run again")
ok_, jr = sql(REF, "select jobname, schedule, active from cron.job where jobname in (" + ", ".join(lit(j) for j in JOBS) + ")")
if not ok_: bad(f"could not read the schedules: {jr}")
else:
    have = {j["jobname"] for j in jr}
    say("  · the schedules: " + "; ".join(f"{j} " + ("exists (it is replaced)" if j in have else "is new") for j in JOBS))
st0 = onb()
if st0 is None: bad("could not read the Hub switches (ops_settings)")
else:
    on_ = [k for k in MUST_BE_OFF if is_on(st0.get(k))]
    if on_: bad("these nurse switches are already on: " + ", ".join(on_) + ". This step expects them off. Tell Claude.")
    else: say("  ✓ the three nurse visit check switches are off (nurse visit checks, the do-not-bill hold, license reminders): everything runs as practice")
    say("  · shown only (this step changes none): " + ", ".join(f"{k} {'on' if is_on(st0.get(k)) else 'off'}" for k in SHOWN)
        + "; the nurse service list is " + ("the one saved on the Admin page" if isinstance(st0.get("nurse_services"), list) and st0.get("nurse_services") else "the built-in one"))
ok_, ns = sql(REF, "select data from public.app_data where key = 'nurse_staff'")
if ok_:
    staff = ns[0]["data"] if ns and isinstance(ns[0].get("data"), list) else []
    rns = [n for n in staff if isinstance(n, dict) and str(n.get("cred", "")).upper() == "RN"]
    sup = [n for n in rns if n.get("supervising_rn")]
    say("  · RNs on the nurse list: " + (", ".join(f"{n.get('name', '?')}{' (supervising)' if n.get('supervising_rn') else ''}{'' if n.get('email') else ' (no email: cannot sign in to the review page)'}" for n in rns) or "none yet"))
    if not sup: say("  ! no supervising RN is marked on the nurse list; LPN forms with no reviewing RN picked will have nobody to go to. Not stopping; mark Natasha as supervising RN on Nurse Scheduling.")
else: say(f"  · could not read the nurse list ({str(ns)[:120]}); not stopping")
ok_, r = sql(REF, "select key, case when jsonb_typeof(data) = 'array' then jsonb_array_length(data) else null end as n from public.app_data "
                  "where key in ('nurse_clients', 'medicaid_plans', 'nurse_staff', 'ghe_forms', 'ghe_watch')")
if ok_: say("  · what the visit check reads: " + ", ".join(f"{x['key']} {x['n']}" for x in sorted(r, key=lambda x: x["key"])))
ok_, r = sql(REF, "select coalesce(i->>'month', '') as month, coalesce(i->>'stage', '') as stage, count(*)::int as n from public.app_data a, "
                  "jsonb_array_elements(case when jsonb_typeof(a.data) = 'array' then a.data else '[]'::jsonb end) i where a.key = 'ghe_watch' group by 1, 2 order by 1, 2")
if ok_: say("  · the GHE watch (ghe-reminders) as of its last run: " + (", ".join(f"{x['month']} {x['stage']} {x['n']}" for x in r) if r else "no GHE months on Nurse Scheduling yet"))
ok_, fr = sql(REF, "select count(*)::int as n, count(*) filter (where completed_at is null and not coalesce(practice, false))::int as open_real from public.step1_forms")
FR0 = fr[0] if ok_ and fr else None
say(f"  · Step 1 records now: {FR0['n']} ({FR0['open_real']} real under way). Every one of them stays exactly as it is: the nursing license form is only in a Step 1 that starts from an LPN or RN offer after this step") if FR0 else bad(f"could not count the Step 1 records: {fr}")
ok_, cr = sql(REF, "select count(*) filter (where active)::int as active from public.client_journey_step_def where key like 'cg.%'")
CAT0 = cr[0]["active"] if ok_ and cr else None
say(f"  · {CAT0} caregiver readiness rows are active now; this step adds 4 that apply only to licensed nurses") if CAT0 is not None else bad(f"could not read the catalog: {cr}")
V0 = versions()
ok_, ks = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG()); ANON = SVC = ""
try:
    arr = json.loads(ks) if ok_ == 200 else []
    if isinstance(arr, dict): arr = arr.get("keys") or []
    for k in arr:
        v = str(k.get("api_key", "")) if isinstance(k, dict) else ""
        if k.get("name") == "anon" and v.startswith("eyJ"): ANON = v
        if k.get("name") == "service_role" and v.startswith("eyJ"): SVC = v
except Exception: pass
HIDE.extend([ANON, SVC])
say("  ✓ the project's public and server keys are readable (the schedules, the practice run and the proofs use them)") if ANON and SVC else bad("could not read the project's public and server keys")
say("  · what changes: nurse-review.sql and lpn-hiring-708.sql; rn-review, hub-access, nurse-visit-check, hire-profile, applicant-link, step2-handoff, caregiver-journey, offer-sign "
    "and step1-sign; the schedules rn-review-pass (every hour) and nurse-visit-check-pass (every 30 minutes). No switch, no person's record, no app_data change. Nothing is sent.")
say("  · other services that share a changed helper file are NOT redeployed by this step; they keep running their current live copy.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
for rel in SQLS:
    if not sql_reviewed(rel): bad(f"{rel.split('/')[-1]} changed since it was checked"); say("  RESULT: STOPPED. " + ("Nothing was changed." if rel == NURSE_SQL else "nurse-review.sql is in; nothing was deployed.") + " Tell Claude."); done(5)
src = open(os.path.join(ROOT, NURSE_SQL)).read()
TRIGGER_IN = True
ok_, r_ = sql(REF, src)
if ok_: say("  ✓ nurse-review.sql is in")
elif STORAGE_PERM.search(str(r_)) and re.search(rf"create trigger {TRIG}", src):
    bad(f"the keep-guard on signed nursing PDFs ({TRIG}) could NOT be added: the database did not allow a trigger on storage.objects (" + str(r_)[:160] + "). Those PDFs are NOT protected yet. Tell Claude. The rest carries on.")
    ok2, r2 = sql(REF, without_trigger(src))
    if not ok2: bad(f"the rest of nurse-review.sql did not install either: {r2}"); say("  RESULT: STOPPED. Nothing was deployed. Tell Claude."); done(5)
    TRIGGER_IN = False; say("  ✓ the rest of nurse-review.sql is in (the guard function is in, but nothing calls it until the trigger is added)")
else: bad(f"nurse-review.sql did not install: {r_}"); say("  RESULT: STOPPED. Nothing was deployed. Tell Claude."); done(5)
ok_, r_ = sql(REF, open(os.path.join(ROOT, LPN_SQL)).read())
if not ok_: bad(f"lpn-hiring-708.sql did not install: {str(r_)[:300]}"); say("  RESULT: STOPPED. nurse-review.sql is in (it changes nothing on its own); no service was deployed. Tell Claude."); done(5)
say("  ✓ lpn-hiring-708.sql is in")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, VJ[fn]): say(f"  RESULT: STOPPED at {fn}. Both SQL files are in (they change nothing on their own); the schedules were NOT added. Tell Claude."); done(6)
for job, (fn, sched, tmo, words) in JOBS.items():
    command = ("select net.http_post(url := " + lit(f"https://{REF}.supabase.co/functions/v1/{fn}") + ", headers := jsonb_build_object('Content-Type', 'application/json', "
               "'Authorization', " + lit("Bearer " + ANON) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
               f"body := '{{\"action\": \"pass\"}}'::jsonb, timeout_milliseconds := {tmo});")
    sql(REF, f"select cron.unschedule({lit(job)}) where exists (select 1 from cron.job where jobname = {lit(job)})")
    ok_, r_ = sql(REF, f"select cron.schedule({lit(job)}, {lit(sched)}, {lit(command)}) as id")
    say(f"  ✓ {job} scheduled {words} (practice until its switches are on)") if ok_ else bad(f"the schedule {job} did not install: {r_}")

say(); say("PART 3 · PROOF (nothing is sent; nothing is written to AxisCare; no real record changes)")
for fn in FNS:
    okl, livef = live_files(REF, fn); s_, m_ = fmeta(REF, fn)
    good = okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in NEED[fn])
    if good and (m_ or {}).get("verify_jwt") == VJ[fn]: say(f"  ✓ {fn} is live as tested (version {(m_ or {}).get('version', '?')}, gateway sign-in check {'on' if VJ[fn] else 'off'})")
    elif not good: bad(f"{fn}'s live copy is not this build")
    else: bad(f"{fn}'s gateway setting is not {'on' if VJ[fn] else 'off'}")
VIS = {"apikey": ANON, "Authorization": "Bearer " + ANON}
# ── RN review (was 706) ──
s1, _ = http("POST", f"{FNB}/functions/v1/rn-review", {"action": "queue"}, VIS)
say(f"  ✓ rn-review refuses a visitor who is not signed in ({s1})") if s1 in (401, 403) else bad(f"rn-review answered a visitor with {s1}")
s2, _ = http("POST", f"{FNB}/functions/v1/rn-review", {"action": "pass"}, VIS)
say(f"  ✓ rn-review refuses a pass without the job secret ({s2})") if s2 in (401, 403) else bad(f"rn-review ran a pass for a visitor ({s2})")
ALLP = "'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'"
tl = "array[" + ", ".join(lit(t) for t in RN_TABLES + ["rn_review_retention"]) + "]"
ok_, tr = sql(REF, f"select t, to_regclass('public.' || t) is not null as here, case when to_regclass('public.' || t) is null then null else "
                   f"has_table_privilege('anon', 'public.' || t, {ALLP}) or has_table_privilege('authenticated', 'public.' || t, {ALLP}) end as browser from unnest({tl}) t")
if not ok_: bad(f"could not read the new tables: {tr}")
else:
    absent = [x["t"] for x in tr if x["here"] is not True]; opened = [x["t"] for x in tr if x["here"] is True and x["browser"] is not False]
    if absent: bad("these are missing: " + ", ".join(absent))
    if opened: bad("a visitor or a signed-in page can reach: " + ", ".join(opened) + ". Tell Claude.")
    if not absent and not opened: say("  ✓ the three RN review tables and the seven-year view are in; a visitor or a signed-in page can reach none of them")
ok_, bk = sql(REF, "select public from storage.buckets where id = 'nurse-docs'")
say("  ✓ the nurse-docs bucket is private") if ok_ and bk and bk[0]["public"] is False else bad(f"the nurse-docs bucket: {bk}")
if TRIGGER_IN:
    probe = ("do $p$ declare m text := 'deleted'; begin "
             "perform set_config('storage.allow_delete_query', 'true', true); "
             f"insert into storage.objects (bucket_id, name) values ('nurse-docs', {lit(PROBE)}); "
             f"begin delete from storage.objects where bucket_id = 'nurse-docs' and name = {lit(PROBE)}; "
             "exception when others then m := sqlerrm; end; "
             "raise exception '710_PROBE_RESULT: %', m; end $p$")
    ok_, pr = sql(REF, probe); pr = str(pr)
    if ok_: bad("the keep-guard probe did not roll back as planned. Tell Claude.")
    elif "710_PROBE_RESULT" in pr and "kept for seven years" in pr: say("  ✓ a signed nursing PDF cannot be deleted: the database answered \"kept for seven years\" (tried on a probe inside one transaction that was rolled back)")
    elif "710_PROBE_RESULT: deleted" in pr: bad("the keep-guard let a signed nursing PDF be deleted (on the probe, rolled back). Tell Claude.")
    else: bad("the keep-guard probe could not run as planned: " + pr[:200])
else: say("  · the keep-guard was not tried (it could not be added; see the ✗ line above)")
ok_, pz = sql(REF, "select count(*)::int as n from storage.objects where starts_with(name, '_710_probe/')")
say("  ✓ no probe is left in storage") if ok_ and int(pz[0]["n"]) == 0 else bad(f"a probe row is left in storage: {pz}. Tell Claude.")
def as_persona(hubs, tag):
    claims = json.dumps({"role": "authenticated", "app_metadata": {"hub_access": hubs}})
    q = ("do $p$ declare n int; m int; begin "
         f"perform set_config('request.jwt.claims', {lit(claims)}, true); execute 'set local role authenticated'; "
         "select count(*) into n from public.app_data; "
         "select count(*) into m from public.app_data where key in ('ghe_forms', 'nurse_staff', 'nurse_clients', 'leads', 'caregivers', 'ops_settings'); "
         f"raise exception '{tag}: % %', n, m; end $p$")
    ok_, out = sql(REF, q); out = str(out); mm = re.search(tag + r": (\d+) (\d+)", out)
    return (int(mm.group(1)), int(mm.group(2))) if (not ok_ and mm) else None
rn_ = as_persona(["rn_review"], "710_RLS_RN"); cc_ = as_persona(["care_coordinator"], "710_RLS_CC")
if rn_ is None or cc_ is None: bad(f"the RN review only sign-in check could not run as planned ({rn_}, {cc_}). Tell Claude.")
elif rn_ == (0, 0) and cc_[0] > 0: say(f"  ✓ an RN review only sign-in reads no app_data key (0 rows; ghe_forms, nurse lists, leads, caregivers, settings: none), while a Care Coordinator Hub sign-in reads {cc_[0]} keys (tried as each sign-in inside one transaction that was rolled back)")
elif rn_ != (0, 0): bad(f"an RN review only sign-in can read {rn_[0]} app_data key(s). Do not give anyone RN review only until this is fixed. Tell Claude.")
else: bad("the check could not show a Care Coordinator Hub sign-in reading its keys, so the RN review only result proves nothing. Tell Claude.")
ok_, jr2 = sql(REF, "select jobname, schedule, active from cron.job where jobname in (" + ", ".join(lit(j) for j in JOBS) + ")")
jm = {j["jobname"]: j for j in (jr2 if ok_ else [])}
for job, (fn, sched, tmo, words) in JOBS.items():
    x = jm.get(job)
    say(f"  ✓ {job} is on, {words} ({sched})") if x and x["active"] is True and x["schedule"] == sched else bad(f"the schedule {job}: {x or jr2}")
# ── nurse visit checks (was 707) ──
s3, _ = http("POST", f"{FNB}/functions/v1/nurse-visit-check", {"action": "pass"}, VIS)
s4, _ = http("POST", f"{FNB}/functions/v1/nurse-visit-check", {"action": "report"}, VIS)
say("  ✓ nurse-visit-check refuses a visitor (the pass and the office report both answer 401)") if s3 == 401 and s4 == 401 else bad(f"nurse-visit-check did not refuse a visitor: pass {s3}, report {s4}")
s5, b5 = http("POST", f"{FNB}/functions/v1/nurse-visit-check?dry=1", {"action": "pass"}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, timeout=300)
try: j5 = json.loads(b5)
except Exception: j5 = {}
v, l = j5.get("visits") or {}, j5.get("license") or {}
if s5 == 200 and v.get("dry") is True and l.get("dry") is True:
    if v.get("ok") is False: bad("the practice run could not read AxisCare: " + str(v.get("error") or "no reason"))
    else: say(f"  ✓ practice run (nothing written): {v.get('clients', 0)} clients read, {v.get('visits_checked', 0)} completed nurse visits in the last 120 days, "
              f"{v.get('ready', 0)} ready, {v.get('not_ready', 0)} not ready" + (f", AxisCare could not be read for {v.get('read_failed')}" if v.get("read_failed") else "")
              + f"; service list {v.get('services_from', '?')}; license reminders due now: {l.get('due', 0)}")
else: bad(f"the practice run answered {s5}: {str(b5)[:200]}")
V1 = versions()
say("  ✓ the practice run wrote nothing (the Hub's nurse check records are unchanged)") if V0 is not None and V1 == V0 else bad(f"the nurse check records changed during the practice run: {V0} then {V1}")
# ── LPN hiring (was 708) ──
ok_, c = sql(REF, "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'step1_forms' and column_name = 'nurse_form') as nf, "
                  "exists (select 1 from pg_trigger where tgname = 'step1_forms_nurse_form_keep_t' and not tgisinternal) as trg, "
                  "(select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'step1_identity' and column_name in ('nurse_license_sealed', 'nurse_license_last4'))::int as idc, "
                  "has_table_privilege('authenticated', 'public.step1_identity', 'select') as leak, "
                  "(select pg_get_constraintdef(oid) from pg_constraint where conname = 'axiscare_change_log_kind_check') as kinds, "
                  "(select count(*) from public.client_journey_step_def where key in ('cg.credential.nurse_license', 'cg.nurse.orientation', 'cg.nurse.section2_ack', 'cg.step2.position_description') and active and def->'applies'->>'licensed_nurse' = 'true')::int as rows4, "
                  "(select count(*) filter (where active) from public.client_journey_step_def where key like 'cg.%')::int as active, "
                  "(select count(*) from public.step1_forms)::int as n, (select count(*) from public.step1_forms where nurse_form)::int as nurse")
if ok_ and c:
    x = c[0]
    say("  ✓ step1_forms.nurse_form and its keep trigger are in") if x["nf"] is True and x["trg"] is True else bad(f"nurse_form or its trigger is missing: {x}")
    say("  ✓ the sealed nursing license columns are in; no browser role reads step1_identity") if x["idc"] == 2 and x["leak"] is False else bad(f"the identity columns are not as expected: {x}")
    say("  ✓ the change log allows caregiver_class, and every kind it allowed before") if x["kinds"] and "caregiver_class" in x["kinds"] and "caregiver_level" in x["kinds"] and "client_created" in x["kinds"] else bad(f"the change log kinds: {x['kinds']}")
    say("  ✓ the four nurse readiness rows are active and apply only to licensed nurses") if x["rows4"] == 4 else bad(f"the nurse rows: {x['rows4']} of 4")
    say(f"  ✓ the caregiver rows are as they were: {x['active']} active now = {CAT0} + the 4 nurse rows") if CAT0 is not None and x["active"] == CAT0 + 4 else bad(f"the active catalog rows: {x['active']} (before {CAT0})")
    say(f"  ✓ no Step 1 record changed: {x['n']} on file, {x['nurse']} with the nursing license form") if FR0 and x["n"] >= FR0["n"] and x["nurse"] == 0 else (say(f"  · {x['nurse']} Step 1 records already have the nursing license form (an LPN or RN started Step 1 during the step)") if FR0 and x["n"] >= FR0["n"] else bad(f"Step 1 records: {x}"))
else: bad(f"could not read the result: {c}")
def call(fn, body):
    s_, b_ = http("POST", f"{FNB}/functions/v1/{fn}", body, VIS)
    try: return s_, json.loads(b_)
    except Exception: return s_, {}
s1, p1 = call("step1-sign", {"action": "preview"})
forms = [f for f in (p1.get("forms") or []) if isinstance(f, dict)]
if s1 == 200 and len(forms) == 14 and p1.get("form_count") == 13 and forms[-1].get("key") == "hepb_vaccination" and not any(f.get("key") == "nurse_license" for f in forms):
    say("  ✓ a caregiver's Step 1 is unchanged: the preview has 14 forms, 13 to sign, the Hepatitis B form last, no nursing license form")
else: bad(f"the Step 1 preview answered {s1}: {len(forms)} forms, form_count {p1.get('form_count')}")
s2, p2 = call("step1-sign", {"action": "preview", "position": "lpn"})
nf = [f for f in (p2.get("forms") or []) if isinstance(f, dict)]
if s2 == 200 and len(nf) == 15 and p2.get("form_count") == 14 and nf[-1].get("key") == "nurse_license" and nf[-1].get("approved_for_real") is False and "17" in (p2.get("screens") or []):
    say("  ✓ an LPN's Step 1 (preview): 15 forms, 14 to sign, Your Nursing License last (screen 17), proposed, NOT approved for real")
else: bad(f"the LPN Step 1 preview answered {s2}: {len(nf)} forms")
chk = [{"form": f.get("key"), "version": f.get("version")} for f in forms]
s3, p3 = call("step1-sign", {"action": "preview", "approval_check": chk + [{"form": "nurse_license", "version": 1}]})
ac = p3.get("approval_check") if isinstance(p3.get("approval_check"), list) else []
if s3 == 200 and len(ac) == 15 and all(x.get("accepted") is True for x in ac[:14]) and ac[14].get("accepted") is False:
    say("  ✓ a real applicant may still sign every caregiver Step 1 form; the nursing license form is refused for real until she approves it")
else: bad(f"the approval check answered {s3}: " + ", ".join(f"{x.get('form')} {x.get('accepted')}" for x in ac))
s4, p4 = call("offer-sign", {"action": "preview"})
if s4 == 200 and p4.get("pd") and (p4.get("versions") or {}).get("offer") == 2 and (p4.get("versions") or {}).get("pd") == 2 and not p4.get("letter_only"):
    say("  ✓ a caregiver offer is unchanged: the letter and the position description, versions 2 and 2")
else: bad(f"the offer preview answered {s4}: {p4.get('versions')}")
s5, p5 = call("offer-sign", {"action": "preview", "position": "lpn"})
lt = "\n".join(str(b.get("t", "")) for b in (p5.get("offer") or []) if isinstance(b, dict))
if s5 == 200 and p5.get("letter_only") is True and p5.get("pd") is None and p5.get("approved") is False and "Licensed Practical Nurse (LPN)" in lt and "field caregiver" not in lt:
    say("  ✓ an LPN offer (preview): the licensed nurse letter alone, no position description, no \"field caregiver\", NOT approved yet")
else: bad(f"the LPN offer preview answered {s5}")
st1 = onb()
if st1 is None: bad("could not read the Hub switches again")
else:
    moved = sorted(k for k in set(st0 or {}) | set(st1) if (k.endswith("_live") or k in ALL_SW) and (st0 or {}).get(k) != st1.get(k))
    say("  ✓ no switch changed (" + ", ".join(f"{k} {'on' if is_on(st1.get(k)) else 'off'}" for k in ["nurse_review_live", "nurse_visit_check_live", "nurse_bill_hold_live", "nurse_license_reminders_live", "nurse_hire_live"]) + ")") \
        if not moved else bad("these switches changed during the step: " + ", ".join(moved))
say("  ✓ nothing was sent: the only calls were refusals, one practice run and the read-only previews")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the nurse program is installed on the Hub project, all of it OFF:")
say("  ✓ RN review: three server-only tables, the private nurse-docs bucket with its seven-year keep-guard, the keeper of the RN's signature on a GHE form, rn-review, hub-access with RN review only, and the hourly rn-review-pass")
say("  ✓ nurse visit checks: nurse-visit-check runs every 30 minutes as PRACTICE (it reads AxisCare and fills the list on Nurse Scheduling; no cards, nothing sent, nothing written to AxisCare)")
say("  ✓ LPN hiring: caregivers have the same offer, Step 1 and readiness card; an LPN or RN gets the letter only, Step 1 with Your Nursing License, the four nurse rows and the nurse setup in practice")
say("  ✓ waiting for Samantha: \"approve nurse wording\" (the nurse letter, Your Nursing License, the documents, the reminders, Natasha's page and the switch wording); every switch stays off")
say("NEXT: merge the Hub pull request (rn.html, the Nurse Portal, Nurse Scheduling, the offer and Step 1 pages) and the Owners Hub pull request (the five switches, the nurse services list, the RN review only card). "
    "Then give Natasha RN review only (Owners Hub Admin page, Team) with the email on her nurse record; she signs in at cc.mo-care.com/rn.html."); done(0)
