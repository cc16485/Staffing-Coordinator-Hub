#!/usr/bin/env python3
# 575 · SLICE 4, VIVENTIUM STEP 2, MANUAL AND AUDITED (Samantha "go", 2026-10-10). Hub project. Installs step2_patch (the Step 2
# server's door onto a person's record), deploys the new step2-handoff function and welcome-call (its server door for the automatic
# invitation), sets the GoHighLevel reply token (STEP2_REPLY_TOKEN) and writes the webhook address to a Desktop file for the one
# GoHighLevel workflow she creates, and schedules the 15-minute pass. The three switches stay OFF (practice): nothing is sent.
# No existing record changes.
import os, json, secrets
os.environ.setdefault("SB_STEP", "575")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FNS = ["step2-handoff", "welcome-call"]
JOB = "step2-handoff-pass"; SCHEDULE = "*/15 * * * *"; VAULT_NAME = "hub_job_secret"
HOOK_FILE = os.path.expanduser("~/Desktop/Step 2 reply webhook (paste into GoHighLevel).txt")
start("SLICE 4: VIVENTIUM STEP 2, MANUAL AND AUDITED")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
VJ = {}
for fn in FNS:
    sx, mx = fmeta(REF, fn)
    if sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool): VJ[fn] = mx["verify_jwt"]; say(f"  ✓ {fn} is live at version {mx.get('version', '?')} (gateway sign-in check {'on' if VJ[fn] else 'off'}); replaced by this build, same setting")
    elif sx == 404 and fn == "step2-handoff": VJ[fn] = False; say(f"  · {fn} is new; deployed with the gateway sign-in check OFF (the caregiver's DONE page and the GoHighLevel webhook carry no sign-in; the function checks its own doors: the signed link, the reply token, the job secret, a staff sign-in)")
    else: bad(f"{fn} is not live or unreadable: {sx}")
SQLF = os.path.join(ROOT, "supabase", "slice4-step2.sql")
if not os.path.exists(SQLF): bad("the SQL file is not in the reviewed build")
def lit(v): return "'" + str(v).replace("'", "''") + "'"
ok_, sw = sql(REF, "select coalesce(data->>'step2_send_live', 'not set') as s, coalesce(data->>'step2_reminders_live', 'not set') as r, coalesce(data->>'wc_auto_invite_live', 'not set') as w, coalesce(data->>'onboarding_switch_date', '') as d from public.app_data where key = 'ops_settings'")
if ok_ and sw: say(f"  ✓ the switches: Step 2 message {sw[0]['s']}, reminders {sw[0]['r']}, automatic invitation {sw[0]['w']} (practice unless true); the onboarding switch date is {'NOT set' if not sw[0]['d'] else sw[0]['d']}")
else: bad(f"could not read the switches: {sw}")
ok_, c = sql(REF, "select (select count(*)::int from public.client_journey where subject = 'caregiver') as cg, (select count(*)::int from public.welcome_calls) as wc, (select count(*)::int from cron.job where jobname = " + lit(JOB) + ") as job, (select count(*)::int from vault.decrypted_secrets where name = 'hub_job_secret') as vault")
if ok_: say(f"  · {c[0]['cg']} caregiver journey(s), {c[0]['wc']} welcome call(s); the pass {'already' if int(c[0]['job']) else 'not yet'} scheduled; the job secret in the Vault: {int(c[0]['vault']) == 1}")
else: bad(f"could not count: {c}")
if ok_ and int(c[0]['vault']) != 1: bad("the Vault does not hold hub_job_secret (tell Claude)")
s_, b_ = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG()); ANON = ""
try:
    arr = json.loads(b_) if s_ == 200 else []
    if isinstance(arr, dict): arr = arr.get("keys") or []
    ANON = next((k.get("api_key") for k in arr if isinstance(k, dict) and k.get("name") == "anon" and str(k.get("api_key", "")).startswith("eyJ")), "")
