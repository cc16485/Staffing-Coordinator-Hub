#!/usr/bin/env python3
# 701 · ONBOARDING GO-LIVE, THE HUB HALF (Samantha 2026-10-13). Hub project. Staffing PR #413.
# PART 1 reads only and stops before any change if anything is wrong: the reviewed build; for each of the eleven services,
# its live files against this build (a live file from main's own history is just older and is named; a live file that was
# never on main is someone's unmerged work: STOP); each service's gateway sign-in setting; the database pieces; the three
# schedules; the switch date (must NOT be set) and the onboarding switches (shown only); Step 1 records, practice and real.
# PART 2 changes: the tightened Step 1 link (step1-link-tighten.sql), seven-year retention for signed onboarding documents
# (onboarding-retention-700.sql), and the eleven services deployed, each keeping its own gateway setting.
# PART 3 proves it with nothing sent and no real record changed: the retention guard is tried inside one transaction that
# always rolls back.
# This step never sets the switch date and never turns a switch on.
# ORDER: merge Staffing PR #413 (merge commit, not squash), then run this.
import os, re, json, subprocess, hashlib
os.environ.setdefault("SB_STEP", "701")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FNS = ["bg-review", "caregiver-export", "caregiver-journey", "hire-profile", "match-dark", "offer-sign", "reference-send",
       "reference-tasks", "step1-sign", "step2-handoff", "welcome-call"]
SQL_LINK = "supabase/step1-link-tighten.sql"; SQL_KEEP = "supabase/onboarding-retention-700.sql"
JOBS = [("caregiver-journey-sweep", "*/10 * * * *"), ("caregiver-audit-nightly", "5 11 * * *"), ("step2-handoff-pass", "*/15 * * * *")]
SWITCHES = ["offer_send_live", "offer_reminders_live", "step1_auto_live", "step2_send_live", "step2_reminders_live", "wc_auto_invite_live",
            "orient_remind_live", "approve_work_text_live", "approve_work_axiscare_live", "axiscare_hire_date_live", "axiscare_level_live"]
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
PROBE = "_701_probe/x.pdf"
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
    ok_, r = sql(REF, "select data from public.app_data where key = 'ops_settings'")
    return (r[0]["data"] or {}) if ok_ and r else None
def is_on(v): return v is True or str(v).lower() == "true"

start("ONBOARDING GO-LIVE, THE HUB HALF")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
FN_SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))
check_build(FNROOT, FN_SHAS)
NEED = {fn: need(FNROOT, fn) for fn in FNS}
unpinned = sorted({k for fn in FNS for k in NEED[fn]} - {"supabase/functions/" + k for k in FN_SHAS})
if unpinned: bad("these files the services need are not pinned to the reviewed build: " + short(unpinned) + ". Nothing runs."); done(2)
SQL_SHAS = json.loads(os.environ.get("SB_SQL_SHAS", "{}"))
def sql_reviewed(rel):
    p_ = os.path.join(ROOT, rel)
    return os.path.exists(p_) and SQL_SHAS.get(rel) and sha(p_) == SQL_SHAS.get(rel)
for rel in (SQL_LINK, SQL_KEEP):
    say(f"  ✓ {rel.split('/')[-1]} is the reviewed build") if sql_reviewed(rel) else bad(f"{rel.split('/')[-1]} is not the reviewed build: nothing runs")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(2)

VJ = {}
for fn in FNS:
    sx, mx = fmeta(REF, fn)
    if sx == 404: bad(f"{fn} is not live at all; this step only brings live services up to date. Tell Claude."); continue
    if not (sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool)): bad(f"could not read {fn} ({sx})"); continue
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
                  "(select count(*)::int from pg_trigger where tgname = 'onboarding_documents_keep' and not tgisinternal) as trig")
if not ok_: bad(f"could not read the database pieces: {r}")
else:
    x = r[0]
    say("  ✓ step1_candidate_create exists (it is replaced by the tightened version)") if x["fn"] is True else bad("step1_candidate_create does not exist. Tell Claude.")
    say("  ✓ step1_forms exists") if x["forms"] is True else bad("step1_forms does not exist. Tell Claude.")
    say("  ✓ storage.objects exists") if x["objs"] is True else bad("storage.objects does not exist. Tell Claude.")
    say("  · the onboarding-documents storage bucket " + ("exists" if int(x["bucket"]) else "does not exist yet (the retention proof needs it)"))
    say("  · the seven-year retention guard is " + ("already in (it is replaced by the same file)" if int(x["trig"]) else "new") + "; the retention view is " + ("already in" if x["view"] is True else "new"))
