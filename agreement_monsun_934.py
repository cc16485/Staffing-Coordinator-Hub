#!/usr/bin/env python3
# 934 · CLIENT CARE AGREEMENT: OVERTIME COUNTED MONDAY TO SUNDAY (Samantha 2026-10-18: the pay week runs Monday to Sunday,
# so the agreement's overtime sentence now says "in any Monday through Sunday week", not "any Thursday through Wednesday
# timesheet period"; and "add the agreement to Forms & Templates too").
#  Stores the updated master agreement PDF next to the earlier two (they are never touched), and redeploys client-agreement
#  and agreement-sign. New agreements use the updated wording; one signed on an earlier wording is countersigned, printed and
#  emailed on that wording, exactly what the family read. Every fill-in box sits where it did on 2026-10-17 (measured).
#  Then saves the blank agreement in Forms & Templates (Contracts & agreements), once. No other database change. Nothing is sent.
import json, os, hashlib, re, subprocess, urllib.request, urllib.error
from datetime import datetime, timezone
os.environ.setdefault("SB_STEP", "934")
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta, API, MG, HIDE, lit

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
BUCKET = "client-agreements"; DOCS_BUCKET = "agency-docs"
FNS = ("client-agreement", "agreement-sign")
DOC_ID = "8e9636b4-5b3f-40f6-82cc-040f713947f8"     # the Forms & Templates item, fixed so a second run never adds a second one
DOC_PATH = f"contract/{DOC_ID}.pdf"
ok = lambda s: say("  ✓ " + s)
def run(args): p = subprocess.run(args, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg): bad(msg); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(2)
def mapof(name):
    src = open(os.path.join(FNROOT, "_shared", name)).read()
    return re.search(r"MASTER_PATH = '([^']+)'", src).group(1), re.search(r'PDF_SHA256 = "([0-9a-f]{64})"', src).group(1)

start("CLIENT CARE AGREEMENT: OVERTIME COUNTED MONDAY TO SUNDAY")
say("PART 1 · READ ONLY (nothing changes)")
NEW_PATH, NEW_SHA = mapof("client-agreement-map.ts")
OLD_PATH, OLD_SHA = mapof("client-agreement-map-2026-10-17.ts")
FIRST_PATH, FIRST_SHA = mapof("client-agreement-map-2026-10-16.ts")
new = open(os.path.join(ROOT, "client-agreement", "client-care-agreement-rev-2026-10-18.pdf"), "rb").read()
old = open(os.path.join(ROOT, "client-agreement", "client-care-agreement-rev-2026-10-17.pdf"), "rb").read()
first = open(os.path.join(ROOT, "client-agreement", "client-care-agreement-rev-2026-10.pdf"), "rb").read()
if hashlib.sha256(new).hexdigest() == os.environ.get("SB_PDF_SHA", "") == NEW_SHA: ok("the updated agreement PDF is the reviewed one, and it is the file the field map was measured on")
else: stop("the updated agreement PDF does not match the reviewed build or the field map")
if hashlib.sha256(old).hexdigest() == OLD_SHA and hashlib.sha256(first).hexdigest() == FIRST_SHA and len({NEW_PATH, OLD_PATH, FIRST_PATH}) == 3:
    ok("the two earlier agreement PDFs and their field maps are kept unchanged, each under its own name")
else: stop("an earlier agreement PDF or its field map changed")
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
ok1, r1 = sql(REF, f"""select to_regclass('public.client_agreement_links') is not null as stage3, to_regproc('public.upsert_app_data_item') is not null as upsert,
  (select count(*) from public.client_agreements where status = 'draft' and pdf_sha256 = '{OLD_SHA}') as old_drafts,
  (select count(*) from public.client_agreements where status = 'signed' and pdf_sha256 = '{OLD_SHA}') as old_signed,
  exists (select 1 from public.app_data a, jsonb_array_elements(case when jsonb_typeof(a.data) = 'array' then a.data else '[]'::jsonb end) e
          where a.key = 'agency_docs' and e->>'id' = '{DOC_ID}') as doc_there""")
if not ok1: stop(f"could not read the database: {r1}")
x = r1[0]
if not x["stage3"] or not x["upsert"]: stop(f"the agreement tables or the safe list save are missing: {x}. Tell Claude.")
ok("the agreement tables and the safe list save are there")
say(f"  · agreements started on the 10-17 wording and not signed yet: {x['old_drafts']}" + (" (after this step, tap Start another on each client's card)" if int(x["old_drafts"]) else ""))
say(f"  · agreements the family signed on the 10-17 wording, waiting for the office: {x['old_signed']}" + (" (countersign as usual: they stay on the wording the family read)" if int(x["old_signed"]) else ""))
say("  · the agreement is already in Forms & Templates (kept as it is)" if x["doc_there"] else "  · the agreement is not in Forms & Templates yet (this step adds it)")
gate = {}
for fn in FNS:
    s, m = fmeta(REF, fn)
    if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})")
    gate[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate[fn] else 'off'} (kept)")
sK, bK = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG())
SVC = ""
try: SVC = next((k.get("api_key", "") for k in json.loads(bK) if isinstance(k, dict) and k.get("name") == "service_role"), "") if sK == 200 else ""
except Exception: SVC = ""
HIDE.append(SVC)
if not SVC.startswith(("eyJ", "sb_secret_")): stop("could not read the server key needed to store the updated PDF")
ok("the server key for storing the updated PDF can be read")

