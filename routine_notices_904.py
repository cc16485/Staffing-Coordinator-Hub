#!/usr/bin/env python3
# 904 · ROUTINE NOTICES GO TO THE WORK AREA OWNER, NOT A NAME IN THE CODE (SOP ruling 8, Samantha 2026-10-17: "Yes, but I want
# owners to see all work and who has it, dont keep any cards from me"; plan claude.ai/artifact/YG7kXm9XaG5h2qo4U9VJH3).
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass; then it reads, and writes in the
#     report, who each routine notice will go to now (the work area owners, the Springfield lead, the Referral Desk default).
#  2. Deploys the server pieces that use the changed files: the website booking, star check-ins, stories, Caregivers Corner,
#     417 and campaign autopilot notices (each now goes to the work area owner, then the Springfield lead, then Samantha, and
#     leaves a card with that person's name), and the pieces whose empty alert list used to fall back to Samantha by name.
#     Each keeps its gateway setting.
#  3. Proves each piece still refuses a caller with no key.
# Sends nothing. No database change. Safe to run again.
import json, os, subprocess, shutil
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, deploy, start, check_build, fmeta, sql

HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
FNS = ["cc-booking", "cc-feedback", "cc-story", "cc-corner", "cc-417", "campaign-auto", "lead-intake", "care-packet-watch",
       "coverage-watch", "coverage-run", "staff-contacts-check",
       # these only share _shared/clockin-admins.ts (the missed clock-in list); their own code is unchanged
       "callin-alert", "care-notes", "clockin-alert", "coverage-assign", "coverage-reply", "late-alert", "late-watch", "lead-watch", "timekeeper-watch"]
TESTS = ("routine_notices_test.mjs", "campaign_auto_hold_test.mjs", "care_packet_watch_test.mjs", "nsf2_families_test.mjs", "late_l1_test.mjs",
         "staff_contacts_test.mjs", "referral_intake_test.mjs", "callin_test.mjs", "ci1_test.mjs", "waves_retired_test.mjs")
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)

start("ROUTINE NOTICES GO TO THE WORK AREA OWNER")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = []
for k in sorted(set().union(*[L.need(FNROOT, fn) for fn in FNS])):
    c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
    if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE:
    for t in TESTS:
        c, o = run([NODE, t], cwd=ROOT)
        last = (o.strip().splitlines() or ["(no output)"])[-1]
        if c != 0: stop(f"{t} failed: {last}")
        ok(f"{t}: {last.strip()} (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")

okw, rows = sql(HUB, """select jsonb_build_object(
  'areas', (select coalesce(jsonb_object_agg(d.code, coalesce(p.full_name, p.primary_email)), '{}'::jsonb) from public.domains d
            left join public.persons p on p.person_id = d.owner_person and p.active is not false
            where d.entity = 'cc_ihs' and d.code in ('family_enquiries', 'client_care', 'caregivers', 'scheduling_coverage')),
  'lead', (select coalesce(jsonb_agg(coalesce(p.full_name, p.primary_email) order by p.primary_email), '[]'::jsonb) from public.staff_roles r
           join public.persons p on p.person_id = r.person_id and p.active is not false where r.entity = 'cc_ihs' and r.role = 'springfield_lead'),
  'alerts', (select data->'coverage_alert_admins' from public.app_data where key = 'ops_settings')) as who""")
if not okw: stop(f"couldn't read the work areas and roles ({str(rows)[:200]})", 3)
W = rows[0]["who"] if isinstance(rows[0]["who"], dict) else json.loads(rows[0]["who"])
A = W.get("areas") or {}; lead = (W.get("lead") or [None])[0]
first = lambda *xs: next((x for x in xs if x), "Samantha (nobody else is set)")
say("  · who each routine notice goes to after this step:")
say(f"      website consult bookings: {first(A.get('family_enquiries'), lead)}")
say(f"      star check-ins and low ratings (with a card): {first(A.get('client_care'), lead)}")
say(f"      Caregiver of the Year nominations: {first(A.get('caregivers'), lead)}")
say(f"      stories, Caregivers Corner, campaign autopilot (with cards): {first(lead)}")
say(f"      417 Caring Community (with cards): {first(lead)}")
al = W.get("alerts") or []
say(f"      call-in alerts: {', '.join(al) if al else 'the list is empty, so ' + first(A.get('scheduling_coverage'), lead) + ' and the lead'}")
if not lead: say("  · there is no Springfield lead yet (run 897 first), so anything without a work area owner still goes to Samantha")
gate = {}
for fn in FNS:
    s, m = fmeta(HUB, fn)
    if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})", 3)
    gate[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate[fn] else 'off'} (kept)")

say(); say("PART 2 · CHANGE")
for fn in FNS:
    if not deploy(HUB, FNROOT, fn, gate[fn]): say("  STOP. Tell Claude. (Anything above this line is in; the rest is unchanged.)"); done(5)

say(); say("PART 3 · PROOF")
for fn in FNS:
    s, b = http("POST", f"{FNB}/functions/v1/{fn}", {})
    chk(s is not None and s != 200 and s < 500, f"{fn}: a caller with no key gets nothing ({s})", f"{fn} answered a caller with no key ({s})")
say()
say("  904: " + ("DONE. Routine notices now go to the work area owner, then the Springfield lead, and each one that needs action is a card with that person's name, so owners see it under Everyone. Nothing was sent." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
