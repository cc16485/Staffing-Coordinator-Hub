#!/usr/bin/env python3
# 1045 · TAKEN OFF A SHIFT IS NOT A CALL-IN (2026-10-22, Samantha: "the automation of us taking a caregiver off a shift ...
# makes it look like they called in ... when it could be that the client canceled the shift, or that we approved the
# caregiver asking off ... the message that just sent out saying kyra linde called off from april davidson is not true
# april canceled that shift. please remove that call in from Kyras profile also").
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only); finds Kyra
#     Linde's April Davidson case and the call-in it put on her attendance.
#  2. Deploys coverage-run, coverage-watch, lead-digest, callin-alert (gateway settings kept). Then the clean-up:
#     the call-in comes off Kyra's attendance (a copy is kept on the case), the case is marked "not a call-in", an open
#     case is closed as "client cancelled", and any HR suggestion built from that call-in is dismissed.
#  3. Proves it: a stranger is refused; Kyra has no call-in left from that shift.
# Sends nothing. Safe to run again.
import json, os, subprocess, shutil
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta, lit

HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
FNS = ["coverage-run", "coverage-watch", "lead-digest", "callin-alert"]
WHO_OFF = os.environ.get("SB_WHO_OFF", "kyra")         # the caregiver (first name is enough)
CLIENT = os.environ.get("SB_CLIENT", "davidson")       # the client (last name is enough)
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
ARR = lambda key: f"jsonb_array_elements(coalesce((select case when jsonb_typeof(data::jsonb) = 'array' then data::jsonb else '[]'::jsonb end from public.app_data where key = '{key}'), '[]'::jsonb))"
CASES = f"""select c->>'id' as id, c->>'client' as client, c->>'shift_date' as shift_date, c->>'shift_time' as shift_time, c->>'calling_off' as calling_off,
  c->>'opened_by' as opened_by, c->>'opened_at' as opened_at, c->>'modification_reason' as reason, c->>'status' as status, c->>'resolved_how' as resolved_how,
  coalesce((c->>'not_a_callin')::boolean, false) as not_a_callin, src from (
  select c, 'open list' as src from {ARR('coverage_cases')} c union all select c, 'archive' from {ARR('coverage_cases_archive')} c) x
 where c->>'calling_off' ilike {lit('%' + WHO_OFF + '%')} and c->>'client' ilike {lit('%' + CLIENT + '%')}
   and coalesce(c->>'shift_date', '') >= to_char(now() - interval '14 days', 'YYYY-MM-DD') order by c->>'opened_at'"""
def events(case_ids):
    ids = "array[" + ",".join(lit("att_cov_" + i) for i in case_ids) + "]::text[]" if case_ids else "array[]::text[]"
    return sql(HUB, f"""select e->>'id' as id, e->>'caregiver' as caregiver, e->>'shift_date' as shift_date, e->>'note' as note, e->>'logged_by' as logged_by
      from {ARR('attendance_events')} e where e->>'type' = 'callin' and e->>'caregiver' ilike {lit('%' + WHO_OFF + '%')}
       and (e->>'id' = any({ids}) or e->>'note' ilike {lit('%' + CLIENT + '%')})""")

start("TAKEN OFF A SHIFT IS NOT A CALL-IN")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = []
for fn in FNS:
    for k in sorted(L.need(FNROOT, fn)):
        c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
        if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(sorted(set(drift)))[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE:
    for t, must in (("callin_plan_harness.mjs", "never lands on the caregiver's attendance"), ("callin_test.mjs", "31/31 passed"), ("step4_id_match_test.mjs", "9/9 passed")):
        c, o = run([NODE, t], cwd=ROOT)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l for l in o.splitlines() if "FAIL" in l or "✗" in l)[:240])
    ok("tests pass: a shift taken off in AxisCare never says \"called off\" and never lands on attendance; a real call-in still does (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
okq, cases = sql(HUB, CASES)
if not okq: stop("couldn't read the call-in cases: " + str(cases)[:200], 3)
for c in cases:
    say(f"  · case {c['id']}: {c['client']} {c['shift_date']} {c['shift_time']}, {c['calling_off']} named, opened by {c['opened_by'] or '?'}"
        + f" {(c['opened_at'] or '')[:16]}, AxisCare reason \"{c['reason'] or 'none'}\", {c['status']}" + (f" ({c['resolved_how']})" if c['resolved_how'] else "") + f", {c['src']}")
if not cases: say(f"  · no recent case names {WHO_OFF.title()} on a {CLIENT.title()} shift")
ids = [c["id"] for c in cases]
okq, evs = events(ids)
if not okq: stop("couldn't read attendance: " + str(evs)[:200], 3)
for e in evs: say(f"  · call-in on {e['caregiver']}'s attendance: {e['shift_date']}, \"{e['note']}\" (logged by {e['logged_by']}, id {e['id']})")
if not evs: say(f"  · no call-in from a {CLIENT.title()} shift on {WHO_OFF.title()}'s attendance")
ev_ids = [e["id"] for e in evs]
okq, hrc = sql(HUB, "select id, status, title, practice from public.hr_cases where source_ids && array[" + ",".join(lit(i) for i in ev_ids) + "]::text[]") if ev_ids else (True, [])
if not okq: hrc = []; say("  · couldn't read HR suggestions (left as they are)")
for h in hrc: say(f"  · HR suggestion built from it: \"{h['title']}\" ({h['status']}{', practice' if h['practice'] else ''})")
metas = {}
for fn in FNS:
    s, m = fmeta(HUB, fn)
    if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})", 3)
    metas[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if metas[fn] else 'off'} (kept)")

