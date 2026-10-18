#!/usr/bin/env python3
# 966 · CLIENT CARE AGREEMENT: THE BOOKING APP TERMS AND "CAN BOOK IN THE APP" (Samantha 2026-10-18: the Booking App needs
# its own terms because of the $15 fee for a month with no visits, signed at the care assessment; "Update Section 9 in the
# agreement with the new wording, keep it under Initials 1 of 6, add the Can book in the app box to Exhibit I, and update
# the tablet").
#  1. Database (agreement_book_966.sql): circle_contacts.app_book_choice, the latest booking choice for a person (signed
#     agreement or the office switch). Everyone starts with none, so nobody's booking changes today.
#  2. Stores the updated master agreement PDF next to the earlier three (they are never touched).
#  3. Redeploys client-agreement and agreement-sign (new wording; approving contacts sets booking from the signed choice),
#     family-gateway (a first sign-in follows the choice) and family-app-office (the office switch records the choice).
#  New agreements use the updated wording; one signed on an earlier wording is countersigned, printed and emailed on that
#  wording, exactly what the family read. Nothing is sent. Undo: redeploy the previous functions, then
#  agreement_book_966_rollback.sql.
import json, os, hashlib, re, subprocess, urllib.request, urllib.error
os.environ.setdefault("SB_STEP", "966")
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta, live_files, sha, API, MG, HIDE

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
BUCKET = "client-agreements"
# the column must exist before family-gateway reads it, so the database change runs first; the agreement functions next
FNS = ("client-agreement", "agreement-sign", "family-app-office", "family-gateway")
ok = lambda s: say("  ✓ " + s)
def run(args): p = subprocess.run(args, capture_output=True, text=True); return p.returncode, (p.stdout or ""), (p.stderr or "")
def stop(msg): bad(msg); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(2)
def mapof(name):
    src = open(os.path.join(FNROOT, "_shared", name)).read()
    return re.search(r"MASTER_PATH = '([^']+)'", src).group(1), re.search(r'PDF_SHA256 = "([0-9a-f]{64})"', src).group(1)

start("CLIENT CARE AGREEMENT: THE BOOKING APP TERMS AND \"CAN BOOK IN THE APP\"")
say("PART 1 · READ ONLY (nothing changes)")
mig = open(os.path.join(ROOT, "agreement_book_966.sql"), "rb").read()
ok("agreement_book_966.sql is the reviewed build") if hashlib.sha256(mig).hexdigest() == os.environ.get("SB_SQL_SHA", "") else stop("agreement_book_966.sql is not the reviewed build: nothing runs")
NEW_PATH, NEW_SHA = mapof("client-agreement-map.ts")
EARLIER = [mapof(n) for n in ("client-agreement-map-2026-10-18.ts", "client-agreement-map-2026-10-17.ts", "client-agreement-map-2026-10-16.ts")]
new = open(os.path.join(ROOT, "client-agreement", "client-care-agreement-rev-2026-10-18b.pdf"), "rb").read()
if hashlib.sha256(new).hexdigest() == os.environ.get("SB_PDF_SHA", "") == NEW_SHA: ok("the updated agreement PDF is the reviewed one, and it is the file the field map was measured on")
else: stop("the updated agreement PDF does not match the reviewed build or the field map")
if len({NEW_PATH} | {p for p, _ in EARLIER}) == 4: ok("the three earlier agreement field maps are kept, each under its own name")
else: stop("an earlier agreement field map was changed or renamed")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
MAIN = os.environ.get("SB_MAIN_REF", "origin/main"); BASE = os.environ.get("SB_BASE", "")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
files = sorted(set().union(*[L.need(FNROOT, f) for f in FNS]))
drift = [k for k in files if (lambda c: c[0] != 0 or c[1] != open(os.path.join(ROOT, k)).read())(run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"]))]
if drift: stop("this build isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the build is what is on GitHub's main")
def base_need(fn):
    """the files the build this was made on imported for fn (the same reading as cc_step_lib.need, from git)"""
    seen, todo = set(), [f"supabase/functions/{fn}/index.ts"]
    while todo:
        k = todo.pop()
        if k in seen: continue
        rc, src, _ = run(["git", "-C", ROOT, "show", f"{BASE}:{k}"])
        if rc != 0: continue
        seen.add(k)
        src = "\n".join(l for l in src.split("\n") if not re.match(r"\s*import\s+type\b", l))
        for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", src):
            todo.append(os.path.normpath(os.path.join(os.path.dirname(k), m[0] or m[1])))
    return seen
gate = {}
for fn in FNS:
    s, m = fmeta(REF, fn)
    if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})")
    gate[fn] = bool(m["verify_jwt"])
    okl, live = live_files(REF, fn)
    if not okl: stop(f"couldn't download the live {fn} to compare")
    odd, BN = [], base_need(fn)
    for k in sorted(L.need(FNROOT, fn)):
        rc, was, _ = run(["git", "-C", ROOT, "show", f"{BASE}:{k}"])
        base_sha = hashlib.sha256(was.encode()).hexdigest() if rc == 0 else None
        if live.get(k) is None and k not in BN: continue   # a file this build newly imports is not live yet: expected
        if live.get(k) not in (base_sha, sha(os.path.join(ROOT, k))): odd.append(k)
    if odd: stop(f"the live {fn} has code that isn't what this was built on (someone else's change not released or not merged): " + ", ".join(odd)[:240])
    say(f"  · {fn}: live version {m.get('version', '?')} is the code this was built on, gateway sign-in check {'on' if gate[fn] else 'off'} (kept)")
