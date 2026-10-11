#!/usr/bin/env python3
# 595 · SLICE 10, THE PRACTICE RUN: CLOSE-OUT (run it after you have read the 594 report). Hub and Training.
# Pat Practice is made up, so nothing of Pat's should keep counting anywhere:
#   · the offer is withdrawn (its links stop working) with a 'withdrawn' event on the trail;
#   · Pat's Training row is set inactive (its training link stops working; the completions stay);
#   · Pat's readiness card is closed with the reason, and a 'closed' event;
#   · Pat's Needs Attention cards are marked done with a note;
#   · Pat's Background & References and caregiver roster records are taken off the working lists, the same way the Hub
#     itself moves people off a list (the welcome call does it to every new hire), so the nightly audits, the eligibility
#     and obligation passes and the hiring numbers stop counting a made-up person. Every value they held stays in the change
#     history and the evidence value history; no history line, PDF, trail event or log row is deleted.
# Nothing is sent.
import os, json
os.environ.setdefault("SB_STEP", "595")
from cc_step_lib import *
from practice_run_lib import *
start("SLICE 10, THE PRACTICE RUN: CLOSE-OUT")
say("PART 1 · READ ONLY (nothing changes)")
o = offer()
if not o: bad("no practice-run offer found"); done(3)
oid = str(o['id'])
# Pat may be at the practice number or, since 599, at the owner's own test number: the label and the name identify Pat
if str(o.get('first_name')) != FIRST or str(o.get('last_name')) != LAST: bad("the offer under the practice-run label is not Pat Practice; nothing runs"); done(3)
rows = person_rows(oid); j = journey(oid)
for key, lst in rows.items():
    for r in lst:
        if str(r.get('first', '')).lower() != 'pat' or str(r.get('last', '')).lower() != 'practice': bad(f"a {key} record with Pat's offer is not named Pat Practice; nothing runs"); done(3)
say(f"  · offer {o['offer_status']}{' (already withdrawn)' if o.get('offer_withdrawn_at') else ''}; Hub records: {len(rows['candidates'])} in Background & References, {len(rows['caregivers'])} on the roster; readiness card {j['status'] if j else 'none'}")
ok_, ec = sql(HUB, "select (select count(*)::int from public.evidence_history) as ev, (select count(*)::int from public.app_data_item_change) as ch, (select count(*)::int from public.client_journey_event) as je")
before = ec[0] if ok_ else {}
say("  · what changes: Pat's offer withdrawn, Training row inactive, card closed, Pat's cards done, Pat's two records off the working lists (histories kept). Nothing is sent.")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(3)

say(); say("PART 2 · CHANGE (Pat only)")
if not o.get('offer_withdrawn_at'):
    ok_, _ = sql(TRN, f"update public.job_offers set offer_status = 'withdrawn', offer_withdrawn_at = now(), offer_withdrawn_by = {lit(LABEL)}, offer_withdraw_reason = 'practice run finished (made-up hire)' where id = {lit(oid)} and offered_by = {lit(LABEL)}")
    ok2, _ = sql(TRN, f"""insert into public.offer_events (offer_id, kind, by_who, channel, doc_version, detail) values ({lit(oid)}, 'withdrawn', 'office', null, 1, '{{"step": "595", "practice": true, "reason": "practice run finished"}}')""")
    say("  ✓ the offer is withdrawn (its signing and Step 1 links stop working)") if ok_ and ok2 else bad("could not withdraw the offer")
ok_, _ = sql(TRN, f"update public.caregivers set active = false, updated_at = now() where axiscare_id = {lit(AXID)} and name = 'Pat Practice'")
cid_all = [str(r.get('candidate_id') or r.get('id')) for lst in rows.values() for r in lst]
if cid_all:
    ok_w, wl = sql(HUB, f"update public.welcome_calls set status = 'cancelled', closed_reason = 'practice run finished (made-up hire)', updated_at = now() where candidate_id in ({','.join(lit(c) for c in cid_all)}) and status in ('invited', 'booked', 'noshow') returning id")
    # the shared room's time a booked call held goes back on offer, exactly as the Hub's own done / reschedule does
    for w_ in (wl if ok_w else []): sql(HUB, f"delete from public.coordinator_busy where source = 'welcome_call' and source_id = {lit(str(w_['id']))}")
    say(f"  ✓ Pat's open welcome call cancelled ({len(wl) if ok_w else 0}); its time in the shared room is free again") if ok_w else bad("could not cancel Pat's welcome call")
