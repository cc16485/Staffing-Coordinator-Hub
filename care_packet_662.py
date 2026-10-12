#!/usr/bin/env python3
# 662 · CAREGIVER PACKETS, STEP 3 (Samantha "build step 3", 2026-10-12). (1) care-packet gains "Coming up in the next 14
# days" for the card (AxisCare, read live). (2) A new job, care-packet-watch, twice a day: anyone on a ready-packet client's
# schedule in the next 3 days who has not confirmed goes on one Needs Attention card per client for Client Care; it closes
# itself. It texts nobody. The switch "Caregiver packet check before shifts" (ops_settings.care_packet_watch_live) is NOT
# touched: off, the job only records what it would raise. No table changes.
# Undo: cron.unschedule('care-packet-watch-twice-daily'), delete the care-packet-watch function, redeploy care-packet from 661.
import os, json, time
os.environ.setdefault("SB_STEP", "662")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
VAULT = "hub_job_secret"; JOB = "care-packet-watch-twice-daily"; SCHEDULE = "30 12,18 * * *"   # 7:30am and 1:30pm Central (CDT); an hour earlier in winter
start("CAREGIVER PACKETS, STEP 3 (BEFORE THE SHIFT)")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
s1, _ = fmeta(REF, "care-packet")
say("  ✓ care-packet is live (step 2)") if s1 == 200 else bad(f"care-packet is not deployed ({s1}). Tell Claude.")
s2, _ = fmeta(REF, "care-packet-watch")
if s2 == 404: say("  ✓ care-packet-watch is new")
elif s2 == 200: bad("a care-packet-watch function is already deployed. Tell Claude.")
else: bad(f"could not check the functions ({s2}). Tell Claude.")
ok, sv = sql(REF, f"""select coalesce((select data->>'care_packet_watch_live' from public.app_data where key = 'ops_settings'), 'not set') as live,
  (select count(*) from vault.decrypted_secrets where name = {lit(VAULT)})::int as vault, (select count(*) from cron.job where jobname = {lit(JOB)})::int as job,
  (select count(*) from public.care_packets where ready) as ready, (select count(*) from public.care_packets where ready and axiscare_client_id ~ '^[0-9]+$') as in_ax""")
if not ok or not sv: bad(f"could not read the settings: {sv}")
else:
    x = sv[0]
    say("  ✓ the jobs' secret is in the vault") if x["vault"] == 1 else bad("the jobs' secret isn't in the vault. Tell Claude.")
    say("  ✓ no schedule yet") if x["job"] == 0 else bad("the schedule already exists (run before?). Tell Claude.")
    say(f"  · {x['ready']} ready packet(s), {x['in_ax']} for clients in AxisCare (only those are checked)")
    say(f"  · the switch \"Caregiver packet check before shifts\" is {'ON' if x['live'] == 'true' else 'OFF'}; this step leaves it alone")
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG())
try: K = {k.get("name"): k.get("api_key", "") for k in json.loads(kb) if isinstance(k, dict)}
except Exception: K = {}
ANON, SVC = K.get("anon", ""), K.get("service_role", "")
if not ANON or not SVC: bad("couldn't read the project keys. Tell Claude.")
HIDE.extend([ANON, SVC])
say("  · what changes: care-packet redeployed (adds Coming up), care-packet-watch added and scheduled at 7:30am and 1:30pm. No tables, no texts.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, "care-packet", False): say("  RESULT: STOPPED. Nothing else was changed. Tell Claude."); done(6)
if not deploy(REF, FNROOT, "care-packet-watch", True): say("  RESULT: STOPPED. care-packet has Coming up; the check is not installed. Tell Claude."); done(6)
URL = f"https://{REF}.supabase.co/functions/v1/care-packet-watch"
cmd = ("select net.http_post(url := " + lit(URL) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
       "'Authorization', " + lit("Bearer " + ANON) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT) + ")), "
       "body := '{}'::jsonb, timeout_milliseconds := 120000);")
okj, rj = sql(REF, f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(cmd)}) as id")
ok2, jb = sql(REF, f"select schedule, command from cron.job where jobname = {lit(JOB)}")
say("  ✓ scheduled at 7:30am and 1:30pm every day (switched off it only records)") if okj and ok2 and jb and jb[0]["schedule"] == SCHEDULE and "x-cron-secret" in jb[0]["command"] else bad(f"it was not scheduled: {rj} {jb}")

say(); say("PART 3 · PROOF AND A PRACTICE RUN (reads AxisCare; writes, texts and emails nothing)")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
s3, _ = http("POST", URL, {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
say(f"  ✓ the check refuses anyone without the schedule's secret ({s3})") if s3 in (401, 403) else bad(f"the check answered someone without the secret ({s3})")
s4, b4 = http("POST", URL, {"dry": True}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
try: d = json.loads(b4)
except Exception: d = {}
if s4 == 200 and d.get("dry") is True:
    say(f"  ✓ practice run: {d.get('packets', 0)} packet(s) checked, {d.get('read', 0)} read from AxisCare, {d.get('caregivers_upcoming', 0)} caregiver(s) coming up in 3 days, {d.get('missing', 0)} not confirmed")
    for w in d.get("would", [])[:10]: say(f"    · {w.get('client') or 'a client'}: would {w.get('what')} a card ({', '.join(w.get('missing') or []) or 'nobody left'})")
    if d.get("unreadable"): bad(f"AxisCare did not answer for {d['unreadable']} client(s) in the practice run. Tell Claude.")
else: bad(f"the practice run answered {s4}: {b4[:160]}")
s5, b5 = http("POST", f"https://{REF}.supabase.co/functions/v1/care-packet", {"action": "upcoming", "packet_id": "00000000-0000-0000-0000-000000000000"})
say("  ✓ Coming up refuses anyone not signed in (401)") if s5 == 401 else bad(f"Coming up without sign-in answered {s5}: {b5[:120]}")
say("  · tested before deploying: care-packet against a fake database, GoHighLevel and AxisCare (68 checks, 5 new for Coming up), the check itself (19: secret only, ready packets in AxisCare only, one card per client, urgent within 24 hours, closes itself, a closed card stays closed unless someone new appears, AxisCare failing never changes a card, switch off records only, dry run writes nothing) and the card in a browser (32).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · Coming up and the before-shift check are installed, the check switched OFF. Merge the Hub and Owners Hub pull requests, then turn on \"Caregiver packet check before shifts\" on the Admin page when you are ready."); done(0)
