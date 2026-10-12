#!/usr/bin/env python3
# 631 · DOES CARA EVER TEXT ON HER OWN? (read only; scheduling review step 4, Samantha's decision 6: "if Cara is always
# on manual select, retire the auto waves"). Reads the switches and every ask on record (open, closed and archived
# call-offs): how many were sent by Cara's automatic waves and when the last one was, against the ones a person picked.
# Changes nothing. Sends nothing.
import os, json
os.environ.setdefault("SB_STEP", "631")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
start("DOES CARA EVER TEXT ON HER OWN? (READ ONLY)")
ok, r = sql(REF, """select coalesce(data->>'coverage_send_live','not set') as send_live, coalesce(data->>'coverage_manual_select','not set') as manual,
  coalesce(data->>'coverage_wave_fuse_min','not set') as fuse from public.app_data where key = 'ops_settings'""")
if not ok or not r: bad(f"could not read the switches: {r}"); done(3)
x = r[0]
say(f"  · Cara's open-shift texts: {x['send_live']} · \"you choose who gets asked\" (manual select): {x['manual']} · minutes between waves: {x['fuse']}")
ok, a = sql(REF, """with c as (
    select c from public.app_data, jsonb_array_elements(coalesce(data::jsonb,'[]'::jsonb)) c where key in ('coverage_cases','coverage_cases_archive')),
  a as (select c->>'id' as case_id, coalesce(c->>'kind','') as kind, x from c, jsonb_array_elements(coalesce(c->'asked','[]'::jsonb)) x)
  select count(*) filter (where x->>'auto' = 'true') as auto_n,
         max(x->>'at') filter (where x->>'auto' = 'true') as auto_last,
         count(*) filter (where x->>'picked_by_coordinator' = 'true') as picked_n,
         max(x->>'at') filter (where x->>'picked_by_coordinator' = 'true') as picked_last,
         count(*) filter (where x->>'auto' = 'true' and (x->>'at') >= to_char(now() - interval '30 days', 'YYYY-MM-DD')) as auto_30,
         count(*) filter (where x->>'picked_by_coordinator' = 'true' and (x->>'at') >= to_char(now() - interval '30 days', 'YYYY-MM-DD')) as picked_30,
         count(*) as all_n from a""")
if not ok or not a: bad(f"could not read the asks: {a}"); done(3)
y = a[0]
say(f"  · every ask on record: {y['all_n']}")
say(f"  · sent by Cara's automatic waves: {y['auto_n']} in all, {y['auto_30']} in the last 30 days; the last one {str(y['auto_last'] or 'never')[:16]}")
say(f"  · picked by a person: {y['picked_n']} in all, {y['picked_30']} in the last 30 days; the last one {str(y['picked_last'] or 'never')[:16]}")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · read only; nothing changed, nothing sent. Tell Claude \"ran 631\"."); done(0)
