#!/usr/bin/env python3
# 593 · SLICE 10, THE PRACTICE RUN: TRAINING (station 8; Samantha's decision 2a). Training and Hub.
# Pat cannot take the courses for real, so this records them as test completions the way a finished course does:
#   1. a Training caregiver row for Pat (made-up AxisCare number 990000183, In Training), which assigns the courses as for
#      any new hire; orientation and the Dementia course marked complete with their completion rows (hours from the course);
#   2. Pat's offer is matched to that row, and Pat's Hub roster record is given the same made-up AxisCare number;
#   3. the REAL completion notice: notify-cleared with Pat's own training link, exactly as when a caregiver finishes a course.
#      On the new path it reports to the Hub's readiness card and sends nothing.
# Refuses unless Pat signed both documents, finished Step 1 and is on the caregiver roster (welcome call done).
import os, json
os.environ.setdefault("SB_STEP", "593")
from cc_step_lib import *
from practice_run_lib import *
KNOWN_TRN_TRIGGERS = {"trg_assign_onboarding"}
start("SLICE 10, THE PRACTICE RUN: TRAINING (test completions for Pat)")
say("PART 1 · READ ONLY (nothing changes)")
o = offer()
if not o: bad("no practice-run offer found: run 591 first"); done(3)
oid = str(o['id'])
if o.get('offer_withdrawn_at'): bad("Pat's offer is withdrawn (the run was closed)")
say("  ✓ Pat signed both documents and finished Step 1") if o.get('offer_signed_at') and o.get('pd_signed_at') and o.get('step1_done_at') else bad("Pat has not signed both documents and finished Step 1 yet (stations 1 to 3)")
rows = person_rows(oid)
if not rows['caregivers']: bad("Pat is not on the caregiver roster yet: finish station 7 (Welcome call done) first")
rec = (rows['caregivers'] or [{}])[0]
if rec and str(rec.get('axiscare_id') or '') not in ('', AXID): bad(f"Pat's roster record already carries AxisCare number {rec.get('axiscare_id')}; tell Claude")
j = journey(oid)
say(f"  ✓ Pat's readiness card is {j['status']}") if j and j['status'] in ('open', 'active') else bad(f"Pat's readiness card is not open: {j and j['status']}")
ok_, tg = sql(TRN, "select tgname from pg_trigger where tgrelid = 'public.caregivers'::regclass and not tgisinternal")
other = [t['tgname'] for t in tg if t['tgname'] not in KNOWN_TRN_TRIGGERS] if ok_ else ['(unreadable)']
say("  ✓ the only trigger on Training caregivers assigns the courses") if ok_ and not other else bad(f"Training caregivers has other triggers ({', '.join(other)}); tell Claude before adding Pat")
ok_, hk = sql(TRN, "select count(*)::int as n from information_schema.triggers where event_object_table = 'caregivers' and action_statement ilike '%http%'")
if ok_ and int(hk[0]['n']): bad("a web hook fires on Training caregivers; tell Claude")
ok_, cg = sql(TRN, f"select id, cleared_reported_at from public.caregivers where axiscare_id = {lit(AXID)}")
existing = cg[0] if ok_ and cg else None
if existing: say("  · Pat's Training row already exists (a re-run): it is reused")
ok_, cs = sql(TRN, "select id, slug, title, hours from public.courses where slug in ('agency-orientation', 'dementia-care')")
if not ok_ or len(cs) != 2: bad(f"could not read the two pre-service courses: {cs}")
say("  · what changes: one Training row for Pat (made up), two test completions, the offer matched to it, Pat's roster record given the made-up AxisCare number; then the real completion notice. Nothing is sent.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE (Pat only)")
if existing: cgid = existing['id']
else:
    ok_, r_ = sql(TRN, f"""insert into public.caregivers (emp_id, axiscare_id, name, hire_date, active, mobile_phone, email, status_label)
      values ('PRACTICE-0183', {lit(AXID)}, 'Pat Practice', current_date, true, {lit(PHONE)}, {lit(EMAIL)}, 'In Training') returning id""")
    if not ok_ or not r_: bad(f"could not add Pat's Training row: {r_}"); done(7)
    cgid = r_[0]['id']
