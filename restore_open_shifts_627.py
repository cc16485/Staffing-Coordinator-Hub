#!/usr/bin/env python3
# 627 · THE REAL OPEN SHIFTS GO BACK TO CARA (Samantha 2026-10-12, after 626: "leave those open, those are real clients
# with open shifts" · "put the open shifts back in cara"). 626 archived 21 cases Cara's hourly sweep had opened for AxisCare
# schedules with no caregiver; they were real openings, not testing.
#   1. The dark report runs once first, so "no caregiver" is today's AxisCare, not this morning's.
#   2. Each sweep case 626 archived comes back to coverage_cases if its schedule still has an upcoming date with no
#      caregiver. It moves forward to the first such date (so Cara never treats it as an already-ended shift) and keeps
#      who was asked before. A schedule now fully staffed in AxisCare stays archived, and is listed.
#   3. LeeAnn Walker's (the test call-off) and every other archived case stay where they are.
# Nothing is deleted. This step sends nothing itself; once a case is back, Cara works it as before (her open-shift texts
# are on).
import os, json, re, datetime as dt
os.environ.setdefault("SB_STEP", "627")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
WHO = "Samantha (Desktop 627)"
def lit(v): return "'" + str(v).replace("'", "''") + "'"
slot = lambda v: re.sub(r"^v=[^:]+:", "", str(v or ""))
CHI = dt.timezone(dt.timedelta(hours=-5))
NOW = dt.datetime.now(CHI); TODAY = NOW.strftime("%Y-%m-%d"); HHMM = NOW.strftime("%H:%M")
start("THE REAL OPEN SHIFTS GO BACK TO CARA")
say("PART 1 · READ (only the dark report is refreshed)")
s2, b2 = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG()); SVC = ""
try:
    arr = json.loads(b2) if s2 == 200 else []
    if isinstance(arr, dict): arr = arr.get("keys") or []
    SVC = next((str(k.get("api_key")) for k in arr if isinstance(k, dict) and k.get("name") == "service_role" and str(k.get("api_key", "")).startswith("eyJ")), "")
except Exception: SVC = ""
H = {"apikey": SVC, "Authorization": "Bearer " + SVC}
s5, b5 = http("POST", f"https://{REF}.supabase.co/functions/v1/match-dark", {"once": True}, H) if SVC else (None, "no key")
try: j = json.loads(b5)
except Exception: j = {}
say(f"  ✓ AxisCare read fresh (the dark report ran: {j.get('counts', {}).get('visits', 0)} staffed visits, {j.get('counts', {}).get('open_visits', 0)} with no caregiver, next 14 days)") if s5 == 200 and j.get("ok") else bad(f"could not read AxisCare fresh (the dark report did not run): {s5} {str(b5)[:200]}")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
ok, r = sql(REF, """select (select data::jsonb from public.app_data where key = 'coverage_cases_archive') as arch,
  (select data::jsonb from public.app_data where key = 'coverage_cases') as cases,
  (select data::jsonb from public.app_data where key = 'match_dark_report') -> 'rows' as rows,
  (select data::jsonb from public.app_data where key = 'ops_settings') as st""")
if not ok or not r: bad(f"could not read: {r}"); done(3)
arch = r[0]["arch"] or []; cases = r[0]["cases"] or []; rows = r[0]["rows"] or []; st = r[0]["st"] or {}
staffed = {slot(x.get("visit_id")): x.get("caregiver") for x in rows if x.get("visit_id")}
say(f"  · Cara's open-shift texts are {'ON: she works these as soon as they are back' if st.get('coverage_send_live') is True else 'off: these go back on the board, nobody is texted'}")
live_sched = {m.group(1) for m in (re.match(r"^s=([^:]+):", slot(c.get("axiscare_visit_id"))) for c in cases if c.get("status") == "open") if m}
cand = [c for c in arch if str(c.get("archived_by", "")).startswith("Samantha (Desktop 626)") and c.get("opened_by") == "ongoing-sweep"]
back, stay = [], []
for c in cand:
    pat = c.get("shift_pattern") if isinstance(c.get("shift_pattern"), dict) else {}
    m = re.match(r"^s=([^:]+):", slot(c.get("axiscare_visit_id"))); sched = str(pat.get("schedule_id") or (m.group(1) if m else ""))
    t0 = (re.match(r"^(\d{2}:\d{2})", str(c.get("shift_time") or "")) or [None, "00:00"])[1]
    dates = sorted({d for d in [str(c.get("shift_date") or "")] + [str(x) for x in (pat.get("future_dates") or [])] if re.match(r"^\d{4}-\d{2}-\d{2}$", d)})
    upcoming = [d for d in dates if d > TODAY or (d == TODAY and t0 > HHMM)]
    open_d = [d for d in upcoming if sched and f"s={sched}:d={d}" not in staffed]
    who = f"{c.get('client') or c.get('client_name') or 'client'} {c.get('shift_time') or ''}".strip()
    if not sched: stay.append((c, f"{who}: no AxisCare schedule on the case")); continue
    if sched in live_sched: stay.append((c, f"{who}: Cara already has an open case for this schedule")); continue
    if not open_d: stay.append((c, f"{who}: every upcoming date now has a caregiver in AxisCare" if upcoming else f"{who}: no upcoming dates left")); continue
    n = dict(c)
    for k in ("archived_at", "archived_by", "archived_reason"): n.pop(k, None)
    n.update({"shift_date": open_d[0], "axiscare_visit_id": f"s={sched}:d={open_d[0]}", "restored_at": NOW.astimezone(dt.timezone.utc).isoformat(), "restored_by": WHO,
              "note": (str(c.get("note") or "") + f" Back on the board {TODAY} (Samantha: a real client with open shifts).").strip(),
              "shift_pattern": dict(pat, future_dates=open_d[:8], more_dates=max(0, len(open_d) - 8), checked_at=NOW.astimezone(dt.timezone.utc).isoformat())})
    back.append(n)
    say(f"     - back to Cara: {who} · open {', '.join(d[5:] for d in open_d[:8])}{' …' if len(open_d) > 8 else ''} · asked before: {len(c.get('asked') or [])}")
