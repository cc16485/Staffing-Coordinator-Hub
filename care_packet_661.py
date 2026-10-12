#!/usr/bin/env python3
# 661 · CAREGIVER PACKETS, STEP 2 (Samantha "build step 2", 2026-10-12). The Caregiver packet card texts a caregiver their
# own packet link (first text, reminder or updated packet) from the office number, after a person reads the exact text and
# presses Send. Adds five empty columns to care_packet_recipients (care_packet_2.sql) and redeploys care-packet. The switch
# "Caregiver packet texts" (ops_settings.care_packet_send_live) is NOT touched: it starts off and is turned on from the
# Owners Hub Admin page. Nothing is texted by this step.
# Undo: care_packet_2_rollback.sql (drops the five columns) and redeploy care-packet from 660's build.
import os, json, hashlib
os.environ.setdefault("SB_STEP", "661")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
FN = "care-packet"
start("CAREGIVER PACKETS, STEP 2 (TEXTING FROM THE CARD)")
say("PART 1 · READ ONLY (nothing changes)")
mig = open(os.path.join(ROOT, "care_packet_2.sql"), "rb").read()
say("  ✓ care_packet_2.sql is the reviewed build") if hashlib.sha256(mig).hexdigest() == os.environ.get("SB_SQL_SHA", "") else bad("care_packet_2.sql is not the reviewed build: nothing runs")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
ok1, r1 = sql(REF, """select to_regclass('public.care_packet_recipients') is not null as tbl,
  (select count(*) from information_schema.columns where table_schema='public' and table_name='care_packet_recipients' and column_name in ('last_sent_at','last_sent_by','last_send_kind','last_send_id','send_count')) as cols,
  (select count(*) from public.care_packets) as packets, (select count(*) from public.care_packet_recipients) as recips,
  coalesce((select (data->>'care_packet_send_live') from public.app_data where key='ops_settings'), 'not set') as switch""")
if not ok1: bad(f"could not read the database: {r1}")
else:
    x = r1[0]
    if not x["tbl"]: bad("the packet tables are not there (660 has not run?). Tell Claude.")
    elif int(x["cols"]): bad(f"{x['cols']} of the five send columns already exist (run before?). Tell Claude.")
    else: say(f"  ✓ step 1 is in: {x['packets']} packet(s), {x['recips']} caregiver row(s); the send columns are not there yet")
    say(f"  · the switch Caregiver packet texts is {x['switch'] if x['switch'] != 'not set' else 'not set (off)'}; this step leaves it alone")
sM, mM = fmeta(REF, FN)
say(f"  ✓ care-packet is live now (version {(mM or {}).get('version', '?')})") if sM == 200 else bad(f"care-packet is not deployed ({sM}). Tell Claude.")
say("  · what changes: 5 new empty columns, and care-packet gains Send (a person presses it; the switch starts off). No packet, caregiver or message changes.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
okc, rc = sql(REF, mig.decode())
if not okc: bad(f"the columns were not added (nothing changed: it is all or nothing): {rc}"); say("  RESULT: STOPPED. Tell Claude."); done(5)
say("  ✓ the five send columns are in")
if not deploy(REF, FNROOT, FN, False): say("  RESULT: STOPPED. The columns are in; care-packet is still the step 1 build. Tell Claude."); done(6)

say(); say("PART 3 · PROOF (nothing is sent)")
ok2, r2 = sql(REF, """select (select count(*) from information_schema.columns where table_schema='public' and table_name='care_packet_recipients' and column_name in ('last_sent_at','last_sent_by','last_send_kind','last_send_id','send_count')) as cols,
  (select count(*) from public.care_packet_recipients where last_sent_at is not null) as texted, (select count(*) from public.care_packet_recipients) as recips,
  has_table_privilege('anon','public.care_packet_recipients','select') or has_table_privilege('authenticated','public.care_packet_recipients','select') as browser_can_read,
  coalesce((select (data->>'care_packet_send_live') from public.app_data where key='ops_settings'), 'not set') as switch""")
if ok2:
    y = r2[0]
    say(f"  ✓ 5 columns, nobody marked as texted, {y['recips']} caregiver row(s) as before") if int(y["cols"]) == 5 and int(y["texted"]) == 0 and int(y["recips"]) == int(x["recips"]) else bad(f"the columns do not read back as expected: {y}")
    say("  ✓ still no browser role can read the caregiver rows") if not y["browser_can_read"] else bad("a browser role can read care_packet_recipients")
    say(f"  ✓ the switch is unchanged ({y['switch'] if y['switch'] != 'not set' else 'not set, so off'})") if y["switch"] == x["switch"] else bad(f"the switch changed: {y['switch']}")
else: bad(f"could not read back: {r2}")
U = f"https://{REF}.supabase.co/functions/v1/{FN}"
s1, _ = http("OPTIONS", U)
say("  ✓ the Hub page can reach it (the browser check answers)") if s1 == 200 else bad(f"the browser check answered {s1}")
s2, b2 = http("POST", U, {"action": "send", "packet_id": "00000000-0000-0000-0000-000000000000", "caregiver_axiscare_id": "1", "send_id": "proof-0001"})
say("  ✓ Send refuses anyone not signed in (401)") if s2 == 401 else bad(f"Send without sign-in answered {s2}: {b2[:120]}")
s3, b3 = http("POST", U, {"action": "view", "i": "pl_" + "A" * 20, "e": 9999999999, "t": "A" * 43})
say("  ✓ a made-up caregiver link is still refused (403)") if s3 == 403 else bad(f"a made-up link answered {s3}: {b3[:120]}")
say("  · tested before deploying: the real function against a fake database and a fake GoHighLevel (63 checks, 19 new: the exact three texts with no health words and no em dash, sign-in and roles, switch off sends nothing, one text per Send even pressed twice, first then reminder then updated, nothing once confirmed, opted out and no phone refused, a GoHighLevel refusal lands on Needs Attention) and the card in a browser (29 checks).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · texting from the Caregiver packet card is installed, switched OFF. Merge the Hub and Owners Hub pull requests, then turn on \"Caregiver packet texts\" on the Owners Hub Admin page when you are ready."); done(0)
