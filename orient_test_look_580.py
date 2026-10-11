#!/usr/bin/env python3
# 580 · ORIENTATION REMINDER TEST, THE LOOK (Samantha, 2026-10-11: test the Hub reminder with her own number and a test
# booking; verify the text arrived, the reminder row records success, and no duplicate came from GoHighLevel).
# Read only. Run the day of the session (after the day-before reminder window, 10am to 6pm Central) or any time after.
# Prints counts, dates and first names only; never a phone number.
import os, re
os.environ.setdefault("SB_STEP", "580")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
_say = say
def say(s=""): _say(re.sub(r"(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})", "(a number)", str(s)))
start("ORIENTATION REMINDER TEST: WHAT THE RECORD SAYS")
say("PART 1 · READ ONLY (nothing changes)")
ok_, sw = sql(REF, "select coalesce((data->>'orient_remind_live')::boolean, false) as live from app_data where key = 'ops_settings'")
say(f"  · the Hub reminder switch is {'ON' if ok_ and sw and sw[0]['live'] else 'OFF'}")
ok_, rows = sql(REF, "select session_date, mode, who, result, left(coalesce(detail, ''), 60) as detail, to_char(at, 'YYYY-MM-DD HH24:MI') as at, to_char(sent_at, 'YYYY-MM-DD HH24:MI') as sent_at from orient_reminders where at > now() - interval '21 days' order by at desc limit 40")
if not ok_: bad(f"reminder rows unreadable: {rows}"); done(3)
if not rows: say("  · no reminder rows in the last 21 days: nobody has been due yet (the day-before window has not passed for any booked session, or no session has a booking)")
for r in rows:
    first = str(r["who"] or "").split(" ")[0]
    say(f"  · {r['session_date']}  {r['mode']:8} {r['result']:9} {first:12} checked {r['at']}" + (f", sent {r['sent_at']}" if r["sent_at"] else "") + (f"  ({r['detail']})" if r["result"] in ("not_sent", "failed", "skipped") else ""))
ok_, sent = sql(REF, "select count(*)::int as n from orient_reminders where mode = 'live' and result = 'sent' and at > now() - interval '21 days'")
(say if ok_ and sent and sent[0]["n"] > 0 else bad)(("  ✓ " if ok_ and sent and sent[0]["n"] > 0 else "") + (f"{sent[0]['n']} live reminder(s) recorded as sent in the last 21 days" if ok_ and sent and sent[0]["n"] > 0 else "no live reminder recorded as sent yet"))
ok_, rel = sql(REF, "select count(*)::int as n from orient_bookings where ghl_relayed_at > now() - interval '21 days'")
(say if ok_ and rel and rel[0]["n"] == 0 else bad)(("  ✓ " if ok_ and rel and rel[0]["n"] == 0 else "") + (f"no booking was relayed to the GoHighLevel workflow in the last 21 days, so no duplicate could come from there" if ok_ and rel and rel[0]["n"] == 0 else f"{rel[0]['n'] if ok_ and rel else '?'} booking(s) were relayed to GoHighLevel: a duplicate was possible"))
ok_, both = sql(REF, "select count(*)::int as n from orient_bookings b join orient_reminders o on o.phone10 = regexp_replace(coalesce(b.phone,''), '\\D', '', 'g') and o.session_id = b.session_id and o.mode = 'live' and o.result = 'sent' where b.ghl_relayed_at is not null and o.at > now() - interval '21 days'")
(say if ok_ and both and both[0]["n"] == 0 else bad)(("  ✓ " if ok_ and both and both[0]["n"] == 0 else "") + f"people reminded by both the Hub and GoHighLevel for the same session: {both[0]['n'] if ok_ and both else '?'}")
ok_, cards = sql(REF, "select count(*)::int as n from app_data, jsonb_array_elements(data) c where key = 'ops_items' and c->>'kind' = 'send_problem' and c->>'sender' ilike '%orient%' and c->>'status' = 'open'")
if ok_ and cards: say(f"  · open send-problem cards from the orientation reminder: {cards[0]['n']}")
say()
say("  The test passes when: one row above reads live / sent for your session with a sent time, your phone received exactly one reminder text, no relay happened, and no card is open. Then workflow 7a and the relay can retire (their own step).")
say("RESULT: " + ("LOOKED · nothing was changed." if not fails else "LOOKED, WITH ✗ LINES · nothing was changed."))
done(0 if not fails else 8)