OLD_SHA = EARLIER[0][1]
ok1, r1 = sql(REF, f"""select to_regclass('public.circle_contacts') is not null as contacts,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'circle_contacts' and column_name = 'app_book_choice') as col_there,
  (select count(*) from public.client_agreements where status = 'draft' and pdf_sha256 = '{OLD_SHA}') as old_drafts,
  (select count(*) from public.client_agreements where status = 'signed' and pdf_sha256 = '{OLD_SHA}') as old_signed""")
if not ok1: stop(f"could not read the database: {r1}")
x = r1[0]
if not x["contacts"]: stop("the Family Circle table is missing. Tell Claude.")
say("  · the booking choice column is already there (kept)" if x["col_there"] else "  · the booking choice column is not there yet (this step adds it)")
say(f"  · agreements started on the 10-18 wording and not signed yet: {x['old_drafts']}" + (" (after this step, tap Start another on each client's card so they sign the Booking App terms)" if int(x["old_drafts"]) else ""))
say(f"  · agreements the family signed on the 10-18 wording, waiting for the office: {x['old_signed']}" + (" (countersign as usual: they stay on the wording the family read)" if int(x["old_signed"]) else ""))
sK, bK = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG())
SVC = ""
try: SVC = next((k.get("api_key", "") for k in json.loads(bK) if isinstance(k, dict) and k.get("name") == "service_role"), "") if sK == 200 else ""
except Exception: SVC = ""
HIDE.append(SVC)
if not SVC.startswith(("eyJ", "sb_secret_")): stop("could not read the server key needed to store the updated PDF")
ok("the server key for storing the updated PDF can be read")

