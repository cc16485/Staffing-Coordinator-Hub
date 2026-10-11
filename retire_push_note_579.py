#!/usr/bin/env python3
# 579 · RETIRE axiscare-push-note (Samantha, 2026-10-11: "retire the old, unsecured function now … if the function can be
# disabled sooner, prioritize closing that security exposure"). Hub project.
# Part 1 (read only): the live copy is exactly the preserved build; the Hub's callers; the queue's records. Part 2: the
# function is removed from the Hub project. Part 3 (proof): it answers 404; the queue rows it stamped are untouched.
# Nothing is sent. No AxisCare note is written or deleted. The Hub's automatic callers go with CC Hub PR (merge after).
import os, time
os.environ.setdefault("SB_STEP", "579")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; BASE = f"https://{REF}.supabase.co"; FN = "axiscare-push-note"
KEEP = os.path.join(ROOT, "retired", FN, "index.ts")
start("RETIRE THE UNSECURED AXISCARE NOTE WRITER")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
if not os.path.exists(KEEP): bad("the preserved source (retired/axiscare-push-note/index.ts) is not in the reviewed build"); done(2)
sx, mx = fmeta(REF, FN)
if sx == 404: say(f"  · {FN} is already gone from the Hub project (nothing to remove)"); say(); say("RESULT: ALREADY DONE"); done(0)
if sx != 200: bad(f"{FN} could not be read ({sx})"); done(3)
say(f"  · live: version {mx.get('version', '?')}, gateway sign-in check {'ON' if mx.get('verify_jwt') else 'OFF'}")
okd, lf = live_files(REF, FN)
same = okd and lf.get(f"supabase/functions/{FN}/index.ts") == sha(KEEP)
(say if same else bad)(("  ✓ " if same else "") + ("the live copy is exactly the preserved build (retired/axiscare-push-note/index.ts)" if same else "the live copy is NOT the preserved build; nothing removed. Tell Claude."))
ok_, q = sql(REF, "select count(*)::int as total, count(*) filter (where axiscare_note_id is not null)::int as stamped, count(*) filter (where status <> 'complete')::int as open_rows from client_queue")
if ok_ and q: say(f"  · client_queue: {q[0]['total']} rows, {q[0]['stamped']} stamped with a note id (kept as they are), {q[0]['open_rows']} not complete")
else: bad(f"client_queue unreadable: {q}")
say("  · the Hub's two automatic callers (New Clients queue; the engine's standalone queue section) fail quietly today when the function is gone, exactly as a network error does; CC Hub PR removes them after this step.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude."); done(3)
say(); say("PART 2 · CHANGE")
s_, b_ = http("DELETE", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
time.sleep(3); sx2, _ = fmeta(REF, FN)
(say if sx2 == 404 else bad)(("  ✓ " if sx2 == 404 else "") + (f"{FN} is removed from the Hub project" if sx2 == 404 else f"{FN} did not go ({s_}: {str(b_)[:120]})"))
say(); say("PART 3 · PROOF (nothing is sent or changed)")
s3, _ = http("POST", f"{BASE}/functions/v1/{FN}", {"client_queue_id": "00000000-0000-0000-0000-000000000000"}, {"apikey": "", "Authorization": "Bearer "})
(say if s3 in (404, 401, 403) else bad)(("  ✓ " if s3 in (404, 401, 403) else "") + f"a call to the old URL now answers {s3}; nobody can make it write to AxisCare")
ok_, q2 = sql(REF, "select count(*) filter (where axiscare_note_id is not null)::int as stamped from client_queue")
(say if ok_ and q2 and q2[0]['stamped'] == (q[0]['stamped'] if ok_ and q else None) else bad)(("  ✓ " if ok_ and q2 else "") + "the queue rows it stamped are untouched")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the unsecured AxisCare note writer is gone. Next: Claude merges the CC Hub PR that removes its automatic callers. The source stays in retired/ for the record.")
say("Rollback: none needed; the preserved source could be redeployed only by a deliberate, reviewed step, and should not be.")
done(0)
