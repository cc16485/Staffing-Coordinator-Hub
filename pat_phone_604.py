#!/usr/bin/env python3
# 604 · PAT PRACTICE USES 417-593-2805 (Samantha 2026-10-11: "please make the pat practice's number 417-593-2805 so we can
# complete step 1"). Pat's offer (Training) gets that phone; the phone and Pat's practice email go on the Admin page's test list,
# so Pat counts as a test person: Pat's onboarding TEXTS reach 417-593-2805 even with the switches off. Pat's emails still go
# nowhere (a practice email is always refused). AxisCare is never written. Refuses if 417-593-2805 is on any caregiver,
# applicant or other open offer (it could be joined to that person). Nothing is sent by this step. Then: Resend Step 1 on
# Pat's offer card (8am to 6pm Central) to get the Step 1 link by text.
import os, json
os.environ.setdefault("SB_STEP", "604")
from cc_step_lib import *
HUB = "zngsgedlsxinbygwmxwn"; TRN = "rdqujxiycycwhskyvrwa"; LABEL = "Slice 10 practice run"
NEW_PHONE = "4175932805"; PAT_EMAIL = "pat.practice@practice.invalid"
def lit(v): return "'" + str(v).replace("'", "''") + "'"
d10 = lambda col: f"right(regexp_replace(coalesce({col}, ''), '\\D', '', 'g'), 10)"
XPH = d10("x->>'phone'")
start("PAT PRACTICE USES 417-593-2805")
say("PART 1 · READ ONLY (nothing changes)")
ok_, o = sql(TRN, f"select id, first_name, last_name, phone, email, offer_status, offer_signed_at, pd_signed_at from public.job_offers where offered_by = {lit(LABEL)} and offer_withdrawn_at is null and offer_declined_at is null order by created_at desc limit 1")
if ok_ and o and o[0]['first_name'] == 'Pat' and o[0]['last_name'] == 'Practice':
    o = o[0]; say(f"  ✓ Pat Practice's open offer {str(o['id'])[:8]}… ({o['offer_status']}), now at {o['phone']} / {o['email']}")
    if str(o['email']).lower() != PAT_EMAIL: bad(f"Pat's email is {o['email']}, not the practice address; tell Claude")
else: bad(f"no open Pat Practice offer: {o}"); o = None
ok_, t = sql(TRN, f"select count(*)::int as n from public.caregivers where {d10('mobile_phone')} = {lit(NEW_PHONE)}")
say("  ✓ no Training Platform caregiver has 417-593-2805") if ok_ and int(t[0]['n']) == 0 else bad(f"a Training Platform caregiver has 417-593-2805 ({t}); Pat could be joined to them. Tell Claude.")
ok_, h = sql(HUB, f"select a.key, x->>'first' as first, x->>'last' as last from public.app_data a, jsonb_array_elements(a.data) x where a.key in ('candidates', 'caregivers') and {XPH} = {lit(NEW_PHONE)}")
say("  ✓ no Hub applicant or caregiver record has 417-593-2805") if ok_ and not h else (bad(f"could not read the Hub records: {h}") if not ok_ else None) if not ok_ else bad(f"a Hub record has 417-593-2805: {', '.join((r['first'] or '') + ' ' + (r['last'] or '') + ' (' + r['key'] + ')' for r in (h if isinstance(h, list) else []))}. Tell Claude.")
ok_, ap = sql(HUB, f"select first_name, last_name from public.job_applicants where {d10('phone')} = {lit(NEW_PHONE)}")
say("  ✓ no application has 417-593-2805") if ok_ and not ap else bad(f"an application has 417-593-2805: {', '.join(r['first_name'] + ' ' + r['last_name'] for r in (ap if isinstance(ap, list) else []))}. Tell Claude.")
if o:
    ok_, oo = sql(TRN, f"select count(*)::int as n from public.job_offers where {d10('phone')} = {lit(NEW_PHONE)} and id <> {lit(o['id'])} and offer_withdrawn_at is null and offer_declined_at is null")
    say("  ✓ no other open offer has 417-593-2805") if ok_ and int(oo[0]['n']) == 0 else bad(f"another open offer has 417-593-2805 ({oo}). Tell Claude.")
ok_, wt = sql(HUB, "select coalesce(jsonb_agg(x), '[]'::jsonb) as w from public.app_data, jsonb_array_elements(data) x where key = 'training_walkthroughs' and x->>'status' = 'open'")
if ok_ and any(NEW_PHONE in json.dumps(w) for w in (wt[0]['w'] if wt else [])): bad("417-593-2805 is in an open staff training walkthrough; end it first")
ok_, st = sql(HUB, "select coalesce(data->'test_people', '{}'::jsonb) as tp from public.app_data where key = 'ops_settings'")
if ok_ and st: say(f"  · the test list now: {json.dumps(st[0]['tp'])}")
say("  · what changes: Pat's offer phone, and two entries on the test list. Nothing is sent by this step.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
ok_, r_ = sql(HUB, f"select public.test_people_add({lit(NEW_PHONE)}, {lit(PAT_EMAIL)}) as r")
say(f"  ✓ 417-593-2805 and Pat's practice email are on the test list ({r_[0]['r'] if ok_ else ''})") if ok_ else bad(f"the test list did not change: {r_}")
ok_, _ = sql(TRN, f"update public.job_offers set phone = {lit(NEW_PHONE)} where id = {lit(o['id'])} and offered_by = {lit(LABEL)} and first_name = 'Pat' and last_name = 'Practice'")
say("  ✓ Pat's offer has 417-593-2805") if ok_ else bad("Pat's offer did not change")
# (no offer event: the event list has no 'contact changed' kind; this report is the record of the change)
say(); say("PART 3 · PROOF (nothing is sent)")
ok_, o2 = sql(TRN, f"select phone, email from public.job_offers where id = {lit(o['id'])}")
ok2, st2 = sql(HUB, "select coalesce(data->'test_people', '{}'::jsonb) as tp from public.app_data where key = 'ops_settings'")
tp = st2[0]['tp'] if ok2 and st2 else {}
good = ok_ and o2 and o2[0]['phone'] == NEW_PHONE and NEW_PHONE in (tp.get('phones') or []) and PAT_EMAIL in (tp.get('emails') or [])
say("  ✓ Pat is a test person: phone 417-593-2805 (on the list) and the practice email (on the list, and always refused)") if good else bad(f"after: {o2} / {tp}")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · Pat's texts now go to 417-593-2805 (8am to 6pm Central); emails go nowhere. Next: on Pat's offer card press Resend Step 1, then do Step 1 from the text. Nothing was sent by this step."); done(0)
