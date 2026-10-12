#!/usr/bin/env python3
# 660 · CAREGIVER PACKETS, STEP 1 (Samantha "yes start step 1", 2026-10-12). Adds four new tables (care_packet_1.sql), puts
# the how-to library she approved into care_topics (care_topics_seed.json: 6 topics, the hospice nurses first, BD for the
# PureWick), and deploys the care-packet function. Nothing existing changes, nothing is texted or emailed, and no client
# has a packet until the office writes one on the client's Care tab (after the Hub pull request is merged).
# Undo: care_packet_1_rollback.sql (drops the four tables) and delete the care-packet function.
import os, json, hashlib
os.environ.setdefault("SB_STEP", "660")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
FN = "care-packet"
start("CAREGIVER PACKETS, STEP 1")
say("PART 1 · READ ONLY (nothing changes)")
mig = open(os.path.join(ROOT, "care_packet_1.sql"), "rb").read()
seed_raw = open(os.path.join(ROOT, "care_topics_seed.json"), "rb").read()
say("  ✓ care_packet_1.sql is the reviewed build") if hashlib.sha256(mig).hexdigest() == os.environ.get("SB_SQL_SHA", "") else bad("care_packet_1.sql is not the reviewed build: nothing runs")
say("  ✓ the how-to library is the one you approved") if hashlib.sha256(seed_raw).hexdigest() == os.environ.get("SB_SEED_SHA", "") else bad("care_topics_seed.json is not the approved build: nothing runs")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
seed = json.loads(seed_raw)
ok1, r1 = sql(REF, "select to_regclass('public.care_packets') is not null as packets, to_regclass('public.care_topics') is not null as topics")
if not ok1: bad(f"could not read the database: {r1}")
elif r1[0]["packets"] or r1[0]["topics"]: bad("the packet tables are already there (installed before?). Tell Claude.")
else: say("  ✓ no packet tables yet")
s, b = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
names = [x.get("name") for x in (json.loads(b) if s == 200 else [])]
say("  ✓ the server's link secret (HUB_JOB_SECRET) is set") if "HUB_JOB_SECRET" in names else bad("HUB_JOB_SECRET is not set, so caregiver links could not be made. Tell Claude.")
sM, mM = fmeta(REF, FN)
if sM == 200: bad("a care-packet function is already deployed. Tell Claude.")
else: say("  ✓ no care-packet function yet")
say(f"  · what changes: 4 new tables, {len(seed)} how-to topics, 1 new function. No client, caregiver or message changes.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
okc, rc = sql(REF, mig.decode())
if not okc: bad(f"the tables were not added (nothing changed: it is all or nothing): {rc}"); say("  RESULT: STOPPED. Tell Claude."); done(5)
say("  ✓ the four packet tables are in, locked to the server only")
rows = ",\n".join("(%s, %s, %s, %s::jsonb, true, 'install-660')" % (lit(t["key"]), lit(t["title"]), lit(t["notes"]), lit(json.dumps(t["videos"]))) for t in seed)
okt, rt = sql(REF, f"insert into public.care_topics (key, title, notes, videos, active, updated_by) values\n{rows}\non conflict (key) do nothing")
say(f"  ✓ the {len(seed)} how-to topics are in the library") if okt else bad(f"the topics were not added: {rt}")
if not deploy(REF, FNROOT, FN, False): say("  RESULT: STOPPED. The tables are in; the function is not. Tell Claude."); done(6)

say(); say("PART 3 · PROOF (nothing is sent)")
ok2, r2 = sql(REF, """select (select count(*) from public.care_topics where active) as topics,
  (select count(*) from public.care_packets) as packets,
  (select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.care_topics'::regclass,'public.care_packets'::regclass,'public.care_packet_recipients'::regclass,'public.care_packet_acks'::regclass)) as rls,
  has_table_privilege('anon','public.care_packets','select') or has_table_privilege('authenticated','public.care_packets','select')
   or has_table_privilege('anon','public.care_packet_recipients','select') or has_table_privilege('authenticated','public.care_packet_recipients','select')
   or has_table_privilege('anon','public.care_topics','select') or has_table_privilege('authenticated','public.care_topics','select') as browser_can_read""")
if ok2:
    x = r2[0]
    say(f"  ✓ {x['topics']} topics in the library, {x['packets']} packets") if int(x["topics"]) == len(seed) and int(x["packets"]) == 0 else bad(f"the library does not read back as expected: {x}")
    say("  ✓ row security on, and no browser role can read the tables (only the function can)") if x["rls"] and not x["browser_can_read"] else bad(f"the tables are not locked as expected: {x}")
else: bad(f"could not read back: {r2}")
U = f"https://{REF}.supabase.co/functions/v1/{FN}"
s1, _ = http("OPTIONS", U)
say("  ✓ the Hub page can reach it (the browser check answers)") if s1 == 200 else bad(f"the browser check answered {s1}")
s2, b2 = http("POST", U, {"action": "get", "ax": "1"})
say("  ✓ office actions refuse anyone not signed in (401)") if s2 == 401 else bad(f"an office action without sign-in answered {s2}: {b2[:120]}")
s3, b3 = http("POST", U, {"action": "view", "i": "pl_" + "A" * 20, "e": 9999999999, "t": "A" * 43})
say("  ✓ a made-up caregiver link is refused (403)") if s3 == 403 else bad(f"a made-up link answered {s3}: {b3[:120]}")
say("  · tested before deploying: the real function against a fake database (44 checks: sign-in and roles, stale saves, versions, roster by AxisCare id, forged, swapped and expired links, opening records nothing, one confirmation per version, an edit asks again, owner-only library, https-only videos) and both screens in a browser (19 checks).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · caregiver packets are installed. Merge the Hub pull request next; then the Caregiver packet card shows on every client's Care tab."); done(0)
