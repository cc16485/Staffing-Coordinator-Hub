#!/usr/bin/env python3
# 626 · THE LAST TEST CALL-OFFS (Samantha 2026-10-12, after 625: "archive all 22, they were testing").
#   1. coverage-watch first: an archived call-off counts as handled, so Cara never opens it again from AxisCare (a closed
#      case holds unless the shift changes in AxisCare; the hourly sweep leaves an archived schedule alone for 14 days).
#   2. Every call-off case opened before 625 ran moves from coverage_cases to coverage_cases_archive, stamped. A case
#      opened after 625 is kept and listed (it may be real).
#   3. Office to-dos tied to an archived call-off (open ops_items with its case_id) are closed, stamped.
#   4. Proof: Cara's watcher, in a dry run, opens none of them again; the dark report runs once.
# Nothing is sent and nothing is deleted; no visit, schedule, caregiver or client record changes.
import os, json, re
os.environ.setdefault("SB_STEP", "626")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FN = "coverage-watch"
WHO = "Samantha (Desktop 626)"
CUTOFF = "2026-10-12T05:40"   # 625 ran at 05:39 UTC; anything opened later is not part of the testing she named
def lit(v): return "'" + str(v).replace("'", "''") + "'"
slot = lambda v: re.sub(r"^v=[^:]+:", "", str(v or ""))
CLOSED = ("resolved", "closed", "dismissed", "done", "cancelled")
start("THE LAST TEST CALL-OFFS (ARCHIVE ALL 22)")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
ok, r = sql(REF, """select (select data::jsonb from public.app_data where key = 'coverage_cases') as cases,
  (select data::jsonb from public.app_data where key = 'coverage_cases_archive') as arch,
  (select data::jsonb from public.app_data where key = 'ops_items') as ops,
  (select data::jsonb from public.app_data where key = 'match_dark_report') -> 'rows' as rows,
  (select data::jsonb from public.app_data where key = 'match_dark_report') ->> 'at' as rows_at,
  (select data::jsonb from public.app_data where key = 'ops_settings') as st""")
if not ok or not r: bad(f"could not read: {r}"); done(3)
cases = r[0]["cases"] or []; arch = r[0]["arch"] or []; ops = r[0]["ops"] or []; rows = r[0]["rows"] or []; st = r[0]["st"] or {}
say(f"  · Cara's switches: call-off watcher {st.get('coverage_watch_live') is True}, open-shift texts {st.get('coverage_send_live') is True}, reopen-on-change {st.get('coverage_watch_7b_live') is True}")
staffed = {slot(x.get("visit_id")): x.get("caregiver") for x in rows if x.get("visit_id")}
move = [c for c in cases if str(c.get("opened_at") or "") < CUTOFF]
keep = [c for c in cases if c not in move]
say(f"  · call-offs: {len(cases)} active; {len(move)} opened before 625 ran (archived by this step); {len(keep)} opened since (kept)")
for c in move:
    v = slot(c.get("axiscare_visit_id")); cg = staffed.get(v)
    now = f"AxisCare now: {cg} is on it" if cg else "AxisCare now: no caregiver (check the shift in AxisCare if it was a test)"
    say(f"     - {c.get('shift_date')} {c.get('shift_time') or ''} · {c.get('client_name') or c.get('client') or 'client'} · {c.get('status')} · opened by {c.get('opened_by') or '?'} · {now}")
