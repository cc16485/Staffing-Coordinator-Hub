#!/usr/bin/env python3
# 872 · CLIENT CARE AGREEMENT, STAGE 2: SIGNED CONTACTS INTO AXISCARE AND THE FAMILY CIRCLE (Samantha 2026-10-16: "yes start
# stage 2"; "Checklist" for what AxisCare's API cannot set; "Separately" for running-late and caregiver-change texts).
#  1. Database (agreement_contacts_872.sql, all or nothing): a running-late switch for each Family Circle member, added ONCE
#     with everyone's current choice carried over (nobody's texts change today); a link from a member back to the agreement
#     they came from; a column on the agreement for the office review and its checklist.
#  2. Deploys client-agreement (the review: contacts / contacts_apply / contacts_todo), then late-alert and late-watch
#     (running-late texts follow the new switch). Each keeps its gateway setting exactly as it is live today.
#  3. Proves the switch carried everyone's choice over, the agreement table is still closed to browsers, and the doors
#     still refuse strangers.
# Nothing is texted, emailed or written to AxisCare by this step. AxisCare changes only when an office person reviews a
# signed agreement's contacts and taps Approve. Undo: agreement_contacts_872_rollback.sql after redeploying the previous
# functions.
import json, os, hashlib, subprocess
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FNS = ("client-agreement", "late-alert", "late-watch")
ok = lambda s: say("  ✓ " + s)
def run(args): p = subprocess.run(args, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg): bad(msg); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(2)

start("CLIENT CARE AGREEMENT, STAGE 2: SIGNED CONTACTS INTO AXISCARE AND THE FAMILY CIRCLE")
say("PART 1 · READ ONLY (nothing changes)")
mig = open(os.path.join(ROOT, "agreement_contacts_872.sql"), "rb").read()
ok("agreement_contacts_872.sql is the reviewed build") if hashlib.sha256(mig).hexdigest() == os.environ.get("SB_SQL_SHA", "") else stop("agreement_contacts_872.sql is not the reviewed build: nothing runs")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
# every file each function uses must match GitHub's main, so nobody's newer work is undone (run after the PR is merged)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
for fn in FNS:
    drift = []
    for k in sorted(L.need(FNROOT, fn)):
        c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
        if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
    if drift: stop(f"{fn} isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
    ok(f"{fn}: the reviewed build is what is on GitHub's main")
ok1, r1 = sql(REF, """select to_regclass('public.client_agreements') is not null as agreements,
  exists (select 1 from information_schema.columns where table_schema='public' and table_name='circle_contacts' and column_name='wants_late') as late_there,
  exists (select 1 from information_schema.columns where table_schema='public' and table_name='client_agreements' and column_name='contacts_review') as review_there,
  (select count(*) from public.circle_contacts) as members,
  (select count(*) from public.circle_contacts where wants_changes is false) as no_changes""")
if not ok1: stop(f"could not read the database: {r1}")
x = r1[0]
if not x["agreements"]: stop("the agreement table is not there (step 871 first)")
if x["late_there"] or x["review_there"]: stop("872 looks installed already (the new columns are there). Tell Claude.")
MEMBERS, NO_CHANGES = int(x["members"]), int(x["no_changes"])
ok(f"no running-late switch yet; {MEMBERS} Family Circle members, {NO_CHANGES} of them with caregiver-change texts off (they keep running-late texts off too)")
gate = {}
for fn in FNS:
    s, m = fmeta(REF, fn)
    if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})")
    gate[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate[fn] else 'off'} (kept)")
say("  · what changes: 3 columns and 1 index added, 3 functions redeployed. Nothing in AxisCare, nothing sent, nobody's texts change.")
if L.fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
okc, rc = sql(REF, mig.decode())
if not okc: bad(f"the database change did not run (nothing changed: it is all or nothing): {rc}"); say("  RESULT: STOPPED. Tell Claude."); done(5)
ok("the running-late switch, the link back to the agreement and the review column are in")
for i, fn in enumerate(FNS):
    if not deploy(REF, FNROOT, fn, gate[fn]):
        say("  RESULT: STOPPED. The database change is in (harmless on its own: the live functions do not read it yet)" + (f"; {', '.join(FNS[:i])} deployed" if i else "") + ". Tell Claude."); done(6)

say(); say("PART 3 · PROOF (nothing is sent)")
ok2, r2 = sql(REF, """select (select count(*) from public.circle_contacts) as members,
  (select count(*) from public.circle_contacts where wants_late is false) as late_off,
  (select count(*) from public.circle_contacts where wants_late is distinct from coalesce(wants_changes, true)) as differ,
  (select is_nullable from information_schema.columns where table_schema='public' and table_name='circle_contacts' and column_name='wants_late') as nullable,
  has_table_privilege('anon','public.client_agreements','select') or has_table_privilege('authenticated','public.client_agreements','select') as browser_can_read,
  exists (select 1 from pg_indexes where indexname = 'circle_contacts_from_agreement') as one_per_contact""")
if ok2:
    y = r2[0]
    ok(f"every Family Circle member is still there ({y['members']})") if int(y["members"]) == MEMBERS else bad(f"member count changed: {MEMBERS} -> {y['members']}")
    ok(f"running-late switch carried over for everyone: {y['late_off']} off, exactly the {NO_CHANGES} with caregiver-change texts off") if int(y["late_off"]) == NO_CHANGES and int(y["differ"]) == 0 and y["nullable"] == "NO" else bad(f"the carry-over is not as expected: {y}")
    ok("the agreement table is still closed to browsers; one Family Circle member per agreement contact") if not y["browser_can_read"] and y["one_per_contact"] else bad(f"not as expected: {y}")
else: bad(f"could not read back: {r2}")
U = f"{FNB}/functions/v1/client-agreement"
s1, _ = http("OPTIONS", U); ok("the Hub page can reach client-agreement") if s1 == 200 else bad(f"the browser check answered {s1}")
s2, b2 = http("POST", U, {"action": "contacts", "id": "00000000-0000-4000-8000-000000000000"})
ok("the contacts review refuses anyone not signed in (401)") if s2 == 401 else bad(f"the contacts review answered a stranger {s2}: {b2[:120]}")
s3, b3 = http("POST", f"{FNB}/functions/v1/late-alert", {"action": "view"})
ok(f"late-alert still refuses a caller with no sign-in ({s3})") if s3 in (401, 403) else bad(f"late-alert answered a stranger {s3}: {b3[:120]}")
say("  · tested before deploying: the review against a fake AxisCare and database (37 checks: slots matched by name, nobody else's slot touched, HIPAA and Medical Decisions from the signed agreement, read-back, change log, typo fixes, retries without duplicates, the checklist), the database change on a real local Postgres (11 checks), the running-late and caregiver-change texts (95 checks), and the Hub screens in two browsers (238 checks).")
say()
if L.fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · Merge the Hub pull request next; then a signed agreement's card has \"Review contacts\". Nothing was sent, and nothing changed in AxisCare."); done(0)
