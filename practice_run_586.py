#!/usr/bin/env python3
# 586 · SLICE 10, THE PRACTICE RUN: PAT'S LINKS AND WHERE PAT STANDS (read only; run it as often as you like).
# The Hub records the Step 2 message and the welcome call invitation in practice without sending them, so the links a real
# hire would get by text are printed here for your phone. Nothing changes; nothing is sent.
import os, re
os.environ.setdefault("SB_STEP", "586")
from cc_step_lib import *
from practice_run_lib import *
start("SLICE 10, THE PRACTICE RUN: PAT'S LINKS (read only)")
o = offer()
if not o: bad("no practice-run offer found: run 585 first"); done(3)
oid = str(o['id'])
say(f"THE OFFER  {o['first_name']} {o['last_name']} · {o['offer_status']}" + (" · WITHDRAWN" if o.get('offer_withdrawn_at') else ""))
say(f"  offer letter signed: {o.get('offer_signed_at') or 'not yet'} · position description signed: {o.get('pd_signed_at') or 'not yet'} · Step 1 done: {o.get('step1_done_at') or 'not yet'}")
say("  the signing link and the Step 1 link: on Pat's offer card in the Hub (Signing link / Step 1 link)")
rows = person_rows(oid); rec = (rows['caregivers'] or rows['candidates'] or [None])[0]
where = 'caregiver roster' if rows['caregivers'] else 'Background & References' if rows['candidates'] else 'not moved into Background & References yet (station 2)'
say(f"PAT'S HUB RECORD  {where}")
if rec:
    for k in ("oig", "edl", "fcsr", "r1s", "r2s", "r3s", "r4s", "step2_sent_at", "step2_done_at", "step2_verified_at", "orient_date", "alz_date", "axiscare_id", "approved_to_work_at"):
        if rec.get(k): say(f"  {k}: {rec.get(k)}")
    m = rec.get('step2_msg') or {}
    link = re.search(r"https://cc\.mo-care\.com/step2\.html\?\S+", str(m.get('text') or ''))
    say("STEP 2 DONE LINK (open on your phone)  " + (link.group(0).rstrip('.') if link else "not yet: press 'Step 2 sent' first (station 6)"))
    ok_, w = sql(HUB, f"select id, status, starts_at, done_at from public.welcome_calls where candidate_id = {lit(str(rec.get('candidate_id') or rec.get('id')))} order by invited_at desc limit 1")
    if ok_ and w:
        say(f"WELCOME CALL  {w[0]['status']}" + (f" · {w[0]['starts_at']}" if w[0]['starts_at'] else ""))
        say("  booking link (open on your phone): https://cc.mo-care.com/welcome.html?w=" + str(w[0]['id']))
    else: say("WELCOME CALL  not invited yet (station 7)")
j = journey(oid)
if j:
    ok_, s = sql(HUB, f"select step_key, state from public.client_journey_step where journey_id = {lit(j['journey_id'])} order by step_key")
    done_n = sum(1 for x in s if x['state'] in ('complete', 'not_needed')) if ok_ else 0
    say(f"READINESS CARD  {j['status']} · {done_n} of {len(s) if ok_ else '?'} rows complete or not needed")
    if ok_: say("  still open: " + ", ".join(x['step_key'] for x in s if x['state'] not in ('complete', 'not_needed'))[:900])
else: say("READINESS CARD  starts when both documents are signed")
say(); say("RESULT: DONE · read only. Nothing changed; nothing was sent."); done(0)
