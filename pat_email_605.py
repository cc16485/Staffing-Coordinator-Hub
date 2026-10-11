#!/usr/bin/env python3
# 605 · PAT PRACTICE'S STEP 1 BY EMAIL TO SAMANTHA (Samantha 2026-10-11: "do step 1 with email, it should text and email step
# one right?"). Pat's offer (Training) gets the email stroutman2011+pat@gmail.com (a Gmail alias: it lands in her normal inbox
# but matches no record) and NO phone (so no text is attempted and no made-up number goes into GoHighLevel). The alias goes on
# the Admin page's test list, so Pat counts as a test person: Pat's onboarding EMAILS reach her even with the switches off.
# AxisCare is never written. Refuses if the alias is on any caregiver, applicant or other open offer. Nothing is sent by
# this step. Then: Resend Step 1 on Pat's offer card (email goes any time).
import os, json
os.environ.setdefault("SB_STEP", "605")
from cc_step_lib import *
HUB = "zngsgedlsxinbygwmxwn"; TRN = "rdqujxiycycwhskyvrwa"; LABEL = "Slice 10 practice run"
ALIAS = "stroutman2011+pat@gmail.com"
def lit(v): return "'" + str(v).replace("'", "''") + "'"
start("PAT PRACTICE'S STEP 1 BY EMAIL")
say("PART 1 · READ ONLY (nothing changes)")
ok_, o = sql(TRN, f"select id, first_name, last_name, phone, email, offer_status from public.job_offers where offered_by = {lit(LABEL)} and offer_withdrawn_at is null and offer_declined_at is null order by created_at desc limit 1")
if ok_ and o and o[0]['first_name'] == 'Pat' and o[0]['last_name'] == 'Practice':
    o = o[0]; say(f"  ✓ Pat Practice's open offer {str(o['id'])[:8]}… ({o['offer_status']}), now at {o['phone']} / {o['email']}")
else: bad(f"no open Pat Practice offer: {o}"); o = None
ok_, t = sql(TRN, f"select count(*)::int as n from public.caregivers where lower(coalesce(email, '')) = {lit(ALIAS)}")
say("  ✓ no Training Platform caregiver has the alias") if ok_ and int(t[0]['n']) == 0 else bad(f"a Training Platform caregiver has the alias ({t}). Tell Claude.")
ok_, h = sql(HUB, f"select count(*)::int as n from public.app_data a, jsonb_array_elements(a.data) x where a.key in ('candidates', 'caregivers') and lower(coalesce(x->>'email', '')) = {lit(ALIAS)}")
say("  ✓ no Hub applicant or caregiver record has the alias") if ok_ and int(h[0]['n']) == 0 else bad(f"a Hub record has the alias ({h}). Tell Claude.")
ok_, ap = sql(HUB, f"select count(*)::int as n from public.job_applicants where lower(coalesce(email, '')) = {lit(ALIAS)}")
say("  ✓ no application has the alias") if ok_ and int(ap[0]['n']) == 0 else bad(f"an application has the alias ({ap}). Tell Claude.")
if o:
    ok_, oo = sql(TRN, f"select count(*)::int as n from public.job_offers where lower(coalesce(email, '')) = {lit(ALIAS)} and id <> {lit(o['id'])} and offer_withdrawn_at is null and offer_declined_at is null")
    say("  ✓ no other open offer has the alias") if ok_ and int(oo[0]['n']) == 0 else bad(f"another open offer has the alias ({oo}). Tell Claude.")
ok_, st = sql(HUB, "select coalesce(data->'test_people', '{}'::jsonb) as tp from public.app_data where key = 'ops_settings'")
if ok_ and st: say(f"  · the test list now: {json.dumps(st[0]['tp'])}")
say("  · what changes: Pat's offer email (to the alias) and phone (cleared; it was the made-up 417-555-0183), and one email on the test list. Nothing is sent by this step.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
ok_, r_ = sql(HUB, f"select public.test_people_add('', {lit(ALIAS)}) as r")
say("  ✓ the alias is on the test list") if ok_ else bad(f"the test list did not change: {r_}")
ok_, _ = sql(TRN, f"update public.job_offers set email = {lit(ALIAS)}, phone = null where id = {lit(o['id'])} and offered_by = {lit(LABEL)} and first_name = 'Pat' and last_name = 'Practice'")
say("  ✓ Pat's offer has the alias and no phone") if ok_ else bad("Pat's offer did not change")
say(); say("PART 3 · PROOF (nothing is sent)")
ok_, o2 = sql(TRN, f"select phone, email from public.job_offers where id = {lit(o['id'])}")
ok2, st2 = sql(HUB, "select coalesce(data->'test_people', '{}'::jsonb) as tp from public.app_data where key = 'ops_settings'")
tp = st2[0]['tp'] if ok2 and st2 else {}
good = ok_ and o2 and not o2[0]['phone'] and o2[0]['email'] == ALIAS and ALIAS in (tp.get('emails') or [])
say("  ✓ Pat is a test person reachable only at the alias (on the list); no phone, so no text is attempted") if good else bad(f"after: {o2} / {tp}")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · Pat's emails now come to your Gmail (as stroutman2011+pat@gmail.com). Next: on Pat's offer card press Resend Step 1. If a Step 1 screen asks for a phone, use 417-555-0183. Nothing was sent by this step."); done(0)
