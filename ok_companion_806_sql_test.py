# 806 · the database rules, on a throwaway local Postgres (ok_companion_806_fixture.py). Made-up people only.
#   HUB=<care-coordinator-hub checkout> python3 ok_companion_806_sql_test.py
import os, re, json
from ok_companion_806_fixture import make, as_anon, as_office
HERE = os.path.dirname(os.path.abspath(__file__)); HUB = os.environ.get("HUB", os.path.join(HERE, "..", "cc-hub-live"))
s, sock = make(HUB)
res = []
ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[-900:]))
def load(p):
    s.execute_simple(re.sub(r"^notify .*$", "", open(os.path.join(HERE, p)).read(), flags=re.M))
row = lambda q, **k: (lambda r, c: dict(zip([x["name"] for x in c], r[0])) if r else None)(s.run(q, **k), s.columns)

# a Missouri applicant BEFORE 806, to prove it reads MO afterwards and is untouched
as_anon(s)
mo_old = s.run("""select public.apply_save(null, '{"first_name":"Mo","last_name":"Before","phone":"417-555-0101","email":"mo.before@example.invalid","zip":"65714","position":"caregiver"}'::jsonb, false)""")[0][0]
s.run("""select public.apply_save(:a, '{"age_ok":true,"work_auth":true,"has_transport":true,"one_year":"yes","has_license":true,"has_insurance":true,"can_pass_background":true}'::jsonb, false)""", a=mo_old)
s.run("select public.apply_save(:a, '{\"availability\":\"weekdays\"}'::jsonb, true)", a=mo_old)
before = row("select screen_grade, screen_flags, miles_out from job_applicants where id = :a", a=mo_old)
s.run("insert into early_interest (site, kind, name, phone, email, zip, interests, timing, experience, message, may_contact) values "
      "('oklahoma','caregiver','Okla Listone','405-555-0111','list.one@example.invalid','73099',array['weekdays-all','drives'],'Early 2027','1 to 3 years','I love older folks',true),"
      "('oklahoma','caregiver','Okla Listtwo Smith',null,'list.two@example.invalid','73064',array['weekdays-some'],'When you open in June 2027','None yet, but I''d love to learn',null,true),"
      "('oklahoma','family','Fam Ily','405-555-0113',null,'73064',null,null,null,null,true),"
      "('oklahoma','caregiver','Already There','417-555-0101',null,'73064',null,null,null,null,true),"
      "('oklahoma','caregiver','Notify Only',null,'notify@example.invalid',null,array['email-when-hiring'],null,null,null,true)")

s.run("reset role")
load("ok_companion_806.sql")
ck("806 goes in on top of 731", True)
ck("every existing applicant reads Missouri", s.run("select office from job_applicants where id = :a", a=mo_old)[0][0] == "MO")
ck("the Missouri applicant's grade is unchanged", row("select screen_grade, screen_flags, miles_out from job_applicants where id = :a", a=mo_old) == before, before)
ck("Companion is an Oklahoma position", s.run("select label, office, active from job_positions where key = 'companion'")[0] == ["Companion", "OK", True])
ck("Caregiver stays Missouri", s.run("select office from job_positions where key = 'caregiver'")[0][0] == "MO")

# the Oklahoma form, as the public
as_anon(s)
ok1 = s.run("""select public.apply_save(null, '{"first_name":"Okla","last_name":"Applicant","phone":"405-555-0120","email":"okla.app@example.invalid","zip":"73099","position":"companion","source":"website","channel":"caringcompanionsoklahoma.com","posting_title":"Companion","sms_consent":true}'::jsonb, false)""")[0][0]
ck("a Companion application is Oklahoma from the first save", s.run("select office, status from job_applicants where id = :a", a=ok1)[0] == ["OK", "partial"])
s.run("""select public.apply_save(:a, '{"age_ok":true,"work_auth":true,"can_pass_background":true,"has_transport":true,"has_license":true,"has_insurance":true,"experience_years":"1 to 3 years","availability":"All weekdays, 8am to 6pm","role_answers":{"When can you start":"Spring 2027"}}'::jsonb, false)""", a=ok1)
s.run("select public.apply_save(:a, '{\"experience\":\"Visiting my grandmother\",\"referral_source\":\"Facebook\"}'::jsonb, true)", a=ok1)
g = row("select office, status, screen_grade, screen_flags, miles_out from job_applicants where id = :a", a=ok1)
ck("an Oklahoma applicant from Yukon clears the screen", g["status"] == "new" and g["screen_grade"] == "qualified" and g["screen_flags"] == [], g)
ck("...measured from Mustang (about 10 miles), not Springfield", g["miles_out"] is not None and 5 < float(g["miles_out"]) < 15, g)
s.run("reset role"); as_office(s)
ck("nothing more to ask before an interview", s.run("select public.applicant_screening_gap(:a)", a=ok1)[0][0] is None)

