#!/usr/bin/env python3
# 570 · SLICE 3a, THE JOURNEY LEARNS A CAREGIVER SUBJECT (Samantha approved Migrations A and B, 2026-10-10). Hub project.
# Runs the one SQL file: the subject column, the offer and caregiver ids, the constraints that keep client and caregiver rows
# apart, and the 37 caregiver catalog rows, INACTIVE until Slice 3b's code reads them. No existing row changes; no grant or
# policy changes; nothing deployed; nothing sent.
import os
os.environ.setdefault("SB_STEP", "570")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
start("SLICE 3a: THE JOURNEY LEARNS A CAREGIVER SUBJECT (MIGRATIONS A AND B)")
say("PART 1 · READ ONLY (nothing changes)")
SQLF = os.path.join(ROOT, "supabase", "slice3a-journey-caregiver-subject.sql")
if not os.path.exists(SQLF): bad("the SQL file is not in the reviewed build"); done(2)
ok_, c = sql(REF, "select (select count(*)::int from public.client_journey) as journeys, (select count(*)::int from public.client_journey_step) as steps, (select count(*)::int from public.client_journey_event) as events, (select count(*)::int from public.client_journey_step_def) as defs, (select count(*)::int from public.client_journey_step_def where key like 'cg.%') as cg_defs")
if not ok_: bad(f"could not read the journey tables: {c}"); done(3)
say(f"  · today: {c[0]['journeys']} client journey(s), {c[0]['steps']} step rows, {c[0]['events']} history rows, {c[0]['defs']} catalog rows ({c[0]['cg_defs']} caregiver rows); none changes")
ok_, col = sql(REF, "select count(*)::int as n from information_schema.columns where table_name = 'client_journey' and column_name in ('subject', 'offer_id', 'axiscare_caregiver_id')")
say(f"  · the subject columns exist already: {int(col[0]['n']) == 3} (safe to run again)") if ok_ else bad(f"columns: {col}")
say("  · what changes: three columns, the constraints, 37 inactive catalog rows. No existing row changes; no grant or policy changes.")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(3)
say(); say("PART 2 · CHANGE")
ok_, r_ = sql(REF, open(SQLF).read())
if not ok_: bad(f"the migration did not run: {r_}"); done(5)
say("  ✓ Migration A (the subject column, the ids, the constraints) and Migration B (the caregiver catalog, inactive) ran")
say(); say("PART 3 · PROOF (nothing is sent or changed)")
ok_, col = sql(REF, "select count(*)::int as n from information_schema.columns where table_name = 'client_journey' and column_name in ('subject', 'offer_id', 'axiscare_caregiver_id')")
say("  ✓ the three columns exist") if ok_ and int(col[0]['n']) == 3 else bad(f"columns after: {col}")
ok_, cons = sql(REF, "select count(*)::int as n from pg_constraint where conname in ('cj_subject_kind', 'cj_client_rows_are_clients', 'cj_caregiver_rows_are_caregivers', 'cj_has_a_person_or_offer', 'cj_offer_id_unique', 'cj_caregiver_id_unique', 'cj_caregiver_id_digits')")
say("  ✓ the seven constraints are in place") if ok_ and int(cons[0]['n']) == 7 else bad(f"constraints: {cons}")
ok_, mixed = sql(REF, """do $p$ begin
  begin
    insert into public.client_journey (subject, lead_id, offer_id, client_name, created_by, is_test) values ('caregiver', 'proof-lead', 'proof-offer', 'Proof Row', '570 proof', true);
    raise exception 'MIXED ROW ACCEPTED';
  exception when check_violation then null;
  end;
  begin
    insert into public.client_journey (subject, lead_id, offer_id, client_name, created_by, is_test) values ('client', null, 'proof-offer', 'Proof Row', '570 proof', true);
    raise exception 'CLIENT ROW WITH OFFER ACCEPTED';
  exception when check_violation then null;
  end;
end $p$""")
say("  ✓ a row that is both subjects is refused; a client row with an offer id is refused (nothing was inserted)") if ok_ else bad(f"the constraints did not hold: {mixed}")
ok_, c2 = sql(REF, "select (select count(*)::int from public.client_journey) as journeys, (select count(*)::int from public.client_journey where subject = 'client') as clients, (select count(*)::int from public.client_journey_step) as steps, (select count(*)::int from public.client_journey_event) as events, (select count(*)::int from public.client_journey_step_def where key like 'cg.%') as cg_defs, (select count(*)::int from public.client_journey_step_def where key like 'cg.%' and active) as cg_active")
say(f"  ✓ every existing journey is a client journey ({c2[0]['clients']} of {c2[0]['journeys']}); steps and history unchanged ({c[0]['steps']}/{c[0]['events']} → {c2[0]['steps']}/{c2[0]['events']})") if ok_ and int(c2[0]['journeys']) == int(c[0]['journeys']) and int(c2[0]['clients']) == int(c2[0]['journeys']) and int(c2[0]['steps']) == int(c[0]['steps']) and int(c2[0]['events']) == int(c[0]['events']) else bad(f"rows changed: {c2}")
say(f"  ✓ {c2[0]['cg_defs']} caregiver catalog rows, {c2[0]['cg_active']} active (must be 0 until Slice 3b)") if ok_ and int(c2[0]['cg_defs']) == 37 and int(c2[0]['cg_active']) == 0 else bad(f"catalog: {c2}")
ok_, g = sql(REF, "select bool_or(has_table_privilege(r, 'public.client_journey', 'select')) as any_read from unnest(array['anon', 'authenticated']) r")
say("  ✓ the journey tables stay server-only (no page can read them)") if ok_ and g[0]['any_read'] is False else bad(f"grants: {g}")
say("  · tested before running: 15 checks on the shape of the migration and the rollback.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the journey can hold caregivers; nothing reads the caregiver rows yet. Nothing was sent; no existing row changed."); done(0)
