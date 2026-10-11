#!/usr/bin/env python3
# 577 · SLICE 8, CLIENT AUDIT READINESS (Samantha "GO" / "YES TO ALL", 2026-10-11). Hub project. Adds the grievance answer columns,
# approves the served ihs-rules.js fingerprint for the server (the file is unchanged; the Payer tab already runs it), deploys the new
# client-audit function (the nightly client pass, proof uploads, logged opens, the client export) and replaces client-journey (client
# rows only; logged file opens), issues-run (a grievance resolves only with the written answer or an in-person reason) and
# caregiver-export (the as-of date). Schedules client-audit-nightly. The switch client_audit_live stays OFF: the first nights only
# count. Nothing is sent; no existing record changes.
import os, json, hashlib
os.environ.setdefault("SB_STEP", "577")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FNS = ["client-audit", "client-journey", "issues-run", "caregiver-export"]
RULES_FILE = "ihs-rules.js"; RULES_FP = "626a6eb21ffba271f244e9840f641a5e33455843de74499c5432e41bd6283163"
JOB = "client-audit-nightly"; SCHEDULE = "15 11 * * *"; VAULT_NAME = "hub_job_secret"
start("SLICE 8: CLIENT AUDIT READINESS")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
VJ = {}
for fn in FNS:
    sx, mx = fmeta(REF, fn)
    if sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool): VJ[fn] = mx["verify_jwt"]; say(f"  ✓ {fn} is live at version {mx.get('version', '?')} (gateway sign-in check {'on' if VJ[fn] else 'off'}); replaced by this build, same setting")
    elif sx == 404 and fn == "client-audit": VJ[fn] = True; say(f"  · {fn} is new; deployed with the gateway sign-in check on (the Hub calls it with your sign-in; the nightly pass with the job secret)")
    else: bad(f"{fn} is not live or unreadable: {sx}")
SQLF = os.path.join(ROOT, "supabase", "slice8-client-audit.sql")
if not os.path.exists(SQLF): bad("the SQL file is not in the reviewed build")
def lit(v): return "'" + str(v).replace("'", "''") + "'"
s_, b_ = http("GET", f"https://cc.mo-care.com/{RULES_FILE}?v=577")
live_fp = hashlib.sha256(b_ if isinstance(b_, bytes) else str(b_).encode("utf-8")).hexdigest() if s_ == 200 else None
say(f"  ✓ cc.mo-care.com serves {RULES_FILE} with the reviewed fingerprint {RULES_FP[:12]}") if live_fp == RULES_FP else bad(f"cc.mo-care.com serves {RULES_FILE} as {live_fp[:12] if live_fp else '(unreadable)'}, not the reviewed {RULES_FP[:12]}; tell Claude")
ok_, sw = sql(REF, "select coalesce(data->>'client_audit_live', 'not set') as c, coalesce(data->>'onboarding_switch_date', '') as d from public.app_data where key = 'ops_settings'")
if ok_ and sw: say(f"  ✓ the switch: nightly client audit tasks {sw[0]['c']} (practice unless true)")
else: bad(f"could not read the switches: {sw}")
ok_, c = sql(REF, "select (select count(*)::int from public.client_issue where category = 'grievance') as g, (select count(*)::int from public.client_issue where category = 'grievance' and state = 'resolved') as gr, (select count(*)::int from public.client_journey where subject = 'client') as cl, (select count(*)::int from public.client_journey where subject = 'caregiver') as cg, (select count(*)::int from public.document_access_log) as logs, (select count(*)::int from vault.decrypted_secrets where name = 'hub_job_secret') as vault")
if ok_: say(f"  · {c[0]['g']} grievance(s) on file ({c[0]['gr']} resolved, kept as they are); {c[0]['cl']} client journey(s), {c[0]['cg']} caregiver card(s); {c[0]['logs']} access-log row(s); the job secret in the Vault: {int(c[0]['vault']) == 1}")
else: bad(f"could not count: {c}")
if ok_ and int(c[0]['vault']) != 1: bad("the Vault does not hold hub_job_secret (tell Claude)")
ok_, mp = sql(REF, "select count(*)::int as n from public.app_data, jsonb_array_elements(data) x where key = 'medicaid_plans' and x->>'kind' = 'plan'")
say(f"  · {mp[0]['n'] if ok_ else '?'} Medicaid care plan(s) on file: the nightly pass looks at each client's current one")
s_, b_ = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG()); ANON = ""
try:
    arr = json.loads(b_) if s_ == 200 else []
    if isinstance(arr, dict): arr = arr.get("keys") or []
    ANON = next((k.get("api_key") for k in arr if isinstance(k, dict) and k.get("name") == "anon" and str(k.get("api_key", "")).startswith("eyJ")), "")
