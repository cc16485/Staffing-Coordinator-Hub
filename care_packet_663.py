#!/usr/bin/env python3
# 663 · CAREGIVER PACKETS: THE LIBRARY EDITOR AND SUGGESTED TOPICS (Samantha "build the library editor and suggestions",
# 2026-10-12). Redeploys care-packet with: 'library' (owner only, every topic), topic_save refusing a name already taken
# and allowing retire, retired topics kept in packets that already have them, and 'suggest' (the AI reads the client's
# newest care plan, intake answers and About notes, never medications, and suggests library topics with one line of why;
# it saves nothing). No table changes, no switches, nothing texted.
# Undo: redeploy care-packet from 662's build.
import os, json
os.environ.setdefault("SB_STEP", "663")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
start("CAREGIVER PACKETS: LIBRARY EDITOR AND SUGGESTED TOPICS")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
s1, m1 = fmeta(REF, "care-packet")
say(f"  ✓ care-packet is live (version {(m1 or {}).get('version', '?')})") if s1 == 200 else bad(f"care-packet is not deployed ({s1}). Tell Claude.")
s, b = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
names = [x.get("name") for x in (json.loads(b) if s == 200 else [])]
say("  ✓ the AI key is set (ANTHROPIC_API_KEY)") if "ANTHROPIC_API_KEY" in names else bad("ANTHROPIC_API_KEY is not set, so Suggest topics could not work. Tell Claude.")
ok, r = sql(REF, "select (select count(*) from public.care_topics) as topics, (select count(*) from public.care_topics where active) as active, (select count(*) from public.care_packets) as packets")
if ok: say(f"  · the library has {r[0]['topics']} topic(s) ({r[0]['active']} offered), {r[0]['packets']} packet(s); this step changes none of them")
else: bad(f"could not read the library: {r}")
say("  · what changes: care-packet only (the library editor and Suggest topics on the card). No tables, no switches, no texts.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, "care-packet", False): say("  RESULT: STOPPED. Tell Claude."); done(6)

say(); say("PART 3 · PROOF (nothing is sent, nothing is saved)")
U = f"https://{REF}.supabase.co/functions/v1/care-packet"
for act, body in (("library", {}), ("suggest", {"ax": "1", "about": "x"}), ("topic_save", {"key": "proof_only", "title": "x"})):
    sx, bx = http("POST", U, dict(body, action=act))
    say(f"  ✓ {act} refuses anyone not signed in (401)") if sx == 401 else bad(f"{act} without sign-in answered {sx}: {bx[:120]}")
ok2, r2 = sql(REF, "select (select count(*) from public.care_topics) as topics, (select count(*) from public.care_topics where key = 'proof_only') as proof")
say("  ✓ the library is unchanged") if ok2 and ok and r2[0]["topics"] == r[0]["topics"] and int(r2[0]["proof"]) == 0 else bad(f"the library changed: {r2}")
say("  · tested before deploying: care-packet against a fake database, GoHighLevel, AxisCare and AI (87 checks, 19 new: owner-only library, a taken name refused, retire keeps the topic in packets that have it, suggestions only from the library, newest care plan for this client only, medications never sent, nothing saved, AI down or nothing to read said plainly) and the card in a browser (45).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the library editor and Suggest topics are installed on the server. Merge the Hub pull request next."); done(0)
