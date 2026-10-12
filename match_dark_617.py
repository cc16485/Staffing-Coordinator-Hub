#!/usr/bin/env python3
# 617 · MATCHING, IN THE DARK (Samantha "go", 2026-10-12, Track 3d). Records her approval of the shared match rule's
# fingerprint (match-rules.js as served by cc.mo-care.com; her run of this step is the approval, as with the eligibility
# rules), lets the Hub read one new stored report (app_data match_dark_report), deploys match-dark, schedules it nightly
# (11:50 UTC, about 6:50am Central; it runs only while the Admin switch "Matching dark report (nightly)" is on), and runs it
# ONCE now so she sees a report. The job writes only that report: no visit, schedule, caregiver, client, card or text.
# ORDER: merge Staffing, Hub (the rule 1.1.0 and the report window) and team-hub (the switch) first; Pages must serve the rule.
import os, json, hashlib
os.environ.setdefault("SB_STEP", "617")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FN = "match-dark"; JOB = "match-dark-nightly"; SCHED = "50 11 * * *"; VAULT_NAME = "hub_job_secret"
RULES_FP = os.environ.get("SB_RULES_FP", "")
def lit(v): return "'" + str(v).replace("'", "''") + "'"
start("MATCHING, IN THE DARK")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
sx, mx = fmeta(REF, FN)
if sx == 404: say("  ✓ match-dark is new (not live yet)")
elif sx == 200: say(f"  · match-dark is live at version {mx.get('version', '?')}; replaced by this build")
else: bad(f"could not read match-dark: {sx}")
s_, b_ = http("GET", "https://cc.mo-care.com/match-rules.js?v=617")
live_fp = hashlib.sha256(b_ if isinstance(b_, bytes) else str(b_).encode("utf-8")).hexdigest() if s_ == 200 else None
if live_fp == RULES_FP: say(f"  ✓ cc.mo-care.com serves the reviewed match rule (version 1.1.0, {RULES_FP[:12]})")
else: bad(f"cc.mo-care.com serves {live_fp[:12] if live_fp else 'nothing'}, not the reviewed {RULES_FP[:12]}: merge the Hub pull request first (and give Pages a minute)")
ok1, r1 = sql(REF, "select (select count(*) from public.rules_approved where file = 'eligibility-rules.js') as elig, (select count(*) from vault.decrypted_secrets where name = 'hub_job_secret') as vault, (select count(*) from cron.job where jobname = 'match-dark-nightly') as job, (select count(*) from public.app_data_key_hub_map where data_key = 'match_dark_report') as mapped, coalesce((select data->>'match_dark_live' from public.app_data where key = 'ops_settings'), 'not set') as sw")
if not ok1: bad(f"could not read the set-up: {r1}")
else:
    x = r1[0]
    say("  ✓ the eligibility rules are approved (the job uses them for cleared to work)") if int(x["elig"]) else bad("the eligibility rules have no approved fingerprint. Tell Claude.")
    say("  ✓ the job secret is in the Vault") if int(x["vault"]) == 1 else bad("the Vault does not hold hub_job_secret. Tell Claude.")
    say(f"  · the nightly schedule {'exists (replaced)' if int(x['job']) else 'is new'}; the report key {'is already readable' if int(x['mapped']) else 'will be made readable by the Hub'}; the Admin switch is {x['sw']}")
s2, b2 = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG()); ANON = SVC = ""
try:
    arr = json.loads(b2) if s2 == 200 else []
    if isinstance(arr, dict): arr = arr.get("keys") or []
    for k in arr:
        v = str(k.get("api_key", "")) if isinstance(k, dict) else ""
        if k.get("name") == "anon" and v.startswith("eyJ"): ANON = v
        if k.get("name") == "service_role" and v.startswith("eyJ"): SVC = v