# the form cannot choose the office
as_anon(s)
mo2 = s.run("""select public.apply_save(null, '{"first_name":"Sneaky","phone":"417-555-0130","position":"caregiver","office":"OK"}'::jsonb, false)""")[0][0]
ck("an 'office' sent by the form is ignored (Caregiver stays Missouri)", s.run("select office from job_applicants where id = :a", a=mo2)[0][0] == "MO")
nop = s.run("""select public.apply_save(null, '{"first_name":"Nopos","phone":"417-555-0131"}'::jsonb, false)""")[0][0]
ck("no position: Missouri", s.run("select office from job_applicants where id = :a", a=nop)[0][0] == "MO")
s.run("reset role")
try: s.run("update job_applicants set office = 'OK' where id = :a", a=mo2); t = s.run("select office from job_applicants where id = :a", a=mo2)[0][0]
except Exception as e: t = str(e)
ck("typing the office directly does not move anyone (only the position does)", t == "MO", t)
s.run("update job_applicants set position = 'companion' where id = :a", a=mo2)
ck("changing the position to Companion moves them to Oklahoma", s.run("select office from job_applicants where id = :a", a=mo2)[0][0] == "OK")
s.run("update job_applicants set position = 'caregiver' where id = :a", a=mo2)
ck("...and back to Caregiver moves them to Missouri", s.run("select office from job_applicants where id = :a", a=mo2)[0][0] == "MO")

# flags that never hold anyone back in Oklahoma, and the ones that do
as_anon(s)
ok2 = s.run("""select public.apply_save(null, '{"first_name":"Okla","last_name":"Nodrive","phone":"405-555-0121","zip":"73064","position":"companion"}'::jsonb, false)""")[0][0]
s.run("""select public.apply_save(:a, '{"age_ok":true,"work_auth":true,"can_pass_background":true,"has_transport":false,"experience_years":"Less than 1 year","lived_outside_mo":true}'::jsonb, false)""", a=ok2)
s.run("select public.apply_save(:a, '{}'::jsonb, true)", a=ok2)
g2 = row("select screen_grade, screen_flags from job_applicants where id = :a", a=ok2)
ck("won't drive + under a year: both flagged, still qualified (her decisions 2 and 4)", g2["screen_grade"] == "qualified"
   and set(g2["screen_flags"]) == {"won't drive clients", "under a year of experience"}, g2)
ck("'lived outside Missouri' is never flagged for Oklahoma", not any("Missouri" in f for f in g2["screen_flags"]), g2)
s.run("reset role"); as_office(s)
ck("no transport is not ineligible in Oklahoma", s.run("select public.applicant_screening_gap(:a)", a=ok2)[0][0] is None)
as_anon(s)
ok3 = s.run("""select public.apply_save(null, '{"first_name":"Okla","last_name":"Far","phone":"405-555-0122","zip":"74103","position":"companion"}'::jsonb, false)""")[0][0]
s.run("""select public.apply_save(:a, '{"age_ok":true,"work_auth":true,"can_pass_background":true,"has_transport":true}'::jsonb, false)""", a=ok3)
s.run("select public.apply_save(:a, '{}'::jsonb, true)", a=ok3)
g3 = row("select screen_grade, screen_flags from job_applicants where id = :a", a=ok3)
ck("a ZIP outside the Oklahoma area: Needs a look", g3["screen_grade"] == "review" and "zip we do not cover, check where they are" in g3["screen_flags"], g3)
ok4 = s.run("""select public.apply_save(null, '{"first_name":"Okla","last_name":"Noscreen","phone":"405-555-0123","zip":"73064","position":"companion"}'::jsonb, false)""")[0][0]
s.run("""select public.apply_save(:a, '{"age_ok":true,"work_auth":true,"can_pass_background":false,"decline_reason":"would not agree to the OKSCREEN fingerprint check"}'::jsonb, false)""", a=ok4)
s.run("reset role"); as_office(s)
ck("no to OKSCREEN: declined and ineligible", s.run("select status, public.applicant_screening_gap(id) from job_applicants where id = :a", a=ok4)[0] == ["declined", "ineligible"])
ck("a Missouri applicant still needs transport (731 unchanged)",
   s.run("select public.applicant_screening_gap(:a)", a=nop)[0][0] == "questions")

