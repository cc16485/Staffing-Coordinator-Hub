#!/usr/bin/env python3
# Change 7a follow-up · READ ONLY. Every unassigned upcoming shift Cara's watcher saw on its latest
# run, what it decided, and every Cara case ever opened for that shift. Nothing is written or sent.
# Why: AxisCare visits carry no "last changed" date, and the watcher's reopen rule depends on one,
# so a shift whose earlier case was closed may never get a new case.
import json, os, urllib.request, urllib.error, datetime as dt
REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def sql(q):
    req = urllib.request.Request(f"{API}/v1/projects/{REF}/database/query", data=json.dumps({"query": q}).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "User-Agent": "cc-uncovered-check/1.0", "Authorization": "Bearer " + TOKEN})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return True, json.loads(r.read().decode())
    except urllib.error.HTTPError as e: return False, f"HTTP {e.code}: {e.read().decode(errors='replace')[:300]}"
    except Exception as e: return False, str(e)[:300]

say("UNASSIGNED SHIFTS AND CARA'S CASES (read only)")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
ok, r = sql("""with last as (select created, content from net._http_response
     where content like '%"unassigned_detail"%' order by created desc limit 1)
   select created::text as at, content::jsonb->>'mode' as mode, content::jsonb->'unassigned_detail' as detail from last""")
if not ok: say("  ✗ could not read the watcher's latest run: " + str(r)); done(2)
if not r: say("  ✗ no recent watcher run is on record (the database keeps about 6 hours). Try again in a few minutes."); done(3)
run = r[0]; detail = run["detail"] if isinstance(run["detail"], list) else json.loads(run["detail"] or "[]")
say(f"  watcher's latest run: {str(run['at'])[:16]} UTC · {run['mode']} · {len(detail)} unassigned upcoming shift(s)")
ids = sorted({str(x.get("visit") or "") for x in detail if x.get("visit")})
cases = {}
if ids:
    arr = ",".join("'" + i.replace("'", "''") + "'" for i in ids)
    ok, cr = sql(f"""select e->>'axiscare_visit_id' as visit, e->>'status' as status, e->>'opened_at' as opened_at, e->>'opened_by' as opened_by,
         e->>'resolved_at' as resolved_at, e->>'resolved_how' as how, e->>'covered_by' as covered_by
       from app_data a, jsonb_array_elements(case when jsonb_typeof(a.data) = 'array' then a.data else '[]'::jsonb end) e
       where a.key = 'coverage_cases' and e->>'axiscare_visit_id' in ({arr}) order by e->>'opened_at'""")
    if not ok: say("  ✗ could not read Cara's cases: " + str(cr)); done(4)
    for c in cr: cases.setdefault(c["visit"], []).append(c)

held = 0
say()
for x in sorted(detail, key=lambda y: str(y.get("when") or "")):
    v = str(x.get("visit") or ""); cs = cases.get(v, [])
    open_ = [c for c in cs if c["status"] == "open"]; closed = [c for c in cs if c["status"] != "open" and c["resolved_at"]]
    started = str(x.get("verdict", "")).startswith("ignored — already started")
    reasoned = x.get("verdict") in ("opens a case", "already has an open case")
    is_held = reasoned and not open_ and closed and not started
    held += 1 if is_held else 0
    say(f"  {'✗' if is_held else '•'} {x.get('client')} · {str(x.get('when'))[:16].replace('T', ' ')} · reason: {x.get('reason')}")
    say(f"      watcher: {x.get('verdict')}")
    if is_held: say("      HELD: an earlier Cara case for this shift was closed, so the watcher will not open a new one (AxisCare gives it no \"last changed\" date)")
    for c in cs:
        say(f"      case: {c['status']} · opened {str(c['opened_at'])[:16]} by {c['opened_by']}"
            + (f" · closed {str(c['resolved_at'])[:16]} ({c['how'] or 'no reason'})" if c["resolved_at"] else "")
            + (f" · covered by {c['covered_by']}" if c["covered_by"] else ""))
    if not cs: say("      case: none ever")
say()
if held: say(f"RESULT: {held} CALLED-OFF SHIFT(S) HELD WITH NO OPEN CASE · check them in AxisCare now (✗ lines)")
else: say("RESULT: NO HELD SHIFTS · every called-off upcoming shift has an open case, a reason it was skipped, or never had one")
say("Nothing was changed and nothing was sent.")
done(0)
