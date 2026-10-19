#!/usr/bin/env python3
# 977 · COACHING CALLS, part C3 (Samantha 2026-10-18: "Start coaching calls part 3: overdue escalation, the follow-up
# check and office coaching").
# Part 1 (read only): the reviewed build; part C1 is in (969: the coaching call records); coaching calls are off.
# Part 2: hr_coaching_c3.sql (office coaching rows, owners only; team reviews decided as Coaching become office coaching
#   records and finishing either side closes the other; the daily follow-through: overdue to Zach, 3 business days later
#   to Samantha, the follow-up check back to the coach, "not yet" to Zach); redeploy hr-coach-call (office employees'
#   phones; office records owners only); the daily follow-through at 8:05 Central.
# Part 3 (proof; every change undone; nothing rings, nothing is sent): with the switch pretended on, an overdue coaching
#   record gives Zach a card and, 3 business days on, Samantha one; a finished one gives its coach the follow-up check;
#   "not yet" gives Zach a card; a team review in Coaching becomes an office coaching record Krystal can't see, and
#   finishing it closes the review; a review finished on the Team page closes its record.
# Everything waits for ops_settings.hr_coaching_calls_live (her two gates). Until then the daily run only counts.
import os, json, re
os.environ.setdefault("SB_STEP", "977")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
NEW = "hr-coach-call"; JOB = "hr-coaching-followthrough"; SCHEDULE = "5 13 * * *"
CC_EMAIL = os.environ.get("SB_CC_EMAIL", "krystal@mo-care.com")
HERE = os.path.dirname(os.path.abspath(__file__))

start("COACHING CALLS (PART C3)")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
ok, st = sql(REF, """select (to_regclass('public.hr_coaching_call') is not null) as c1, (to_regclass('public.hr_coaching') is not null) as coaching,
  coalesce((select data->>'hr_coaching_calls_live' from public.app_data where key = 'ops_settings'), '') as live,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hr_coaching' and column_name = 'review_id')::int as again,
  (select count(*) from public.hr_coaching where status = 'open')::int as open_n""")
if not ok or not st: bad(f"could not read the database: {st}")
else:
    x = st[0]
    if not x["coaching"]: bad("the coaching tracker is not there (Desktop 961)")
    if not x["c1"]: bad("coaching calls part C1 is not in yet (Desktop 969)")
    if x["live"] == "true": bad("coaching calls are already switched on; this step expects them off")
    if not fails: say(f"  ✓ the coaching tracker and part C1 are in · coaching calls are off · {x['open_n']} open coaching record(s) · part C3 is {'already in (an earlier run)' if x['again'] else 'new'}")