# the office's Oklahoma questions
as_anon(s)
ok5 = s.run("""select public.apply_save(null, '{"first_name":"Okla","last_name":"Partial","phone":"405-555-0124","zip":"73064","position":"companion"}'::jsonb, false)""")[0][0]
s.run("reset role"); as_office(s)
ck("a half-finished Oklahoma application has questions to ask", s.run("select public.applicant_screening_gap(:a)", a=ok5)[0][0] == "questions")
ck("the office answers the Oklahoma three", s.run("select public.applicant_screen_by_office_ok(:a, true, true, true)", a=ok5)[0][0] is None)
try: s.run("select public.applicant_screen_by_office_ok(:a, true, true, false)", a=ok5); t = "changed"
except Exception as e: t = str(e)
ck("...and an answer already given can't be changed", "SCREENING_LOCKED" in t, t)
try: s.run("select public.applicant_screen_by_office_ok(:a, true, true, true)", a=nop); t = "saved"
except Exception as e: t = str(e)
ck("the Oklahoma office screen refuses a Missouri application", "not an Oklahoma application" in t, t)
as_anon(s)
try: s.run("select public.applicant_screen_by_office_ok(:a, true, true, true)", a=ok5); t = "saved"
except Exception as e: t = str(e)
ck("the public can't use it", "office staff only" in t or "permission" in t, t)

# the hold
s.run("reset role")
stop = lambda a: s.run("select public.applicant_followup_stop(:a)", a=a)[0][0]
ck("follow-ups: an Oklahoma applicant gets none", stop(ok1) == "Oklahoma applicant: messages held")
ck("follow-ups: a Missouri applicant is exactly as before", stop(nop) != "Oklahoma applicant: messages held")
hold = lambda ph, em: s.run("select public.ok_applicant_hold(:p, :e, 'interview-messages', 'sms')", p=ph, e=em)[0][0]
ck("hold: the Oklahoma applicant's phone", hold("+14055550120", None) is True)
ck("hold: the Oklahoma applicant's email (any case)", hold(None, "OKLA.APP@example.invalid") is True)
h = row("select msgs_held_at, msgs_held_note from job_applicants where id = :a", a=ok1)
ck("hold: marked on their record for the Hub", h["msgs_held_at"] is not None and "Oklahoma applicant messages are off" in h["msgs_held_note"], h)
ck("hold: a Missouri applicant is never held", hold("4175550101", "mo.before@example.invalid") is False)
ck("hold: somebody we don't know is not held", hold("4175559999", "nobody@example.invalid") is False)
s.run("update job_applicants set position = 'companion' where id = :a", a=mo2)       # an MO person who later applies in Oklahoma...
as_anon(s)
again = s.run("""select public.apply_save(null, '{"first_name":"Mo","last_name":"Before","phone":"417-555-0101","position":"companion"}'::jsonb, false)""")[0][0]
s.run("reset role")
ck("hold: their latest application decides (now Oklahoma)", hold("4175550101", None) is True)
s.run("update app_data set data = data || '{\"ok_applicant_msgs_live\": true}' where key = 'ops_settings'")
ck("switch on: nothing is held", hold("+14055550120", None) is False and stop(ok1) != "Oklahoma applicant: messages held")
s.run("update app_data set data = data - 'ok_applicant_msgs_live' where key = 'ops_settings'")
for r_ in ["anon", "authenticated"]:
    s.run(f"set role {r_}")
    try: s.run("select public.ok_applicant_hold('4055550120', null, null, null)"); t = "ran"
    except Exception as e: t = str(e)
    s.run("reset role")
    ck(f"hold: {r_} can't call it", "permission" in t, t)