except Exception: ANON = ""
if ANON: HIDE.append(ANON); say("  ✓ the project's public key is readable (the schedule needs it)")
else: bad("could not read the project's public key for the schedule")
s_, b_ = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
have_token = s_ == 200 and any(isinstance(x, dict) and x.get("name") == "STEP2_REPLY_TOKEN" for x in (json.loads(b_) if b_ else []))
say(f"  · the GoHighLevel reply token STEP2_REPLY_TOKEN is {'already set (kept)' if have_token else 'not set yet (this step creates it)'}")
say("  · what changes: one function in the database, two functions, one secret, one schedule, one text file on the Desktop. Nothing is sent; no record changes.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
ok_, r_ = sql(REF, open(SQLF).read())
if not ok_: bad(f"the migration did not run: {r_}"); done(5)
say("  ✓ step2_patch is installed (server only)")
TOKEN2 = None
if not have_token:
    TOKEN2 = secrets.token_urlsafe(32); HIDE.append(TOKEN2)
    s_, b_ = http("POST", f"{API}/v1/projects/{REF}/secrets", [{"name": "STEP2_REPLY_TOKEN", "value": TOKEN2}], MG())
    if s_ in (200, 201): say("  ✓ STEP2_REPLY_TOKEN set on the project")
    else: bad(f"the reply token could not be set: {s_} {str(b_)[:120]}"); done(5)
for fn in FNS:
    if not deploy(REF, FNROOT, fn, VJ[fn]): say("  RESULT: STOPPED. Tell Claude."); done(6)
FNB = f"https://{REF}.supabase.co"
command = ("select net.http_post(url := " + lit(f"{FNB}/functions/v1/step2-handoff") + ", headers := jsonb_build_object('Content-Type', 'application/json', "
           "'Authorization', " + lit("Bearer " + ANON) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
           "body := '{\"action\": \"pass\"}'::jsonb, timeout_milliseconds := 120000);")
sql(REF, f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
ok_, r_ = sql(REF, f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(command)}) as id")
say(f"  ✓ the Step 2 pass is scheduled every 15 minutes ({JOB})") if ok_ else bad(f"the schedule did not install: {r_}")
if TOKEN2:
    with open(HOOK_FILE, "w") as f:
        f.write("STEP 2 REPLY WEBHOOK · for ONE GoHighLevel workflow (Samantha creates it; the Hub cannot)\n\n"
                "Workflow trigger:  Customer Replied  ·  filter: contact has the tag  step2-sent\n"
                "Action:            Webhook (POST)\n"
                f"URL:               {FNB}/functions/v1/step2-handoff?token={TOKEN2}\n"
                "Body (JSON):       {\"id\": \"{{contact.id}}\", \"phone\": \"{{contact.phone}}\", \"name\": \"{{contact.name}}\", \"message\": \"{{message.body}}\"}\n\n"
                "The Hub tags a contact step2-sent when it sends the Step 2 message. A reply of DONE / done / finished from a phone that matches\n"
                "exactly one person at Step 2 Sent is recorded as their report; anything else becomes an office review card. Nothing is verified\n"
                "by a reply. Keep this file private: the token in the URL is the webhook's key.\n")
    say("  ✓ the webhook address is on the Desktop: 'Step 2 reply webhook (paste into GoHighLevel).txt' (the token is only in that file)")
else: say("  · the reply token already existed, so the webhook file was not rewritten (tell Claude if you need it again)")
say(); say("PART 3 · PROOF (nothing is sent or changed)")
ok_, p = sql(REF, "select public.step2_patch('candidates', 'no-such-person-575', 0, '{\"step2_sent_at\": \"2026-01-01T00:00:00Z\"}'::jsonb) as r")
say("  ✓ the Step 2 door accepts its fields (and found no such person, so nothing changed)") if ok_ and p and (p[0]['r'] or {}).get('reason') == 'gone' else bad(f"step2 patch: {p}")
ok_, p2 = sql(REF, "select public.step2_patch('candidates', 'no-such-person-575', 0, '{\"first\": \"x\"}'::jsonb) as r")
say("  ✓ the Step 2 door refuses a field it does not own") if not ok_ and 'not a Step 2 field' in str(p2) else bad(f"step2 patch did not refuse: {ok_} {p2}")
s_, b_ = http("POST", f"{FNB}/functions/v1/step2-handoff", {"action": "sent", "candidate_id": "1"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
say(f"  ✓ Record Sent refuses a caller with no staff sign-in ({s_})") if s_ in (401, 403) else bad(f"sent without a sign-in answered {s_}")
s_, b_ = http("POST", f"{FNB}/functions/v1/step2-handoff", {"action": "pass"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
say(f"  ✓ the pass refuses a caller without the job secret ({s_})") if s_ in (401, 403) else bad(f"pass without the secret answered {s_}")
s_, b_ = http("POST", f"{FNB}/functions/v1/step2-handoff?token=wrong", {"phone": "0", "message": "DONE"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
say(f"  ✓ the GoHighLevel door refuses a wrong token ({s_})") if s_ == 401 else bad(f"webhook with a wrong token answered {s_}")
s_, b_ = http("POST", f"{FNB}/functions/v1/step2-handoff", {"action": "done", "c": "1", "e": "1", "t": "x"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
say(f"  ✓ the DONE page refuses a forged link ({s_})") if s_ == 401 else bad(f"done with a forged link answered {s_}")
s_, b_ = http("POST", f"{FNB}/functions/v1/welcome-call", {"action": "invite_auto", "candidate_id": "1"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
say(f"  ✓ welcome-call's server door refuses a caller without the job secret ({s_})") if s_ in (401, 403) else bad(f"invite_auto without the secret answered {s_}")
ok_, j = sql(REF, f"select schedule, active from cron.job where jobname = {lit(JOB)}")
say(f"  ✓ the schedule is on ({j[0]['schedule']})") if ok_ and j and j[0]['active'] else bad(f"schedule: {j}")
ok_, c2 = sql(REF, "select (select count(*)::int from public.welcome_calls) as wc, (select count(*)::int from public.client_journey where subject = 'caregiver') as cg")
say(f"  ✓ welcome calls untouched ({c[0]['wc']} → {c2[0]['wc']}); caregiver journeys untouched ({c[0]['cg']} → {c2[0]['cg']})") if ok_ and int(c2[0]['wc']) == int(c[0]['wc']) and int(c2[0]['cg']) == int(c[0]['cg']) else bad(f"after: {c2}")
say("  · tested before deploying: 46 checks on the Step 2 server (the gate, Sent once and Resend, DONE by link and by reply with the one-person rule, the cards and their deadlines, reminders in practice and live, Verify with the checklist confirming the card rows, undo with reasons, the automatic invitation through welcome-call's door, old-path people), the Hub's queue tests, the journey check.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the three Step 2 actions are live on the Orientations tab (after the Hub merge); messages, reminders and the automatic invitation stay in practice until you turn their switches on. Create the one GoHighLevel workflow from the Desktop file so DONE replies reach the Hub. Nothing was sent; no record changed."); done(0)