say(); say("PART 2 · CHANGE")
for fn in FNS:
    if not deploy(HUB, FNROOT, fn, metas[fn]): say("  STOP. Tell Claude. (Functions before this one are deployed; nothing else was changed.)"); done(5)
note = f"Not a call-in: {CLIENT.title()} cancelled this shift; {WHO_OFF.title()} did not call in (Samantha, 2026-10-22, Desktop 1045)."
for c in cases:
    if c["src"] == "archive": say(f"  · case {c['id']} is in the archive (left as it is; it is already off the board)"); continue
    kept = [e for e in evs if e["id"] == "att_cov_" + c["id"]]
    patch = {"not_a_callin": True, "not_a_callin_note": note}
    if kept: patch["removed_attendance_event"] = kept[0]
    okq, r = sql(HUB, f"select public.coverage_case_patch({lit(c['id'])}, {lit(json.dumps(patch))}::jsonb, '{{}}'::jsonb) as r")
    chk(okq and (r[0]["r"] or {}).get("outcome") == "ok", f"case {c['id']} marked \"not a call-in\"", f"case {c['id']} could not be marked: {str(r)[:200]}")
    if c["status"] == "open":
        okq, r = sql(HUB, f"""select public.coverage_case_patch({lit(c['id'])}, jsonb_build_object('status', 'done', 'resolved_how', 'client_cancelled', 'covered_by', null,
          'resolved_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'confirmed_by', 'Samantha', 'confirmed_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'close_note', {lit(note)}, 'reopened_from', null), '{{"status":"open"}}'::jsonb) as r""")
        out = (r[0]["r"] or {}).get("outcome") if okq else None
        chk(out in ("ok", "conflict"), f"case {c['id']} closed as \"client cancelled\"" if out == "ok" else f"case {c['id']} was already closed by someone", f"case {c['id']} could not be closed: {str(r)[:200]}")
for i in ev_ids:
    okq, r = sql(HUB, f"select public.delete_app_data_item('attendance_events', {lit(i)})")
    chk(okq, f"call-in {i} taken off {WHO_OFF.title()}'s attendance", f"call-in {i} could not be removed: {str(r)[:200]}")
for h in hrc:
    if h["status"] != "open": continue
    okq, r = sql(HUB, f"update public.hr_cases set status = 'dismissed', review_note = {lit(note)}, updated_at = now() where id = {lit(h['id'])}")
    chk(okq, f"HR suggestion \"{h['title']}\" dismissed", f"HR suggestion {h['id']} could not be dismissed: {str(r)[:200]}")

say(); say("PART 3 · PROOF")
for fn in FNS:
    s, b = http("POST", f"{FNB}/functions/v1/{fn}", {})
    chk(s in (400, 401, 403), f"{fn}: a caller with no key gets nothing ({s})", f"{fn} answered a stranger ({s})")
okq, left = events(ids)
chk(okq and not left, f"{WHO_OFF.title()} has no call-in left from a {CLIENT.title()} shift", f"a call-in is still there: {str(left)[:200]}")
okq, after = sql(HUB, CASES)
if okq:
    for c in after: say(f"  · case {c['id']}: {c['status']}" + (f" ({c['resolved_how']})" if c['resolved_how'] else "") + (", not a call-in" if c["not_a_callin"] else ""))
say()
say("  1045: " + ("DONE. Taking a caregiver off a shift in AxisCare no longer counts as a call-in, and Kyra's is gone." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