for c in keep: say(f"     - kept: {c.get('shift_date')} {c.get('shift_time') or ''} · {c.get('client_name') or c.get('client') or 'client'} · opened {str(c.get('opened_at'))[:16]}")
say(f"    (AxisCare state read from the dark report of {str(r[0]['rows_at'] or '?')[:16]} UTC)")
gone = {str(c.get("id")) for c in arch} | {str(c.get("id")) for c in move}
todo = [i for i in ops if str(i.get("case_id") or "") in gone and str(i.get("status") or "open") not in CLOSED]
say(f"  · office to-dos tied to archived call-offs: {len(todo)} still open (closed by this step)")
for i in todo[:12]: say(f"     - {i.get('kind') or 'item'}: {str(i.get('title') or '')[:110]}")
if len(todo) > 12: say(f"     … and {len(todo) - 12} more")
sx, mx = fmeta(REF, FN)
say(f"  · coverage-watch is live at version {mx.get('version', '?')}; replaced by this build (archived = handled)") if sx == 200 else bad(f"coverage-watch is not live: {sx}")
say("  · what changes: coverage-watch first, then the call-offs above move to coverage_cases_archive and their office to-dos close. Nothing is sent or deleted.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, FN, mx.get("verify_jwt", True) if isinstance(mx, dict) else True): say("  RESULT: STOPPED before any call-off moved. Tell Claude."); done(6)
ids = "array[" + ",".join(lit(c.get("id")) for c in move) + "]::text[]" if move else "array[]::text[]"
if move:
    ok, rr = sql(REF, f"""begin;
      select 1 from public.app_data where key = 'coverage_cases' for update;
      insert into public.app_data (key, data) values ('coverage_cases_archive', '[]') on conflict (key) do nothing;
      update public.app_data set data = coalesce(data::jsonb, '[]'::jsonb) || coalesce((select jsonb_agg(c || jsonb_build_object('archived_at', now(), 'archived_by', {lit(WHO)}, 'archived_reason', 'testing (Samantha: they were testing)')) from jsonb_array_elements((select data::jsonb from public.app_data where key = 'coverage_cases')) c where c->>'id' = any({ids})), '[]'::jsonb), updated_at = now() where key = 'coverage_cases_archive';
      update public.app_data set data = coalesce((select jsonb_agg(c) from jsonb_array_elements(data::jsonb) c where not (c->>'id' = any({ids}))), '[]'::jsonb), updated_at = now() where key = 'coverage_cases';
      commit;""")
    say(f"  ✓ {len(move)} call-off case(s) moved to coverage_cases_archive") if ok else bad(f"the call-offs were not moved (nothing changed): {rr}")
if todo:
    tids = "array[" + ",".join(lit(i.get("id")) for i in todo) + "]::text[]"
    ok, rr = sql(REF, f"""begin;
      select 1 from public.app_data where key = 'ops_items' for update;
      update public.app_data set data = (select jsonb_agg(case when i->>'id' = any({tids}) and coalesce(i->>'status', 'open') not in ('resolved','closed','dismissed','done','cancelled')
          then i || jsonb_build_object('status', 'resolved', 'resolved_at', now(), 'resolved_by', {lit(WHO)}, 'resolution', 'its call-off was testing and is archived') else i end) from jsonb_array_elements(data::jsonb) i), updated_at = now()
        where key = 'ops_items';
      commit;""")
    say(f"  ✓ {len(todo)} office to-do(s) closed, stamped") if ok else bad(f"the office to-dos were not closed: {rr}")
say(); say("PART 3 · PROOF (nothing is sent)")
ok, p = sql(REF, f"""select jsonb_array_length(coalesce((select data::jsonb from public.app_data where key = 'coverage_cases'), '[]'::jsonb)) as cases,
  jsonb_array_length(coalesce((select data::jsonb from public.app_data where key = 'coverage_cases_archive'), '[]'::jsonb)) as archived,
  (select count(*) from public.app_data, jsonb_array_elements(data::jsonb) i where key = 'ops_items' and i->>'case_id' = any(array[{",".join(lit(x) for x in gone) or "''"}]::text[]) and coalesce(i->>'status', 'open') not in ('resolved','closed','dismissed','done','cancelled')) as todo""")
if ok: say(f"  ✓ call-offs: {p[0]['cases']} active, {p[0]['archived']} in the archive · office to-dos still open for archived call-offs: {p[0]['todo']}")
if ok and int(p[0]["todo"]) != 0: bad("office to-dos are still open for archived call-offs")
okl, livef = live_files(REF, FN)
say("  ✓ coverage-watch is live as tested") if okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need(FNROOT, FN)) else bad("the live copy is not this build")
s2, b2 = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG()); SVC = ""
try:
    arr = json.loads(b2) if s2 == 200 else []
    if isinstance(arr, dict): arr = arr.get("keys") or []
    SVC = next((str(k.get("api_key")) for k in arr if isinstance(k, dict) and k.get("name") == "service_role" and str(k.get("api_key", "")).startswith("eyJ")), "")
except Exception: SVC = ""
H = {"apikey": SVC, "Authorization": "Bearer " + SVC}
s4, b4 = http("POST", f"https://{REF}.supabase.co/functions/v1/{FN}?dry=1&sweep=1", {}, H) if SVC else (None, "no key")
try: w = json.loads(b4)
except Exception: w = {}
if s4 == 200 and isinstance(w, dict) and "unassigned_detail" in w:
    av = {slot(c.get("axiscare_visit_id")) for c in move}
    asch = {m.group(1) for m in (re.match(r"^s=([^:]+):", v) for v in av) if m}
    again = [d for d in (w.get("unassigned_detail") or []) if slot(d.get("visit")) in av and str(d.get("verdict", "")).startswith("opens")]
    again += [e for e in ((w.get("ongoing_sweep") or {}).get("would_open") or []) if str(e.get("schedule_id")) in asch]
    say(f"  ✓ Cara's watcher, dry run: none of the archived call-offs would open again ({len(w.get('unassigned_detail') or [])} unassigned shifts in the next 72 hours checked; sweep ran)") if not again else bad(f"the watcher would open these again: {json.dumps(again)[:400]}")
else: bad(f"the watcher dry run did not answer: {s4} {str(b4)[:200]}")
s5, b5 = http("POST", f"https://{REF}.supabase.co/functions/v1/match-dark", {"once": True}, H) if SVC else (None, "no key")
try: j = json.loads(b5)
except Exception: j = {}
if s5 == 200 and j.get("ok"):
    c = j.get("counts", {})
    say(f"  ✓ the dark report again: {c.get('visits', 0)} visits (Ready {c.get('ready', 0)}, Likely fit {c.get('likely_fit', 0)}, one more step {c.get('one_more_step', 0)}, not for the visit {c.get('not_for_visit', 0)}); call-offs replayed: {j.get('replay', 0)}")
else: bad(f"the report did not run again: {s5} {str(b5)[:200]}")
say("  · undo: every moved case is in coverage_cases_archive and every closed to-do is stamped; Claude can move any back.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the test call-offs are archived and their to-dos closed (nothing deleted); Cara treats archived call-offs as handled. Nothing was sent."); done(0)
