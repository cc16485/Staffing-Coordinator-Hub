# 808 · the two Oklahoma switches in the database, on a throwaway local Postgres (806's fixture with 806 installed).
# Made-up people only.   HUB=<care-coordinator-hub checkout> python3 ok_messages_808_sql_test.py
import os, re, json
from ok_companion_806_fixture import make, as_anon
HERE = os.path.dirname(os.path.abspath(__file__)); HUB = os.environ.get("HUB", os.path.join(HERE, "..", "cc-hub-live"))
s, sock = make(HUB)
res = []
ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[-900:]))
load = lambda p: s.execute_simple(re.sub(r"^notify .*$", "", open(os.path.join(HERE, p)).read(), flags=re.M))
load("ok_companion_806.sql")
s.run("update app_data set data = data || '{\"ok_from_number\": \"+14059999999\"}' where key = 'ops_settings'")   # set by her before: must survive
as_anon(s)
ok1 = s.run("""select public.apply_save(null, '{"first_name":"Okla","phone":"405-555-0120","email":"okla@example.invalid","zip":"73099","position":"companion"}'::jsonb, false)""")[0][0]
mo1 = s.run("""select public.apply_save(null, '{"first_name":"Mo","phone":"417-555-0101","position":"caregiver"}'::jsonb, false)""")[0][0]
s.run("reset role")
load("ok_messages_808.sql")
ops = lambda: (lambda d: json.loads(d) if isinstance(d, str) else d)(s.run("select data from app_data where key = 'ops_settings'")[0][0])
o = ops()
ck("808 adds both switches OFF", o.get("ok_applicant_office_msgs_live") is False and o.get("ok_applicant_auto_msgs_live") is False, o)
ck("...and keeps a number she already set (never overwritten)", o.get("ok_from_number") == "+14059999999", o)
ck("...and keeps every other setting", o.get("applicant_msgs_v2_live") is True, o)
OFFICE = ["send-candidate-message (office text)", "send-candidate-message (interview cancelled)", "send-candidate-message (applicant decision)", "applicant-noshow"]
OTHER = ["reference-chase", "step2-handoff", "outreach-check", None, "welcome-call", "caregiver-journey"]
hold = lambda sender, ph="+14055550120": s.run("select public.ok_applicant_hold(:p, null, :s, 'sms')", p=ph, s=sender)[0][0]
setsw = lambda k, v: s.run(f"update app_data set data = data || jsonb_build_object('{k}', {str(v).lower()}) where key = 'ops_settings'")
ck("both off: every sender is held for an Oklahoma applicant", all(hold(x) for x in OFFICE + ["interview-messages"] + OTHER))
ck("...a Missouri applicant is never held", not any(hold(x, "4175550101") for x in OFFICE + ["interview-messages"] + OTHER))
setsw("ok_applicant_office_msgs_live", True)
ck("office switch on: the office's buttons go through", not any(hold(x) for x in OFFICE))
ck("...the automatic interview messages are still held", hold("interview-messages") is True)
note = s.run("select msgs_held_note from job_applicants where id = :a", a=ok1)[0][0]
ck("...and the record says which switch held it", "Oklahoma interview messages are off" in (note or ""), note)
ck("...references, Step 2, offers, Training and the rest stay held", all(hold(x) for x in OTHER))
setsw("ok_applicant_office_msgs_live", False); setsw("ok_applicant_auto_msgs_live", True)
ck("interview switch on: interview messages go through, the office buttons are held", hold("interview-messages") is False and all(hold(x) for x in OFFICE))
setsw("ok_applicant_office_msgs_live", True)
ck("both on: the rest still held (not set up for Oklahoma yet)", all(hold(x) for x in OTHER))
hold("reference-chase")
note = s.run("select msgs_held_note from job_applicants where id = :a", a=ok1)[0][0]
ck("...and the record says so", "not set up for Oklahoma yet" in (note or ""), note)
ck("the old 806 switch no longer lets anything through", (setsw("ok_applicant_msgs_live", True), hold("reference-chase"))[1] is True)
stop = s.run("select public.applicant_followup_stop(:a)", a=ok1)[0][0]
ck("follow-ups: never for an Oklahoma applicant, whatever the switches say", stop == "Oklahoma applicant: the recruiter calls (no automatic follow-ups)", stop)
ck("...Missouri unchanged", s.run("select public.applicant_followup_stop(:a)", a=mo1)[0][0] != stop)
# driving is required (her rule, relayed 2026-10-16)
as_anon(s)
d1 = s.run("""select public.apply_save(null, '{"first_name":"Okla","last_name":"Drive","phone":"405-555-0130","zip":"73064","position":"companion"}'::jsonb, false)""")[0][0]
s.run("""select public.apply_save(:a, '{"age_ok":true,"work_auth":true,"can_pass_background":true,"experience_years":"Less than 1 year"}'::jsonb, false)""", a=d1)
s.run("reset role")
gap = lambda a: s.run("select public.applicant_screening_gap(:a)", a=a)[0][0]
ck("driving: not answered yet = a question to ask", gap(d1) == "questions")
as_anon(s); s.run("""select public.apply_save(:a, '{"has_transport":false}'::jsonb, true)""", a=d1); s.run("reset role")
ck("driving: a no = not eligible", gap(d1) == "ineligible")
g = s.run("select screen_grade, screen_flags from job_applicants where id = :a", a=d1)[0]
ck("...and the screen no longer passes it as qualified", g[0] == "review" and "won't drive clients (every Companion drives)" in g[1], g)
as_anon(s)
d2 = s.run("""select public.apply_save(null, '{"first_name":"Okla","last_name":"Drives","phone":"405-555-0131","zip":"73064","position":"companion"}'::jsonb, false)""")[0][0]
s.run("""select public.apply_save(:a, '{"age_ok":true,"work_auth":true,"can_pass_background":true,"has_transport":true,"experience_years":"Less than 1 year"}'::jsonb, true)""", a=d2)
s.run("reset role")
ck("driving yes + under a year: qualified, nothing more to ask", gap(d2) is None and s.run("select screen_grade from job_applicants where id = :a", a=d2)[0][0] == "qualified")
from ok_companion_806_fixture import as_office
as_anon(s); d3 = s.run("""select public.apply_save(null, '{"first_name":"Okla","last_name":"Phone","phone":"405-555-0132","position":"companion"}'::jsonb, false)""")[0][0]; s.run("reset role")
as_office(s)
ck("the office's Oklahoma questions include driving (four answers)", s.run("select public.applicant_screen_by_office_ok(:a, true, true, true, true)", a=d3)[0][0] is None)
s.run("reset role")
for r_ in ["anon", "authenticated"]:
    s.run(f"set role {r_}")
    try: s.run("select public.ok_applicant_hold('4055550120', null, null, null)"); t = "ran"
    except Exception as e: t = str(e)
    s.run("reset role")
    ck(f"{r_} still can't call the hold", "permission" in t, t)
load("ok_messages_808_rollback.sql")
setsw("ok_applicant_msgs_live", False)
ck("rollback: 806's single switch is back (office sends held again)", hold(OFFICE[0]) is True)
ck("rollback: 806's follow-up stop is back", s.run("select public.applicant_followup_stop(:a)", a=ok1)[0][0] == "Oklahoma applicant: messages held")
load("ok_messages_808.sql")
ck("808 goes in again after a rollback, the switches as she left them", ops().get("ok_applicant_office_msgs_live") is True)
for n, ok, note in res: print(("PASS  " if ok else "FAIL  ") + n + ("" if ok else "\n    " + note))
p = sum(1 for _, ok, _ in res if ok); print(f"ALL {len(res)} CHECKS PASS" if p == len(res) else f"{len(res) - p} OF {len(res)} FAILED")
raise SystemExit(0 if p == len(res) else 1)