def store(path, data):
    req = urllib.request.Request(f"{FNB}/storage/v1/object/{BUCKET}/{path}", data=data, method="POST",
        headers={"Authorization": "Bearer " + SVC, "apikey": SVC, "Content-Type": "application/pdf", "x-upsert": "false", "User-Agent": "cc-966/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
def fetch(path):
    req = urllib.request.Request(f"{FNB}/storage/v1/object/authenticated/{BUCKET}/{path}", headers={"Authorization": "Bearer " + SVC, "apikey": SVC, "User-Agent": "cc-966/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, r.read()
    except urllib.error.HTTPError as e: return e.code, b""
    except Exception: return None, b""
already = lambda s, b: s in (400, 409) and re.search(r"exists|Duplicate", b or "", re.I)

for (p, want), what in zip(EARLIER, ("the 10-18 agreement PDF", "the 10-17 agreement PDF", "the first agreement PDF")):
    sO, bO = fetch(p)
    if sO == 200 and hashlib.sha256(bO).hexdigest() == want: ok(f"{what} is stored and reads back byte for byte (it stays)")
    else: stop(f"{what} did not read back as expected ({sO})")
say("  · what changes: 1 column added (empty for everyone), 1 file added (the updated agreement PDF), 4 functions redeployed. Nothing sent, nothing in AxisCare, nobody's booking changed.")
if L.fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
okc, rc = sql(REF, mig.decode())
if not okc: bad(f"the database change did not go through: {rc}"); say("  RESULT: STOPPED. Nothing changed (the database change is all or nothing). Tell Claude."); done(4)
ok2, r2 = sql(REF, """select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'circle_contacts' and column_name = 'app_book_choice' and data_type = 'boolean') as col,
  (select count(*) from public.circle_contacts where app_book_choice is not null) as chosen""")
if not (ok2 and r2[0]["col"]): bad(f"the booking choice column did not read back: {r2}"); say("  RESULT: STOPPED before the PDF and functions. Tell Claude."); done(4)
ok(f"the booking choice column is there; people with a choice recorded: {r2[0]['chosen']}")
sU, bU = store(NEW_PATH, new)
if sU in (200, 201): ok("the updated agreement PDF is stored")
elif already(sU, bU): say("  · the updated agreement PDF was already stored; checking it is the same file below")
else: bad(f"the updated agreement PDF was not stored ({sU}): {(bU or '')[:160]}"); say("  RESULT: STOPPED. Only the empty column was added (safe on its own). Tell Claude."); done(5)
sN, bN = fetch(NEW_PATH)
if not (sN == 200 and hashlib.sha256(bN).hexdigest() == NEW_SHA):
    bad(f"the stored updated PDF does not read back as the reviewed file ({sN})"); say("  RESULT: STOPPED before the functions changed. Tell Claude."); done(6)
ok("the stored updated PDF reads back byte for byte")
for i, fn in enumerate(FNS):
    if not deploy(REF, FNROOT, fn, gate[fn]):
        say(f"  RESULT: STOPPED at {fn}. The functions before it are on the new build, which is safe on its own; still to deploy: {', '.join(FNS[i:])}.")
        say("  Running this step again finishes it. Tell Claude."); done(7)

say(); say("PART 3 · PROOF (nothing is sent)")
for fn in FNS:
    s1, _ = http("OPTIONS", f"{FNB}/functions/v1/{fn}"); ok(f"the pages can reach {fn}") if s1 == 200 else bad(f"{fn}: the browser check answered {s1}")
s2, b2 = http("POST", f"{FNB}/functions/v1/client-agreement", {"action": "contacts_apply", "id": "00000000-0000-4000-8000-000000000000", "people": []})
ok("approving contacts refuses anyone not signed in to the Hub (401)") if s2 == 401 else bad(f"contacts_apply answered a stranger {s2}: {b2[:120]}")
s3, b3 = http("POST", f"{FNB}/functions/v1/family-app-office", {"action": "can_book", "contact_id": 0, "on": True})
ok("the office booking switch refuses anyone not signed in to the Hub (401)") if s3 == 401 else bad(f"family-app-office answered a stranger {s3}: {b3[:120]}")
s4, b4 = http("POST", f"{FNB}/functions/v1/family-gateway", {"action": "home"})
ok("the Booking App refuses anyone not signed in (401)") if s4 == 401 else bad(f"family-gateway answered a stranger {s4}: {b4[:120]}")
s5, b5 = http("POST", f"{FNB}/functions/v1/agreement-sign", {"action": "open", "t": "x" * 48})
ok(f"the from-home door refuses a made-up link ({s5})") if s5 in (400, 401, 403, 404, 410) else bad(f"the from-home door answered a made-up link {s5}: {b5[:120]}")
say("  · tested before deploying: the agreement functions against a fake database and storage (a new agreement records the updated wording; one signed on the 10-18 wording is countersigned on it; approving a contact marked No turns their booking off, Yes turns it on, blank leaves it alone), and sign-in (a first sign-in follows the choice; someone already on keeps what the office set).")
say()
if L.fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · Tell Claude, who merges the Hub pull request next (the tablet's new pages). Nothing was sent by this step."); done(0)