jn = ", ".join(lit(j) for j, _ in JOBS)
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
st0 = onb()
if st0 is None: bad("could not read the Hub switches (ops_settings)")
else:
    sd = str(st0.get("onboarding_switch_date") or "")
    if sd: bad(f"the switch date is already set ({sd}). Tell Claude before this runs.")
    else: say("  ✓ the switch date is not set (this step does not set it)")
    say("  · the onboarding switches (shown only; this step changes none): " + ", ".join(f"{k} {'on' if is_on(st0.get(k)) else 'off'}" for k in SWITCHES))
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
say("  · what changes: the tightened Step 1 link (a name alone never links two records), seven-year retention for signed onboarding documents, and the eleven services brought up to this build. No switch, no switch date, no person's record. Nothing is sent.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
if not sql_reviewed(SQL_LINK): bad("the Step 1 link file changed since it was checked"); done(5)
ok_, r_ = sql(REF, open(os.path.join(ROOT, SQL_LINK)).read())
if not ok_: bad(f"the tightened Step 1 link did not install: {r_}"); say("  RESULT: STOPPED. Nothing else changed. Tell Claude."); done(5)
say("  ✓ the tightened Step 1 link is in (first name AND phone or email; an old-path record is never flipped)")
if not sql_reviewed(SQL_KEEP): bad("the retention file changed since it was checked"); done(5)
KEEP_SRC = open(os.path.join(ROOT, SQL_KEEP)).read()
TRIGGER_IN = False
ok_, r_ = sql(REF, KEEP_SRC)
if ok_:
    TRIGGER_IN = True; say("  ✓ seven-year retention is in: signed onboarding documents cannot be deleted, moved or renamed; the retention view is in")
elif re.search(r"must be owner|permission denied|42501|insufficient_privilege", str(r_), re.I):
    bad("the seven-year guard on signed documents could NOT be added: the database did not allow a trigger on storage.objects ("
        + str(r_)[:160] + "). Signed documents are NOT protected yet. Tell Claude. The rest carries on.")
    # the same reviewed file without its two trigger statements: the guard function and the retention view still go in
    rest = re.sub(r"drop trigger if exists onboarding_documents_keep on storage\.objects;\s*", "", KEEP_SRC)
    rest = re.sub(r"create trigger onboarding_documents_keep .*?execute function public\.onboarding_documents_keep\(\);\s*", "", rest, flags=re.S)
    ok2, r2 = sql(REF, rest)
    say("  ✓ the retention view is in (the guard function is in, but nothing calls it until the trigger is added)") if ok2 else bad(f"the retention view did not install either: {r2}")
else: bad(f"seven-year retention did not install: {r_}"); say("  RESULT: STOPPED. The tightened Step 1 link is in; no service was deployed. Tell Claude."); done(5)
for fn in FNS:
    if not deploy(REF, FNROOT, fn, VJ[fn]): say("  RESULT: STOPPED. The services above this line are deployed; tell Claude."); done(6)

say(); say("PART 3 · PROOF (nothing is sent; no real record changes)")
for fn in FNS:
    okl, livef = live_files(REF, fn); s_, m_ = fmeta(REF, fn)
    good = okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in NEED[fn])
    same_gw = (m_ or {}).get("verify_jwt") == VJ[fn]
    if good and same_gw: say(f"  ✓ {fn} is live as tested (version {(m_ or {}).get('version', '?')}, gateway sign-in check {'on' if VJ[fn] else 'off'}, as before)")
    elif not good: bad(f"{fn}'s live copy is not this build")
    else: bad(f"{fn}'s gateway setting changed (was {'on' if VJ[fn] else 'off'})")
