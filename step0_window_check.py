#!/usr/bin/env python3
# Step 0 · which stored records changed while Desktop 270 ran (Desktop 272). READ ONLY: changes nothing.
# 270 flagged "something outside these two settings changed while this ran". This lists every app_data
# record written between 22:13:30 and 22:17:30 UTC on Sept 27, 2026 (270 ran 22:14:00 to 22:16:10), so each
# one can be matched to the scheduled job that normally writes it. Values are never printed, only record names.
import json, os, re, urllib.request, urllib.error, datetime as dt
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "")
REPORT = os.environ["SB_REPORT"]; API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
lines = []
def say(s=""): print(s, flush=True); lines.append(s)
def read(q):
    if not re.match(r"^\s*(select|with)\b", q, re.I): return False, "refused"
    req = urllib.request.Request(f"{API}/v1/projects/{REF}/database/query", data=json.dumps({"query": q}).encode(), method="POST",
                                 headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-step0-window/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return True, json.loads(r.read())
    except urllib.error.HTTPError as e: return False, f"HTTP {e.code}: {e.read().decode(errors='replace')[:200]}"
    except Exception as e: return False, f"{type(e).__name__}: {e}"
say("STEP 0 · WHAT CHANGED WHILE 270 RAN · READ ONLY, nothing is changed")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
WRITERS = {"ops_settings": "270 itself (timekeeper_text_live)", "campaign_settings": "270 itself (open-lead audience)",
           "timekeeper_cases": "timekeeper-watch (every 2 min)", "evv_chase_state": "timekeeper-watch (every 2 min)",
           "coverage_cases": "coverage-watch / coverage-run (every 5 / 3 min)", "ops_items": "scheduled watchers and the hub",
           "automation_log": "every scheduled job's run log", "leads": "lead-followup / the hub", "launch_evidence": "launch-evidence (every 30 min)"}
ok, rows = read("""select key, to_char(updated_at at time zone 'utc','HH24:MI:SS') as at from app_data
                    where updated_at between '2026-09-27 22:13:30+00' and '2026-09-27 22:17:30+00' order by updated_at""")
if not ok: say("✗ " + str(rows))
elif not rows: say("  No stored record was written in that window (the flag must have come from a record without a time stamp).")
else:
    for r in rows: say(f"  {r['at']} UTC  {r['key']:<28} normally written by: {WRITERS.get(r['key'], 'UNKNOWN, tell Claude')}")
    unknown = [r['key'] for r in rows if r['key'] not in WRITERS]
    say(); say("RESULT: " + ("every change in the window matches a known scheduled writer or 270 itself" if not unknown else "UNEXPLAINED: " + ", ".join(unknown)))
open(REPORT, "w").write("\n".join(lines) + "\n")
