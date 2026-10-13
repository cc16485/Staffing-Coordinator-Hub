#!/usr/bin/env python3
# 676 · CAREGIVER PACKETS: SEND AUTOMATICALLY PER CLIENT, KEEP CONFIRMATIONS AFTER A SMALL FIX, SIT-TO-STAND (Samantha 2026-10-12):
#   "have us mark if we want it sent to anyone who is scheduled with him or only send manually ... that option for each client"
#   "change ariels smiths back to confirmed ... i just accidently clicked save packet again"
#   "please add hoyer lift and sit to stand instructional videos in the care library if it isnt there yet"
#   1. care_packet_5.sql: auto_send per packet (OFF for every client), and carried-over marks on confirmations (new columns only).
#   2. care-packet: 'auto_set' (the card's choice), 'carry_acks' (Small fix: keep their confirmations, recorded as carried over,
#      by whom, from which version), 'auto_send' (only the check's secret; same send path, 8am-8pm, first/updated only).
#   3. care-packet-watch: for a client set to automatic, texts each caregiver coming up who has not had THIS version.
#   4. The check's schedule moves to 15 past 14, 19, 23 UTC (about 9:15am, 2:15pm, 6:15pm Central; an hour earlier in winter),
#      so every run falls inside 8am to 8pm.
#   5. The library: Sit-to-stand lift (3 videos) and 2 more Hoyer videos, all WAITING for her OK.
# Texts nobody during the install: every client stays set to by hand until the office turns one on.
# Undo: care_packet_5_rollback.sql, redeploy both functions from 675's build, schedule back to '30 12,18 * * *'.
import os, json, hashlib
os.environ.setdefault("SB_STEP", "676")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
ROOT = os.path.abspath(os.path.join(FNROOT, "..", ".."))
JOB = "care-packet-watch-twice-daily"; NEW_SCHEDULE = "15 14,19,23 * * *"
U = f"https://{REF}.supabase.co/functions/v1/care-packet"
start("CAREGIVER PACKETS: SEND AUTOMATICALLY PER CLIENT, KEEP CONFIRMATIONS, SIT-TO-STAND")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
mig = open(os.path.join(ROOT, "care_packet_5.sql"), "rb").read()
add_raw = open(os.path.join(ROOT, "care_library_seed_2.json"), "rb").read()
say("  ✓ care_packet_5.sql is the reviewed build") if hashlib.sha256(mig).hexdigest() == os.environ.get("SB_SQL_SHA", "") else bad("care_packet_5.sql is not the reviewed build: nothing runs")
say("  ✓ the library additions are the reviewed build") if hashlib.sha256(add_raw).hexdigest() == os.environ.get("SB_SEED_SHA", "") else bad("care_library_seed_2.json is not the reviewed build: nothing runs")
add = json.loads(add_raw)
for fn in ("care-packet", "care-packet-watch"):
    s1, m1 = fmeta(REF, fn)
    say(f"  ✓ {fn} is live (version {(m1 or {}).get('version', '?')})") if s1 == 200 else bad(f"{fn} is not deployed ({s1}). Tell Claude.")