except Exception: pass
say("  ✓ the project's keys are readable (the schedule and the one run need them)") if ANON and SVC else bad("could not read the project's keys")
say("  · what changes: one approved fingerprint, one readable report key, one new function, one nightly schedule (it runs only while the switch is on), and one run now that writes the report. Nothing is sent; no visit, schedule, caregiver or client changes.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
ok_, _ = sql(REF, f"insert into public.rules_approved (file, sha256, note) values ('match-rules.js', {lit(RULES_FP)}, '617 the shared match rule 1.1.0, run in the dark (report only)') on conflict (file, sha256) do update set approved_at = now(), note = excluded.note")
say("  ✓ your approval of the match rule's fingerprint is recorded") if ok_ else bad("the fingerprint could not be approved")
ok_, _ = sql(REF, "insert into public.app_data_key_hub_map (data_key, hub_slug) select 'match_dark_report', h from (values ('care_coordinator'), ('team_hub')) v(h) where not exists (select 1 from public.app_data_key_hub_map m where m.data_key = 'match_dark_report' and m.hub_slug = v.h)")
say("  ✓ the Hub can read the report") if ok_ else bad("the report key could not be made readable")
if not deploy(REF, FNROOT, FN, True): say("  RESULT: STOPPED. Tell Claude."); done(6)
FNB = f"https://{REF}.supabase.co"
command = ("select net.http_post(url := " + lit(f"{FNB}/functions/v1/{FN}") + ", headers := jsonb_build_object('Content-Type', 'application/json', "
           "'Authorization', " + lit("Bearer " + ANON) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
           "body := '{}'::jsonb, timeout_milliseconds := 300000);")
sql(REF, f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
ok_, r_ = sql(REF, f"select cron.schedule({lit(JOB)}, {lit(SCHED)}, {lit(command)}) as id")
say(f"  ✓ {JOB} scheduled ({SCHED} UTC, about 6:50am Central; it runs only while the switch is on)") if ok_ else bad(f"the schedule did not install: {r_}")
say(); say("PART 3 · PROOF (nothing is sent; only the report is written)")
okl, livef = live_files(REF, FN)
say("  ✓ match-dark is live as tested") if okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need(FNROOT, FN)) else bad("the live copy is not this build")
s3, b3 = http("POST", f"{FNB}/functions/v1/{FN}", {"once": True}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ it refuses a caller with neither the schedule's secret nor the server key ({s3})") if s3 in (401, 403) else bad(f"a caller with no key got {s3}")
s4, b4 = http("GET", f"{FNB}/functions/v1/{FN}?rules_check=1", None, {"apikey": SVC, "Authorization": "Bearer " + SVC})
try: rc = json.loads(b4)
except Exception: rc = {}
say("  ✓ both rules it runs are approved (match-rules.js, eligibility-rules.js)") if rc.get("all_approved") else bad(f"the rules check answered: {str(b4)[:200]}")
s5, b5 = http("POST", f"{FNB}/functions/v1/{FN}", {"once": True}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
try: j = json.loads(b5)
except Exception: j = {}
if s5 == 200 and j.get("ok"):
    c, cl, g = j.get("counts", {}), j.get("clients", {}), j.get("gaps", {})
    say(f"  ✓ the first report: {c.get('visits', 0)} visits judged (Ready {c.get('ready', 0)}, Likely fit {c.get('likely_fit', 0)}, one more step {c.get('one_more_step', 0)}, not for the visit {c.get('not_for_visit', 0)}); {c.get('open_visits', 0)} open visits")
    say(f"  · clients with visits: {cl.get('total', 0)}; incomplete {cl.get('incomplete', 0)}, flagged {cl.get('flagged', 0)}, no Journey {cl.get('no_journey', 0)}; call-offs replayed: {j.get('replay', 0)}")
    say("  · most clients show incomplete until their needs are confirmed on the Care tab: that is the size of the gap, not a fault")
else: bad(f"the first run answered {s5}: {str(b5)[:300]}")
ok6, r6 = sql(REF, "select (data->>'at') as at, jsonb_array_length(coalesce(data->'rows', '[]'::jsonb)) as rows from public.app_data where key = 'match_dark_report'")
say(f"  ✓ the report is stored ({r6[0]['rows']} rows) for the Hub's Matching, in the dark window") if ok6 and r6 else bad("the stored report could not be read back")
say("  · tested before deploying: the rule 1.1.0 (41), the report builder and the job (26: groups and reasons, unknowns never count, the lock failing closed, the replay, the history, refused callers, the switch, the fingerprint, and one write only), and the window offline (11).")
say("  · to see it: the Hub, Scheduling, Live Schedule, 🧪 Matching, in the dark. To run it each night: Owners Hub Admin page, Matching dark report (nightly).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the match rule ran in the dark once; the report is in the Hub. Nothing was sent; no visit, schedule, caregiver or client changed."); done(0)
