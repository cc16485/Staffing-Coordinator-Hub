#!/usr/bin/env python3
# 706 · RN REVIEW, THE HUB PROJECT (LPN nurse visit plan steps 5 to 7; Samantha approved "approve nursing plan" 2026-10-14;
# build spec launch/review/lpn/build-spec.md). Hub project. Staffing PR "rn-review".
# PART 1 reads only and stops before any change if anything is wrong: the reviewed build (every file rn-review needs and the
# SQL file, pinned); main has not moved on in those files since the review; rn-review's live copy, if it is live already,
# against this build and main's history (a live file from main's history is just older; a live file never on main is
# someone's unmerged work: STOP) and its gateway setting; the database pieces it needs (storage, the document access log,
# the shared app_data door, the job secret in the Vault); the RN review tables (new or already in); the schedule; the switch
# nurse_review_live (shown only); who is on the nurse list as an RN (names only).
# PART 2 changes, in this order: nurse-review.sql (checked against its pin right before it runs); rn-review deployed (new; gateway
# sign-in check on, or kept as it is if already live) and hub-access deployed (it may now give "RN review only"; keeps its own
# gateway setting); one hourly schedule rn-review-pass.
# PART 3 proves it with nothing sent and no real record changed: rn-review is live as tested; it refuses a visitor and a
# pass without the job secret; the tables are in and closed to browsers; the bucket is private; the keep-guard is tried on a
# probe inside one transaction that always rolls back; no probe is left; the schedule is on; an "RN review only" sign-in reads
# no app_data key (tried as that sign-in inside one transaction that always rolls back, beside a Care Coordinator Hub
# sign-in that does read its keys); no switch changed.
# This step never turns a switch on. Natasha's sign-in is not created here (that is yours, on the Team Access page).
# ORDER: merge Staffing PR rn-review (merge commit, not squash), then run this. Then merge the Hub and Owners Hub PRs.
import os, re, json, subprocess, hashlib
os.environ.setdefault("SB_STEP", "706")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FN = "rn-review"; NEW_VJ = True
FNS = ["rn-review", "hub-access"]   # rn-review is new; hub-access is live and only brought up to date
SQL = "supabase/nurse-review.sql"
JOB = "rn-review-pass"; SCHED = "7 * * * *"; VAULT_NAME = "hub_job_secret"
SWITCH = "nurse_review_live"
TABLES = ["nurse_flag", "rn_ghe_signature", "rn_review_event"]
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
PROBE = "_706_probe/x.pdf"
_H = {}
def hist(ref, rel):
    if (ref, rel) not in _H:
        out = set()
        try:
            for c in subprocess.run(["git", "-C", ROOT, "log", ref, "--format=%H", "--", rel], capture_output=True, text=True, timeout=120).stdout.split():
                b = subprocess.run(["git", "-C", ROOT, "show", f"{c}:{rel}"], capture_output=True, timeout=60).stdout
                if b: out.add(hashlib.sha256(b).hexdigest())
        except Exception: pass
        _H[(ref, rel)] = out
    return _H[(ref, rel)]
short = lambda ks: ", ".join(k.split("/")[-2] + "/" + k.split("/")[-1] for k in ks[:4]) + (f" and {len(ks) - 4} more" if len(ks) > 4 else "")
def onb():
    ok_, r = sql(REF, "select data, version from public.app_data where key = 'ops_settings'")
    if not ok_ or not r: return None
    d = r[0].get("data"); return d if isinstance(d, dict) else {}
def is_on(v): return v is True or str(v).lower() == "true"
STORAGE_PERM = re.compile(r"must be owner|permission denied|42501|insufficient_privilege", re.I)
TRIG = "nurse_documents_keep"
def without_trigger(src):
    src = re.sub(rf"drop trigger if exists {TRIG} on storage\.objects;\s*", "", src)
    return re.sub(rf"create trigger {TRIG} before [^;]*? on storage\.objects\s.*?execute function [\w.]+\(\);\s*", "", src, flags=re.S | re.I)