def store(bucket, path, data):
    req = urllib.request.Request(f"{FNB}/storage/v1/object/{bucket}/{path}", data=data, method="POST",
        headers={"Authorization": "Bearer " + SVC, "apikey": SVC, "Content-Type": "application/pdf", "x-upsert": "false", "User-Agent": "cc-934/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
def fetch(bucket, path):
    req = urllib.request.Request(f"{FNB}/storage/v1/object/authenticated/{bucket}/{path}", headers={"Authorization": "Bearer " + SVC, "apikey": SVC, "User-Agent": "cc-934/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, r.read()
    except urllib.error.HTTPError as e: return e.code, b""
    except Exception: return None, b""
already = lambda s, b: s in (400, 409) and re.search(r"exists|Duplicate", b or "", re.I)

for p, want, what in ((OLD_PATH, OLD_SHA, "the 10-17 agreement PDF"), (FIRST_PATH, FIRST_SHA, "the first agreement PDF")):
    sO, bO = fetch(BUCKET, p)
    if sO == 200 and hashlib.sha256(bO).hexdigest() == want: ok(f"{what} is stored and reads back byte for byte (it stays)")
    else: stop(f"{what} did not read back as expected ({sO})")
say("  · what changes: 1 file added (the updated agreement PDF), client-agreement and agreement-sign redeployed, and the blank agreement saved once in Forms & Templates. Nothing sent, nothing in AxisCare.")
if L.fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
sU, bU = store(BUCKET, NEW_PATH, new)
if sU in (200, 201): ok("the updated agreement PDF is stored")
elif already(sU, bU): say("  · the updated agreement PDF was already stored; checking it is the same file below")
else: bad(f"the updated agreement PDF was not stored ({sU}): {(bU or '')[:160]}"); say("  RESULT: STOPPED. Nothing else changed. Tell Claude."); done(5)
sN, bN = fetch(BUCKET, NEW_PATH)
if not (sN == 200 and hashlib.sha256(bN).hexdigest() == NEW_SHA):
    bad(f"the stored updated PDF does not read back as the reviewed file ({sN})"); say("  RESULT: STOPPED before the functions changed. Tell Claude."); done(6)
ok("the stored updated PDF reads back byte for byte")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, gate[fn]):
        say(f"  RESULT: STOPPED at {fn}. Tell Claude. (The updated PDF is stored; it is only used once client-agreement is deployed.)"); done(7)

# Forms & Templates: the blank agreement, as the page itself saves an upload (forms.html: bucket agency-docs, list agency_docs)
if not x["doc_there"]:
    sD, bD = store(DOCS_BUCKET, DOC_PATH, new)
    if not (sD in (200, 201) or already(sD, bD)): bad(f"the agreement was not saved to Forms & Templates ({sD}): {(bD or '')[:160]}"); say("  RESULT: the agreement update is DONE and live; only the Forms & Templates copy failed. Tell Claude."); done(8)
    sR, bR = fetch(DOCS_BUCKET, DOC_PATH)
    if not (sR == 200 and hashlib.sha256(bR).hexdigest() == NEW_SHA): bad(f"the Forms & Templates copy does not read back as the reviewed file ({sR})"); say("  RESULT: the agreement update is DONE and live; only the Forms & Templates copy failed. Tell Claude."); done(8)
    item = {"id": DOC_ID, "name": "Client Care Agreement (blank)", "cat": "Contract", "path": DOC_PATH, "size": len(new),
            "filename": "18-client-care-agreement.pdf", "by": "samantha@mo-care.com", "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            "rev": "Rev. 10/2026", "family": DOC_ID}
    okI, rI = sql(REF, f"select jsonb_array_length(public.upsert_app_data_item('agency_docs', {lit(json.dumps(item))}::jsonb)) as n")
    if not okI: bad(f"the Forms & Templates list was not updated: {rI}"); say("  RESULT: the agreement update is DONE and live; only the Forms & Templates list failed. Tell Claude."); done(8)
    ok("the blank agreement is saved in Forms & Templates, under Contracts & agreements")

say(); say("PART 3 · PROOF (nothing is sent)")
for fn in FNS:
    s1, _ = http("OPTIONS", f"{FNB}/functions/v1/{fn}"); ok(f"the Hub pages can reach {fn}") if s1 == 200 else bad(f"{fn}: the browser check answered {s1}")
s2, b2 = http("POST", f"{FNB}/functions/v1/client-agreement", {"action": "countersign", "id": "00000000-0000-4000-8000-000000000000", "signature": "x"})
ok("countersigning refuses anyone not signed in to the Hub (401)") if s2 == 401 else bad(f"countersign answered a stranger {s2}: {b2[:120]}")
s3, b3 = http("POST", f"{FNB}/functions/v1/agreement-sign", {"action": "open", "t": "x" * 48})
ok(f"the from-home door refuses a made-up link ({s3})") if s3 in (400, 401, 403, 404, 410) else bad(f"the from-home door answered a made-up link {s3}: {b3[:120]}")
ok5, r5 = sql(REF, f"""select count(*) as n from public.app_data a, jsonb_array_elements(case when jsonb_typeof(a.data) = 'array' then a.data else '[]'::jsonb end) e
  where a.key = 'agency_docs' and e->>'id' = '{DOC_ID}' and e->>'path' = '{DOC_PATH}' and not (e ? 'removed')""")
ok("Forms & Templates lists the agreement once") if ok5 and int(r5[0]["n"]) == 1 else bad(f"Forms & Templates does not list the agreement once: {r5}")
say("  · tested before deploying: the agreement functions against a fake database and storage (174 checks, including: a new agreement records the updated wording; one signed on the 10-17 wording is countersigned on the 10-17 wording even if the updated file is broken; a draft on the 10-17 wording can't be signed; an unknown wording is refused), and the Hub screens.")
say()
if L.fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · Merge the Hub pull request next. Nothing was sent by this step."); done(0)