# the move
cnt = s.run("select public.ok_companion_move(false)")[0][0]
cnt = json.loads(cnt) if isinstance(cnt, str) else cnt
ck("move (count only): 2 to move, 1 already in the Hub, the family left alone", cnt == {"to_move": 2, "moved": 0, "already_in_hub": 1}, cnt)
ck("...and the count changed nothing", s.run("select count(*) from early_interest where moved_applicant_id is not null")[0][0] == 0)
mv = s.run("select public.ok_companion_move(true)")[0][0]; mv = json.loads(mv) if isinstance(mv, str) else mv
ck("move: 2 moved", mv == {"to_move": 2, "moved": 2, "already_in_hub": 1}, mv)
m1 = row("""select a.office, a.position, a.status, a.sms_consent, a.first_name, a.last_name, a.availability, a.has_transport, a.experience_years,
           a.role_answers, a.notes, a.source, a.screen_grade from job_applicants a join early_interest e on e.moved_applicant_id = a.id where e.name = 'Okla Listone'""")
ck("moved: an Oklahoma Companion, call only (no text consent)", m1["office"] == "OK" and m1["position"] == "companion" and m1["status"] == "new" and m1["sms_consent"] is False, m1)
ck("moved: their answers land in the Hub's own fields", m1["first_name"] == "Okla" and m1["last_name"] == "Listone" and m1["availability"] == "All weekdays, 8am to 6pm"
   and m1["has_transport"] is True and m1["experience_years"] == "1 to 3 years" and m1["notes"] == "I love older folks" and m1["source"] == "ok-opening-list", m1)
ck("moved: their start timing is kept", (json.loads(m1["role_answers"]) if isinstance(m1["role_answers"], str) else m1["role_answers"]).get("When can you start") == "Early 2027", m1)
m2 = row("select a.last_name, a.screen_grade, a.screen_flags from job_applicants a join early_interest e on e.moved_applicant_id = a.id where e.name = 'Okla Listtwo Smith'")
ck("moved: a two-word last name stays whole", m2["last_name"] == "Listtwo Smith", m2)
ck("moved: the person already in the Hub is linked, not added twice",
   s.run("select count(*) from job_applicants where right(regexp_replace(coalesce(phone,''),'\\D','','g'),10) = '4175550101'")[0][0] == 2
   and s.run("select moved_applicant_id is not null from early_interest where name = 'Already There'")[0][0] is True)
ck("moved: the family on the list is left alone", s.run("select moved_applicant_id from early_interest where kind = 'family'")[0][0] is None)
ck("moved: an 'Email me when hiring opens' sign-up stays on the list (not an application)", s.run("select moved_applicant_id from early_interest where name = 'Notify Only'")[0][0] is None
   and s.run("select count(*) from job_applicants where lower(email) = 'notify@example.invalid'")[0][0] == 0)
mv2 = s.run("select public.ok_companion_move(true)")[0][0]; mv2 = json.loads(mv2) if isinstance(mv2, str) else mv2
ck("move twice: nothing more happens", mv2 == {"to_move": 0, "moved": 0, "already_in_hub": 0}, mv2)

# rollback
load("ok_companion_806_rollback.sql")
ck("rollback: the office no longer follows the position", s.run("select count(*) from pg_trigger where tgname = 'job_applicants_office_from_position'")[0][0] == 0)
ck("rollback: Companion retired", s.run("select active from job_positions where key = 'companion'")[0][0] is False)
ck("rollback: the hold is kept (the senders ask it)", s.run("select count(*) from pg_proc where proname = 'ok_applicant_hold'")[0][0] == 1)
ck("rollback: 731's gap is back (a Missouri half-application still has questions)", s.run("select public.applicant_screening_gap(:a)", a=nop)[0][0] == "questions")
load("ok_companion_806.sql")
ck("806 goes in again after a rollback", s.run("select count(*) from pg_trigger where tgname = 'job_applicants_office_from_position'")[0][0] == 1)

for n, ok, note in res: print(("PASS  " if ok else "FAIL  ") + n + ("" if ok else "\n    " + note))
p = sum(1 for _, ok, _ in res if ok); print(f"ALL {len(res)} CHECKS PASS" if p == len(res) else f"{len(res) - p} OF {len(res)} FAILED")
raise SystemExit(0 if p == len(res) else 1)