start("RN REVIEW, THE HUB PROJECT")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
FN_SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))
check_build(FNROOT, FN_SHAS)
NEED = {fn: need(FNROOT, fn) for fn in FNS}
if not all(NEED.values()): bad("rn-review or hub-access is not in the reviewed build. Nothing runs."); done(2)
ALLNEED = set().union(*NEED.values())
unpinned = sorted(ALLNEED - {"supabase/functions/" + k for k in FN_SHAS})
if unpinned: bad("these files the services need are not pinned to the reviewed build: " + short(unpinned) + ". Nothing runs."); done(2)
SQL_SHA = os.environ.get("SB_SQL_SHA", "").strip().lower()
sql_ok = lambda: os.path.exists(os.path.join(ROOT, SQL)) and SQL_SHA and sha(os.path.join(ROOT, SQL)) == SQL_SHA
say("  ✓ nurse-review.sql is the reviewed build") if sql_ok() else bad("nurse-review.sql is not the reviewed build: nothing runs")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(2)
moved = []
for k in sorted(ALLNEED | {SQL}):
    b = subprocess.run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"], capture_output=True).stdout
    if b and hashlib.sha256(b).hexdigest() != sha(os.path.join(ROOT, k)) and hashlib.sha256(b).hexdigest() not in hist("HEAD", k): moved.append(k)
if moved: bad("main has newer versions of " + short(moved) + " than this reviewed build (merged after the review); running this would roll them back. Tell Claude. Nothing runs."); done(2)
say("  ✓ main holds no newer version of any file this step uses")

VJ = {}
for fn in FNS:
    sx, mx = fmeta(REF, fn)
    if sx == 404 and fn == FN: VJ[fn] = NEW_VJ; say(f"  ✓ rn-review is new (not live yet); it goes in with the gateway sign-in check on"); continue
    if sx == 404: bad(f"{fn} is not live at all; this step only brings it up to date. Tell Claude."); continue
    if not (sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool)): bad(f"could not read {fn} ({sx})"); continue
    VJ[fn] = mx["verify_jwt"]
    okl, livef = live_files(REF, fn)
    if not okl: bad(f"could not read {fn}'s live files"); continue
    mine = {k: sha(os.path.join(ROOT, k)) for k in NEED[fn]}
    differ = [k for k in sorted(mine) if livef.get(k) != mine[k]]
    missing = [k for k in differ if livef.get(k) is None]
    older = [k for k in differ if k not in missing and livef.get(k) in hist(MAIN, k)]
    unknown = [k for k in differ if k not in missing and k not in older] + [k for k in sorted(livef) if k not in mine and livef[k] not in hist(MAIN, k)]
    gw = f"gateway sign-in check {'on' if VJ[fn] else 'off'}"
    if unknown: bad(f"{fn}'s live copy holds {short(unknown)} in a version that was never on main (someone's unmerged work); deploying would overwrite it. Tell Claude.")
    elif differ: say(f"  ✓ {fn} is live at version {mx.get('version', '?')} ({gw}) with older versions (from main's own history) of {short(older + missing)}. This deploy brings it up to date.")
    else: say(f"  ✓ {fn} is live at version {mx.get('version', '?')} ({gw}) and is already this build")
ok_, r = sql(REF, "select to_regclass('storage.objects') is not null as objs, to_regclass('public.document_access_log') is not null as dal, "
                  "to_regprocedure('public.upsert_app_data_item(text,jsonb)') is not null as door, to_regclass('public.evidence_history') is not null as ev, "
                  "(select count(*)::int from storage.buckets where id = 'nurse-docs') as bucket, "
                  "(select count(*)::int from pg_trigger where tgname = 'nurse_documents_keep' and not tgisinternal) as trig, "
                  "(select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('nurse_flag', 'rn_ghe_signature', 'rn_review_event')) as tables, "
                  "(select count(*)::int from public.app_data_key_hub_map where hub_slug = 'rn_review') as mapped, "
                  "to_regprocedure('public.can_access_data_key(text)') is not null as rule, "
                  f"(select count(*)::int from vault.decrypted_secrets where name = {lit(VAULT_NAME)}) as vault")
