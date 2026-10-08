#!/usr/bin/env python3
# 528 · GRIEVANCE AS A CLIENT ISSUE KIND (Samantha 2026-10-08, "grievance log"). Adds one row to issue_category
# (client-issues/grievance.sql): a grievance is reported, owned, answered and followed up like any client issue, with its own
# rule for what "resolved" means. Changes nothing else; texts and emails nothing. Safe to run again.
import json, os, re, urllib.request, urllib.error, datetime as dt, sys, hashlib
REPORT = os.environ["SB_REPORT"]; ROOT = os.environ["SB_ROOT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))
lines = []; fails = []
def say(s=""):
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", str(s)); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-528/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, {"Authorization": "Bearer " + TOKEN})
    if s not in (200, 201): return False, b[:300]
    try: return True, json.loads(b)
    except Exception: return False, b[:300]
sha = lambda p_: hashlib.sha256(open(p_, "rb").read()).hexdigest()
FILE = os.path.join(ROOT, "client-issues", "grievance.sql")
say("528 · GRIEVANCE AS A CLIENT ISSUE KIND"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for name, want in SHAS.items():
    p_ = os.path.join(ROOT, name); have_ = sha(p_) if os.path.exists(p_) else "(missing)"
    say(f"  ✓ {name} is the reviewed build") if have_ == want else bad(f"{name} is not the reviewed build: nothing runs")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(2)
ok, r = sql("select count(*)::int as n, count(*) filter (where code = 'grievance')::int as g from public.issue_category")
if not ok or not r: bad("couldn't read the issue kinds: " + str(r)); done(3)
say(f"  ✓ {r[0]['n']} issue kinds today" + ("; Grievance is already there (an earlier run)" if r[0]["g"] else ""))
before = r[0]["n"]
say(); say("PART 2 · CHANGE")
ok, r2 = sql(open(FILE).read())
say("  ✓ the Grievance kind is in place") if ok else bad("the Grievance kind did not install: " + str(r2))
if fails: say("  RESULT: STOPPED. Nothing else was changed."); done(5)
say(); say("PART 3 · PROOF")
ok, r3 = sql("select code, label, target_hours, follow_up_required, follow_up_days, notify_beyond_owner, (select count(*)::int from public.issue_category) as n from public.issue_category where code = 'grievance'")
g = (r3 or [{}])[0] if ok else {}
if g.get("code") == "grievance" and g.get("follow_up_required") and g.get("follow_up_days") == 14 and g.get("target_hours") == 24 and g.get("n") in (before, before + 1):
    say("  ✓ Grievance: first response within a day, a follow-up check 14 days after it is resolved, Samantha sees it")
    say(f"  ✓ nothing else changed ({g.get('n')} issue kinds)")
else: bad(f"the Grievance kind is not as reviewed: {g}")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · a grievance can now be reported as its own kind of client issue. Nothing was texted or emailed.")
done(0)
