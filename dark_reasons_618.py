#!/usr/bin/env python3
# 618 · WHY "NOT FOR THIS VISIT" (read only; Samantha 2026-10-12, after 617's first report: 143 of 210 visits). Counts the
# reasons in the stored dark report, with times and digits blanked so like reasons group together, plus the warnings and
# the call-off replay's groups. Reads one stored report; changes nothing; sends nothing.
import os, json
os.environ.setdefault("SB_STEP", "618")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
start("WHY NOT FOR THIS VISIT (READ ONLY)")
ok, r = sql(REF, "select data->>'at' as at, data->'counts' as counts, data->'clients' - 'flagged_list' as clients, data->'gaps' as gaps from public.app_data where key = 'match_dark_report'")
if not ok or not r: bad(f"could not read the report: {r}"); done(3)
say(f"  · the report of {r[0]['at']}: {json.dumps(r[0]['counts'])}")
say(f"  · clients: {json.dumps(r[0]['clients'])}")
say(f"  · gaps: {json.dumps(r[0]['gaps'])}")
say(); say("THE REASONS, MOST COMMON FIRST (digits and times blanked)")
ok, rs = sql(REF, """select x->>'group' as grp, regexp_replace(regexp_replace(coalesce(x->>'reason',''), '[0-9]{1,2}:[0-9]{2}', 'hh:mm', 'g'), '[0-9]+', 'n', 'g') as why, count(*) as n
  from public.app_data, jsonb_array_elements(data->'rows') x where key = 'match_dark_report' group by 1, 2 order by 3 desc limit 40""")
if ok:
    for row in rs: say(f"  {int(row['n']):>4}  {row['grp']:<14} {row['why'][:160]}")
else: bad(f"could not count the reasons: {rs}")
say(); say("THE WARNINGS")
ok, ws = sql(REF, """select regexp_replace(w #>> '{}', '[0-9]+', 'n', 'g') as w, count(*) as n from public.app_data, jsonb_array_elements(data->'rows') x, jsonb_array_elements(coalesce(x->'warnings','[]'::jsonb)) w
  where key = 'match_dark_report' group by 1 order by 2 desc limit 15""")
if ok:
    for row in ws: say(f"  {int(row['n']):>4}  {row['w'][:160]}")
say(); say("HOW MANY CAREGIVERS AND CLIENTS EACH TOP REASON TOUCHES")
ok, cs = sql(REF, """select regexp_replace(regexp_replace(coalesce(x->>'reason',''), '[0-9]{1,2}:[0-9]{2}', 'hh:mm', 'g'), '[0-9]+', 'n', 'g') as why, count(distinct x->>'caregiver_id') as caregivers, count(distinct x->>'client_id') as clients
  from public.app_data, jsonb_array_elements(data->'rows') x where key = 'match_dark_report' and x->>'group' = 'not_for_visit' group by 1 order by count(*) desc limit 12""")
if ok:
    for row in cs: say(f"  {row['caregivers']:>3} caregivers, {row['clients']:>3} clients · {row['why'][:150]}")
say(); say("THE CALL-OFF REPLAY")
ok, rp = sql(REF, """select coalesce(x->>'covered_group','(no one recorded / not on the roster)') as g, count(*) as n from public.app_data, jsonb_array_elements(data->'replay'->'rows') x where key = 'match_dark_report' group by 1 order by 2 desc""")
if ok:
    for row in rp: say(f"  {int(row['n']):>4}  {row['g']}")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · read only; nothing changed. Send this report to Claude."); done(0)
