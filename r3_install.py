#!/usr/bin/env python3
# R3 · THE FAMILY CIRCLE SYNC SAYS WHEN IT RAN (Desktop 332), plus a read-only look at the care-notes watcher.
# Part 1 (read only): both functions are the reviewed builds; gateway settings read and kept; the nightly circle sync
#   schedule is found and makes a real (committed) run; what the hourly care-notes watcher last saw (counts only, never
#   a note's words) and how many flagged-note items it has ever made.
# Part 2: deploy identity-backfill (a real sync leaves a heartbeat) and automation-watchdog (expects it; quiet until the
#   first night).
# Part 3 (read back, nothing runs): gateway settings kept, newer versions; the watchdog's practice check raises nothing
#   about the sync.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, time
FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FNS = ["identity-backfill", "automation-watchdog"]
lines = []; fails = []
def say(s=""): s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", str(s)); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-r3/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, b[:200]
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def meta(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    try: m = json.loads(b) if s == 200 else None
    except Exception: m = None
    return m if isinstance(m, dict) and isinstance(m.get("verify_jwt"), bool) else None

say("R3 · THE FAMILY CIRCLE SYNC SAYS WHEN IT RAN"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
for fn in FNS:
    got = hashlib.sha256(open(os.path.join(FNROOT, fn, "index.ts"), "rb").read()).hexdigest()
    if got != SHAS.get(fn): bad(f"{fn} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
before = {fn: meta(fn) for fn in FNS}
if any(v is None for v in before.values()): bad("could not read the functions' settings. Nothing was changed."); done(4)
say("  ✓ both functions are the reviewed builds · gateway settings read and kept")
ok, r = sql("select schedule, active, command from cron.job where jobname = 'circles-sync-nightly'")
if ok and r:
    cmd = r[0]["command"] or ""
    real = "identity-backfill" in cmd and "circles=1" in cmd and "commit=1" in cmd
    say(("  ✓ " if real and r[0]["active"] else "  · ") + f"the nightly circle sync: {r[0]['schedule']}, {'on' if r[0]['active'] else 'PAUSED'}, "
        + ("makes a real run (so it will report each night)" if real else "does NOT look like a real run (it may not report; tell Claude)"))
else: say("  · the nightly circle sync schedule was not found (the Hub will show no sync time; tell Claude)")
say()
say("  THE CARE-NOTES WATCHER (read only, counts only)")
ok, r = sql("""select content from net._http_response where content like '%"notes_sweep"%' and content like '%visits_checked%'
               order by id desc limit 1""")
sweep = None
if ok and r:
    try: sweep = json.loads(r[0]["content"]).get("notes_sweep")
    except Exception: sweep = None
if isinstance(sweep, dict):
    shape = str(sweep.get("shape") or "")
    say(f"  · its last full look (kept by the database for a few hours): {sweep.get('visits_checked', '?')} visits checked, "
        f"{sweep.get('notes_seen', '?')} care notes seen, {sweep.get('flagged', '?')} rated medium or high")
    say("  · where AxisCare keeps the notes: " + ("NOT FOUND: AxisCare's answers had no care notes on visits, and the per-visit note addresses didn't answer" if shape.startswith("NONE") else shape or "not reported"))
else: say("  · no recent full look is kept (the database keeps these answers only a few hours); the item count below still tells us")
ok, r = sql("""select count(*)::int as total, count(*) filter (where coalesce(i->>'status','') <> 'done')::int as open
               from app_data a, jsonb_array_elements(case when jsonb_typeof(a.data) = 'array' then a.data else '[]'::jsonb end) i
               where a.key = 'ops_items' and i->>'opened_by' = 'flagged-visit-note'""")
if ok and r: say(f"  · flagged-note items it has ever made for the office: {r[0]['total']} (still open: {r[0]['open']})")
else: say("  · could not count its items")

say(); say("PART 2 · CHANGE")
for fn in FNS:
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if before[fn]["verify_jwt"] else ["--no-verify-jwt"]),
                       cwd=os.path.dirname(os.path.dirname(FNROOT)), env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: bad(f"{fn} deploy failed: " + (p.stderr or p.stdout)[-240:]); say("  STOP. Functions above this line run the new code; the rest are unchanged."); done(6)
    say(f"  ✓ {fn} deployed")

say(); say("PART 3 · CHECK (nothing runs)")
time.sleep(float(os.environ.get("SB_SETTLE", "6")))
for fn in FNS:
    m = meta(fn) or {}
    kept = m.get("verify_jwt") == before[fn]["verify_jwt"]
    newer = isinstance(m.get("version"), int) and isinstance(before[fn].get("version"), int) and m["version"] > before[fn]["version"]
    (say if kept and newer else bad)(("  ✓ " if kept and newer else "") + f"{fn}: gateway setting kept: {'yes' if kept else 'NO'} · now running version {m.get('version')} (was {before[fn].get('version')})")
s, b = http("POST", f"{FNB}/functions/v1/automation-watchdog?dry=1", {}, {})
try: probs = json.loads(b).get("problems") or []
except Exception: probs = None
if probs is None: bad(f"the watchdog's practice check did not answer ({s})")
else:
    mine = [p for p in probs if "circles-sync" in p]
    (say if not mine else bad)(("  ✓ " if not mine else "") + "the watchdog's practice check (sends nothing) raises nothing about the sync" + ("" if not mine else ": " + mine[0][:160]))
say()
say("RESULT: " + ("DONE · from tonight's run (about 4am), each Family Circle shows when it last synced from AxisCare, and a missed or failed night is flagged." if not fails else "CHECK THE ✗ LINES."))
say("No name, phone number or note text was printed. Rollback if ever needed: redeploy both functions from the commit before this one.")
done(0 if not fails else 7)
