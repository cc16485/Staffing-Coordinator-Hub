#!/usr/bin/env python3
# 706 · RN REVIEW, THE HUB PROJECT (LPN nurse visit plan steps 5 to 7; Samantha approved "approve nursing plan" 2026-10-14;
# build spec launch/review/lpn/build-spec.md). Hub project. Staffing PR "rn-review".
# PART 1 reads only and stops before any change if anything is wrong: the reviewed build (every file rn-review needs and the
# SQL file, pinned); main has not moved on in those files since the review; rn-review's live copy, if it is live already,
# against this build and main's history (a live file from main's history is just older; a live file never on main is
# someone's unmerged work: STOP) and its gateway setting; the database pieces it needs (storage, the document access log,
# the shared app_data door, the job secret in the Vault); the RN review tables (new or already in); the schedule; the switch
# nurse_review_live (shown only); who is on the nurse list as an RN (names only).
# PART 2 changes, in this order: nurse-review.sql (checked against its pin right before it runs); rn-review deployed (the only
# new or changed service; gateway sign-in check on, or kept as it is if already live); one hourly schedule rn-review-pass.
# PART 3 proves it with nothing sent and no real record changed: rn-review is live as tested; it refuses a visitor and a
# pass without the job secret; the tables are in and closed to browsers; the bucket is private; the keep-guard is tried on a
# probe inside one transaction that always rolls back; no probe is left; the schedule is on; no switch changed.
# This step never turns a switch on. Natasha's sign-in is not created here (that is yours, on the Team Access page).
# ORDER: merge Staffing PR rn-review (merge commit, not squash), then run this. Then merge the Hub and Owners Hub PRs.
import os, re, json, subprocess, hashlib
os.environ.setdefault("SB_STEP", "706")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FN = "rn-review"; NEW_VJ = True
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
NEED = need(FNROOT, FN)
if not NEED: bad("rn-review is not in the reviewed build. Nothing runs."); done(2)
unpinned = sorted(NEED - {"supabase/functions/" + k for k in FN_SHAS})
if unpinned: bad("these files rn-review needs are not pinned to the reviewed build: " + short(unpinned) + ". Nothing runs."); done(2)
SQL_SHA = os.environ.get("SB_SQL_SHA", "").strip().lower()
sql_ok = lambda: os.path.exists(os.path.join(ROOT, SQL)) and SQL_SHA and sha(os.path.join(ROOT, SQL)) == SQL_SHA
say("  ✓ nurse-review.sql is the reviewed build") if sql_ok() else bad("nurse-review.sql is not the reviewed build: nothing runs")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(2)
moved = []
for k in sorted(NEED | {SQL}):
    b = subprocess.run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"], capture_output=True).stdout
    if b and hashlib.sha256(b).hexdigest() != sha(os.path.join(ROOT, k)) and hashlib.sha256(b).hexdigest() not in hist("HEAD", k): moved.append(k)
if moved: bad("main has newer versions of " + short(moved) + " than this reviewed build (merged after the review); running this would roll them back. Tell Claude. Nothing runs."); done(2)
say("  ✓ main holds no newer version of any file this step uses")

VJ = NEW_VJ
sx, mx = fmeta(REF, FN)
if sx == 404: say(f"  ✓ rn-review is new (not live yet); it goes in with the gateway sign-in check on")
elif not (sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool)): bad(f"could not read rn-review ({sx})")
else:
    VJ = mx["verify_jwt"]
    okl, livef = live_files(REF, FN)
    if not okl: bad("could not read rn-review's live files")
    else:
        mine = {k: sha(os.path.join(ROOT, k)) for k in NEED}
        differ = [k for k in sorted(mine) if livef.get(k) != mine[k]]
        missing = [k for k in differ if livef.get(k) is None]
        older = [k for k in differ if k not in missing and livef.get(k) in hist(MAIN, k)]
        unknown = [k for k in differ if k not in missing and k not in older] + [k for k in sorted(livef) if k not in mine and livef[k] not in hist(MAIN, k)]
        gw = f"gateway sign-in check {'on' if VJ else 'off'}"
        if unknown: bad(f"rn-review's live copy holds {short(unknown)} in a version that was never on main (someone's unmerged work); deploying would overwrite it. Tell Claude.")
        elif differ: say(f"  ✓ rn-review is live at version {mx.get('version', '?')} ({gw}) with older versions (from main's own history) of {short(older + missing)}. This deploy brings it up to date.")
        else: say(f"  ✓ rn-review is live at version {mx.get('version', '?')} ({gw}) and is already this build")
