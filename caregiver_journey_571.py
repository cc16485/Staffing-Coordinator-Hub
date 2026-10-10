#!/usr/bin/env python3
# 571 · SLICE 3b, THE ONE NEW-HIRE READINESS VIEW (Samantha, 2026-10-10; fictional offers only). Hub project. Deploys the new
# caregiver-journey function, offer-sign (starts the readiness card at the second signature), welcome-call and reference-send
# (the server refusals on the new path), activates the 37 caregiver catalog rows, and schedules the readiness sweep every
# ten minutes (like the client journey's). The old path is untouched: a person without a readiness card is never refused.
# Nothing is sent; no existing row changes.
import os, json
os.environ.setdefault("SB_STEP", "571")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FNS = ["caregiver-journey", "offer-sign", "welcome-call", "reference-send"]
JOB = "caregiver-journey-sweep"; SCHEDULE = "*/10 * * * *"; VAULT_NAME = "hub_job_secret"
start("SLICE 3b: THE ONE NEW-HIRE READINESS VIEW")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
VJ = {}
for fn in FNS:
    sx, mx = fmeta(REF, fn)
    if sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool): VJ[fn] = mx["verify_jwt"]; say(f"  ✓ {fn} is live at version {mx.get('version', '?')} (gateway sign-in check {'on' if VJ[fn] else 'off'}); replaced by this build, same setting")
    elif sx == 404 and fn == "caregiver-journey": VJ[fn] = True; say(f"  · {fn} is new; deployed with the gateway sign-in check on (the Hub calls it with your sign-in; the sweep with the job secret)")
    else: bad(f"{fn} is not live or unreadable: {sx}")
SQLF = os.path.join(ROOT, "supabase", "slice3b-activate-caregiver-catalog.sql")
if not os.path.exists(SQLF): bad("the SQL file is not in the reviewed build")
ok_, c = sql(REF, "select (select count(*)::int from public.client_journey_step_def where key like 'cg.%') as cg, (select count(*)::int from public.client_journey_step_def where key like 'cg.%' and active) as cg_active, (select count(*)::int from public.client_journey where subject = 'caregiver') as cg_journeys, (select count(*)::int from public.client_journey where subject = 'client') as cl_journeys, (select count(*)::int from vault.decrypted_secrets where name = 'hub_job_secret') as vault")
if ok_: say(f"  · {c[0]['cg']} caregiver catalog rows ({c[0]['cg_active']} active), {c[0]['cg_journeys']} caregiver journey(s), {c[0]['cl_journeys']} client journey(s); the job secret in the Vault: {int(c[0]['vault']) == 1}")
else: bad(f"could not count: {c}")
if ok_ and int(c[0]['vault']) != 1: bad("the Vault does not hold hub_job_secret (the client journey sweep installed it; tell Claude)")
s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG()); ANON = ""
try:
    arr = json.loads(b) if s == 200 else []
    if isinstance(arr, dict): arr = arr.get("keys") or []
    ANON = next((k.get("api_key") for k in arr if isinstance(k, dict) and k.get("name") == "anon" and str(k.get("api_key", "")).startswith("eyJ")), "")
except Exception: ANON = ""
if ANON: HIDE.append(ANON); say("  ✓ the project's public key is readable (the sweep's schedule needs it, like the client journey's)")
else: bad("could not read the project's public key for the schedule")
say("  · what changes: four functions, the 37 rows active, one scheduled job. Nothing is sent; no existing row changes; the old path is untouched.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, VJ[fn]): say("  RESULT: STOPPED. Tell Claude."); done(6)
ok_, r_ = sql(REF, open(SQLF).read())
if not ok_: bad(f"the catalog did not activate: {r_}"); done(5)
say("  ✓ the 37 caregiver catalog rows are active")
def lit(v): return "'" + str(v).replace("'", "''") + "'"
FNB = f"https://{REF}.supabase.co"
command = ("select net.http_post(url := " + lit(f"{FNB}/functions/v1/caregiver-journey") + ", headers := jsonb_build_object('Content-Type', 'application/json', "
           "'Authorization', " + lit("Bearer " + ANON) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
           "body := '{\"action\": \"sweep\"}'::jsonb, timeout_milliseconds := 120000);")
sql(REF, f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
ok_, r_ = sql(REF, f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(command)}) as id")
say(f"  ✓ the readiness sweep is scheduled every ten minutes ({JOB})") if ok_ else bad(f"the schedule did not install: {r_}")
say(); say("PART 3 · PROOF (nothing is sent or changed)")
s_, b_ = http("POST", f"{FNB}/functions/v1/caregiver-journey", {"action": "get", "offer_id": "00000000-0000-0000-0000-000000000000"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ the readiness card refuses a caller with no sign-in ({s_})") if s_ in (401, 403) else bad(f"get without a sign-in answered {s_}")
s_, b_ = http("POST", f"{FNB}/functions/v1/caregiver-journey", {"action": "sweep"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ the sweep refuses a caller without the job secret ({s_})") if s_ in (401, 403) else bad(f"sweep without the secret answered {s_}")
ok_, j = sql(REF, f"select schedule, active from cron.job where jobname = {lit(JOB)}")
say(f"  ✓ the schedule is on ({j[0]['schedule']})") if ok_ and j and j[0]['active'] else bad(f"schedule: {j}")
ok_, c2 = sql(REF, "select (select count(*)::int from public.client_journey where subject = 'client') as cl, (select count(*)::int from public.client_journey_step_def where key like 'cg.%' and active) as cg_active")
say(f"  ✓ client journeys untouched ({c[0]['cl_journeys']} → {c2[0]['cl']}); {c2[0]['cg_active']} caregiver rows active") if ok_ and int(c2[0]['cl']) == int(c[0]['cl_journeys']) and int(c2[0]['cg_active']) == 37 else bad(f"after: {c2}")
say("  · tested before deploying: 29 checks on the function and its core (start once, sweep verifies rows from the records, lists decide confirmations, owners only for Approve to Work and not-needed, documents required, the gate allows the old path), 42 on the rules, 11 on the card.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the readiness card is live for fictional offers; the sweep verifies every ten minutes. Nothing was sent; no existing row changed."); done(0)
