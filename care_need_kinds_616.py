#!/usr/bin/env python3
# 616 · CARE NEEDS FOR MATCHING: THE 25 KINDS OF FACT (Samantha "go", 2026-10-12, Track 3c). Adds catalog rows only
# (care-need-kinds.sql): one kind per skill on the approved list, the lift type, the advanced tasks we do not provide,
# pets and smoking, caregiver gender and Spanish, on every layer. No fact, lead, Journey or client record changes; nothing
# reads them for matching; the Hub's checklist stays hidden until the Admin switch "Care needs for matching" is on.
# Proof: the door saves a care-plan need inside a transaction that is always undone. Undo: care-need-kinds-rollback.sql
# (inactive, nothing deleted).
import os, json, hashlib
os.environ.setdefault("SB_STEP", "616")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
start("CARE NEEDS FOR MATCHING: THE KINDS OF FACT")
say("PART 1 · READ ONLY (nothing changes)")
mig = open(os.path.join(ROOT, "care-need-kinds.sql"), "rb").read(); h = hashlib.sha256(mig).hexdigest()
say("  ✓ care-need-kinds.sql is the reviewed build") if h == os.environ.get("SB_SQL_SHA", "") else bad("care-need-kinds.sql is not the reviewed build: nothing runs")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(2)
ok1, r1 = sql(REF, "select to_regclass('public.fact_kind') is not null as catalog, to_regprocedure('public.client_fact_record(uuid,text,text,jsonb,text,text,uuid,text,text,text,text,timestamptz,text,text,text)') is not null as door, (select count(*) from public.fact_kind) as kinds, (select count(*) from public.fact_kind where created_by = 'match_needs' or kind like 'need\\_%' escape '\\' or kind in ('home_cats','home_dogs','home_smoking','pref_caregiver_gender')) as ours, (select count(*) from public.client_fact) as facts, (select count(*) from public.journey_episode) as journeys")
if not ok1: bad(f"could not read the fact record: {r1}")
else:
    x = r1[0]
    if not (x["catalog"] and x["door"]): bad("the fact record or its door is missing. Tell Claude.")
    elif int(x["ours"]): bad(f"{x['ours']} of these kinds already exist (installed before?). Tell Claude.")
    else: say(f"  ✓ the fact record and its door are there: {x['kinds']} kinds, {x['facts']} facts, {x['journeys']} Journeys; none of the 25 yet")
say("  · what changes: 25 new kinds of fact in the catalog. No fact is written; no screen changes (the checklist waits for its Admin switch).")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
okc, rc = sql(REF, mig.decode())
if not okc: bad(f"the kinds were not added (nothing changed: it is all or nothing): {rc}"); say("  RESULT: STOPPED. Tell Claude."); done(5)
say("  ✓ the 25 kinds are in the catalog")
say(); say("PART 3 · PROOF (nothing is sent; the door test is always undone)")
ok2, r2 = sql(REF, "select (select count(*) from public.fact_kind where created_by = 'match_needs' and active and layers = '{intake,assessment,plan,current}') as ours, (select count(*) from public.fact_kind) as kinds, (select count(*) from public.client_fact) as facts")
if ok2 and int(r2[0]["ours"]) == 25 and int(r2[0]["kinds"]) == int(x["kinds"]) + 25: say(f"  ✓ 25 kinds, active, on all four layers ({r2[0]['kinds']} kinds in all)")
else: bad(f"the catalog does not read back as expected: {r2}")
say(f"  ✓ no fact was written ({r2[0]['facts']} facts, as before)") if ok2 and int(r2[0]["facts"]) == int(x["facts"]) else bad("the fact count changed")
if int(x["journeys"]):
    okp, rp = sql(REF, """do $p$ declare ep uuid; r jsonb; begin
      select episode_id into ep from public.journey_episode where state <> 'voided' limit 1;
      r := public.client_fact_record(ep, 'need_bathing', 'plan', '"required"'::jsonb, 'confirmed', 'first', null, null, null, null, 'staff_observation', null, null, null, 'install-proof (undone)');
      raise exception 'PROOF:%', r::text; end $p$""")
    txt = str(rp)
    say("  ✓ the door saves a care-plan need (\"bathing: required\") and the test was undone") if (not okp and 'PROOF:' in txt and 'recorded' in txt) else bad(f"the door test did not answer as expected: {txt[:200]}")
    ok3, r3 = sql(REF, "select count(*) as facts from public.client_fact")
    say("  ✓ after the test: still no fact written") if ok3 and int(r3[0]["facts"]) == int(x["facts"]) else bad("a fact was left behind")
say("  · tested before deploying: the real fact record in a local database (16: 25 kinds on all layers, a second install refused, a care-plan need recorded, a value off the list refused, a second first refused, a correction without a reason refused, an update, a stale save refused, a correction with its reason, the history kept, rollback inactive with every fact kept).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the 25 care-need kinds are in. Nothing was written to any client; the checklist appears only when you turn on Care needs for matching on the Admin page (after the Hub pull request is merged)."); done(0)
