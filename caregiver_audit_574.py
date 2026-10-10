#!/usr/bin/env python3
# 574 · SLICE 6, CONTINUOUS CAREGIVER AUDITS (Samantha "yes to all", 2026-10-10). Hub project. Installs caregiver_audit_patch (the
# audit's own door onto a roster record), approves the reviewed eligibility rules fingerprint (OIG monthly, annual hours, typed
# credential expiries; Hub PR), replaces caregiver-journey (the nightly audit), onboarding-permissions (the Audit export list),
# eligibility-sweep and obligations-run (the schedule may call them; still practice), deploys the new caregiver-export, and
# schedules three nightly jobs: caregiver-audit-nightly, eligibility-sweep-nightly, obligations-run-nightly. The three audit
# switches stay OFF: the first nights only count. Nothing is sent; nothing is written to a record or to AxisCare by this step.
import os, json, hashlib
os.environ.setdefault("SB_STEP", "574")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FNS = ["caregiver-journey", "caregiver-export", "onboarding-permissions", "eligibility-sweep", "obligations-run"]
RULES_FILE = "eligibility-rules.js"; RULES_FP = "ed26adb2632a6538a1de818e59b8f519d97f3eba538950243fadc6a1195241c8"
JOBS = [("caregiver-audit-nightly", "5 11 * * *", "caregiver-journey", '{"action": "nightly"}'), ("eligibility-sweep-nightly", "25 11 * * *", "eligibility-sweep", '{}'), ("obligations-run-nightly", "45 11 * * *", "obligations-run", '{}')]
VAULT_NAME = "hub_job_secret"
start("SLICE 6: CONTINUOUS CAREGIVER AUDITS")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
VJ = {}
for fn in FNS:
    sx, mx = fmeta(REF, fn)
    if sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool): VJ[fn] = mx["verify_jwt"]; say(f"  ✓ {fn} is live at version {mx.get('version', '?')} (gateway sign-in check {'on' if VJ[fn] else 'off'}); replaced by this build, same setting")
    elif sx == 404 and fn == "caregiver-export": VJ[fn] = True; say(f"  · {fn} is new; deployed with the gateway sign-in check on (the Hub calls it with your sign-in)")
    else: bad(f"{fn} is not live or unreadable: {sx}")
SQLF = os.path.join(ROOT, "supabase", "slice6-continuous-audits.sql")
if not os.path.exists(SQLF): bad("the SQL file is not in the reviewed build")
def lit(v): return "'" + str(v).replace("'", "''") + "'"
ok_, cur = sql(REF, f"select sha256, approved_at from public.rules_approved where file = {lit(RULES_FILE)} order by approved_at desc")
if ok_: say(f"  · {len(cur)} approved fingerprint(s) for {RULES_FILE}; the reviewed Slice 6 build is {RULES_FP[:12]}" + (" (already approved)" if any(r['sha256'] == RULES_FP for r in cur) else ""))
else: bad(f"could not read the approved rules: {cur}")
s_, b_ = http("GET", f"https://cc.mo-care.com/{RULES_FILE}?v=574")
live_fp = hashlib.sha256((b_ if isinstance(b_, bytes) else str(b_).encode("utf-8")).hexdigest() if s_ == 200 else None
say(f"  · cc.mo-care.com serves {live_fp[:12] if live_fp else '(unreadable)'}" + (" = the reviewed build (Hub PR merged)" if live_fp == RULES_FP else " (the Hub PR is not merged yet, or Pages has not rebuilt; expected before the merge)"))
ok_, sw = sql(REF, "select coalesce(data->>'training_sync_live', 'not set') as t, coalesce(data->>'oig_monthly_live', 'not set') as o, coalesce(data->>'audit_sweep_live', 'not set') as a, coalesce(data->>'eligibility_sweep_live', 'not set') as e, coalesce(data->>'obligations_live', 'not set') as ob, coalesce(data->>'onboarding_switch_date', '') as d from public.app_data where key = 'ops_settings'")
if ok_ and sw: say(f"  ✓ the switches: Training sync {sw[0]['t']}, OIG monthly {sw[0]['o']}, audit tasks {sw[0]['a']}, eligibility sweep {sw[0]['e']}, obligations {sw[0]['ob']} (practice unless true); the onboarding switch date is {'NOT set' if not sw[0]['d'] else sw[0]['d']}")
else: bad(f"could not read the switches: {sw}")
ok_, c = sql(REF, "select (select count(*)::int from public.client_journey where subject = 'caregiver') as cg, (select count(*)::int from public.client_journey where subject = 'client') as cl, (select count(*)::int from public.document_access_log) as logs, (select count(*)::int from cron.job where jobname in ('caregiver-audit-nightly','eligibility-sweep-nightly','obligations-run-nightly')) as jobs, (select count(*)::int from vault.decrypted_secrets where name = 'hub_job_secret') as vault")
if ok_: say(f"  · {c[0]['cg']} caregiver journey(s), {c[0]['cl']} client journey(s), {c[0]['logs']} access-log row(s); {c[0]['jobs']} of the 3 nightly jobs already scheduled; the job secret in the Vault: {int(c[0]['vault']) == 1}")
else: bad(f"could not count: {c}")
if ok_ and int(c[0]['vault']) != 1: bad("the Vault does not hold hub_job_secret (tell Claude)")
s_, b_ = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG()); ANON = ""
try:
    arr = json.loads(b_) if s_ == 200 else []
    if isinstance(arr, dict): arr = arr.get("keys") or []
    ANON = next((k.get("api_key") for k in arr if isinstance(k, dict) and k.get("name") == "anon" and str(k.get("api_key", "")).startswith("eyJ")), "")
