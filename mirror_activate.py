#!/usr/bin/env python3
# Coverage mirror activation.
#   SB_STEP=install   install the run log (sha-checked), run the wrapper once by hand, show the logged row
#   SB_STEP=schedule  create the every-15-minutes job (replace, never duplicate) and verify it
import json, os, hashlib, urllib.request, urllib.error, datetime as dt

STEP = os.environ.get("SB_STEP", "install")
MIG = open(os.environ["SB_MIGFILE"], "rb").read() if os.environ.get("SB_MIGFILE") else b""
EXPECTED_SHA = os.environ.get("SB_EXPECTED_SHA", "")
REPORT = os.environ["SB_REPORT"]
LOCAL = os.environ.get("SB_LOCAL_SOCK")
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "")
JOB = "legacy-mirror-coverage"

lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "a" if STEP == "schedule" else "w").write("\n".join(lines) + "\n"); raise SystemExit(code)

def sql(q):
    if LOCAL:
        from pg8000.native import Connection, DatabaseError
        c = Connection(user="postgres", database="postgres", unix_sock=LOCAL)
        try:
            rows = c.run(q); cols = [d["name"] for d in (c.columns or [])]
            return True, [dict(zip(cols, r)) for r in (rows or [])]
        except DatabaseError as e:
            d = e.args[0] if e.args and isinstance(e.args[0], dict) else {}
            return False, str(d.get("M", e))
        finally:
            try: c.close()
            except Exception: pass
    req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{REF}/database/query",
        data=json.dumps({"query": q}).encode(), method="POST",
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-mirror-activate/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return True, json.loads(r.read().decode(errors="replace"))
    except urllib.error.HTTPError as e:
        return False, "HTTP %s: %s" % (e.code, e.read().decode(errors="replace")[:600])
    except Exception as e:
        return False, "%s: %s" % (type(e).__name__, e)

if STEP == "install":
    say("COVERAGE MIRROR · RUN LOG + FIRST LOGGED RUN")
    say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC") + ("   (DISPOSABLE TEST TARGET)" if LOCAL else ""))
    say()
    sha = hashlib.sha256(MIG).hexdigest()
    say("  run-log migration sha256 " + sha + ("  ✓ proven build" if sha == EXPECTED_SHA else "  ✗ NOT the proven build"))
    if sha != EXPECTED_SHA: say("  STOP. Nothing was run."); done(2)
    ok, res = sql(MIG.decode())
    if not ok: say("  ✗ STOPPED: the install did not complete (guard or self-check): " + str(res)[:400]); done(4)
    say("  ✓ installed: run log, parity view, scheduled wrapper; guard and self-check passed")
    ok, r = sql("select public.legacy_mirror_scheduled('manual') as r")
    if not ok: say("  ✗ the first logged run failed: " + str(r)[:400]); done(5)
    row = r[0]["r"] if isinstance(r[0]["r"], dict) else json.loads(r[0]["r"])
    say()
    say("  First logged run (" + row.get("trigger_source", "") + "):")
    for k in ("outcome", "cases_seen", "mirrored", "unmapped", "skipped", "errors", "diverged",
              "needs_written", "asks_written", "replies_written", "assignments_written",
              "parity_mismatches", "not_mirrored", "legacy_unchanged", "detail"):
        say(f"    {k:22} {row.get(k)}")
    healthy = row.get("outcome") == "ok" and row.get("legacy_unchanged") is True and row.get("parity_mismatches") == 0
    say()
    say("  " + ("✓ healthy: no errors, legacy untouched, every mirrored case agrees with legacy"
                if healthy else "⚠ not scheduling: look at the lines above first"))
    say("HEALTH " + ("OK" if healthy else "NOT_OK"))
    done(0 if healthy else 6)

# ---- schedule -----------------------------------------------------------------------
say()
say("== SCHEDULE =======================================================")
ok, r = sql(f"""select cron.unschedule(jobid) from cron.job where jobname = '{JOB}'""")
if not ok: say("  ✗ could not check for an existing job: " + str(r)[:300]); done(7)
ok, r = sql(f"""select cron.schedule('{JOB}', '*/15 * * * *', $job$select public.legacy_mirror_scheduled('schedule')$job$) as jobid""")
if not ok: say("  ✗ scheduling failed: " + str(r)[:300]); done(8)
ok, j = sql(f"select jobname, schedule, active, command from cron.job where jobname = '{JOB}'")
good = ok and len(j) == 1 and j[0]["active"] is True and j[0]["schedule"] == "*/15 * * * *" and "legacy_mirror_scheduled('schedule')" in j[0]["command"]
say("  " + ("✓ exactly one job, every 15 minutes, active, calling legacy_mirror_scheduled('schedule')" if good else "✗ " + str(j)[:300]))
say("  Each run adds one row to legacy_mirror_run (outcome, counts, parity mismatches, legacy untouched).")
say()
say("RESULT: " + ("MIRROR SCHEDULED" if good else "CHECK THE ✗ LINES"))
done(0 if good else 9)
