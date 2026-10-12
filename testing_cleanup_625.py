#!/usr/bin/env python3
# 625 · TESTING CLEAN-UP, AGAIN (619 stopped itself: Cara's open-shift texts are on and 25 call-offs were still open). Same as 619,
# but only FINISHED call-offs and call-offs whose shift date has passed are archived; any still-open call-off for a shift
# today or later stays where Cara is working it, and is listed by name for Samantha to decide.
# (619's header:) TESTING CLEAN-UP (Samantha 2026-10-12: "please clear the do not return, it was just testing" · "please help clear off
# the call-offs for now so they dont mess up our stats, we have been in testing mode" · "we need to assume 24 hour
# availability if they have not put it in").
#   1. The Do Not Return entry the dark report found (a caregiver scheduled with that client) moves from dnr_log to
#      dnr_log_cleared, stamped who, when and why. Nothing is deleted.
#   2. Every call-off case moves from coverage_cases to coverage_cases_archive, stamped. Nothing is deleted; the shadow
#      staffing copies stay as history. STOPS if Cara's open-shift texts are switched on while a case is still open.
#   3. match-dark: a caregiver with no availability on file is assumed available any time; the report runs once again.
# Nothing is sent; no visit, schedule, caregiver or client record changes.
import os, json, re
os.environ.setdefault("SB_STEP", "625")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FN = "match-dark"
WHO = "Samantha (Desktop 625)"
def lit(v): return "'" + str(v).replace("'", "''") + "'"
norm = lambda v: re.sub(r"\s+", " ", re.sub(r"[^a-z ]", " ", str(v or "").lower())).strip()
start("TESTING CLEAN-UP, AGAIN (FINISHED AND PAST CALL-OFFS ONLY)")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
ok, r = sql(REF, """select (select data::jsonb from public.app_data where key = 'dnr_log') as dnr, (select data::jsonb from public.app_data where key = 'match_dark_report') -> 'rows' as rows,
  (select data::jsonb from public.app_data where key = 'coverage_cases') as cases, coalesce((select data->>'coverage_send_live' from public.app_data where key = 'ops_settings'), 'not set') as send_live""")
if not ok or not r: bad(f"could not read: {r}"); done(3)
dnr = r[0]["dnr"] or []; rows = r[0]["rows"] or []; cases = r[0]["cases"] or []; send_live = r[0]["send_live"]
hits = [x for x in rows if x.get("reason") == "Do Not Return for this client"]
pairs = {(str(x.get("client_id")), norm(x.get("client")), norm(x.get("caregiver"))) for x in hits}
match = [i for i, d in enumerate(dnr) if any(norm(d.get("caregiver")) == cg and (str(d.get("axiscare_client_id") or "") == cid or norm(d.get("client")) == cn) for cid, cn, cg in pairs)]
if not hits: say("  · the stored report has no Do Not Return visit (nothing to clear)")
for i in match: d = dnr[i]; say(f"  ✓ the Do Not Return entry to clear: {d.get('caregiver')} for {d.get('client')} (logged {str(d.get('logged_at') or '')[:10]}, {d.get('reason') or 'no reason'})")
if hits and not match: bad("the report's Do Not Return visit does not match a dnr_log entry exactly. Tell Claude.")
say(f"  · Do Not Return: {len(dnr)} entr{'y' if len(dnr) == 1 else 'ies'} in all; {len(match)} cleared by this step; the rest stay")
import datetime as _dt
TODAY = _dt.datetime.now(_dt.timezone(_dt.timedelta(hours=-5))).strftime("%Y-%m-%d")
live_open = lambda c: str(c.get("status")) in ("open", "by_hand", "assigned") and str(c.get("shift_date") or "9999") >= TODAY
keep_cases = [c for c in cases if live_open(c)]
move_ids = [str(c.get("id")) for c in cases if not live_open(c)]
say(f"  · call-offs: {len(cases)} case(s); {len(move_ids)} finished or past (archived by this step); {len(keep_cases)} still open for today or later (kept; Cara's open-shift texts are {send_live})")
for c in keep_cases: say(f"     - kept: {c.get('shift_date')} {c.get('shift_time') or ''} · {c.get('client_name') or c.get('client') or 'client'} · calling off {c.get('calling_off') or '?'} · {c.get('status')}")
sx, mx = fmeta(REF, FN)
say(f"  · match-dark is live at version {mx.get('version', '?')}; replaced by this build (24-hour availability)") if sx == 200 else bad(f"match-dark is not live: {sx}")
say("  · what changes: the Do Not Return entry above and every call-off case move to their archive lists (nothing deleted); match-dark assumes 24-hour availability; the dark report runs once. Nothing is sent.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
if match:
    moved = [dict(dnr[i], cleared_at="now", cleared_by=WHO, cleared_reason="a testing entry (Samantha: it was just testing)") for i in match]
    keep = [d for i, d in enumerate(dnr) if i not in match]
    ok, rr = sql(REF, f"""begin;
      insert into public.app_data (key, data) values ('dnr_log_cleared', '[]') on conflict (key) do nothing;
      update public.app_data set data = (coalesce(data::jsonb, '[]'::jsonb) || (select jsonb_agg(x || jsonb_build_object('cleared_at', now())) from jsonb_array_elements({lit(json.dumps(moved))}::jsonb) x)), updated_at = now() where key = 'dnr_log_cleared';
      update public.app_data set data = {lit(json.dumps(keep))}::jsonb, updated_at = now() where key = 'dnr_log' and data::jsonb = {lit(json.dumps(dnr))}::jsonb;
      do $c$ begin if (select jsonb_array_length(data::jsonb) from public.app_data where key = 'dnr_log') <> {len(keep)} then raise exception 'dnr_log changed while this ran; nothing was moved'; end if; end $c$;
      commit;""")
    say(f"  ✓ {len(match)} Do Not Return entr{'y' if len(match) == 1 else 'ies'} cleared (kept in dnr_log_cleared)") if ok else bad(f"the Do Not Return entry was not moved (nothing changed): {rr}")
if move_ids:
    ids = "array[" + ",".join(lit(i) for i in move_ids) + "]::text[]"
    ok, rr = sql(REF, f"""begin;
      select 1 from public.app_data where key = 'coverage_cases' for update;
      insert into public.app_data (key, data) values ('coverage_cases_archive', '[]') on conflict (key) do nothing;
      update public.app_data set data = coalesce(data::jsonb, '[]'::jsonb) || coalesce((select jsonb_agg(c || jsonb_build_object('archived_at', now(), 'archived_by', {lit(WHO)}, 'archived_reason', 'testing mode: cleared so it does not count in staffing stats')) from jsonb_array_elements((select data::jsonb from public.app_data where key = 'coverage_cases')) c where c->>'id' = any({ids})), '[]'::jsonb), updated_at = now() where key = 'coverage_cases_archive';
      update public.app_data set data = coalesce((select jsonb_agg(c) from jsonb_array_elements(data::jsonb) c where not (c->>'id' = any({ids}))), '[]'::jsonb), updated_at = now() where key = 'coverage_cases';
      commit;""")
    say(f"  ✓ {len(move_ids)} finished or past call-off case(s) moved to coverage_cases_archive; {len(keep_cases)} still-open ones kept") if ok else bad(f"the call-offs were not moved (nothing changed): {rr}")
if not deploy(REF, FNROOT, FN, mx.get("verify_jwt", True) if isinstance(mx, dict) else True): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent)")
ok, p = sql(REF, """select jsonb_array_length(coalesce((select data::jsonb from public.app_data where key = 'coverage_cases'), '[]'::jsonb)) as cases,
  jsonb_array_length(coalesce((select data::jsonb from public.app_data where key = 'coverage_cases_archive'), '[]'::jsonb)) as archived,
  jsonb_array_length(coalesce((select data::jsonb from public.app_data where key = 'dnr_log'), '[]'::jsonb)) as dnr,
  jsonb_array_length(coalesce((select data::jsonb from public.app_data where key = 'dnr_log_cleared'), '[]'::jsonb)) as dnr_cleared""")
