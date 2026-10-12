#!/usr/bin/env python3
# 675 · CARE LIBRARY: "BED-BOUND AND HOSPICE CARE" GROUP (Samantha 2026-10-12: "the bed bound/Hospice support care should be in
# there", "the ones you made for Dan"). care_packet_4.sql adds the group and moves Dan's six topics into it (only a topic still
# in its starting group); care-packet redeployed so the group can be picked. No approvals, notes or videos change. No switches,
# nothing texted. Undo: care_packet_4_rollback.sql + redeploy care-packet from 674's build.
import os, json, hashlib
os.environ.setdefault("SB_STEP", "675")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
ROOT = os.path.abspath(os.path.join(FNROOT, "..", ".."))
DAN = ["hospice_basics", "turning", "skin", "commode", "brief_in_bed", "purewick_male"]
Q = "select key, category, pending, active, approved_by, notes, videos::text as videos from public.care_topics"
start("CARE LIBRARY: BED-BOUND AND HOSPICE CARE GROUP")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
mig = open(os.path.join(ROOT, "care_packet_4.sql"), "rb").read()
say("  ✓ care_packet_4.sql is the reviewed build") if hashlib.sha256(mig).hexdigest() == os.environ.get("SB_SQL_SHA", "") else bad("care_packet_4.sql is not the reviewed build: nothing runs")
s1, m1 = fmeta(REF, "care-packet")
say(f"  ✓ care-packet is live (version {(m1 or {}).get('version', '?')})") if s1 == 200 else bad(f"care-packet is not deployed ({s1}). Tell Claude.")
ok0, r0 = sql(REF, Q)
if not ok0: bad(f"could not read the library (has 674 run?): {r0}")
before = {x["key"]: x for x in (r0 if ok0 else [])}
missing = [k for k in DAN if k not in before]
if missing: bad(f"Dan's topics not found: {missing}")
say(f"  · {len(before)} topics in the library; moving: " + ", ".join(f"{k} ({before[k]['category']})" for k in DAN if k in before))
say("  · what changes: one new group, Dan's six topics moved into it, care-packet redeployed. No approvals, notes, videos or texts.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, "care-packet", False): say("  RESULT: STOPPED. Nothing else changed. Tell Claude."); done(6)
okc, rc = sql(REF, mig.decode())
say("  ✓ the group is added and Dan's topics are in it") if okc else bad(f"care_packet_4.sql did not run: {rc}")

say(); say("PART 3 · PROOF (nothing is sent, nothing is saved)")
ok2, r2 = sql(REF, Q)
if ok2:
    after = {x["key"]: x for x in r2}
    bb = sorted(k for k, x in after.items() if x["category"] == "bedbound")
    say(f"  ✓ Bed-bound and hospice care: {len(bb)} topic(s): {', '.join(bb)}") if set(bb) <= set(DAN) and bb else bad(f"the group reads back wrong: {bb}")
    same = all({k: v for k, v in after[k].items() if k != "category"} == {k: v for k, v in before[k].items() if k != "category"} for k in before if k in after)
    say("  ✓ nothing else changed (approvals, notes, videos)") if same and len(after) == len(before) else bad("something besides the group changed. Tell Claude.")
else: bad(f"could not read the library back: {r2}")
sx, bx = http("POST", f"https://{REF}.supabase.co/functions/v1/care-packet", {"action": "library"})
say("  ✓ the library still refuses anyone not signed in (401)") if sx == 401 else bad(f"library without sign-in answered {sx}: {bx[:120]}")
say("  · tested before deploying: the group change on a real Postgres 8 checks, care-packet 116, packet watch 19, the tab and card in a browser.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the group is installed. Merge the Hub pull request next."); done(0)
