#!/usr/bin/env python3
# 419 (2026-10-02): close interviews still "booked" for applicants already marked no-show, and keep it that way.
# Runs noshow_bookings_419.sql (pinned) in one transaction. Sends nothing (noshow_notified_at is stamped so no automatic
# no-show message can pick these up). Proof uses a throwaway applicant inside a transaction that is rolled back.
import os, json, hashlib, urllib.request, urllib.error
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ["SB_TOKEN"].strip(); REF = "zngsgedlsxinbygwmxwn"
REPO = os.environ["SB_REPO"]; PIN = os.environ.get("SB_SQL_SHA", "")
API = f"https://api.supabase.com/v1/projects/{REF}/database/query"
lines = []
def say(s=""): print(s, flush=True); lines.append(str(s))
def sql(q):
    rq = urllib.request.Request(API, data=json.dumps({"query": q}).encode(), method="POST",
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-419/1.0"})
    try:
        with urllib.request.urlopen(rq, timeout=120) as r: return True, json.loads(r.read().decode())
    except urllib.error.HTTPError as e: return False, f"HTTP {e.code}: {e.read().decode()[:300]}"
    except Exception as e: return False, type(e).__name__
STUCK = ("select a.first_name || ' ' || left(coalesce(a.last_name,''),1) || '.' as who, a.status, "
         "to_char(b.starts_at at time zone 'America/Chicago', 'Mon DD HH12:MI AM') as was "
         "from interview_bookings b join job_applicants a on a.id = b.applicant_id "
         "where b.status = 'booked' and b.starts_at < now() order by b.starts_at")
try:
    say("419 · INTERVIEWS: NO-SHOWS STOP WAITING ON AN OUTCOME"); say("  (sends nothing)"); say()
    f = os.path.join(REPO, "noshow_bookings_419.sql")
    if hashlib.sha256(open(f, "rb").read()).hexdigest() != PIN: say("  ✗ the SQL is not the reviewed build. Nothing was run."); raise SystemExit(2)
    say("  ✓ the SQL is the reviewed build")
    ok, r = sql(STUCK)
    if not ok: say(f"  ✗ could not read the interviews ({r}). Nothing was changed."); raise SystemExit(1)
    say(f"  · past interviews still waiting on an outcome: {len(r)}")
    for x in r: say(f"      {x['who']} (applicant marked: {x['status']}), interview was {x['was']}")
    ok, w = sql("begin;\n" + open(f).read() + "\ncommit;")
    if not ok: say(f"  ✗ the change failed ({w}). Nothing was changed (one transaction)."); raise SystemExit(1)
    say("  ✓ installed: marking an applicant no-show by any route now closes their past interview too")
    ok, r2 = sql(STUCK)
    left = [x for x in (r2 if ok else []) if x["status"] == "noshow"]
    say(("  ✓" if ok and not left else "  ✗") + f" no-shows still waiting on an outcome: {len(left)}")
    others = [x for x in (r2 if ok else []) if x["status"] != "noshow"]
    if others:
        say(f"  · still waiting, and correctly so (not marked no-show): {len(others)}")
        for x in others: say(f"      {x['who']} (applicant: {x['status']}), interview was {x['was']}")
    ok, t = sql("begin; "
        "insert into job_applicants (id, first_name, last_name, status, source) values ('00000000-0000-4000-8000-000000000419', 'Proof419', 'Throwaway', 'reviewing', 'proof'); "
        "insert into interview_bookings (applicant_id, starts_at, ends_at, status) values ('00000000-0000-4000-8000-000000000419', now() - interval '2 hours', now() - interval '90 minutes', 'booked'); "
        "update job_applicants set status = 'noshow' where id = '00000000-0000-4000-8000-000000000419'; "
        "select status, (noshow_notified_at is not null) as quiet from interview_bookings where applicant_id = '00000000-0000-4000-8000-000000000419'; "
        "rollback;")
    good = ok and t and t[0].get("status") == "noshow" and t[0].get("quiet")
    say(("  ✓ test: a throwaway applicant marked no-show had their past interview closed, quietly (all rolled back)" if good
         else f"  ✗ the automatic close did not prove out: {t}"))
    ok, z = sql("select count(*)::int as n from job_applicants where first_name = 'Proof419'")
    say(("  ✓" if ok and z[0]["n"] == 0 else "  ✗") + " nothing from the test was left behind")
    say(); say("RESULT: " + ("DONE. Refresh the Interviews tab." if good and not left else "PARTLY DONE. Tell Claude."))
finally:
    open(REPORT, "w").write("\n".join(lines) + "\n")
