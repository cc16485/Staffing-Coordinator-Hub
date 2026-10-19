#!/usr/bin/env python3
# 998 · THE OFFICE COACHING SCRIPT (Samantha 2026-10-18: "The office coaching script is approved. Make the changes that
# go with it.").
# Part 1 (read only): coaching calls part C3 is in (977); coaching calls are off.
# Part 2: hr_coaching_office_script.sql: office coaching records get the approved script as their talking points, filled
#   in from the team review; completing office coaching never asks for the write-up warning (caregiver coaching does).
# Part 3 (proof; switched on only inside an undone test; nothing rings, nothing is sent): a team review in Coaching
#   becomes an office record whose talking points are the script (the coach, the person, the follow-ups, two STOPs, the
#   note for the cause); Zach completes it with a confirmed call and no warning; caregiver coaching still needs it.
import os, json, re
os.environ.setdefault("SB_STEP", "998")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
HR_EMAIL = os.environ.get("SB_HR_EMAIL", "zach@mo-care.com")
HERE = os.path.dirname(os.path.abspath(__file__))

start("THE OFFICE COACHING SCRIPT")
say("PART 1 · READ ONLY (nothing changes)")
ok, st = sql(REF, """select (select count(*) from pg_proc where proname = 'hr_coaching_from_reviews')::int as c3,
  coalesce((select data->>'hr_coaching_calls_live' from public.app_data where key = 'ops_settings'), '') as live,
  (select count(*) from pg_proc where proname = 'hr_office_script')::int as again""")
if not ok or not st: bad(f"could not read the database: {st}")
else:
    x = st[0]
    if x["c3"] != 1: bad("coaching calls part 3 is not in (Desktop 977)")
    if x["live"] == "true": bad("coaching calls are already switched on; this step expects them off")
    if not fails: say(f"  ✓ part C3 is in · coaching calls are off · this step is {'already in (an earlier run)' if x['again'] else 'new'}")