ok_, r = sql(REF, "select to_regclass('storage.objects') is not null as objs, to_regclass('public.document_access_log') is not null as dal, "
                  "to_regprocedure('public.upsert_app_data_item(text,jsonb)') is not null as door, to_regclass('public.evidence_history') is not null as ev, "
                  "(select count(*)::int from storage.buckets where id = 'nurse-docs') as bucket, "
                  "(select count(*)::int from pg_trigger where tgname = 'nurse_documents_keep' and not tgisinternal) as trig, "
                  "(select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('nurse_flag', 'rn_ghe_signature', 'rn_review_event')) as tables, "
                  f"(select count(*)::int from vault.decrypted_secrets where name = {lit(VAULT_NAME)}) as vault")
if not ok_: bad(f"could not read the database pieces: {r}")
else:
    x = r[0]
    say("  ✓ storage, the document access log and the shared app_data door exist") if x["objs"] is True and x["dal"] is True and x["door"] is True else bad("storage.objects, document_access_log or upsert_app_data_item is missing. Tell Claude.")
    say("  ✓ the job secret is in the Vault (the hourly schedule uses it)") if int(x["vault"]) == 1 else bad("the Vault does not hold hub_job_secret. Tell Claude.")
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
    "a read-only seven-year view, the rn-review service and one hourly schedule. No switch, no person's record, no app_data change. Nothing is sent.")
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
if not deploy(REF, FNROOT, FN, VJ): say("  RESULT: STOPPED. The SQL is in; rn-review did not deploy cleanly. Tell Claude."); done(6)
command = ("select net.http_post(url := " + lit(f"https://{REF}.supabase.co/functions/v1/{FN}") + ", headers := jsonb_build_object('Content-Type', 'application/json', "
           "'Authorization', " + lit("Bearer " + ANON) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
           "body := '{\"action\": \"pass\"}'::jsonb, timeout_milliseconds := 120000);")
sql(REF, f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
ok_, r_ = sql(REF, f"select cron.schedule({lit(JOB)}, {lit(SCHED)}, {lit(command)}) as id")
say(f"  ✓ {JOB} scheduled every hour (practice until nurse_review_live is on: it counts, raises no card)") if ok_ else bad(f"the schedule {JOB} did not install: {r_}")

say(); say("PART 3 · PROOF (nothing is sent; no real record changes)")
okl, livef = live_files(REF, FN); s_, m_ = fmeta(REF, FN)
good = okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in NEED)
if good and (m_ or {}).get("verify_jwt") == VJ: say(f"  ✓ rn-review is live as tested (version {(m_ or {}).get('version', '?')}, gateway sign-in check {'on' if VJ else 'off'})")
elif not good: bad("rn-review's live copy is not this build")
else: bad(f"rn-review's gateway setting is not {'on' if VJ else 'off'}")
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
st1 = onb()
if st1 is None: bad("could not read the Hub switches again")
else:
    moved = sorted(k for k in set(st0 or {}) | set(st1) if k.endswith("_live") and (st0 or {}).get(k) != st1.get(k))
    say(f"  ✓ no switch changed ({SWITCH} is still {'ON' if is_on(st1.get(SWITCH)) else 'off'})") if not moved else bad("these switches changed during the step: " + ", ".join(moved))
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · RN review is installed on the Hub project: three server-only tables, the private nurse-docs bucket with its seven-year keep-guard, "
    "the rn-review service and one hourly schedule. No switch changed. Nothing was sent; no real record changed.")
say("NEXT: merge the Hub pull request (rn.html and the Nurse Portal) and the Owners Hub pull request (the RN review switch). "
    "Natasha signs in at cc.mo-care.com/rn.html once her Hub sign-in exists; turn on RN review on the Owners Hub Admin page when you are ready."); done(0)