if not ok_: bad(f"could not read the database pieces: {r}")
else:
    x = r[0]
    say("  ✓ storage, the document access log and the shared app_data door exist") if x["objs"] is True and x["dal"] is True and x["door"] is True else bad("storage.objects, document_access_log or upsert_app_data_item is missing. Tell Claude.")
    say("  ✓ the job secret is in the Vault (the hourly schedule uses it)") if int(x["vault"]) == 1 else bad("the Vault does not hold hub_job_secret. Tell Claude.")
    say("  ✓ the app_data access rule is there and no app_data key is mapped to rn_review (an RN review only sign-in will read none)") if x["rule"] is True and int(x["mapped"]) == 0 \
        else bad("can_access_data_key is missing, or an app_data key is mapped to rn_review (that would let an RN review only sign-in read it). Tell Claude.")
    say("  · the value history (slice 9) is " + ("in: waiting time on Natasha counts from when a form went to RN review" if x["ev"] is True else "not in: waiting time counts from each form's last save"))
    say(f"  · the RN review tables: {int(x['tables'])} of 3 already in; the nurse-docs bucket " + ("exists" if int(x["bucket"]) else "is new") + "; its keep-guard " + ("is in (replaced by the same file)" if int(x["trig"]) else "is new"))
ok_, jr = sql(REF, f"select jobname, schedule, active from cron.job where jobname = {lit(JOB)}")
if not ok_: bad(f"could not read the schedules: {jr}")
else: say(f"  · the schedule {JOB} " + ("exists (it is replaced)" if jr else "is new"))
st0 = onb()
if st0 is None: bad("could not read the Hub switches (ops_settings)")
else:
    say(f"  · the switch {SWITCH} is {'ON' if is_on(st0.get(SWITCH)) else 'off (practice)'}; this step does not change it")
ok_, ns = sql(REF, "select data from public.app_data where key = 'nurse_staff'")
if ok_:
    staff = ns[0]["data"] if ns and isinstance(ns[0].get("data"), list) else []
    rns = [n for n in staff if isinstance(n, dict) and str(n.get("cred", "")).upper() == "RN"]
    sup = [n for n in rns if n.get("supervising_rn")]
    say("  · RNs on the nurse list: " + (", ".join(f"{n.get('name', '?')}{' (supervising)' if n.get('supervising_rn') else ''}{'' if n.get('email') else ' (no email: cannot sign in to the review page)'}" for n in rns) or "none yet"))
    if not sup: say("  ! no supervising RN is marked on the nurse list; LPN forms with no reviewing RN picked will have nobody to go to. Not stopping; mark Natasha as supervising RN on Nurse Scheduling.")
else: say(f"  · could not read the nurse list ({str(ns)[:120]}); not stopping")
ok_, ks = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG()); ANON = ""
try:
    arr = json.loads(ks) if ok_ == 200 else []
    if isinstance(arr, dict): arr = arr.get("keys") or []
    for k in arr:
        v = str(k.get("api_key", "")) if isinstance(k, dict) else ""
        if k.get("name") == "anon" and v.startswith("eyJ"): ANON = v
except Exception: pass
HIDE.append(ANON)
say("  ✓ the project's public key is readable (the schedule and the proofs use it)") if ANON else bad("could not read the project's public key")
say("  · what changes: three server-only tables (LPN marks, the RN's signatures, their history), the private nurse-docs bucket with its keep-guard, "
    "a read-only seven-year view, the keeper of the RN's signature on a GHE form, the rn-review service, hub-access (it may now give RN review only), "
    "and one hourly schedule. No switch, no person's record, no app_data change. Nothing is sent.")