except Exception: ANON = ""
if ANON: HIDE.append(ANON); say("  ✓ the project's public key is readable (the schedules need it)")
else: bad("could not read the project's public key for the schedules")
say("  · what changes: one function in the database, one approved fingerprint, five functions, three nightly schedules. Nothing is sent; no record changes.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
ok_, r_ = sql(REF, open(SQLF).read())
if not ok_: bad(f"the migration did not run: {r_}"); done(5)
say("  ✓ caregiver_audit_patch is installed (server only)")
ok_, _ = sql(REF, f"insert into public.rules_approved (file, sha256, note) values ({lit(RULES_FILE)}, {lit(RULES_FP)}, '574 Slice 6: OIG monthly, annual hours, credential expiries (Hub PR)') on conflict (file, sha256) do update set approved_at = now(), note = excluded.note")
say("  ✓ the reviewed eligibility rules fingerprint is approved") if ok_ else bad("the fingerprint could not be approved")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, VJ[fn]): say("  RESULT: STOPPED. Tell Claude."); done(6)
FNB = f"https://{REF}.supabase.co"
for job, sched, fn, body in JOBS:
    command = ("select net.http_post(url := " + lit(f"{FNB}/functions/v1/{fn}") + ", headers := jsonb_build_object('Content-Type', 'application/json', "
               "'Authorization', " + lit("Bearer " + ANON) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
               "body := " + lit(body) + "::jsonb, timeout_milliseconds := 300000);")
    sql(REF, f"select cron.unschedule({lit(job)}) where exists (select 1 from cron.job where jobname = {lit(job)})")
    ok_, r_ = sql(REF, f"select cron.schedule({lit(job)}, {lit(sched)}, {lit(command)}) as id")
    say(f"  ✓ {job} scheduled ({sched} UTC, about 5am to 6am Central)") if ok_ else bad(f"{job} did not install: {r_}")
say(); say("PART 3 · PROOF (nothing is sent or changed)")
ok_, p = sql(REF, "select public.caregiver_audit_patch('no-such-caregiver-574', 0, '{\"oig_date\": \"2026-01-01\"}'::jsonb) as r")
say("  ✓ the audit door accepts its fields (and found no such caregiver, so nothing changed)") if ok_ and p and (p[0]['r'] or {}).get('reason') == 'gone' else bad(f"audit patch: {p}")
ok_, p2 = sql(REF, "select public.caregiver_audit_patch('no-such-caregiver-574', 0, '{\"first\": \"x\"}'::jsonb) as r")
say("  ✓ the audit door refuses a field it does not own") if not ok_ and 'not a field the audit owns' in str(p2) else bad(f"audit patch did not refuse: {ok_} {p2}")
for fn, body in [("caregiver-journey", {"action": "nightly"}), ("eligibility-sweep", {}), ("obligations-run", {})]:
    s_, b_ = http("POST", f"{FNB}/functions/v1/{fn}", body, {"apikey": "", "Authorization": "Bearer "})
    say(f"  ✓ {fn} refuses a caller without the job secret ({s_})") if s_ in (401, 403) else bad(f"{fn} without the secret answered {s_}")
s_, b_ = http("POST", f"{FNB}/functions/v1/caregiver-export", {"action": "export", "caregiver_id": "1"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ the export refuses a caller with no sign-in ({s_})") if s_ in (401, 403) else bad(f"export without a sign-in answered {s_}")
ok_, j = sql(REF, "select jobname, schedule, active from cron.job where jobname in ('caregiver-audit-nightly','eligibility-sweep-nightly','obligations-run-nightly') order by jobname")
say("  ✓ the three nightly schedules are on") if ok_ and len(j) == 3 and all(x['active'] for x in j) else bad(f"schedules: {j}")
ok_, c2 = sql(REF, "select (select count(*)::int from public.client_journey where subject = 'client') as cl, (select count(*)::int from public.document_access_log) as logs, (select count(*)::int from public.rules_approved where file = 'eligibility-rules.js' and sha256 = " + lit(RULES_FP) + ") as fp")
say(f"  ✓ client journeys untouched ({c[0]['cl']} → {c2[0]['cl']}); the access log unchanged ({c[0]['logs']} → {c2[0]['logs']}); the fingerprint approved") if ok_ and int(c2[0]['cl']) == int(c[0]['cl']) and int(c2[0]['logs']) == int(c[0]['logs']) and int(c2[0]['fp']) == 1 else bad(f"after: {c2}")
say("  · tested before deploying: 80 checks on the readiness server and the export (practice counts and writes nothing; live: the Training facts with certificate references, OIG clear with evidence and a match as a review, expiries as permanent events and owned tasks that close themselves, the export logged), 39 on the lists, the Hub's rules and card tests, the journey check.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the nightly audit runs from tonight in practice: it counts what it would do in the automation log and writes nothing until you turn its switches on. Nothing was sent; no record changed."); done(0)