say("  ✓ Pat's Training row is inactive (completions kept)") if ok_ else bad("could not set the Training row inactive")
if j and j['status'] != 'closed':
    ok_, _ = sql(HUB, f"update public.client_journey set status = 'closed', closed_reason = 'Practice run finished (made-up hire)', updated_at = now() where journey_id = {lit(j['journey_id'])} and subject = 'caregiver'")
    ok2, _ = sql(HUB, f"insert into public.client_journey_event (journey_id, actor_email, actor_name, kind, detail, reason) values ({lit(j['journey_id'])}, 'hub', 'The practice run (595)', 'closed', '{{\"practice\": true}}', 'Practice run finished (made-up hire)')")
    say("  ✓ the readiness card is closed, with a 'closed' event") if ok_ and ok2 else bad("could not close the readiness card")
ids = [str(r.get('id')) for lst in rows.values() for r in lst] + ([j['journey_id']] if j else []) + [oid]
cond = " or ".join(f"x::text ilike {lit('%' + i + '%')}" for i in ids if i) + " or x::text ilike '%Pat Practice%'"
ok_, _ = sql(HUB, f"""update public.app_data set data = (select jsonb_agg(case when ({cond}) and coalesce(x->>'status', '') not in ('done', 'closed')
  then x || jsonb_build_object('status', 'done', 'closed_at', now(), 'close_note', 'Practice run finished (made-up hire)') else x end order by i) from jsonb_array_elements(data) with ordinality e(x, i)) where key = 'ops_items'""")
say("  ✓ Pat's Needs Attention cards are marked done") if ok_ else bad("could not close Pat's cards")
for key in ("candidates", "caregivers"):
    if not rows[key]: continue
    ok_, _ = sql(HUB, f"""update public.app_data set data = (select coalesce(jsonb_agg(x order by i), '[]'::jsonb) from jsonb_array_elements(data) with ordinality e(x, i)
      where not (x->>'offer_id' = {lit(oid)} and lower(x->>'first') = 'pat' and lower(x->>'last') = 'practice')) where key = {lit(key)}""")
    say(f"  ✓ Pat's {'Background & References' if key == 'candidates' else 'roster'} record is off the working list") if ok_ else bad(f"could not take Pat's {key} record off the list")

say(); say("PART 3 · PROOF")
o2 = offer(); rows2 = person_rows(oid); j2 = journey(oid)
say("  ✓ offer withdrawn") if o2 and o2.get('offer_withdrawn_at') else bad("offer still open")
say("  ✓ no working-list record names Pat's offer") if not rows2['candidates'] and not rows2['caregivers'] else bad(f"still listed: {rows2}")
say("  ✓ readiness card closed") if not j2 or j2['status'] == 'closed' else bad(f"card: {j2['status']}")
ok_, ec2 = sql(HUB, "select (select count(*)::int from public.evidence_history) as ev, (select count(*)::int from public.app_data_item_change) as ch, (select count(*)::int from public.client_journey_event) as je")
if ok_ and before:
    grew = all(int(ec2[0][k]) >= int(before[k]) for k in before)
    say(f"  ✓ every history only grew: value history {before['ev']} to {ec2[0]['ev']}, change history {before['ch']} to {ec2[0]['ch']}, journey events {before['je']} to {ec2[0]['je']}") if grew else bad(f"a history shrank: {before} {ec2[0]}")
ok_, kept = sql(HUB, f"select count(*)::int as n from public.evidence_history where record_id in ({','.join(lit(str(r.get('id'))) for lst in rows.values() for r in lst) or lit('-')}) and change = 'removed'")
if ok_: say(f"  ✓ the value history kept what Pat's records held when they came off the lists ({kept[0]['n']} 'removed' line(s))")
say("  · Pat's PDFs, the offer trail, Step 1, the journey history and every log row stay where they are")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the practice run is closed. Nothing was sent; no history was deleted."); done(0)
