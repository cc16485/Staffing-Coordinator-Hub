#!/usr/bin/env python3
# 990 · CORRECTIVE ACTION SOP REMINDERS (HR Agent build step 9; Samantha 2026-10-18: "Build HR step 9, the SOP deadline
# reminders").
# Part 1 (read only): the reviewed build; write-ups are owner-only (946); part C3's helpers are in (977); the live
#   hr-alerts is exactly what Claude reviewed; reminders are not switched on.
# Part 2: hr_sop_reminders.sql (each write-up's next SOP step: the facts in 2 business days, a decision in 3, the meeting
#   within 5 of the decision, the follow-up at 30 days; one private card for Zach on the day it is due and after, which
#   closes itself; runs at 7:55 Central and after every write-up save); hr-alerts redeployed so a due step sends Zach his
#   generic alert. PRACTICE until ops_settings.hr_sop_reminders_live (build step 10): it only counts.
# Part 3 (proof; undone after; nothing sent): with reminders pretended on, a practice write-up moves through every step,
#   with one reminder at a time, and the reminder closes when the follow-up is recorded; every real write-up is as before.
import os, json, re
os.environ.setdefault("SB_STEP", "990")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FN = "hr-alerts"; JOB = "hr-sop-reminders"; SCHEDULE = "55 12 * * *"
HERE = os.path.dirname(os.path.abspath(__file__))
LIVE_SHAS = json.loads(os.environ.get("SB_LIVE_SHAS", "{}"))
WU_Q = "select coalesce(md5((select data::text from public.app_data where key = 'discipline_actions')), 'none') as h, (select jsonb_array_length(data) from public.app_data where key = 'discipline_actions')::int as n"
def keys():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_secret_") or v.startswith("sb_publishable_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict) and usable(k.get("api_key", ""))}
        if got.get("service_role") and got.get("anon"): return got
    return {}

start("CORRECTIVE ACTION SOP REMINDERS")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
ok, st = sql(REF, """select (select count(*) from pg_policies where tablename = 'app_data' and policyname like 'app_data_hr_formal_%')::int as lock946,
  (select count(*) from pg_proc where proname in ('hr_lead_email', 'hr_short_name'))::int as c3,
  coalesce((select data->>'hr_sop_reminders_live' from public.app_data where key = 'ops_settings'), '') as live,
  (select count(*) from pg_proc where proname = 'hr_sop_reminders')::int as again""")
if not ok or not st: bad(f"could not read the database: {st}")
else:
    x = st[0]
    if x["lock946"] != 4: bad("write-ups are not owner-only (Desktop 946)")
    if x["c3"] != 2: bad("coaching calls part 3 is not in (Desktop 977)")
    if x["live"] == "true": bad("SOP reminders are already switched on; this step expects them off")
    if not fails: say(f"  ✓ write-ups are owner-only · part C3 is in · reminders are off · this step is {'already in (an earlier run)' if x['again'] else 'new'}")
ok, wb = sql(REF, WU_Q); WU_BEFORE = wb[0] if ok and wb else None
if not WU_BEFORE: bad("could not read the write-ups to compare after")
sF, mF = fmeta(REF, FN); GATE = bool((mF or {}).get("verify_jwt"))
if sF != 200: bad("hr-alerts is not live (Desktop 965)")
else:
    okL, livef = live_files(REF, FN)
    if not okL: bad("could not read the live hr-alerts")
    elif not LIVE_SHAS: bad("the launcher has no reviewed copy of hr-alerts. Tell Claude.")
    elif livef != LIVE_SHAS: bad(f"the live hr-alerts is not what Claude reviewed ({len(set(livef.items()) ^ set(LIVE_SHAS.items()))} difference(s)), so it was not replaced. Tell Claude.")
    else: say(f"  ✓ the live hr-alerts is exactly what Claude reviewed (gateway sign-in check {'on' if GATE else 'off'}, kept)")
