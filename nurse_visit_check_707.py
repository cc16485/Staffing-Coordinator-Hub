#!/usr/bin/env python3
# 707 · NURSE VISIT CHECKS, THE HUB PROJECT (the LPN nurse visit plan, Samantha approved 2026-10-14). Hub project only.
# Staffing PR "nurse-visit-checks".
# PART 1 reads only and stops before any change if anything is wrong: the reviewed build (every file nurse-visit-check needs,
# pinned); main has not changed those files since the review; the service's live copy (expected not to exist yet; if it does,
# any live file must come from this build's own history, never newer and never someone's unmerged work); the job secret in
# the Vault; the schedule; the three nurse switches must all be OFF (this step turns nothing on); the nurse records the check
# will read (counts only).
# PART 2 changes, in this order: nurse-visit-check deployed (new: gateway sign-in check on; an existing one keeps its own
# setting), then the 30-minute schedule nurse-visit-check-pass (the vault job secret, { action: 'pass' }).
# PART 3 proves it with nothing sent, nothing written to AxisCare and no switch changed: the live copy is this build; the
# schedule is on; a visitor is refused; one PRACTICE run (?dry=1, with the project's server key) reads AxisCare and reports
# what it would show, writing nothing (the Hub records it reads are checked unchanged); the switches are as they were.
# ORDER: merge Staffing PR nurse-visit-checks (merge commit, not squash), then run this. Then merge the Hub and team-hub PRs.
import os, re, json, subprocess, hashlib
os.environ.setdefault("SB_STEP", "707")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FN = "nurse-visit-check"
JOB, SCHED, VAULT_NAME = "nurse-visit-check-pass", "*/30 * * * *", "hub_job_secret"
NEW_SWITCHES = ["nurse_visit_check_live", "nurse_bill_hold_live", "nurse_license_reminders_live"]
SHOWN = ["ghe_watch_live", "visit_watch_live"]
WATCH_KEYS = ["nurse_bill_check", "nurse_license_reminders"]
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")

def hist(ref, rel):
    out = set()
    try:
        for c in subprocess.run(["git", "-C", ROOT, "log", ref, "--format=%H", "--", rel], capture_output=True, text=True, timeout=120).stdout.split():
            b = subprocess.run(["git", "-C", ROOT, "show", f"{c}:{rel}"], capture_output=True, timeout=60).stdout
            if b: out.add(hashlib.sha256(b).hexdigest())
    except Exception: pass
    return out
short = lambda ks: ", ".join(k.split("/")[-2] + "/" + k.split("/")[-1] for k in ks[:4]) + (f" and {len(ks) - 4} more" if len(ks) > 4 else "")
def onb():
    ok_, r = sql(REF, "select data, version from public.app_data where key = 'ops_settings'")
    if not ok_ or not r: return None
    d = r[0].get("data"); return d if isinstance(d, dict) else None
is_on = lambda v: v is True or str(v).lower() == "true"
def versions():
    ok_, r = sql(REF, "select key, version from public.app_data where key in (" + ", ".join(lit(k) for k in WATCH_KEYS) + ")")
    return {x["key"]: int(x["version"] or 0) for x in r} if ok_ else None

start("NURSE VISIT CHECKS, THE HUB PROJECT")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
FN_SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))
check_build(FNROOT, FN_SHAS)
NEED = need(FNROOT, FN)
if not NEED: bad(f"{FN} is not in the reviewed build. Nothing runs."); done(2)
unpinned = sorted(NEED - {"supabase/functions/" + k for k in FN_SHAS})
if unpinned: bad("these files the service needs are not pinned to the reviewed build: " + short(unpinned) + ". Nothing runs."); done(2)
moved = []
for k in sorted(NEED):
    b = subprocess.run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"], capture_output=True).stdout
    if b and hashlib.sha256(b).hexdigest() != sha(os.path.join(ROOT, k)) and hashlib.sha256(b).hexdigest() not in hist("HEAD", k): moved.append(k)
if moved: bad("main has newer versions of " + short(moved) + " than this reviewed build (merged after the review); deploying would roll them back. Tell Claude. Nothing runs."); done(2)
say(f"  ✓ main holds no newer version of any of the {len(NEED)} files nurse-visit-check uses")
sx, mx = fmeta(REF, FN); VJ = True
if sx == 404: say(f"  ✓ {FN} is not live yet (this step adds it, gateway sign-in check on)")
elif sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool):
    VJ = mx["verify_jwt"]
    okl, livef = live_files(REF, FN)
    if not okl: bad(f"could not read {FN}'s live files")
    else:
        mine = {k: sha(os.path.join(ROOT, k)) for k in NEED}
        foreign = [k for k in sorted(set(mine) | set(livef)) if livef.get(k) and livef.get(k) != mine.get(k) and livef[k] not in hist("HEAD", k)]
        if foreign: bad(f"{FN}'s live copy holds {short(foreign)} in a version that is not from this build's history (newer, or someone's unmerged work). Tell Claude.")
        else: say(f"  ✓ {FN} is live at version {mx.get('version', '?')} (gateway sign-in check {'on' if VJ else 'off'}): " + ("already this build" if all(livef.get(k) == mine[k] for k in mine) else "an older copy from this build's history; this deploy brings it up to date"))
else: bad(f"could not read {FN} ({sx})")
ok_, r = sql(REF, f"select (select count(*)::int from vault.decrypted_secrets where name = {lit(VAULT_NAME)}) as vault, "
                  f"(select json_agg(json_build_object('schedule', schedule, 'active', active)) from cron.job where jobname = {lit(JOB)}) as job")