say("  · other services that share a changed helper file are NOT redeployed by this step; they keep running their current live copy.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
if not sql_ok(): bad("nurse-review.sql changed since it was checked"); say("  RESULT: STOPPED. Nothing was changed. Tell Claude."); done(5)
src = open(os.path.join(ROOT, SQL)).read()
TRIGGER_IN = True
ok_, r_ = sql(REF, src)
if ok_: say("  ✓ nurse-review.sql is in")
elif STORAGE_PERM.search(str(r_)) and re.search(rf"create trigger {TRIG}", src):
    bad(f"the keep-guard on signed nursing PDFs ({TRIG}) could NOT be added: the database did not allow a trigger on storage.objects (" + str(r_)[:160] + "). Those PDFs are NOT protected yet. Tell Claude. The rest carries on.")
    ok2, r2 = sql(REF, without_trigger(src))
    if not ok2: bad(f"the rest of nurse-review.sql did not install either: {r2}"); say("  RESULT: STOPPED. Nothing was deployed. Tell Claude."); done(5)
    TRIGGER_IN = False; say("  ✓ the rest of nurse-review.sql is in (the guard function is in, but nothing calls it until the trigger is added)")
else: bad(f"nurse-review.sql did not install: {r_}"); say("  RESULT: STOPPED. Nothing was deployed. Tell Claude."); done(5)
for fn in FNS:
    if not deploy(REF, FNROOT, fn, VJ[fn]): say(f"  RESULT: STOPPED. The SQL is in; {fn} did not deploy cleanly. Tell Claude."); done(6)
command = ("select net.http_post(url := " + lit(f"https://{REF}.supabase.co/functions/v1/{FN}") + ", headers := jsonb_build_object('Content-Type', 'application/json', "
           "'Authorization', " + lit("Bearer " + ANON) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
           "body := '{\"action\": \"pass\"}'::jsonb, timeout_milliseconds := 120000);")
sql(REF, f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
ok_, r_ = sql(REF, f"select cron.schedule({lit(JOB)}, {lit(SCHED)}, {lit(command)}) as id")
say(f"  ✓ {JOB} scheduled every hour (practice until nurse_review_live is on: it counts, raises no card)") if ok_ else bad(f"the schedule {JOB} did not install: {r_}")

say(); say("PART 3 · PROOF (nothing is sent; no real record changes)")
for fn in FNS:
    okl, livef = live_files(REF, fn); s_, m_ = fmeta(REF, fn)
    good = okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in NEED[fn])
    if good and (m_ or {}).get("verify_jwt") == VJ[fn]: say(f"  ✓ {fn} is live as tested (version {(m_ or {}).get('version', '?')}, gateway sign-in check {'on' if VJ[fn] else 'off'})")
    elif not good: bad(f"{fn}'s live copy is not this build")
    else: bad(f"{fn}'s gateway setting is not {'on' if VJ[fn] else 'off'}")
vis = {"apikey": ANON, "Authorization": "Bearer " + ANON}
s1, _ = http("POST", f"{FNB}/functions/v1/{FN}", {"action": "queue"}, vis)
say(f"  ✓ rn-review refuses a visitor who is not signed in ({s1})") if s1 in (401, 403) else bad(f"rn-review answered a visitor with {s1}")
s2, _ = http("POST", f"{FNB}/functions/v1/{FN}", {"action": "pass"}, vis)
say(f"  ✓ rn-review refuses a pass without the job secret ({s2})") if s2 in (401, 403) else bad(f"rn-review ran a pass for a visitor ({s2})")
ALLP = "'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'"
tl = "array[" + ", ".join(lit(t) for t in TABLES + ["rn_review_retention"]) + "]"
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
             "raise exception '706_PROBE_RESULT: %', m; end $p$")
    ok_, pr = sql(REF, probe); pr = str(pr)
    if ok_: bad("the keep-guard probe did not roll back as planned. Tell Claude.")
    elif "706_PROBE_RESULT" in pr and "kept for seven years" in pr: say("  ✓ a signed nursing PDF cannot be deleted: the database answered \"kept for seven years\" (tried on a probe inside one transaction that was rolled back)")
    elif "706_PROBE_RESULT: deleted" in pr: bad("the keep-guard let a signed nursing PDF be deleted (on the probe, rolled back). Tell Claude.")
    else: bad("the keep-guard probe could not run as planned: " + pr[:200])
