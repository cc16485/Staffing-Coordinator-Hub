#!/usr/bin/env python3
# 578b · THE RECORD, A LOOK (read only). Run after Desktop step 578 and after you have done one thing in the Hub (a note on a
# work item, a claim, a switch). Shows the last rows of the event record with who (first name), what, when, how (hub, phone,
# admin, link, cron, server) and the outcome; never a phone number, email address or note text. Proves that your own action
# was recorded with YOUR name by the door, and that nothing is still writing the old way.
import os, re
os.environ.setdefault("SB_STEP", "578b")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
start("THE RECORD: A LOOK AFTER SLICE 1")
say("PART 1 · READ ONLY (nothing changes)")
ok_, rows = sql(REF, "select to_char(at, 'YYYY-MM-DD HH24:MI') as at, split_part(actor_name, ' ', 1) as who, actor_kind, via, verb, outcome, left(regexp_replace(summary, '[\\w.%+\\-]+@[\\w.\\-]+\\.[A-Za-z]{2,}', '(an email)', 'g'), 70) as summary from op_events order by id desc limit 12")
if not ok_: bad(f"the record could not be read: {rows}"); done(3)
say("  · the last 12 rows, newest first:")
for r in rows: say(f"      {r['at']}  {r['who']:12} {r['actor_kind']:8} {r['via'] or '-':9} {r['verb']:24} {r['outcome'] or '-':9} {r['summary']}")
ok_, mine = sql(REF, "select count(*)::int as n from op_events where via in ('hub', 'phone', 'admin') and at > now() - interval '2 hours'")
(say if ok_ and mine and mine[0]["n"] > 0 else bad)(("  ✓ " if ok_ and mine and mine[0]["n"] > 0 else "") + (f"{mine[0]['n']} row(s) in the last two hours came through the page door (via hub, phone or admin), stamped by the server from a real sign-in" if ok_ and mine and mine[0]["n"] > 0 else "no row has come through the page door in the last two hours: do one thing in the Hub, then run this again"))
ok_, old = sql(REF, "select count(*)::int as n from op_events where via = '' and actor_kind = 'person' and at > now() - interval '2 hours'")
(say if ok_ and old and old[0]["n"] == 0 else bad)(("  ✓ " if ok_ and old and old[0]["n"] == 0 else "") + (f"no row in the last two hours was written the old way (a person with no via)" if ok_ and old and old[0]["n"] == 0 else f"{old[0]['n']} row(s) in the last two hours look written the old way; tell Claude"))
ok_, pol = sql(REF, "select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = 'op_events' and cmd = 'INSERT'")
(say if ok_ and pol and pol[0]["n"] == 0 else bad)(("  ✓ " if ok_ and pol and pol[0]["n"] == 0 else "") + ("pages still hold no right to insert directly (the fallback cannot write)" if ok_ and pol and pol[0]["n"] == 0 else "an INSERT rule for pages exists; tell Claude"))
say()
say("RESULT: " + ("LOOKED · nothing was changed." if not fails else "LOOKED, WITH ✗ LINES · nothing was changed."))
done(0 if not fails else 8)