sN, mN = fmeta(REF, NEW)
if sN != 200: bad("hr-coach-call is not live (Desktop 969)")
say("  · what changes: office coaching (owners only), the review link both ways, the daily follow-through (only counts while off), hr-coach-call redeployed. Nothing rings, nothing is sent, no switch is turned on.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
CHECK = """
do $v$ begin
  if not exists (select 1 from pg_trigger where tgname = 'hr_reviews_to_coaching' and not tgisinternal) then raise exception '977 self-check: the review trigger is missing'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'hr_coaching_to_review' and not tgisinternal) then raise exception '977 self-check: the write-back trigger is missing'; end if;
  if position('subject_type' in (select pg_get_expr(polqual, polrelid) from pg_policy where polname = 'hr_coaching_read')) = 0 then raise exception '977 self-check: office rows are not owners only'; end if;
end $v$;"""
good, r = sql(REF, "begin;\n" + open(os.path.join(HERE, "hr_coaching_c3.sql")).read() + CHECK + "\ncommit;")
if not good: bad(f"part C3 did not go in, so nothing changed: {str(r)[:300]}"); say("  RESULT: STOPPED. Tell Claude."); done(5)
say("  ✓ office coaching, the review link and the daily follow-through are in (all waiting for the switch)")
if not deploy(REF, FNROOT, NEW, True): say("  RESULT: STOPPED at the deploy. The database part is in (it waits for the switch). Tell Claude."); done(6)
sql(REF, f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
ok, r = sql(REF, f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, 'select public.hr_coaching_followthrough();') as id")
ok2, jb = sql(REF, f"select schedule from cron.job where jobname = {lit(JOB)}")
say("  ✓ the daily follow-through runs at 8:05 Central (7:05 in winter)") if ok and ok2 and jb and jb[0]["schedule"] == SCHEDULE else bad("the daily schedule did not go in")
ok, ft = sql(REF, "select public.hr_coaching_followthrough() as r")
fr = (ft[0]["r"] if ok and ft else None) or {}
if isinstance(fr, str): fr = json.loads(fr)
say(f"  ✓ a first run, counting only (switched off): {fr.get('overdue_to_zach', 0)} overdue for Zach, {fr.get('overdue_to_samantha', 0)} for Samantha, {fr.get('checks', 0)} follow-up check(s), {fr.get('not_yet_to_zach', 0)} not yet") if ok and fr.get("live") is False else bad(f"the first run did not count as expected: {ft}")

say(); say("PART 3 · PROOF (pretend switched on, all undone; nothing rings, nothing is sent)")
ok, pr = sql(REF, f"""do $p$ declare a uuid; b uuid; d uuid; o uuid; res text := ''; n int; t date := (now() at time zone 'America/Chicago')::date; uid uuid; meta jsonb; begin
  update public.app_data set data = data || '{{"hr_coaching_calls_live": true}}'::jsonb where key = 'ops_settings';
  insert into public.hr_coaching (axiscare_caregiver_id, caregiver, kind, topic, assigned_to, assigned_by, due_on) values ('0', 'Probe Late', 'coaching', 'probe', {lit(CC_EMAIL)}, 'probe', t - 8) returning id into a;
  insert into public.hr_coaching (axiscare_caregiver_id, caregiver, kind, topic, assigned_to, assigned_by, due_on, status, held_on, check_on) values ('0', 'Probe Check', 'coaching', 'probe', {lit(CC_EMAIL)}, 'probe', t - 40, 'done', t - 30, t) returning id into b;
  insert into public.hr_coaching (axiscare_caregiver_id, caregiver, kind, topic, assigned_to, assigned_by, due_on, status, held_on, improved) values ('0', 'Probe Notyet', 'coaching', 'probe', {lit(CC_EMAIL)}, 'probe', t - 40, 'done', t - 30, false) returning id into d;
  perform public.hr_coaching_followthrough();
  select count(*) into n from public.app_data, jsonb_array_elements(data) e where key = 'ops_items' and e->>'status' = 'open' and (e->>'sensitive')::boolean
    and ((e->>'id' = 'ops_coach_late_' || a and e->>'owner' = public.hr_lead_email()) or (e->>'id' = 'ops_coach_late2_' || a and e->>'owner' = public.hr_decider_email())
      or (e->>'id' = 'ops_coach_check_' || b and e->>'owner' = {lit(CC_EMAIL)}) or (e->>'id' = 'ops_coach_notyet_' || d and e->>'owner' = public.hr_lead_email()));
  res := res || 'cards=' || n || ';';
  update public.hr_coaching set status = 'withdrawn', closed_at = now() where id = a;
  perform public.hr_coaching_card(c) from public.hr_coaching c where id = a;
  select count(*) into n from public.app_data, jsonb_array_elements(data) e where key = 'ops_items' and e->>'id' in ('ops_coach_late_' || a, 'ops_coach_late2_' || a) and e->>'status' = 'done';
  res := res || 'closed=' || n || ';';
  insert into public.app_data(key, data) values ('coordinator_staff', '[]'::jsonb) on conflict (key) do nothing;
  insert into public.app_data(key, data) values ('cc_reviews', '[]'::jsonb) on conflict (key) do nothing;
  perform public.upsert_app_data_item('cc_reviews', jsonb_build_object('id', 'rev_probe_977', 'person', 'Probe', 'status', 'coaching', 'opened_on', t, 'items', '[]'::jsonb, 'history', '[]'::jsonb,
    'coaching', jsonb_build_object('owner', public.hr_lead_email(), 'deadline', t + 5, 'plan', 'probe plan')));
  select id into o from public.hr_coaching where review_id = 'rev_probe_977' and subject_type = 'office';
  res := res || 'office=' || (case when o is null then 0 else 1 end) || ';';
  select u.id, coalesce(u.raw_app_meta_data, '{{}}'::jsonb) into uid, meta from auth.users u where lower(u.email) = {lit(CC_EMAIL)} and u.banned_until is null;
  if uid is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated', 'app_metadata', meta)::text, true);
    perform set_config('request.jwt.claim.sub', uid::text, true);
    set local role authenticated;
    select count(*) into n from public.hr_coaching where review_id = 'rev_probe_977'; res := res || 'cc_sees=' || n || ';';
    reset role;
  end if;
  update public.hr_coaching set status = 'done', discussed = 'probe done', closed_by = public.hr_lead_email(), closed_at = now() where id = o;
  select count(*) into n from public.app_data, jsonb_array_elements(data) e where key = 'cc_reviews' and e->>'id' = 'rev_probe_977' and e->>'status' = 'done'
    and e->'coaching'->>'done_note' = 'probe done' and jsonb_array_length(e->'history') = 1;
  res := res || 'back=' || n || ';';
  perform public.upsert_app_data_item('cc_reviews', jsonb_build_object('id', 'rev_probe_977b', 'person', 'Probe', 'status', 'coaching', 'opened_on', t, 'items', '[]'::jsonb, 'history', '[]'::jsonb,
    'coaching', jsonb_build_object('owner', public.hr_lead_email(), 'deadline', t + 5, 'plan', 'probe plan')));
  perform public.upsert_app_data_item('cc_reviews', jsonb_build_object('id', 'rev_probe_977b', 'person', 'Probe', 'status', 'done', 'opened_on', t, 'items', '[]'::jsonb, 'history', '[]'::jsonb,
    'coaching', jsonb_build_object('owner', public.hr_lead_email(), 'deadline', t + 5, 'plan', 'probe plan', 'done_note', 'on the team page', 'done_by', public.hr_lead_email())));
  select count(*) into n from public.hr_coaching where review_id = 'rev_probe_977b' and status = 'done' and discussed = 'on the team page';
  res := res || 'fwd=' || n || ';';
  raise exception 'PROBE_RESULT:%', res; end $p$;""")
m_ = re.search(r"PROBE_RESULT:([a-z0-9_=; ]*)", str(pr)) if not ok else None
p = dict(kv.split("=") for kv in m_.group(1).split(";") if "=" in kv) if m_ else None
if p is None: bad(f"the proof did not run: {str(pr)[:300]}")
else:
    say("  ✓ overdue: Zach gets a card, and 3 business days on Samantha does; the follow-up check goes to the coach; \"not yet\" goes to Zach (all private cards)") if p.get("cards") == "4" else bad(f"the follow-through cards were not as expected ({p.get('cards')} of 4)")
    say("  ✓ when the coaching closes, its overdue cards close themselves") if p.get("closed") == "2" else bad("the overdue cards did not close with the coaching")
    say("  ✓ a team review in Coaching becomes an office coaching record") if p.get("office") == "1" else bad("the review did not become an office coaching record")
    if "cc_sees" in p: say("  ✓ acting as Krystal: she can't see the office coaching record") if p.get("cc_sees") == "0" else bad("Krystal could see an office coaching record")
    else: say("  · could not test as Krystal (no sign-in found); the rehearsal covers it")
    say("  ✓ finished here: the review closes too, with the note and one history entry") if p.get("back") == "1" else bad("finishing the office coaching did not close the review")
    say("  ✓ finished on the Team page: the coaching record closes too, with its note") if p.get("fwd") == "1" else bad("finishing the review did not close the coaching record")
ok, lv = sql(REF, """select coalesce((select data->>'hr_coaching_calls_live' from public.app_data where key = 'ops_settings'), '') as live,
  (select count(*) from public.hr_coaching where caregiver like 'Probe%' or review_id like 'rev_probe_977%')::int as probes""")
say("  ✓ coaching calls are still off and the test left nothing behind") if ok and lv and lv[0]["live"] != "true" and lv[0]["probes"] == 0 else bad(f"something was left behind: {lv}")
say("  · tested before this ran: this step against a local copy of the database with 961 and 969 underneath (see coaching_calls_977_test.py).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE. Tell Claude."); done(9)
say("RESULT: DONE · Overdue escalation, the follow-up check and office coaching are in, waiting for the switch. Tell Claude.")
say("Undo: Claude can unschedule hr-coaching-followthrough and drop the two review triggers; records are kept by design.")
done(0)
