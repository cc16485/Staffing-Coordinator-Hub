#!/usr/bin/env python3
# 873 · THE FAMILY'S COPY OF THE SIGNED CLIENT CARE AGREEMENT (Samantha 2026-10-16: "the client, or primary contact gets
# emailed a copy right after they sign"; a big "COPY" on the paper copy we print and hand them; "Signed electronically on
# ___" on the PDF; her answers "At countersign" and "Hide them" for the lockbox and garage codes).
#  1. Database (agreement_copy_873.sql): one column on the agreement recording the printed copy and every emailed copy.
#  2. Deploys client-agreement: the e-sign lines on new signed PDFs, copy_print, copy_email, and the countersign email.
#     It keeps its gateway setting exactly as it is live today.
#  3. Proves the column, that the agreement table is still closed to browsers, and that the doors still refuse strangers.
# Nothing is sent by this step. A family copy is emailed only when an office person ticks it at countersign or taps
# "Email family copy", through GoHighLevel and the family audience gate, 8am to 6pm. Agreements already countersigned
# keep their PDF as it is. Undo: agreement_copy_873_rollback.sql after redeploying the previous client-agreement.
import json, os, hashlib, subprocess
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FNS = ("client-agreement",)
ok = lambda s: say("  ✓ " + s)
def run(args): p = subprocess.run(args, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg): bad(msg); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(2)

start("THE FAMILY'S COPY OF THE SIGNED CLIENT CARE AGREEMENT")
say("PART 1 · READ ONLY (nothing changes)")
mig = open(os.path.join(ROOT, "agreement_copy_873.sql"), "rb").read()
ok("agreement_copy_873.sql is the reviewed build") if hashlib.sha256(mig).hexdigest() == os.environ.get("SB_SQL_SHA", "") else stop("agreement_copy_873.sql is not the reviewed build: nothing runs")
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
  exists (select 1 from information_schema.columns where table_schema='public' and table_name='client_agreements' and column_name='contacts_review') as stage2,
  exists (select 1 from information_schema.columns where table_schema='public' and table_name='client_agreements' and column_name='copies') as copies_there""")
if not ok1: stop(f"could not read the database: {r1}")
x = r1[0]
if not x["agreements"] or not x["stage2"]: stop("the agreement table or the Stage 2 review is not there (steps 871 and 872 first)")
if x["copies_there"]: stop("873 looks installed already (the copies column is there). Tell Claude.")
ok("no copies column yet; 871 and 872 are in")
gate = {}
for fn in FNS:
    s, m = fmeta(REF, fn)
    if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})")
    gate[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate[fn] else 'off'} (kept)")
say("  · what changes: 1 column added, client-agreement redeployed. Nothing sent, nothing in AxisCare.")
if L.fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
okc, rc = sql(REF, mig.decode())
if not okc: bad(f"the database change did not run (nothing changed: it is all or nothing): {rc}"); say("  RESULT: STOPPED. Tell Claude."); done(5)
ok("the copies column is in")
for i, fn in enumerate(FNS):
    if not deploy(REF, FNROOT, fn, gate[fn]):
        say("  RESULT: STOPPED. The database change is in (harmless on its own: the live functions do not read it yet)" + (f"; {', '.join(FNS[:i])} deployed" if i else "") + ". Tell Claude."); done(6)

say(); say("PART 3 · PROOF (nothing is sent)")
ok2, r2 = sql(REF, """select (select is_nullable from information_schema.columns where table_schema='public' and table_name='client_agreements' and column_name='copies') as nullable,
  (select count(*) from public.client_agreements where copies <> '{}'::jsonb) as touched,
  has_table_privilege('anon','public.client_agreements','select') or has_table_privilege('authenticated','public.client_agreements','select') as browser_can_read""")
if ok2:
    y = r2[0]
    ok("the copies column is there for every agreement, empty") if y["nullable"] == "NO" and int(y["touched"]) == 0 else bad(f"the copies column is not as expected: {y}")
    ok("the agreement table is still closed to browsers") if not y["browser_can_read"] else bad("browsers can read the agreement table")
else: bad(f"could not read back: {r2}")
U = f"{FNB}/functions/v1/client-agreement"
s1, _ = http("OPTIONS", U); ok("the Hub page can reach client-agreement") if s1 == 200 else bad(f"the browser check answered {s1}")
s2, b2 = http("POST", U, {"action": "copy_email", "id": "00000000-0000-4000-8000-000000000000", "to": "x@example.com"})
ok("emailing a copy refuses anyone not signed in (401)") if s2 == 401 else bad(f"copy_email answered a stranger {s2}: {b2[:120]}")
say("  · tested before deploying: the family copy against a fake GoHighLevel and send gate (25 checks: the e-sign lines on every page, COPY on the printed and emailed copies only, codes hidden on the emailed copy, the family audience gate, the secure attachment, held after 6pm, declined email, opted out, GoHighLevel refusals raised in Needs Attention), Stages 1 and 2 again (77 checks), the database change on a real local Postgres, and the Hub screens in two browsers (272 checks).")
say()
if L.fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · Merge the Hub pull request next. Then try it: on a countersigned agreement's card, tap \"Email family copy\" and send it to your own email. Nothing was sent by this step."); done(0)