say("  · what changes: how office coaching records are written, and no warning tick for office coaching. Nothing rings, nothing is sent, no switch is turned on.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
CHECK = """
do $v$ begin
  if position('hr_office_script' in pg_get_functiondef('public.hr_coaching_from_reviews()'::regprocedure)) = 0 then raise exception '998 self-check: office records do not use the script'; end if;
  if position('c.subject_type <> ''office'' and coalesce(p->>''warning_given''' in pg_get_functiondef('public.hr_coaching_act(uuid, text, jsonb)'::regprocedure)) = 0 then raise exception '998 self-check: the warning rule did not change'; end if;
end $v$;"""
good, r = sql(REF, "begin;\n" + open(os.path.join(HERE, "hr_coaching_office_script.sql")).read() + CHECK + "\ncommit;")
if not good: bad(f"the change did not go in, so nothing changed: {str(r)[:300]}"); say("  RESULT: STOPPED. Tell Claude."); done(5)
say("  ✓ office coaching records now get the approved script; office coaching asks for no write-up warning")

say(); say("PART 3 · PROOF (pretend switched on, all undone; nothing rings, nothing is sent)")
ok, pr = sql(REF, f"""do $p$ declare t date := (now() at time zone 'America/Chicago')::date; res text := ''; o uuid; k uuid; tp text; uid uuid; meta jsonb; begin
  update public.app_data set data = data || '{{"hr_coaching_calls_live": true}}'::jsonb where key = 'ops_settings';
  insert into public.app_data(key, data) values ('cc_reviews', '[]'::jsonb) on conflict (key) do nothing;
  perform public.upsert_app_data_item('cc_reviews', jsonb_build_object('id', 'rev_probe_998', 'person', 'Probe', 'status', 'coaching', 'opened_on', t, 'cause', 'workload', 'history', '[]'::jsonb,
    'items', jsonb_build_array(jsonb_build_object('kind', 'first_call', 'client', 'the Smith family', 'day', t - 3), jsonb_build_object('kind', 'second_try', 'client', 'the Lee family', 'day', t - 1)),
    'coaching', jsonb_build_object('owner', public.hr_lead_email(), 'deadline', t + 5, 'plan', 'Walk through the follow-up list')));
  select id, talking_points into o, tp from public.hr_coaching where review_id = 'rev_probe_998';
  res := res || 'script=' || coalesce(((tp like '%This call is being recorded for our coaching records%') and (tp like '%the first call for the Smith family%') and (tp like '%the second try for the Lee family%')
    and (array_length(string_to_array(tp, '[STOP: let them answer. Write down what they say.]'), 1) = 3) and (tp like '%[NOTE: The review says workload.%') and (tp like '%[NOTE: The plan from the review: Walk through the follow-up list]%'))::int, 0) || ';';
  insert into public.hr_coaching_call (coaching_id, practice, matched_by, tapped_by, tap_at, ghl_message_id, call_at, seconds, call_status, recording_ok, state, confirmed_at)
    values (o, false, 'tap', {lit(HR_EMAIL)}, now(), 'probe998', now(), 300, 'completed', true, 'confirmed', now());
  insert into public.hr_coaching (axiscare_caregiver_id, caregiver, kind, topic, assigned_to, assigned_by, due_on) values ('0', 'Probe Caregiver', 'coaching', 'probe', {lit(HR_EMAIL)}, 'probe', t + 3) returning id into k;
  insert into public.hr_coaching_call (coaching_id, practice, matched_by, tapped_by, tap_at, ghl_message_id, call_at, seconds, call_status, recording_ok, state, confirmed_at)
    values (k, false, 'tap', {lit(HR_EMAIL)}, now(), 'probe998b', now(), 300, 'completed', true, 'confirmed', now());
  select u.id, coalesce(u.raw_app_meta_data, '{{}}'::jsonb) into uid, meta from auth.users u where lower(u.email) = {lit(HR_EMAIL)} and u.banned_until is null;
  if uid is null then raise exception 'PROBE_RESULT:nouser=1'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated', 'app_metadata', meta)::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  set local role authenticated;
  begin perform public.hr_coaching_act(o, 'done', jsonb_build_object('discussed', 'a', 'response', 'b', 'expectation', 'c', 'help_agreed', 'd', 'followup', 'e', 'warning_given', 'false'));
    res := res || 'office_done=1;'; exception when others then res := res || 'office_done=0;'; end;
  begin perform public.hr_coaching_act(k, 'done', jsonb_build_object('discussed', 'a', 'response', 'b', 'expectation', 'c', 'help_agreed', 'd', 'followup', 'e', 'warning_given', 'false'));
    res := res || 'cg_needs=0;'; exception when others then res := res || 'cg_needs=' || (case when sqlerrm like 'Tick that you told them%' then '1' else '0' end) || ';'; end;
  raise exception 'PROBE_RESULT:%', res; end $p$;""")
m_ = re.search(r"PROBE_RESULT:([a-z0-9_=; ]*)", str(pr)) if not ok else None
p = dict(kv.split("=") for kv in m_.group(1).split(";") if "=" in kv) if m_ else None
if p is None or p.get("nouser"): bad(f"the proof did not run: {str(pr)[:300]}")
else:
    say("  ✓ a team review in Coaching becomes an office record with the approved script: the recording line, the follow-ups with their families, two STOPs, the workload note and the plan") if p.get("script") == "1" else bad("the office record's talking points are not the script")
    say("  ✓ Zach completes office coaching with a confirmed call and no write-up warning") if p.get("office_done") == "1" else bad("office coaching could not be completed without the warning")
    say("  ✓ caregiver coaching still needs the write-up warning tick") if p.get("cg_needs") == "1" else bad("caregiver coaching no longer asked for the warning")
ok, lv = sql(REF, "select coalesce((select data->>'hr_coaching_calls_live' from public.app_data where key = 'ops_settings'), '') as live, (select count(*) from public.hr_coaching where review_id = 'rev_probe_998' or caregiver = 'Probe Caregiver')::int as probes")
say("  ✓ coaching calls are still off and the test left nothing behind") if ok and lv and lv[0]["live"] != "true" and lv[0]["probes"] == 0 else bad(f"something was left behind: {lv}")
say("  · tested before this ran: this step against a local copy of the database with 961, 969 and 977 underneath (see office_script_998_test.py), and the HR page form (20 checks).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE. Tell Claude."); done(9)
say("RESULT: DONE · Office coaching uses the approved script and never asks for the write-up warning. Tell Claude, who merges the Hub change next.")
say("Undo: Claude can put back the part 3 versions of the two functions.")
done(0)