if ok: say(f"  ✓ call-offs: {p[0]['cases']} active, {p[0]['archived']} in the archive · Do Not Return: {p[0]['dnr']} active, {p[0]['dnr_cleared']} cleared")
okl, livef = live_files(REF, FN)
say("  ✓ match-dark is live as tested") if okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need(FNROOT, FN)) else bad("the live copy is not this build")
s2, b2 = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG()); SVC = ""
try:
    arr = json.loads(b2) if s2 == 200 else []
    if isinstance(arr, dict): arr = arr.get("keys") or []
    SVC = next((str(k.get("api_key")) for k in arr if isinstance(k, dict) and k.get("name") == "service_role" and str(k.get("api_key", "")).startswith("eyJ")), "")
except Exception: SVC = ""
s5, b5 = http("POST", f"https://{REF}.supabase.co/functions/v1/{FN}", {"once": True}, {"apikey": SVC, "Authorization": "Bearer " + SVC}) if SVC else (None, "no key")
try: j = json.loads(b5)
except Exception: j = {}
if s5 == 200 and j.get("ok"):
    c = j.get("counts", {})
    say(f"  ✓ the dark report again: {c.get('visits', 0)} visits (Ready {c.get('ready', 0)}, Likely fit {c.get('likely_fit', 0)}, one more step {c.get('one_more_step', 0)}, not for the visit {c.get('not_for_visit', 0)}); call-offs replayed: {j.get('replay', 0)}")
else: bad(f"the report did not run again: {s5} {str(b5)[:200]}")
ok, d2 = sql(REF, "select count(*) as n from public.app_data, jsonb_array_elements(data::jsonb->'rows') x where key = 'match_dark_report' and x->>'reason' = 'Do Not Return for this client'")
say(f"  ✓ no visit shows Do Not Return now ({d2[0]['n']})") if ok and int(d2[0]['n']) == 0 else bad(f"Do Not Return visits remain: {d2}")
say("  · undo: the moved entries are in dnr_log_cleared and coverage_cases_archive; Claude can move any back.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the test Do Not Return entry and the finished or past call-offs are archived (nothing deleted); still-open future call-offs are listed above and kept; the dark report assumes 24-hour availability. Nothing was sent."); done(0)
