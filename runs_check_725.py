#!/usr/bin/env python3
# 725 · HOW DID THE NEW JOBS RUN? (READ ONLY) (Samantha, 2026-10-14: "yes to all" -> Claude checks tomorrow's runs.)
# Reads, changes nothing: the two Admin switches; each new job's schedule results (cron.job_run_details) and its own last
# note (automation_heartbeats): roster-axis-follow (3am CDT), onboard-goal-watch (9am CDT weekdays), availability-checkin
# (noon CDT weekdays); the Hub vs AxisCare list's counts; open onboarding-goal cards; 30-day texts sent in the last day.
# Prints counts only: no name, number, email, key or secret.
import os, json
os.environ.setdefault("SB_STEP", "725")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
JOBS = ["roster-axis-follow", "onboard-goal-watch", "availability-checkin"]
def q1(sqltext):
    ok, r = sql(REF, sqltext)
    if not ok: bad("a read failed: " + str(r)[:160]); return []
    return r or []

start("HOW DID THE NEW JOBS RUN? (READ ONLY)")
say("NOTHING CHANGES IN THIS STEP")
sw = q1("select coalesce(data->>'roster_follow_axis_live','off') as roster, coalesce(data->>'avail_checkin_live','off') as avail from public.app_data where key = 'ops_settings'")
if sw: say(f"  · switches: Caregiver list follows AxisCare = {'ON' if sw[0]['roster'] == 'true' else 'off (practice)'} · 30-day availability texts = {'ON' if sw[0]['avail'] == 'true' else 'off (practice)'}")
say()
for job in JOBS:
    runs = q1("select d.status, to_char(d.start_time at time zone 'America/Chicago', 'Dy Mon DD HH12:MI am') as at, left(coalesce(d.return_message,''), 120) as msg "
              "from cron.job_run_details d join cron.job j on j.jobid = d.jobid where j.jobname = '" + job + "' order by d.start_time desc limit 3")
    hb = q1("select x->>'at' as at, x->>'ok' as ok, left(x->>'note', 260) as note from public.app_data a, jsonb_array_elements(a.data) x "
            "where a.key = 'automation_heartbeats' and x->>'id' = 'hb_" + job + "'")
    say(f"  {job}:")
    if not runs: say("    · its schedule has not fired yet")
    for r in runs: say(f"    · schedule fired {r['at']} Central: {r['status']}" + (f" ({r['msg']})" if r['status'] != 'succeeded' and r['msg'] else ""))
    if hb: say(f"    · its own last note ({str(hb[0]['at'])[:16].replace('T', ' ')} UTC): {'ok' if hb[0]['ok'] == 'true' else 'NOT OK'} · {hb[0]['note']}")
    else: say("    · no note from it yet (a schedule that only checks its hours writes none outside them)")
    if any(r["status"] == "failed" for r in runs): bad(f"{job}: a scheduled run failed")
    if hb and hb[0]["ok"] != "true": bad(f"{job}: its last run says not ok")
say()
rep = q1("select data->>'mode' as mode, data->>'at' as at, data->>'held' as held, jsonb_array_length(coalesce(data->'changes','[]'::jsonb)) as changes, "
         "jsonb_array_length(coalesce(data->'history','[]'::jsonb)) as history, jsonb_array_length(coalesce(data->'no_number','[]'::jsonb)) as no_number, "
         "jsonb_array_length(coalesce(data->'not_in_axiscare','[]'::jsonb)) as not_in from public.app_data where key = 'roster_axis_follow'")
if rep:
    r = rep[0]
    say(f"  · Hub vs AxisCare list (last checked {str(r['at'])[:16].replace('T', ' ')} UTC, {r['mode']}): {r['changes']} differ now, {r['history']} changed so far, "
        f"{r['no_number']} active with no AxisCare number, {r['not_in']} with a number AxisCare doesn't know" + (f" · HELD: {r['held'][:160]}" if r['held'] else ""))
cards = q1("select count(*) filter (where x->>'status' not in ('done','closed','dismissed','resolved')) as open, count(*) as total "
           "from public.app_data a, jsonb_array_elements(a.data) x where a.key = 'ops_items' and x->>'kind' = 'onboarding_goal'")
if cards: say(f"  · onboarding goal cards: {cards[0]['open']} open ({cards[0]['total']} ever)")
inv = q1("select count(*) filter (where x->>'via' = 'availability-checkin' and (x->>'at')::timestamptz > now() - interval '1 day') as day, "
         "count(*) filter (where x->>'via' = 'availability-checkin') as total from public.app_data a, jsonb_array_elements(a.data) x where a.key = 'availability_invites'")
if inv: say(f"  · 30-day availability texts sent: {inv[0]['day']} in the last day, {inv[0]['total']} in all")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE (nothing was changed)"); done(9)
say("RESULT: DONE · read only, nothing was changed. Tell Claude \"ran 725\".")
done(0)