for c, why in stay: say(f"     - stays archived: {why}")
say(f"  · {len(back)} go back to Cara; {len(stay)} stay archived; LeeAnn Walker's test call-off and all others stay archived")
if not back: say(); say("RESULT: NOTHING TO DO · no archived open shift still needs a caregiver. Nothing changed."); done(0)
say("  · what changes: those cases move from coverage_cases_archive back to coverage_cases, moved forward to their first open date. Nothing is deleted.")
say(); say("PART 2 · CHANGE")
ids = "array[" + ",".join(lit(c["id"]) for c in back) + "]::text[]"
ok, rr = sql(REF, f"""begin;
  select 1 from public.app_data where key in ('coverage_cases', 'coverage_cases_archive') for update;
  update public.app_data set data = coalesce(data::jsonb, '[]'::jsonb) || {lit(json.dumps(back))}::jsonb, updated_at = now() where key = 'coverage_cases';
  update public.app_data set data = coalesce((select jsonb_agg(c) from jsonb_array_elements(data::jsonb) c where not (c->>'id' = any({ids}))), '[]'::jsonb), updated_at = now() where key = 'coverage_cases_archive';
  do $c$ begin if (select count(*) from public.app_data, jsonb_array_elements(data::jsonb) c where key = 'coverage_cases' and c->>'id' = any({ids})) <> {len(back)} then raise exception 'not all came back; nothing moved'; end if; end $c$;
  commit;""")
say(f"  ✓ {len(back)} open-shift case(s) back with Cara") if ok else bad(f"nothing moved: {rr}")
say(); say("PART 3 · PROOF (nothing is sent by this step)")
ok, p = sql(REF, f"""select (select count(*) from public.app_data, jsonb_array_elements(data::jsonb) c where key = 'coverage_cases' and c->>'id' = any({ids}) and c->>'status' = 'open') as back,
  (select count(*) from public.app_data, jsonb_array_elements(data::jsonb) c where key = 'coverage_cases_archive' and c->>'id' = any({ids})) as still_arch,
  jsonb_array_length(coalesce((select data::jsonb from public.app_data where key = 'coverage_cases'), '[]'::jsonb)) as active""")
if ok and int(p[0]["back"]) == len(back) and int(p[0]["still_arch"]) == 0: say(f"  ✓ {p[0]['back']} open on Cara's board ({p[0]['active']} active call-offs in all); none left in the archive")
else: bad(f"the board does not show them: {p}")
s4, b4 = http("POST", f"https://{REF}.supabase.co/functions/v1/coverage-watch?dry=1&sweep=1", {}, H) if SVC else (None, "no key")
try: w = json.loads(b4)
except Exception: w = {}
if s4 == 200 and isinstance(w, dict) and "unassigned_detail" in w:
    bs = {re.match(r"^s=([^:]+):", c["axiscare_visit_id"]).group(1) for c in back}
    dup = [e for e in ((w.get("ongoing_sweep") or {}).get("would_open") or []) if str(e.get("schedule_id")) in bs]
    say("  ✓ Cara's watcher, dry run: no second case would open for these schedules") if not dup else bad(f"the watcher would open a second case: {json.dumps(dup)[:300]}")
else: bad(f"the watcher dry run did not answer: {s4} {str(b4)[:200]}")
say("  · undo: Claude can move any of them back to the archive.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say(f"RESULT: DONE · {len(back)} real open shift case(s) are back with Cara at their next open date. Nothing deleted; this step sent nothing."); done(0)
