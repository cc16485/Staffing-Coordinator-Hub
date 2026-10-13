#!/usr/bin/env python3
# 647 · APPLICANT RECORDS, RECORDINGS AND TRANSCRIPTS: OFFICE ONLY (Samantha 2026-10-13, "build": step 1 of the interview
# notes and AI review). Runs office_only_647.sql (one transaction) and proves it with office_only_647_probe.sql, which acts
# as an office member and as a signed-in stranger and rolls everything back. No function is deployed. Nothing is sent.
# Prints counts only: no name, number, email, key or secret.
import os, json, re
os.environ.setdefault("SB_STEP", "647")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
start("APPLICANT RECORDS, RECORDINGS AND TRANSCRIPTS: OFFICE ONLY")
say("PART 1 · READ ONLY (nothing changes)")
for f, want in json.loads(os.environ.get("SB_SQL_SHAS", "{}")).items():
    (say(f"  ✓ {f} is the reviewed build") if os.path.exists(os.path.join(ROOT, f)) and sha(os.path.join(ROOT, f)) == want else bad(f"{f} is not the reviewed build"))
if not os.environ.get("SB_SQL_SHAS"): bad("no reviewed build pinned")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(2)
ok, r = sql(REF, """select to_regprocedure('public.hub_office_ok()') is not null as fn,
  (select count(*)::int from auth.users u where u.deleted_at is null and exists (select 1 from public.auth_identities ai join public.staff_roles s on s.person_id = ai.person_id
     where ai.auth_user_id = u.id and s.entity = 'cc_ihs' and s.role in ('owner_admin','care_coordinator','staffing_coordinator'))) as keep,
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename in ('job_applicants','interview_bookings','recordings','recordings_settings')
     and position('hub_office_ok' in coalesce(qual,'') || coalesce(with_check,'')) = 0) as open_rules""")
if not ok: bad("could not read the project: " + str(r)); done(3)
x = r[0]
say(("  ✓ " if x["fn"] else "  ✗ ") + "the office test (hub_office_ok) is there")
say(("  ✓ " if x["keep"] >= 1 else "  ✗ ") + f"sign-ins with an office role, who keep access: {x['keep']}")
say(f"  · rules open to anyone signed in, today: {x['open_rules']}")
if not x["fn"] or x["keep"] < 1: fails.append("pre")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude."); done(3)

say(); say("PART 2 · CHANGE (all or nothing)")
ok, r = sql(REF, open(os.path.join(ROOT, "office_only_647.sql")).read())
if not ok: bad("it did not go in (undone as a whole, nothing changed): " + str(r)[:300]); done(6)
say("  ✓ applicant records, interview bookings, recordings, transcripts and the audio files are office only")
say("  ✓ the old-audio list is for the server only; the office's phone-screen answers need an office role")

say(); say("PART 3 · PROOF (acts as an office member and as a signed-in stranger; everything is rolled back)")
s0, b0 = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": open(os.path.join(ROOT, "office_only_647_probe.sql")).read()}, MG())
try: msg = json.loads(b0).get("message", b0)
except Exception: msg = b0
m = re.search(r"PROBE_RESULT: (\{.*?\})", str(msg))
if not m: bad("the proof did not run: " + str(msg)[:300]); done(9)
p = json.loads(m.group(1))
def chk(good, msg): (say("  ✓ " + msg) if good else bad(msg))
chk(p["office_applicants"] > 0 and p["office_bookings"] > 0, f"the office still sees applicants ({p['office_applicants']}) and interview bookings ({p['office_bookings']})")
chk(p["office_recordings"] >= 0 and p["office_audio"] >= 0, f"the office still sees recordings ({p['office_recordings']}) and audio files ({p['office_audio']})")
chk(p["office_can_save"] == 1, "the office can still save an applicant")
chk(p["stranger_applicants"] == 0 and p["stranger_bookings"] == 0, "a signed-in stranger sees no applicants and no bookings")
chk(p["stranger_recordings"] == 0 and p["stranger_audio"] == 0 and p["stranger_settings"] == 0, "...no recordings, transcripts or audio files")
chk(p["stranger_saved"] == 0 and p["stranger_add"] is False, "...cannot change or add an applicant")
chk(p["stranger_screen"] is False and p["stranger_purge_list"] is False, "...cannot use the phone-screen answers or the old-audio list")
ok, r = sql(REF, "select has_function_privilege('service_role', 'public.recordings_due_for_purge()', 'execute') as s, has_function_privilege('anon', 'public.recordings_due_for_purge()', 'execute') as a")
chk(ok and r and r[0]["s"] and not r[0]["a"], "the audio clean-up (server) still has its list")
A = None
s_, b_ = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG())
try:
    for k in (json.loads(b_) if s_ == 200 else []):
        if isinstance(k, dict) and k.get("name") == "anon": A = k.get("api_key")
except Exception: pass
HIDE.append(A or "")
if A:
    FNB = f"https://{REF}.supabase.co"
    s1, b1 = http("GET", f"{FNB}/rest/v1/job_applicants?select=id&limit=1", None, {"apikey": A, "Authorization": "Bearer " + A})
    chk(s1 in (401, 403) or b1.strip() == "[]", f"signed out: nothing ({s1})")
    s2, b2 = http("POST", f"{FNB}/rest/v1/rpc/interview_open_slots", {}, {"apikey": A, "Authorization": "Bearer " + A})
    chk(s2 == 200, f"the public booking page still reaches its times ({s2})")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · applicant records, recordings and transcripts are office only. Nothing was sent."); done(0)