except Exception: ANON = ""
if ANON: HIDE.append(ANON); say("  ✓ the project's public key is readable (the schedule needs it)")
else: bad("could not read the project's public key for the schedule")
say("  · what changes: three columns, one approved fingerprint, four functions, one nightly schedule. Nothing is sent; no existing record changes.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
ok_, r_ = sql(REF, open(SQLF).read())
if not ok_: bad(f"the migration did not run: {r_}"); done(5)
say("  ✓ client_issue has the grievance answer columns (resolution_doc, resolution_how, resolution_in_person)")
ok_, _ = sql(REF, f"insert into public.rules_approved (file, sha256, note) values ({lit(RULES_FILE)}, {lit(RULES_FP)}, '577 Slice 8: the nightly client audit runs the Payer tab rules') on conflict (file, sha256) do update set approved_at = now(), note = excluded.note")
say("  ✓ the ihs-rules.js fingerprint is approved for the server") if ok_ else bad("the fingerprint could not be approved")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, VJ[fn]): say("  RESULT: STOPPED. Tell Claude."); done(6)
FNB = f"https://{REF}.supabase.co"
command = ("select net.http_post(url := " + lit(f"{FNB}/functions/v1/client-audit") + ", headers := jsonb_build_object('Content-Type', 'application/json', "
           "'Authorization', " + lit("Bearer " + ANON) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
           "body := '{\"action\": \"nightly\"}'::jsonb, timeout_milliseconds := 300000);")
sql(REF, f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
ok_, r_ = sql(REF, f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(command)}) as id")
say(f"  ✓ {JOB} scheduled ({SCHEDULE} UTC, about 6am Central)") if ok_ else bad(f"the schedule did not install: {r_}")
say(); say("PART 3 · PROOF (nothing is sent or changed)")
s_, b_ = http("POST", f"{FNB}/functions/v1/client-audit", {"action": "nightly"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
say(f"  ✓ the nightly pass refuses a caller without the job secret ({s_})") if s_ in (401, 403) else bad(f"nightly without the secret answered {s_}")
s_, b_ = http("POST", f"{FNB}/functions/v1/client-audit", {"action": "export", "axiscare_client_id": "1"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ the client export refuses a caller with no sign-in ({s_})") if s_ in (401, 403) else bad(f"export without a sign-in answered {s_}")
s_, b_ = http("POST", f"{FNB}/functions/v1/client-audit", {"action": "file_url", "path": "careplan/x/1-x.pdf"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ a client document link refuses a caller with no sign-in ({s_})") if s_ in (401, 403) else bad(f"file_url without a sign-in answered {s_}")
ok_, j = sql(REF, f"select schedule, active from cron.job where jobname = {lit(JOB)}")
say(f"  ✓ the schedule is on ({j[0]['schedule']})") if ok_ and j and j[0]['active'] else bad(f"schedule: {j}")
ok_, c2 = sql(REF, "select (select count(*)::int from public.client_issue where category = 'grievance' and state = 'resolved') as gr, (select count(*)::int from public.client_journey where subject = 'client') as cl, (select count(*)::int from public.document_access_log) as logs, (select count(*)::int from public.rules_approved where file = 'ihs-rules.js' and sha256 = " + lit(RULES_FP) + ") as fp")
say(f"  ✓ resolved grievances untouched ({c[0]['gr']} → {c2[0]['gr']}); client journeys untouched ({c[0]['cl']} → {c2[0]['cl']}); the access log unchanged ({c[0]['logs']} → {c2[0]['logs']}); the fingerprint approved") if ok_ and int(c2[0]['gr']) == int(c[0]['gr']) and int(c2[0]['cl']) == int(c[0]['cl']) and int(c2[0]['logs']) == int(c[0]['logs']) and int(c2[0]['fp']) == 1 else bad(f"after: {c2}")
say("  · tested before deploying: 34 checks on the client audit (the findings, the nightly pass in practice and live with owned cards that close themselves, the rules fingerprint, proof uploads and logged opens, the grievance answer rule, the client export and its as-of date, the caregiver export as of a date), the client journey 111 and care 60 tests with the subject filter, the Hub's Payer tab, grievance and card looks.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the nightly client audit runs from tonight in practice: it counts what it finds in the automation log and raises no task until you turn its switch on. Nothing was sent; no existing record changed."); done(0)
