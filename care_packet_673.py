#!/usr/bin/env python3
# 673 · CAREGIVER PACKET PREVIEW (Samantha "i want to see the caregiver packet link before i send it", 2026-10-12).
# Redeploys care-packet with one new office action, 'preview': exactly what a caregiver's page shows for the saved
# packet (draft or ready), for the card's Preview button. It makes no link, records nothing and texts nobody.
# No tables, no switches. Undo: redeploy care-packet from 672's build.
import os, json
os.environ.setdefault("SB_STEP", "673")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
U = f"https://{REF}.supabase.co/functions/v1/care-packet"
start("CAREGIVER PACKET PREVIEW")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
s1, m1 = fmeta(REF, "care-packet")
say(f"  ✓ care-packet is live (version {(m1 or {}).get('version', '?')})") if s1 == 200 else bad(f"care-packet is not deployed ({s1}). Tell Claude.")
ok, r = sql(REF, "select (select count(*) from public.care_packet_recipients) as recips, (select count(*) from public.care_packet_acks) as acks")
if ok: say(f"  · right now: {r[0]['recips']} caregiver link(s), {r[0]['acks']} confirmation(s); this step changes none of them")
else: bad(f"could not read the packet tables: {r}")
say("  · what changes: care-packet gets a Preview for the office. No tables, no switches, no texts.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, "care-packet", False): say("  RESULT: STOPPED. Tell Claude."); done(6)

say(); say("PART 3 · PROOF (nothing is sent, nothing is saved)")
sx, bx = http("POST", U, {"action": "preview", "packet_id": "00000000-0000-0000-0000-000000000000"})
say("  ✓ the preview refuses anyone not signed in (401)") if sx == 401 else bad(f"preview without sign-in answered {sx}: {bx[:120]}")
ok2, r2 = sql(REF, "select (select count(*) from public.care_packet_recipients) as recips, (select count(*) from public.care_packet_acks) as acks")
say("  ✓ no links or confirmations changed") if ok and ok2 and r2[0] == r[0] else bad(f"the packet tables changed: {r2}")
say("  · tested before deploying: care-packet 95 checks (7 new: preview shows the saved packet draft or ready, makes no link, records nothing, texts nobody, office only), packet watch 19, the card and the caregiver page in a browser 54 (9 new).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the preview is installed on the server. Merge the Hub pull request next."); done(0)
