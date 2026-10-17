#!/usr/bin/env python3
# 874 · CLIENT CARE AGREEMENT, STAGE 3: SIGNING FROM HOME (Samantha 2026-10-17: "start stage 3"; her answers "Office picks each
# time", "6-digit code", "7 days", code "Any time").
#  1. Database (agreement_links_874.sql): the links table. Only hashes of the link's secret, the code and the session.
#  2. Deploys client-agreement (Send to sign from home, cancel, the link's progress; the family signature is one shared
#     step) and the NEW public door agreement-sign (no Hub sign-in: the link plus a 6-digit code opens ONE agreement).
#  3. Proves the table is closed to browsers and that both doors refuse strangers and made-up links.
# Nothing is sent by this step. A link goes only when an office person taps "Send the link" (8am to 6pm); a code goes
# only when the family taps "Send me a code" (any hour, her answer). Undo: delete agreement-sign, redeploy the previous
# client-agreement, then agreement_links_874_rollback.sql.
import json, os, hashlib, subprocess
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FNS = ("client-agreement", "agreement-sign")
NEW = {"agreement-sign"}   # a new function: must not exist yet; deployed with the gateway sign-in check OFF (it is a public door)
ok = lambda s: say("  ✓ " + s)
def run(args): p = subprocess.run(args, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg): bad(msg); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(2)

start("CLIENT CARE AGREEMENT, STAGE 3: SIGNING FROM HOME")
say("PART 1 · READ ONLY (nothing changes)")
mig = open(os.path.join(ROOT, "agreement_links_874.sql"), "rb").read()
ok("agreement_links_874.sql is the reviewed build") if hashlib.sha256(mig).hexdigest() == os.environ.get("SB_SQL_SHA", "") else stop("agreement_links_874.sql is not the reviewed build: nothing runs")
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
ok1, r1 = sql(REF, """select exists (select 1 from information_schema.columns where table_schema='public' and table_name='client_agreements' and column_name='copies') as stage873,
  to_regclass('public.client_agreement_links') is not null as links_there""")
if not ok1: stop(f"could not read the database: {r1}")
x = r1[0]
if not x["stage873"]: stop("the family-copy step is not there (step 873 first)")
if x["links_there"]: stop("874 looks installed already (the links table is there). Tell Claude.")
ok("no links table yet; 871, 872 and 873 are in")
gate = {}
for fn in FNS:
    s, m = fmeta(REF, fn)
    if fn in NEW:
        if s == 404: gate[fn] = False; say(f"  · {fn} is new: it will be deployed with the gateway sign-in check off (a public door; the link and the code are its lock)")
        elif s == 200: stop(f"a {fn} function is already deployed. Tell Claude.")
        else: stop(f"couldn't check the functions ({s})")
        continue
    if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})")
    gate[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate[fn] else 'off'} (kept)")
say("  · what changes: 1 new table, client-agreement redeployed, 1 new public function (agreement-sign). Nothing sent, nothing in AxisCare.")
if L.fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
okc, rc = sql(REF, mig.decode())
if not okc: bad(f"the database change did not run (nothing changed: it is all or nothing): {rc}"); say("  RESULT: STOPPED. Tell Claude."); done(5)
ok("the links table is in, locked to the server only")
for i, fn in enumerate(FNS):
    if not deploy(REF, FNROOT, fn, gate[fn]):
        say("  RESULT: STOPPED. The database change is in (harmless on its own: the live functions do not read it yet)" + (f"; {', '.join(FNS[:i])} deployed" if i else "") + ". Tell Claude."); done(6)

say(); say("PART 3 · PROOF (nothing is sent)")
ok2, r2 = sql(REF, """select (select relrowsecurity from pg_class where oid = 'public.client_agreement_links'::regclass) as rls,
  (select count(*) from public.client_agreement_links) as links,
  has_table_privilege('anon','public.client_agreement_links','select') or has_table_privilege('authenticated','public.client_agreement_links','select')
   or has_table_privilege('anon','public.client_agreement_links','insert') or has_table_privilege('authenticated','public.client_agreement_links','insert') as browser_can_touch""")
if ok2:
    y = r2[0]
    ok("no links yet; row security on and no browser role can read or write the links (only the two functions can)") if y["rls"] and not y["browser_can_touch"] and int(y["links"]) == 0 else bad(f"the links table is not as expected: {y}")
else: bad(f"could not read back: {r2}")
P = f"{FNB}/functions/v1/agreement-sign"
p1, _ = http("OPTIONS", P); ok("a family's phone can reach the public door (the browser check answers)") if p1 == 200 else bad(f"the public door's browser check answered {p1}")
p2, pb2 = http("POST", P, {"action": "open", "t": "A" * 43}); ok("a made-up link opens nothing (404)") if p2 == 404 and "bad_link" in pb2 else bad(f"a made-up link answered {p2}: {pb2[:120]}")
p3, pb3 = http("POST", P, {"action": "get", "t": "short"}); ok("a cut-off link opens nothing (400)") if p3 == 400 else bad(f"a cut-off link answered {p3}: {pb3[:120]}")
U = f"{FNB}/functions/v1/client-agreement"
s1, _ = http("OPTIONS", U); ok("the Hub page can reach client-agreement") if s1 == 200 else bad(f"the browser check answered {s1}")
s2, b2 = http("POST", U, {"action": "link_send", "id": "00000000-0000-4000-8000-000000000000", "to_name": "X Y", "phone": "4175550100", "channels": ["sms"]})
ok("sending a link refuses anyone not signed in to the Hub (401)") if s2 == 401 else bad(f"link_send answered a stranger {s2}: {b2[:120]}")
say("  · tested before deploying: the office link and the public door against a fake database, send gate and GoHighLevel (46 checks: only hashes stored, 7 days, one live link, cancelled/replaced/expired links refused, codes any hour and only on their tap, 5 tries, 10 minutes, 6 codes, 2-hour session, office fields locked, the signature record saying how they signed and how the code was checked, the countersign card), Stages 1, 2 and the family copy again (102 checks), the table on a real local Postgres (11 checks), and the Hub screens in two browsers at phone and tablet sizes (357 checks).")
say()
if L.fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · Merge the Hub pull request next. Then try it on yourself: start an agreement, open \"Send to sign from home\", and send it to your own cell. Nothing was sent by this step."); done(0)