if TRIGGER_IN:
    probe = ("do $p$ declare m text := 'deleted'; begin "
             "perform set_config('storage.allow_delete_query', 'true', true); "
             f"insert into storage.objects (bucket_id, name) values ('onboarding-documents', {lit(PROBE)}); "
             f"begin delete from storage.objects where bucket_id = 'onboarding-documents' and name = {lit(PROBE)}; "
             "exception when others then m := sqlerrm; end; "
             "raise exception '701_PROBE_RESULT: %', m; end $p$")
    ok_, pr = sql(REF, probe)
    pr = str(pr)
    if ok_: bad("the retention probe did not roll back as planned. Tell Claude.")
    elif "701_PROBE_RESULT" in pr and "kept for seven years" in pr: say("  ✓ a signed document cannot be deleted: the database answered \"kept for seven years\" (tried on a probe inside one transaction that was rolled back)")
    elif "701_PROBE_RESULT: deleted" in pr: bad("the retention guard let a signed document be deleted (on the probe, rolled back). Tell Claude.")
    elif "701_PROBE_RESULT" in pr: bad("the probe's delete was refused, but not by the seven-year guard (" + pr[pr.find("701_PROBE_RESULT") + 18:][:160] + "). Tell Claude.")
    else: bad("the retention probe could not run: " + pr[:200])
else: say("  · the retention guard was not tried (it could not be added; see the ✗ line above)")
ok_, pz = sql(REF, f"select count(*)::int as n from storage.objects where starts_with(name, '_701_probe/')")
say("  ✓ no probe is left in storage") if ok_ and int(pz[0]["n"]) == 0 else bad(f"a probe row is left in storage: {pz}. Tell Claude.")
ok_, pv = sql(REF, "select has_function_privilege('anon', 'public.step1_candidate_create(text, jsonb)', 'execute') as a, has_function_privilege('authenticated', 'public.step1_candidate_create(text, jsonb)', 'execute') as b")
say("  ✓ step1_candidate_create is server only (a visitor or a signed-in page cannot call it)") if ok_ and pv[0]["a"] is False and pv[0]["b"] is False else bad(f"step1_candidate_create privileges: {pv}")
ok_, rv = sql(REF, "select count(*)::int as n, count(*) filter (where earliest_removal_if_never_hired is not null)::int as dated from public.onboarding_retention")
say(f"  ✓ the retention view reads ({rv[0]['n']} Step 1 records, each with its earliest removal date)") if ok_ and int(rv[0]["n"]) == int(rv[0]["dated"]) else bad(f"the retention view: {rv}")
vis = {"apikey": ANON, "Authorization": "Bearer " + ANON}
s1, b1 = http("POST", f"{FNB}/functions/v1/step1-sign", {"action": "preview"}, vis)
try: j1 = json.loads(b1)
except Exception: j1 = {}
fc = next((f for f in (j1.get("forms") or []) if isinstance(f, dict) and f.get("key") == "fcra_disclosure"), None)
if s1 == 200 and j1.get("preview") is True and fc and fc.get("title") == "Permission for Background Checks and References" and fc.get("version") == 2:
    say(f"  ✓ the Step 1 preview answers with {len(j1.get('forms') or [])} forms, \"Permission for Background Checks and References\" version 2 among them")
else: bad(f"the Step 1 preview answered {s1}: " + (f"that form is {fc.get('title')!r} version {fc.get('version')}" if fc else str(b1)[:200]))
s2, b2 = http("POST", f"{FNB}/functions/v1/step1-sign", {"action": "review", "offer_id": "00000000-0000-0000-0000-000000000000"}, vis)
say("  ✓ the Step 1 review refuses a visitor who is not signed in (401)") if s2 == 401 else bad(f"the Step 1 review answered a visitor with {s2}")
s3, b3 = http("POST", f"{FNB}/functions/v1/hire-profile", {"action": "get"}, vis)
say("  ✓ the hire profile refuses a visitor who is not signed in (401)") if s3 == 401 else bad(f"the hire profile answered a visitor with {s3}")
st1 = onb()
if st1 is None: bad("could not read the Hub switches again")
else:
    sd = str(st1.get("onboarding_switch_date") or "")
    say("  ✓ the switch date is still not set") if not sd else bad(f"the switch date is now set ({sd})")
    moved = [k for k in SWITCHES if is_on(st1.get(k)) != is_on((st0 or {}).get(k))]
    say("  ✓ no switch changed") if not moved else bad("these switches changed during the step: " + ", ".join(moved))
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the tightened Step 1 link, seven-year retention and the eleven services are live. No switch changed and the switch date is not set. Nothing was sent; no real record changed."); done(0)
