#!/usr/bin/env python3
# 582b · THE DOOR, A LOOK (read only). Run after a week of office use (the Slice 3 gate). For each action behind the door,
# since it went live: how many changes started, how many finished (done / refused / failed), any started with no outcome,
# any request id that ran twice, the people who did them (names only), how many came from an older open page with no
# request id. Also: the authority table and its change log as they stand. Changes nothing. Sends nothing.
import os
os.environ.setdefault("SB_STEP", "582b")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
start("THE DOOR, A LOOK (read only)")
ok_, live = sql(REF, "select min(at) as since from public.action_authority_log where set_by = '582 installer'")
since = live[0]["since"] if ok_ and live and live[0]["since"] else None
if not since: bad("the authority table is not installed (582 has not run)"); done(2)
say(f"  · the door went live {str(since)[:16]} UTC")
ok_, rows = sql(REF, "select action, count(*) filter (where outcome = 'started')::int as started, count(*) filter (where outcome = 'done')::int as done, "
                     "count(*) filter (where outcome = 'refused')::int as refused, count(*) filter (where outcome = 'failed')::int as failed, "
                     "count(*) filter (where outcome = 'started' and request_id like 'srv-%')::int as old_page, "
                     "count(*) filter (where actor_email = '' or actor_kind <> 'person')::int as no_person "
                     "from public.op_events where action in (select action from public.action_registry where mutating) group by 1 order by 1")
if not ok_: bad(f"could not read the record: {rows}"); done(3)
if not rows: say("  · no changes through the door yet")
for r in rows or []:
    fin = r["done"] + r["refused"] + r["failed"]
    say(f"  · {r['action']}: {r['started']} started, {r['done']} done, {r['refused']} refused, {r['failed']} failed; from an older open page {r['old_page']}")
    (say if fin == r["started"] else bad)(("  ✓ " if fin == r["started"] else "") + (f"every one that started has its outcome" if fin == r["started"] else f"{r['started'] - fin} started with no outcome (look at the ones below)"))
    (say if r["no_person"] == 0 else bad)(("  ✓ every row carries the real person" if r["no_person"] == 0 else f"{r['no_person']} row(s) without a person"))
ok_, dup = sql(REF, "select request_id, count(*)::int as n from public.op_events where action in (select action from public.action_registry where mutating) and outcome in ('done', 'refused', 'failed') group by 1 having count(*) > 1")
(say if ok_ and not dup else bad)(("  ✓ no request id finished twice (no duplicates)") if ok_ and not dup else f"request ids that finished more than once: {dup}")
ok_, open_ = sql(REF, "select s.action, s.at, s.actor_name from public.op_events s where s.outcome = 'started' and s.action in (select action from public.action_registry) "
                      "and not exists (select 1 from public.op_events o where o.request_id = s.request_id and o.outcome <> 'started') and s.at < now() - interval '5 minutes' order by s.at desc limit 10")
for r in open_ or []: say(f"      started, no outcome: {r['action']} by {r['actor_name']} at {str(r['at'])[:16]} UTC")
ok_, who = sql(REF, "select actor_name, count(*)::int as n from public.op_events where action in (select action from public.action_registry) and outcome = 'done' group by 1 order by 2 desc")
if ok_ and who: say("  · who: " + ", ".join(f"{r['actor_name']} {r['n']}" for r in who))
ok_, au = sql(REF, "select action, actor_kind, level, array_to_string(roles, ', ') as roles from public.action_authority order by 1, 2")
say("  · who may do what now:")
for r in au or []: say(f"      {r['action']} · {r['actor_kind']}: {r['level']}" + (f" ({r['roles']})" if r["roles"] else ""))
ok_, lg = sql(REF, "select at, action, actor_kind, old_level, new_level, set_by from public.action_authority_log where set_by <> '582 installer' order by at")
say("  · changes since the seed: " + ("none" if ok_ and not lg else ""))
for r in lg or []: say(f"      {str(r['at'])[:16]} {r['action']} · {r['actor_kind']}: {r['old_level']} to {r['new_level']} (by an owner)")
say()
say("RESULT: " + ("CHECK THE ✗ LINES ABOVE" if fails else "DONE · the door's record is whole") + ". Nothing was changed.")
done(1 if fails else 0)