else: say("  · the keep-guard was not tried (it could not be added; see the ✗ line above)")
ok_, pz = sql(REF, "select count(*)::int as n from storage.objects where starts_with(name, '_706_probe/')")
say("  ✓ no probe is left in storage") if ok_ and int(pz[0]["n"]) == 0 else bad(f"a probe row is left in storage: {pz}. Tell Claude.")
ok_, jr2 = sql(REF, f"select jobname, schedule, active from cron.job where jobname = {lit(JOB)}")
x = jr2[0] if ok_ and jr2 else None
say(f"  ✓ {JOB} is on, every hour ({SCHED})") if x and x["active"] is True and x["schedule"] == SCHED else bad(f"the schedule {JOB}: {x or jr2}")
def as_persona(hubs, tag):
    claims = json.dumps({"role": "authenticated", "app_metadata": {"hub_access": hubs}})
    q = ("do $p$ declare n int; m int; begin "
         f"perform set_config('request.jwt.claims', {lit(claims)}, true); execute 'set local role authenticated'; "
         "select count(*) into n from public.app_data; "
         "select count(*) into m from public.app_data where key in ('ghe_forms', 'nurse_staff', 'nurse_clients', 'leads', 'caregivers', 'ops_settings'); "
         f"raise exception '{tag}: % %', n, m; end $p$")
    ok_, out = sql(REF, q); out = str(out); mm = re.search(tag + r": (\d+) (\d+)", out)
    return (int(mm.group(1)), int(mm.group(2))) if (not ok_ and mm) else None
rn_ = as_persona(["rn_review"], "706_RLS_RN"); cc_ = as_persona(["care_coordinator"], "706_RLS_CC")
if rn_ is None or cc_ is None: bad(f"the RN review only sign-in check could not run as planned ({rn_}, {cc_}). Tell Claude.")
elif rn_ == (0, 0) and cc_[0] > 0: say(f"  ✓ an RN review only sign-in reads no app_data key (0 rows; ghe_forms, nurse lists, leads, caregivers, settings: none), while a Care Coordinator Hub sign-in reads {cc_[0]} keys (tried as each sign-in inside one transaction that was rolled back)")
elif rn_ != (0, 0): bad(f"an RN review only sign-in can read {rn_[0]} app_data key(s). Do not give anyone RN review only until this is fixed. Tell Claude.")
else: bad("the check could not show a Care Coordinator Hub sign-in reading its keys, so the RN review only result proves nothing. Tell Claude.")
st1 = onb()
if st1 is None: bad("could not read the Hub switches again")
else:
    moved = sorted(k for k in set(st0 or {}) | set(st1) if k.endswith("_live") and (st0 or {}).get(k) != st1.get(k))
    say(f"  ✓ no switch changed ({SWITCH} is still {'ON' if is_on(st1.get(SWITCH)) else 'off'})") if not moved else bad("these switches changed during the step: " + ", ".join(moved))
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · RN review is installed on the Hub project: three server-only tables, the private nurse-docs bucket with its seven-year keep-guard, "
    "the keeper of the RN's signature on a GHE form, the rn-review service, hub-access with RN review only, and one hourly schedule. "
    "No switch changed. Nothing was sent; no real record changed.")
say("NEXT: merge the Hub pull request (rn.html and the Nurse Portal) and the Owners Hub pull request (the RN review switch). "
    "Then give Natasha RN review only (Owners Hub Admin page, Team) with the email on her nurse record; she signs in at cc.mo-care.com/rn.html. "
    "Turn on RN review on the Admin page when you are ready."); done(0)