say(f"  ✓ Pat's Training row ({str(cgid)[:8]}…, In Training, AxisCare 990000183): the courses were assigned as for any new hire")
for c in cs:
    sql(TRN, f"update public.enrollments set status = 'complete', progress = 1, completed_at = coalesce(completed_at, now()) where caregiver_id = {lit(cgid)} and course_id = {lit(c['id'])}")
    sql(TRN, f"insert into public.completions (caregiver_id, course_id, hours, learner_name) select {lit(cgid)}, {lit(c['id'])}, {float(c['hours'] or 0)}, 'Pat Practice (TEST)' "
             f"where not exists (select 1 from public.completions where caregiver_id = {lit(cgid)} and course_id = {lit(c['id'])})")
    say(f"  ✓ {c['title']}: complete ({c['hours']} hours, test completion)")
ok_, _ = sql(TRN, f"update public.job_offers set matched_caregiver_id = {lit(cgid)} where id = {lit(oid)} and offered_by = {lit(LABEL)}")
say("  ✓ Pat's offer is matched to the Training row") if ok_ else bad("could not match the offer")
ok_, _ = sql(HUB, f"""update public.app_data set data = (select jsonb_agg(case when x->>'offer_id' = {lit(oid)} and coalesce(x->>'axiscare_id', '') = '' then x || jsonb_build_object('axiscare_id', {lit(AXID)}) else x end order by i)
  from jsonb_array_elements(data) with ordinality e(x, i)) where key = 'caregivers'""")
rec2 = (person_rows(oid)['caregivers'] or [{}])[0]
say("  ✓ Pat's roster record carries the made-up AxisCare number") if str(rec2.get('axiscare_id')) == AXID else bad(f"Pat's roster record: {rec2.get('axiscare_id')}")
ok_, tk = sql(TRN, f"select access_token from public.caregivers where id = {lit(cgid)}")
tok = tk[0]['access_token'] if ok_ and tk else ''
HIDE.append(tok)
TSVC = trn_service()
s_, b_ = http("POST", f"{TRB}/functions/v1/notify-cleared", {"token": tok}, {"apikey": TSVC, "Authorization": "Bearer " + TSVC}, timeout=180)
say(f"  · the completion notice answered {s_}: {str(b_)[:300]}")

say(); say("PART 3 · PROOF (nothing is sent)")
ok_, cr = sql(TRN, f"select cleared_reported_at, cleared_notified_at, cleared_hold_note from public.caregivers where id = {lit(cgid)}")
if ok_ and cr and cr[0]['cleared_reported_at']: say(f"  ✓ Training stamped the report to the Hub ({cr[0]['cleared_reported_at']}); no cleared text from Training: {('none' if not cr[0]['cleared_notified_at'] else 'SENT?')}")
else: bad(f"Training did not record the report to the Hub: {cr}")
j = journey(oid)
ok_, s = sql(HUB, f"select step_key, state, completed_by from public.client_journey_step where journey_id = {lit(j['journey_id'])} and step_key in ('cg.training.orientation', 'cg.training.dementia')")
done_ = {x['step_key']: x['state'] for x in s} if ok_ else {}
say("  ✓ the readiness card shows orientation and the Dementia course complete") if done_.get('cg.training.orientation') == 'complete' and done_.get('cg.training.dementia') == 'complete' else bad(f"readiness rows: {done_}")
ok_, ev = sql(HUB, f"select kind, at from public.client_journey_event where journey_id = {lit(j['journey_id'])} and at > now() - interval '15 minutes' order by at")
if ok_: say("  · journey events just now: " + ", ".join(e['kind'] for e in ev))
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · Pat's training reached the readiness card through the real completion notice. Nothing was sent. Next: station 9."); done(0)
