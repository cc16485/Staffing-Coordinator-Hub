#!/usr/bin/env python3
# Team Build mirror · production runner (linked plans -> staffing objects).
#   SB_STEP=dry       install (sha-checked) + dry run          (writes no Journey row)
#   SB_STEP=commit    mirror + parity + first logged run        (writes needs/asks/assignments for LINKED plans)
#   SB_STEP=schedule  one cron job every 15 minutes, verified
import json, os, hashlib, urllib.request, urllib.error, datetime as dt
from collections import Counter

STEP = os.environ.get("SB_STEP", "dry")
MIG = open(os.environ["SB_MIGFILE"], "rb").read() if os.environ.get("SB_MIGFILE") else b""
EXPECTED_SHA = os.environ.get("SB_EXPECTED_SHA", "")
REPORT = os.environ["SB_REPORT"]
LOCAL = os.environ.get("SB_LOCAL_SOCK")
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "")
JOB = "team-build-mirror"

lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w" if STEP == "dry" else "a").write("\n".join(lines) + "\n"); raise SystemExit(code)

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
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-team-build-mirror/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return True, json.loads(r.read().decode(errors="replace"))
    except urllib.error.HTTPError as e:
        return False, "HTTP %s: %s" % (e.code, e.read().decode(errors="replace")[:600])
    except Exception as e:
        return False, "%s: %s" % (type(e).__name__, e)

SNAP = """select (select md5(data::text) from app_data where key = 'staffing_plans') as leads_md5,
                 (select count(*) from staffing_need where origin_system = 'team_builder') as episodes,
                 (select count(*) from staffing_assignment where origin_system = 'team_builder') as facts,
                 (select count(*) from journey_episode) as person_episodes"""

def outcomes(rows):
    by = Counter(r["outcome"] for r in rows)
    say("  " + ", ".join(f"{k} {v}" for k, v in sorted(by.items())) + f"  ({len(rows)} rows)")
    for r in rows:
        say(f"    {r['plan_id']}: {r['outcome']} · {r['detail']}")
    return by

if STEP == "dry":
    say("TEAM BUILD MIRROR (linked plans -> Needs, Asks, Assignments)")
    say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC") + ("   (DISPOSABLE TEST TARGET)" if LOCAL else ""))
    say("One-way: Team Builder plans stay the authority and are only read. Only plans linked to a Journey are mirrored.")
    say()
    sha = hashlib.sha256(MIG).hexdigest()
    say("  migration sha256 " + sha + ("  ✓ proven build" if sha == EXPECTED_SHA else "  ✗ NOT the proven build"))
    if sha != EXPECTED_SHA: say("  STOP. Nothing was run."); done(2)
    ok, b = sql(SNAP); before = b[0] if ok else {}
    ok, res = sql(MIG.decode())
    if not ok: say("  ✗ STOPPED: the install did not complete (guard or self-check): " + str(res)[:400]); done(4)
    say("  ✓ installed: mirror, parity view, run log, scheduled wrapper")
    say(); say("== DRY RUN =========================================================")
    ok, rows = sql("select * from public.team_build_mirror(false)")
    if not ok: say("  ✗ dry run failed: " + str(rows)[:400]); done(5)
    by = outcomes(rows)
    ok, a = sql(SNAP); after = a[0] if ok else {}
    same = all(after.get(k) == before.get(k) for k in ("leads_md5", "episodes", "facts"))
    say(); say("  " + ("✓ nothing written; plans untouched" if same else "✗ something changed during the dry run"))
    say(f"WOULD_OPEN {by.get('would_mirror', 0)}")
    done(0 if same else 6)

if STEP == "commit":
    say(); say("== MIRROR ==========================================================")
    ok, b = sql(SNAP); before = b[0]
    ok, rows = sql("select * from public.team_build_mirror(true)")
    if not ok: say("  ✗ the mirror failed: " + str(rows)[:400]); done(7)
    by = outcomes(rows)
    ok, a = sql(SNAP); after = a[0]
    say(f"  Team Build needs {before['episodes']} -> {after['episodes']} · assignments {before['facts']} -> {after['facts']}")
    say("  plans " + ("✓ untouched" if after["leads_md5"] == before["leads_md5"] else "⚠ changed during the run (live activity); the mirror only reads it"))
    say("  Journey episodes " + ("✓ unchanged (" + str(after["person_episodes"]) + ")" if after["person_episodes"] == before["person_episodes"] else "✗ changed"))
    ok, par = sql("select * from public.team_build_parity")
    mism = [p for p in (par if ok else []) if p["needs_match"] is False or p["assigned_match"] is False]
    linked = [p for p in (par if ok else []) if p["linked"]]
    say(f"  parity: {len(linked)} linked plan(s) compared, {len(mism)} mismatch(es); {len(par) - len(linked) if ok else '?'} not linked yet")
    for p in mism: say(f"    ≠ {p['plan_id']}: shifts {p['slots']} vs open needs {p['open_needs']} · confirmed {p['confirmed']} vs assigned {p['assigned']}")
    say(); say("== FIRST LOGGED RUN ================================================")
    ok, r = sql("select public.team_build_mirror_scheduled('manual') as r")
    row = (r[0]["r"] if isinstance(r[0]["r"], dict) else json.loads(r[0]["r"])) if ok else {}
    for k in ("outcome", "plans_seen", "mirrored", "not_linked", "diverged", "errors", "needs_written",
              "asks_written", "assignments_written", "parity_mismatches", "plans_unchanged", "detail"):
        say(f"    {k:22} {row.get(k)}")
    healthy = row.get("outcome") == "ok" and row.get("needs_written") == 0 and row.get("parity_mismatches") == 0 \
              and not by.get("error")
    say("HEALTH " + ("OK" if healthy else "NOT_OK"))
    done(0 if healthy else 8)

# schedule
say(); say("== SCHEDULE ========================================================")
ok, r = sql(f"select cron.unschedule(jobid) from cron.job where jobname = '{JOB}'")
if not ok: say("  ✗ could not check for an existing job: " + str(r)[:300]); done(9)
ok, r = sql(f"select cron.schedule('{JOB}', '*/15 * * * *', $job$select public.team_build_mirror_scheduled('schedule')$job$)")
if not ok: say("  ✗ scheduling failed: " + str(r)[:300]); done(10)
ok, j = sql(f"select schedule, active, command from cron.job where jobname = '{JOB}'")
good = ok and len(j) == 1 and j[0]["active"] is True and "team_build_mirror_scheduled('schedule')" in j[0]["command"]
say("  " + ("✓ exactly one job, every 15 minutes, active. Its first run is the next quarter hour after now." if good else "✗ " + str(j)[:300]))
say(); say("RESULT: " + ("TEAM BUILD MIRROR SCHEDULED" if good else "CHECK THE ✗ LINES"))
done(0 if good else 11)
