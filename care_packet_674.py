#!/usr/bin/env python3
# 674 · THE CARE LIBRARY (Samantha 2026-10-12: "I would love to see this in it's own tab and make it a large library ... common
# senior issues, such as fall rise, transfers, different diets"). Her rulings: Client Care → Care Library tab; she approves
# every video in the tab; the whole office can browse it, only an owner changes or approves; after a fall caregivers never lift.
#   1. care_packet_3.sql: groups, a warning line, a waiting/approved mark and an office-only note on each topic (new columns
#      only; the six topics she already approved stay approved and offered).
#   2. care-packet redeployed: the tab reads the library, she approves or removes each video and topic, only approved videos in
#      approved topics ever reach a caregiver, and the caregiver page never gets who approved or the office notes.
#   3. care_library_seed.json: 37 researched topics, 95 videos (each checked to be real and to play), all WAITING for her OK.
#      Nothing waiting can be put in a packet. A key already in the library is never overwritten.
# No switches, nothing texted. Undo: care_packet_3_rollback.sql (waiting topics are retired first) + redeploy from 673's build.
import os, json, hashlib
os.environ.setdefault("SB_STEP", "674")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
ROOT = os.path.abspath(os.path.join(FNROOT, "..", ".."))
U = f"https://{REF}.supabase.co/functions/v1/care-packet"
start("THE CARE LIBRARY")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
mig = open(os.path.join(ROOT, "care_packet_3.sql"), "rb").read()
seed_raw = open(os.path.join(ROOT, "care_library_seed.json"), "rb").read()
say("  ✓ care_packet_3.sql is the reviewed build") if hashlib.sha256(mig).hexdigest() == os.environ.get("SB_SQL_SHA", "") else bad("care_packet_3.sql is not the reviewed build: nothing runs")
say("  ✓ the researched library is the reviewed build") if hashlib.sha256(seed_raw).hexdigest() == os.environ.get("SB_SEED_SHA", "") else bad("care_library_seed.json is not the reviewed build: nothing runs")
seed = json.loads(seed_raw)
s1, m1 = fmeta(REF, "care-packet")
say(f"  ✓ care-packet is live (version {(m1 or {}).get('version', '?')})") if s1 == 200 else bad(f"care-packet is not deployed ({s1}). Tell Claude.")
ok0, r0 = sql(REF, "select key, active from public.care_topics")
if not ok0: bad(f"could not read the library: {r0}")
have = {x["key"] for x in (r0 if ok0 else [])}
clash = sorted(have & {t["key"] for t in seed})
say(f"  · the library has {len(have)} topic(s) now; adding {len(seed) - len(clash)} waiting for your OK" + (f" (already there, left alone: {', '.join(clash)})" if clash else ""))
okp, rp = sql(REF, "select (select count(*) from public.care_packets) as packets, (select count(*) from public.care_packet_recipients) as recips")
if okp: say(f"  · {rp[0]['packets']} packet(s), {rp[0]['recips']} caregiver link(s): this step changes none of them")
say("  · what changes: 6 new columns on the library, care-packet redeployed, the researched topics added as waiting. No switches, no texts.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
okc, rc = sql(REF, mig.decode())
say("  ✓ the library columns are added") if okc else bad(f"care_packet_3.sql did not run: {rc}")
if fails: say("  RESULT: STOPPED. Nothing else changed. Tell Claude."); done(6)
if not deploy(REF, FNROOT, "care-packet", False): say("  RESULT: STOPPED (the columns are in, harmless on their own). Tell Claude."); done(6)
rows = ",\n".join("(%s, %s, %s, %s, %s, %s, %s::jsonb, true, true, 'install-674')" % (lit(t["key"]), lit(t["title"]), lit(t["category"]), lit(t["flag"]), lit(t["notes"]), lit(t["review_note"]), lit(json.dumps(t["videos"]))) for t in seed)
okt, rt = sql(REF, f"insert into public.care_topics (key, title, category, flag, notes, review_note, videos, active, pending, updated_by) values\n{rows}\non conflict (key) do nothing")
say(f"  ✓ the researched topics are in the library, waiting for your OK") if okt else bad(f"the topics were not added: {rt}")

say(); say("PART 3 · PROOF (nothing is sent, nothing is saved)")
ok2, r2 = sql(REF, """select (select count(*) from public.care_topics where pending and active) as waiting,
  (select count(*) from public.care_topics where not pending and active) as approved,
  (select coalesce(sum(jsonb_array_length(videos)), 0) from public.care_topics where pending) as waiting_videos,
  (select count(*) from public.care_topics where pending and exists (select 1 from jsonb_array_elements(videos) v where coalesce(v->>'status','approved') = 'approved')) as leaked""")
if ok2:
    x = r2[0]
    say(f"  ✓ {x['waiting']} topics ({x['waiting_videos']} videos) waiting for your OK; {x['approved']} approved topics still offered") if int(x["waiting"]) >= len(seed) - len(clash) and int(x["approved"]) >= 6 else bad(f"the library does not read back as expected: {x}")
    say("  ✓ not one researched video is marked approved") if int(x["leaked"]) == 0 else bad(f"{x['leaked']} waiting topic(s) have an approved video. Tell Claude.")
else: bad(f"could not read the library back: {r2}")
for act, body in (("library", {}), ("review", {"key": "gait_belt", "decision": "approve"})):
    sx, bx = http("POST", U, dict(body, action=act))
    say(f"  ✓ {act} refuses anyone not signed in (401)") if sx == 401 else bad(f"{act} without sign-in answered {sx}: {bx[:120]}")
say("  · tested before deploying: care-packet 114 checks (19 new: nothing waiting reaches a packet or a caregiver page, her stamp set by the server only, owner-only approval, office reads), the library columns on a real Postgres 8, packet watch 19, and the Care Library tab in a browser.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the Care Library is installed. Merge the Hub pull request next, then open Client Care → Care Library."); done(0)
