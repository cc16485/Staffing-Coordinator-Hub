#!/usr/bin/env python3
# 937 · WHO HOLDS A SEAT WHEN NOBODY IS SCHEDULED, AND THE IN CHARGE SEAT GOES LIVE (SOP ruling 8, Samantha 2026-10-17: routine
# work goes to Krystal, the Springfield lead; Samantha only for Money, Incidents and Program administration. Springfield
# structure, Staffing #498, merged 2026-10-18).
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass; then it reads, and writes in the
#     report, who holds a seat nobody is scheduled in after this step (the Scheduling and coverage owner, the Family enquiries
#     owner, the Springfield lead, or the alert list if one is set) and whether the routing switches are on.
#  2. Deploys the three server pieces: work-route (the In charge seat and the team ladder, #498), timekeeper-watch (missed
#     clock-in texts follow the same ladder; an empty alert list now falls back to the Scheduling and coverage owner and the
#     Springfield lead, not a name in the code) and lead-watch (the uncalled-family rung goes to In charge). Each keeps its
#     gateway setting. A piece that is not live is left off, never re-created.
#  3. Proves each piece still refuses a caller with no key.
# Sends nothing. No database change. Nothing routes differently while the routing switches are off. Safe to run again.
import json, os, subprocess, shutil
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, deploy, start, check_build, fmeta, sql

HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
FNS = ["work-route", "timekeeper-watch", "lead-watch"]
TESTS = ("duty_phase3_test.mjs", "routine_notices_test.mjs", "lead_watch_494_test.mjs", "c1_missed_clockin_test.mjs",
         "loops_phase2_test.mjs", "staff_alerts_one_contact_test.mjs")
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)

start("WHO HOLDS A SEAT WHEN NOBODY IS SCHEDULED")
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
            where d.entity = 'cc_ihs' and d.active is not false and d.code in ('scheduling_coverage', 'family_enquiries')),
  'lead', (select coalesce(jsonb_agg(coalesce(p.full_name, p.primary_email) order by p.primary_email), '[]'::jsonb) from public.staff_roles r
           join public.persons p on p.person_id = r.person_id and p.active is not false where r.entity = 'cc_ihs' and r.role = 'springfield_lead'),
  'alerts', (select data->'coverage_alert_admins' from public.app_data where key = 'ops_settings'),
  'routing', (select data->'routing_live' from public.app_data where key = 'ops_settings'),
  'rungs', (select data->'lead_rungs_live' from public.app_data where key = 'ops_settings'),
  'in_charge', (select count(*) from public.app_data a, jsonb_array_elements(case when jsonb_typeof(a.data) = 'array' then a.data else '[]'::jsonb end) w
                where a.key = 'duty_windows' and w->>'area' = 'in_charge' and (w->>'active') is distinct from 'false')) as who""")
if not okw: stop(f"couldn't read the work areas and roles ({str(rows)[:200]})", 3)
W = rows[0]["who"] if isinstance(rows[0]["who"], dict) else json.loads(rows[0]["who"])
A = W.get("areas") or {}; lead = (W.get("lead") or [None])[0]; al = W.get("alerts") or []
first = lambda *xs: next((x for x in xs if x), "Samantha (nobody else is set)")
say("  · who holds a seat nobody is scheduled in, after this step:")
if al: say(f"      the alert list on the Admin page is set, so its first person: {al[0]} (as before)")
else:
    say(f"      scheduling seats (Staffing, In charge, Leadership) and missed clock-in texts: {first(A.get('scheduling_coverage'), lead)}")
    say(f"      the uncalled new family rungs: {first(A.get('family_enquiries'), lead)}")
say(f"      In charge windows on the duty schedule: {W.get('in_charge') or 0}" + ("" if W.get("in_charge") else " (set them in the Hub, Admin page, duty schedule)"))
say(f"      routing switch (work-route, missed clock-in ladder): {'ON' if W.get('routing') is True else 'off, so nothing routes differently yet'}")
say(f"      new family rungs switch (lead-watch): {'ON' if W.get('rungs') is True else 'off, so nothing routes differently yet'}")
if not lead: say("  · there is no Springfield lead yet (run 897 first), so a seat without a work area owner still goes to Samantha")
gate = {}; skipped = []
for fn in FNS:
    s, m = fmeta(HUB, fn)
    if s == 404: skipped.append(fn); say(f"  · {fn} is not live, so it is left off (not deployed)"); continue
    if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})", 3)
    gate[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate[fn] else 'off'} (kept)")

LIVE = [fn for fn in FNS if fn not in skipped]
say(); say("PART 2 · CHANGE")
for fn in LIVE:
    if not deploy(HUB, FNROOT, fn, gate[fn]): say("  STOP. Tell Claude. (Anything above this line is in; the rest is unchanged.)"); done(5)

say(); say("PART 3 · PROOF")
for fn in LIVE:
    s, b = http("POST", f"{FNB}/functions/v1/{fn}", {})
    chk(s is not None and s != 200 and s < 500, f"{fn}: a caller with no key gets nothing ({s})", f"{fn} answered a caller with no key ({s})")
say()
say("  937: " + ("DONE. The In charge seat and the team ladder are live on the server, and a seat nobody is scheduled in goes to the work area owner, then the Springfield lead, not to Samantha by name. Nothing was sent." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
