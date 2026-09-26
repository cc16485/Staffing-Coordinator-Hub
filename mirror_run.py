#!/usr/bin/env python3
# Legacy coverage mirror · production runner.
#   SB_MODE=dry     install/verify the mirror function (sha-checked), then DRY RUN (writes no staffing row)
#   SB_MODE=commit  run the mirror (writes canonical shadow rows through the Doors), then the parity report
# Legacy app_data.coverage_cases is only read; the runner proves it is unchanged.
import json, os, hashlib, urllib.request, urllib.error, datetime as dt
from collections import Counter, defaultdict

MODE = os.environ.get("SB_MODE", "dry")
MIG = open(os.environ["SB_MIGFILE"], "rb").read()
EXPECTED_SHA = os.environ["SB_EXPECTED_SHA"]
PAR = open(os.environ["SB_PARFILE"]).read()
REPORT = os.environ["SB_REPORT"]
LOCAL = os.environ.get("SB_LOCAL_SOCK")
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "")

lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)

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
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-legacy-mirror/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return True, json.loads(r.read().decode(errors="replace"))
    except urllib.error.HTTPError as e:
        return False, "HTTP %s: %s" % (e.code, e.read().decode(errors="replace")[:600])
    except Exception as e:
        return False, "%s: %s" % (type(e).__name__, e)

SNAP = """select (select md5(data::text) from app_data where key = 'coverage_cases') as legacy_md5,
                 (select count(*) from staffing_need) as needs, (select count(*) from staffing_ask) as asks,
                 (select count(*) from staffing_reply) as replies, (select count(*) from staffing_assignment) as assignments,
                 (select count(*) from journey_episode) as episodes"""

say("LEGACY COVERAGE MIRROR · " + ("INSTALL + DRY RUN (no staffing row written)" if MODE == "dry" else "MIRROR + PARITY"))
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC") + ("   (DISPOSABLE TEST TARGET)" if LOCAL else ""))
say("One-way shadow: coverage_cases stays the only authority and is only read.")
say()

ok, b = sql(SNAP)
if not ok: say("  ✗ could not read the starting state: " + str(b)); done(3)
before = b[0]

if MODE == "dry":
    sha = hashlib.sha256(MIG).hexdigest()
    say("  mirror function sha256 " + sha + ("  ✓ proven build" if sha == EXPECTED_SHA else "  ✗ NOT the proven build"))
    if sha != EXPECTED_SHA: say("  STOP. Nothing was run."); done(2)
    ok, res = sql(MIG.decode())
    if not ok: say("  ✗ STOPPED: the install did not complete: " + str(res)[:400]); done(4)
    ok, v = sql("""select p.prosecdef as definer,
                          has_function_privilege('authenticated', p.oid, 'execute') as browser_exec
                     from pg_proc p where p.oid = 'public.legacy_mirror_coverage(boolean)'::regprocedure""")
    good = ok and v and v[0]["definer"] is False and v[0]["browser_exec"] is False
    say("  install: " + ("✓ installed; caller privileges; browser cannot run it" if good else "✗ " + str(v)))
    if not good: done(5)
else:
    ok, v = sql("select 1 from pg_proc where oid = 'public.legacy_mirror_coverage(boolean)'::regprocedure")
    if not ok or not v: say("  ✗ the mirror function is not installed. Nothing was run."); done(4)
say()

ok, rows = sql(f"select * from public.legacy_mirror_coverage({'true' if MODE == 'commit' else 'false'})")
if not ok: say("  ✗ the mirror run failed: " + str(rows)[:500]); done(6)
by = Counter(r["outcome"] for r in rows)
say("== OUTCOME BY CASE ================================================")
say("  " + ", ".join(f"{k} {v}" for k, v in sorted(by.items())) + f"  (of {len(rows)} legacy cases)")
reasons = defaultdict(list)
for r in rows:
    if r["outcome"] in ("unmapped", "skipped", "error", "diverged"):
        key = r["detail"].split(" (")[0] if r["outcome"] == "unmapped" else r["detail"]
        reasons[(r["outcome"], key)].append(r["case_id"])
if reasons:
    say(); say("  Not mirrored, grouped by reason:")
    for (o, k), ids in sorted(reasons.items(), key=lambda x: (-len(x[1]), x[0])):
        say(f"    {o:9} {len(ids):3}  {k}")
        say("              " + ", ".join(ids[:12]) + (" …" if len(ids) > 12 else ""))
say(); say("  " + ("Would mirror:" if MODE == "dry" else "Mirrored:"))
for r in rows:
    if r["outcome"] in ("would_mirror", "mirrored"):
        say(f"    {r['case_id']}: {r['detail']}")
say()

ok, a = sql(SNAP); after = a[0] if ok else {}
legacy_ok = after.get("legacy_md5") == before.get("legacy_md5")
say("== SAFETY =========================================================")
say("  legacy coverage_cases " + ("✓ byte-identical before and after" if legacy_ok else "⚠ changed during the run (live activity) — the mirror only reads it"))
if MODE == "dry":
    unchanged = all(after.get(k) == before.get(k) for k in ("needs", "asks", "replies", "assignments", "episodes"))
    say("  staffing rows " + ("✓ none written by the dry run " if unchanged else "✗ changed ") + json.dumps({k: after.get(k) for k in ("needs","asks","replies","assignments")}))
    say(); say("RESULT: " + ("DRY RUN COMPLETE · review, then run the mirror" if unchanged else "CHECK THE ✗ LINES"))
    done(0 if unchanged else 7)

say("  staffing rows before " + json.dumps({k: before.get(k) for k in ("needs","asks","replies","assignments")})
    + " · after " + json.dumps({k: after.get(k) for k in ("needs","asks","replies","assignments")}))
say("  Journey episodes " + ("✓ unchanged (" + str(after.get("episodes")) + ")" if after.get("episodes") == before.get("episodes") else "✗ changed"))
say()
ok, par = sql(PAR)
say("== PARITY: legacy vs canonical shadow =============================")
if not ok: say("  ✗ " + str(par)[:300]); done(8)
mirrored = [p for p in par if p["canonical"] != "not mirrored"]
dims = ["status_match", "asks_match", "yes_match", "asked_match", "covered_match"]
mism = [p for p in mirrored if any(p[d] is False for d in dims)]
say(f"  {len(mirrored)} mirrored, {len(par) - len(mirrored)} not mirrored (reasons above)")
say("  mirrored cases agreeing on every checked point: " + str(len(mirrored) - len(mism)))
for p in mism:
    say(f"    ≠ {p['case_id']}  legacy {p['legacy_status']} · canonical {p['canonical']} · asks {p['asks_legacy_vs_canonical']} · "
        + ", ".join(d.replace('_match', '') for d in dims if p[d] is False))
say()
say("RESULT: " + ("MIRRORED · every difference is listed above" if not by.get("error") else "MIRRORED WITH ERRORS · see the error lines"))
done(0 if not by.get("error") else 9)