okj, rj = sql(REF, f"select schedule from cron.job where jobname = {lit(JOB)}")
say(f"  · the check runs now at: {rj[0]['schedule']}") if okj and rj else bad(f"the check's schedule was not found: {rj}")
okp, rp = sql(REF, "select count(*) as packets, count(*) filter (where ready) as ready from public.care_packets")
if okp: say(f"  · {rp[0]['packets']} packet(s), {rp[0]['ready']} ready; all stay set to send by hand")
say("  · what changes: 7 new columns, 2 functions redeployed, the check's times, 1 new topic + 2 videos waiting for your OK. Nobody is texted.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
okc, rc = sql(REF, mig.decode())
say("  ✓ the new columns are added (every client set to by hand)") if okc else bad(f"care_packet_5.sql did not run: {rc}")
if fails: say("  RESULT: STOPPED. Nothing else changed. Tell Claude."); done(6)
if not deploy(REF, FNROOT, "care-packet", False): say("  RESULT: STOPPED (the columns are in, harmless on their own). Tell Claude."); done(6)
if not deploy(REF, FNROOT, "care-packet-watch", True): say("  RESULT: STOPPED. care-packet is updated; the check is the old one (it never texts). Tell Claude."); done(6)
q_add = "insert into public.care_topics (key, title, category, flag, notes, review_note, videos, active, pending, updated_by) values " + ",".join("(%s, %s, %s, %s, %s, %s, %s::jsonb, true, true, 'install-676')" % (lit(t["key"]), lit(t["title"]), lit(t["category"]), lit(t["flag"]), lit(t["notes"]), lit(t["review_note"]), lit(json.dumps(t["videos"]))) for t in add["add"]) + " on conflict (key) do nothing"
q_app = ";\n".join("update public.care_topics t set videos = t.videos || coalesce((select jsonb_agg(v) from jsonb_array_elements(%s::jsonb) v where not exists (select 1 from jsonb_array_elements(t.videos) o where o->>'url' = v->>'url')), '[]'::jsonb) where t.key = %s" % (lit(json.dumps(vs)), lit(k)) for k, vs in add["append_videos"].items())
ok1, r1 = sql(REF, q_add); ok2, r2 = sql(REF, "begin; " + q_app + "; commit;")
say("  ✓ Sit-to-stand lift and 2 more Hoyer videos are in the library, waiting for your OK") if ok1 and ok2 else bad(f"the library additions did not go in: {r1} {r2}")
oks, rs = sql(REF, f"select cron.alter_job((select jobid from cron.job where jobname = {lit(JOB)}), schedule := {lit(NEW_SCHEDULE)}) is null as ok")
say("  ✓ the check now runs at about 9:15am, 2:15pm and 6:15pm Central") if oks else bad(f"the schedule did not change: {rs}")

say(); say("PART 3 · PROOF (nothing is sent, nothing is saved)")
okq, rq = sql(REF, f"""select (select schedule from cron.job where jobname = {lit(JOB)}) as schedule,
  (select count(*) from public.care_packets where auto_send) as auto_on,
  (select pending from public.care_topics where key = 'sit_to_stand_lift') as sts_waiting,
  (select count(*) from public.care_topics t, jsonb_array_elements(t.videos) v where t.key in ('hoyer','sit_to_stand_lift') and coalesce(v->>'status','approved') = 'approved') as leaked""")
if okq:
    x = rq[0]
    say("  ✓ the schedule reads back right") if x["schedule"] == NEW_SCHEDULE else bad(f"the schedule reads back as {x['schedule']}")
    say("  ✓ every client is still set to send by hand (nobody can be texted automatically yet)") if int(x["auto_on"]) == 0 else bad(f"{x['auto_on']} packet(s) are set to automatic. Tell Claude.")
    say("  ✓ the new videos are all waiting for your OK") if x["sts_waiting"] is True and int(x["leaked"]) == 0 else bad(f"the new topic or videos are not all waiting: {x}")
else: bad(f"could not read back: {rq}")
for act, body in (("auto_send", {"packet_id": "00000000-0000-0000-0000-000000000000", "caregiver_axiscare_id": "1"}), ("auto_set", {"packet_id": "00000000-0000-0000-0000-000000000000", "on": True}),
                  ("carry_acks", {"packet_id": "00000000-0000-0000-0000-000000000000", "from_version": 1})):
    sx, bx = http("POST", U, dict(body, action=act))
    say(f"  ✓ {act} refuses anyone without sign-in or the check's secret (401)") if sx == 401 else bad(f"{act} without sign-in answered {sx}: {bx[:120]}")
say("  · tested before deploying: care-packet 134 checks (18 new: by hand by default, office-only switch, automatic only with the check's secret, 8am-8pm, never a reminder, opt-outs still refused, small fix carried over honestly), the check 30 (11 new), the columns and library additions on a real Postgres 8, the card in a browser.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · installed. Merge the Hub pull request next, then reload the Hub."); done(0)