K = keys(); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); HIDE.extend([ANON, SVC])
if not (ANON and SVC): bad("could not read the project's keys (the proof needs them)")
say(f"  · {WU_BEFORE['n'] if WU_BEFORE else '?'} write-up(s) on file; none is changed by this step.")
say("  · what changes: the reminder rule and its daily run (counts only while off), hr-alerts redeployed. No switch is turned on; nothing is sent.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
CHECK = """
do $v$ begin
  if not exists (select 1 from pg_trigger where tgname = 'hr_sop_after_save' and not tgisinternal) then raise exception '990 self-check: the after-save trigger is missing'; end if;
  if public.hr_add_business_days('2026-10-16'::date, 1) <> '2026-10-19'::date then raise exception '990 self-check: business days are wrong'; end if;
end $v$;"""
good, r = sql(REF, "begin;\n" + open(os.path.join(HERE, "hr_sop_reminders.sql")).read() + CHECK + "\ncommit;")
if not good: bad(f"the reminders did not go in, so nothing changed: {str(r)[:300]}"); say("  RESULT: STOPPED. Tell Claude."); done(5)
say("  ✓ the reminder rule is in (it only counts while reminders are off)")
sql(REF, f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
ok, r = sql(REF, f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, 'select public.hr_sop_reminders();') as id")
ok2, jb = sql(REF, f"select schedule from cron.job where jobname = {lit(JOB)}")
say("  ✓ it runs every morning at 7:55 Central (6:55 in winter), before the 8am alerts") if ok and ok2 and jb and jb[0]["schedule"] == SCHEDULE else bad("the daily schedule did not go in")
if not deploy(REF, FNROOT, FN, GATE): say("  RESULT: STOPPED at the deploy. The reminder rule is in (it only counts). Tell Claude."); done(6)
ok, ft = sql(REF, "select public.hr_sop_reminders() as r")
fr = (ft[0]["r"] if ok and ft else None) or {}
if isinstance(fr, str): fr = json.loads(fr)
say(f"  ✓ a first run, counting only: {fr.get('due_today', 0)} step(s) due today and {fr.get('overdue', 0)} overdue across the write-ups on file") if ok and fr.get("live") is False else bad(f"the first run did not count as expected: {ft}")

say(); say("PART 3 · PROOF (pretend switched on, all undone; nothing is sent)")
ok, pr = sql(REF, """do $p$ declare t date := (now() at time zone 'America/Chicago')::date; res text := ''; ti text; st text; w jsonb;
  c3 date; begin
  update public.app_data set data = data || '{"hr_sop_reminders_live": true}'::jsonb where key = 'ops_settings';
  c3 := t; while public.hr_business_days(c3, t) < 3 loop c3 := c3 - 1; end loop;
  w := jsonb_build_object('id', 'probe990', 'caregiver', 'Probe Person', 'level', 'Verbal Warning', 'status', 'draft', 'created_at', c3::text || 'T15:00:00Z');
  perform public.upsert_app_data_item('discipline_actions', w);
  select e->>'title' into ti from public.app_data, jsonb_array_elements(data) e where key = 'ops_items' and e->>'id' = 'ops_wu_step_probe990' and e->>'status' = 'open';
  res := res || 'facts=' || coalesce((ti like 'Write-up, check the facts: Probe P.')::int, 0) || ';';
  w := w || jsonb_build_object('facts_checked_at', now()); perform public.upsert_app_data_item('discipline_actions', w);
  select e->>'title' into ti from public.app_data, jsonb_array_elements(data) e where key = 'ops_items' and e->>'id' = 'ops_wu_step_probe990' and e->>'status' = 'open';
  res := res || 'decide=' || coalesce((ti like 'Write-up, decide it:%')::int, 0) || ';';
  w := w || jsonb_build_object('status', 'approved', 'approved_at', (t - 1)::text || 'T15:00:00Z'); perform public.upsert_app_data_item('discipline_actions', w);
  select e->>'status' into st from public.app_data, jsonb_array_elements(data) e where key = 'ops_items' and e->>'id' = 'ops_wu_step_probe990';
  res := res || 'notyet=' || coalesce((st = 'done')::int, 0) || ';';
  w := w || jsonb_build_object('approved_at', (t - 10)::text || 'T15:00:00Z'); perform public.upsert_app_data_item('discipline_actions', w);
  select e->>'title' into ti from public.app_data, jsonb_array_elements(data) e where key = 'ops_items' and e->>'id' = 'ops_wu_step_probe990' and e->>'status' = 'open';
  res := res || 'meet=' || coalesce((ti like 'Write-up, meet with them%')::int, 0) || ';';
  w := w || jsonb_build_object('status', 'issued', 'issued_at', (t - 31)::text || 'T15:00:00Z'); perform public.upsert_app_data_item('discipline_actions', w);
  select e->>'title' into ti from public.app_data, jsonb_array_elements(data) e where key = 'ops_items' and e->>'id' = 'ops_wu_step_probe990' and e->>'status' = 'open';
  res := res || 'follow=' || coalesce((ti like 'Write-up, 30-day follow-up:%')::int, 0) || ';';
  w := w || jsonb_build_object('followup_at', now()); perform public.upsert_app_data_item('discipline_actions', w);
  select e->>'status' into st from public.app_data, jsonb_array_elements(data) e where key = 'ops_items' and e->>'id' = 'ops_wu_step_probe990';
  res := res || 'closed=' || coalesce((st = 'done')::int, 0) || ';';
  select (e->>'sensitive') || ',' || (e->>'owner') into st from public.app_data, jsonb_array_elements(data) e where key = 'ops_items' and e->>'id' = 'ops_wu_step_probe990';
  res := res || 'private=' || coalesce((st = 'true,' || public.hr_lead_email())::int, 0) || ';';
  raise exception 'PROBE_RESULT:%', res; end $p$;""")
m_ = re.search(r"PROBE_RESULT:([a-z0-9_=; ]*)", str(pr)) if not ok else None
p = dict(kv.split("=") for kv in m_.group(1).split(";") if "=" in kv) if m_ else None
if p is None: bad(f"the proof did not run: {str(pr)[:300]}")
else:
    steps = [("facts", "3 business days in with no facts checked: \"check the facts\""), ("decide", "facts checked: the reminder moves to \"decide it\""),
             ("notyet", "approved yesterday: no reminder until the meeting is due"), ("meet", "approved 10 days ago: \"meet with them and get it signed or refused\""),
             ("follow", "issued 31 days ago: \"30-day follow-up\""), ("closed", "the follow-up recorded: the reminder closes itself"), ("private", "it is a private card for Zach")]
    for k_, words in steps: say(f"  ✓ {words}") if p.get(k_) == "1" else bad(f"the practice write-up step '{k_}' did not behave")
ok, wa = sql(REF, WU_Q)
say(f"  ✓ every write-up is exactly as before ({wa[0]['n']}) and reminders are still off") if ok and wa and WU_BEFORE and wa[0]["h"] == WU_BEFORE["h"] else bad("the write-ups changed during this step")
s4, b4 = http("POST", f"{FNB}/functions/v1/{FN}?dry=1", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
try: j4 = json.loads(b4)
except Exception: j4 = {}
say(f"  ✓ Zach's alert job still answers (a look, nothing sent): {j4.get('waiting', 0)} HR item(s) waiting") if s4 == 200 and j4.get("ok") else bad(f"hr-alerts answered {s4}: {str(b4)[:200]}")
say("  · tested before this ran: the alert rules (45 checks), the follow-up button (6), this step against a local copy of the database (see hr_sop_990_test.py).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE. Tell Claude."); done(9)
say("RESULT: DONE · SOP reminders are in, in practice (they only count until build step 10). Tell Claude, who merges the Hub change next.")
say("Undo: Claude can unschedule hr-sop-reminders and drop its trigger; nothing else changes.")
done(0)