if not ok_: bad(f"could not read the Vault and the schedules: {r}")
else:
    say("  ✓ the job secret is in the Vault (the schedule uses it)") if int(r[0]["vault"]) == 1 else bad("the Vault does not hold hub_job_secret. Tell Claude.")
    say(f"  · the schedule {JOB} " + ("exists (it is replaced)" if r[0].get("job") else "is new"))
st0 = onb()
if st0 is None: bad("could not read the Hub switches (ops_settings)")
else:
    on_ = [k for k in NEW_SWITCHES if is_on(st0.get(k))]
    if on_: bad("these nurse switches are already on: " + ", ".join(on_) + ". This step expects them off. Tell Claude.")
    else: say("  ✓ the three nurse switches are off (nurse visit checks, the do-not-bill hold, license reminders): everything runs as practice")
    say("  · shown only: " + ", ".join(f"{k} {'on' if is_on(st0.get(k)) else 'off'}" for k in SHOWN) + "; the service list is " + ("the one saved on the Admin page" if isinstance(st0.get("nurse_services"), list) and st0.get("nurse_services") else "the built-in one"))
ok_, r = sql(REF, "select key, case when jsonb_typeof(data) = 'array' then jsonb_array_length(data) else null end as n from public.app_data "
                  "where key in ('nurse_clients', 'medicaid_plans', 'nurse_staff', 'ghe_forms', 'ghe_watch')")
if ok_: say("  · what the check reads: " + ", ".join(f"{x['key']} {x['n']}" for x in sorted(r, key=lambda x: x["key"])))
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
say("  ✓ the project's public and server keys are readable (the schedule and the practice run use them)") if ANON and SVC else bad("could not read the project's public and server keys")
say("  · what changes: nurse-visit-check is deployed and scheduled every 30 minutes. No switch changes, nothing is sent, nothing is written to AxisCare.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, FN, VJ): say("  RESULT: STOPPED. The schedule was NOT added. Tell Claude."); done(6)
command = ("select net.http_post(url := " + lit(f"https://{REF}.supabase.co/functions/v1/{FN}") + ", headers := jsonb_build_object('Content-Type', 'application/json', "
           "'Authorization', " + lit("Bearer " + ANON) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
           "body := '{\"action\": \"pass\"}'::jsonb, timeout_milliseconds := 300000);")
sql(REF, f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
ok_, r_ = sql(REF, f"select cron.schedule({lit(JOB)}, {lit(SCHED)}, {lit(command)}) as id")
say(f"  ✓ {JOB} scheduled every 30 minutes (practice until its switches are on)") if ok_ else bad(f"the schedule {JOB} did not install: {r_}")

say(); say("PART 3 · PROOF (nothing is sent; nothing is written to AxisCare; no switch changes)")
okl, livef = live_files(REF, FN); s_, m_ = fmeta(REF, FN)
if okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in NEED) and (m_ or {}).get("verify_jwt") == VJ:
    say(f"  ✓ {FN} is live as tested (version {(m_ or {}).get('version', '?')}, gateway sign-in check {'on' if VJ else 'off'})")
else: bad(f"{FN}'s live copy or gateway setting is not as tested")
ok_, jr = sql(REF, f"select schedule, active from cron.job where jobname = {lit(JOB)}")
say(f"  ✓ {JOB} is on, every {jr[0]['schedule']}") if ok_ and jr and jr[0]["active"] is True and jr[0]["schedule"] == SCHED else bad(f"the schedule {JOB}: {jr}")
VIS = {"apikey": ANON, "Authorization": "Bearer " + ANON}
s1, _ = http("POST", f"{FNB}/functions/v1/{FN}", {"action": "pass"}, VIS)
s2, _ = http("POST", f"{FNB}/functions/v1/{FN}", {"action": "report"}, VIS)
say("  ✓ a visitor is refused (the pass and the office report both answer 401)") if s1 == 401 and s2 == 401 else bad(f"a visitor was not refused: pass {s1}, report {s2}")
s3, b3 = http("POST", f"{FNB}/functions/v1/{FN}?dry=1", {"action": "pass"}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, timeout=300)
try: j3 = json.loads(b3)
except Exception: j3 = {}
v, l = j3.get("visits") or {}, j3.get("license") or {}
if s3 == 200 and v.get("dry") is True and l.get("dry") is True:
    if v.get("ok") is False: bad("the practice run could not read AxisCare: " + str(v.get("error") or "no reason"))
    else: say(f"  ✓ practice run (nothing written): {v.get('clients', 0)} clients read, {v.get('visits_checked', 0)} completed nurse visits in the last 120 days, "
              f"{v.get('ready', 0)} ready, {v.get('not_ready', 0)} not ready" + (f", AxisCare could not be read for {v.get('read_failed')}" if v.get("read_failed") else "")
              + f"; service list {v.get('services_from', '?')}; license reminders due now: {l.get('due', 0)}")
else: bad(f"the practice run answered {s3}: {str(b3)[:200]}")
V1 = versions()
say("  ✓ the practice run wrote nothing (the Hub's nurse check records are unchanged)") if V0 is not None and V1 == V0 else bad(f"the nurse check records changed during the practice run: {V0} then {V1}")
st1 = onb()
if st1 is None: bad("could not read the Hub switches again")
else:
    moved = [k for k in NEW_SWITCHES + SHOWN if st1.get(k) != (st0 or {}).get(k)]
    say("  ✓ no switch changed") if not moved else bad("these switches changed during the step: " + ", ".join(moved))
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · nurse-visit-check is live and runs every 30 minutes as PRACTICE: it reads AxisCare and fills the list on Nurse Scheduling, with no cards, nothing sent and nothing written to AxisCare.")
say("NEXT: merge the Hub pull request (the list on Nurse Scheduling) and the team-hub pull request (the switches and the service list on the Admin page). The switches stay off until you turn them on.")
done(0)
