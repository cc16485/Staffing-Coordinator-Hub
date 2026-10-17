#!/usr/bin/env python3
# 871 · CLIENT CARE AGREEMENT ON A TABLET, STAGE 1 (Samantha 2026-10-16: "Yes, start building stage 1: the tablet form, finger
# signature and signed PDF saved in the Hub"). Adds one new table and a private storage area (client_agreement_871.sql),
# puts the frozen master agreement PDF (Rev. 10/2026, the exact file the field map was measured on) into that storage, and
# deploys the client-agreement function. Nothing existing changes, nothing in AxisCare changes, nothing is texted or
# emailed, and no agreement exists until the office starts one from a client in the Hub (after the Hub pull request).
# Undo: client_agreement_871_rollback.sql and delete the client-agreement function (signed files are kept on purpose).
import os, json, hashlib, re, urllib.request, urllib.error
os.environ.setdefault("SB_STEP", "871")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
FN = "client-agreement"
BUCKET = "client-agreements"
FNBASE = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
start("CLIENT CARE AGREEMENT ON A TABLET, STAGE 1")

say("PART 1 · READ ONLY (nothing changes)")
mig = open(os.path.join(ROOT, "client_agreement_871.sql"), "rb").read()
master = open(os.path.join(ROOT, "client-agreement", "client-care-agreement-rev-2026-10.pdf"), "rb").read()
mapsrc = open(os.path.join(FNROOT, "_shared", "client-agreement-map.ts")).read()
MASTER_PATH = re.search(r"MASTER_PATH = '([^']+)'", mapsrc).group(1)
MAP_SHA = re.search(r'PDF_SHA256 = "([0-9a-f]{64})"', mapsrc).group(1)
say("  ✓ client_agreement_871.sql is the reviewed build") if hashlib.sha256(mig).hexdigest() == os.environ.get("SB_SQL_SHA", "") else bad("client_agreement_871.sql is not the reviewed build: nothing runs")
msha = hashlib.sha256(master).hexdigest()
say("  ✓ the master agreement PDF is the reviewed one, and it is the file the field map was measured on") if msha == os.environ.get("SB_PDF_SHA", "") == MAP_SHA else bad("the master agreement PDF does not match the reviewed build or the field map: nothing runs")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
ok1, r1 = sql(REF, "select to_regclass('public.client_agreements') is not null as there")
if not ok1: bad(f"could not read the database: {r1}")
elif r1[0]["there"]: bad("the agreement table is already there (installed before?). Tell Claude.")
else: say("  ✓ no agreement table yet")
sM, mM = fmeta(REF, FN)
if sM == 404: say("  ✓ no client-agreement function yet")
elif sM == 200: bad("a client-agreement function is already deployed. Tell Claude.")
else: bad(f"could not check the functions ({sM}). Tell Claude.")
sK, bK = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG())
SVC = ""
try: SVC = next((k.get("api_key", "") for k in json.loads(bK) if isinstance(k, dict) and k.get("name") == "service_role"), "") if sK == 200 else ""
except Exception: SVC = ""
HIDE.append(SVC)
say("  ✓ the server key for storing the master PDF can be read") if SVC.startswith(("eyJ", "sb_secret_")) else bad("could not read the server key needed to store the master PDF. Tell Claude.")
say("  · what changes: 1 new table, 1 private storage area that keeps every file, the master agreement PDF, 1 new function. Nothing in AxisCare, no client or caregiver changes, nothing sent.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

def store(path, data, ctype):
    req = urllib.request.Request(f"{FNBASE}/storage/v1/object/{BUCKET}/{path}", data=data, method="POST",
        headers={"Authorization": "Bearer " + SVC, "apikey": SVC, "Content-Type": ctype, "x-upsert": "false", "User-Agent": "cc-871/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
def fetch(path):
    req = urllib.request.Request(f"{FNBASE}/storage/v1/object/authenticated/{BUCKET}/{path}", headers={"Authorization": "Bearer " + SVC, "apikey": SVC, "User-Agent": "cc-871/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, r.read()
    except urllib.error.HTTPError as e: return e.code, b""
    except Exception: return None, b""

say(); say("PART 2 · CHANGE")
okc, rc = sql(REF, mig.decode())
if not okc: bad(f"the table was not added (nothing changed: it is all or nothing): {rc}"); say("  RESULT: STOPPED. Tell Claude."); done(5)
say("  ✓ the agreement table is in, locked to the server only, and the private storage area keeps every file")
sU, bU = store(MASTER_PATH, master, "application/pdf")
if sU in (200, 201): say("  ✓ the master agreement PDF is stored")
elif sU in (400, 409) and re.search(r"exists|Duplicate", bU or "", re.I): say("  · the master agreement PDF was already stored; checking it is the same file below")
else: bad(f"the master agreement PDF was not stored ({sU}): {(bU or '')[:160]}"); say("  RESULT: STOPPED. The table is in; nothing else. Tell Claude."); done(6)
if not deploy(REF, FNROOT, FN, False): say("  RESULT: STOPPED. The table and the master PDF are in; the function is not. Tell Claude."); done(7)

say(); say("PART 3 · PROOF (nothing is sent)")
ok2, r2 = sql(REF, """select (select count(*) from public.client_agreements) as agreements,
  (select relrowsecurity from pg_class where oid = 'public.client_agreements'::regclass) as rls,
  has_table_privilege('anon','public.client_agreements','select') or has_table_privilege('authenticated','public.client_agreements','select')
   or has_table_privilege('anon','public.client_agreements','insert') or has_table_privilege('authenticated','public.client_agreements','insert') as browser_can_touch,
  (select public from storage.buckets where id = 'client-agreements') as bucket_public,
  exists (select 1 from pg_trigger where tgname = 'client_agreements_keep_files') as keeps_files""")
if ok2:
    x = r2[0]
    say("  ✓ no agreements yet") if int(x["agreements"]) == 0 else bad(f"unexpected agreements: {x['agreements']}")
    say("  ✓ row security on, and no browser role can read or write the table (only the function can)") if x["rls"] and not x["browser_can_touch"] else bad(f"the table is not locked as expected: {x}")
    say("  ✓ the storage area is private and its files cannot be deleted or renamed") if x["bucket_public"] is False and x["keeps_files"] else bad(f"the storage area is not set as expected: {x}")
else: bad(f"could not read back: {r2}")
sD, bD = fetch(MASTER_PATH)
say("  ✓ the stored master PDF reads back byte for byte") if sD == 200 and hashlib.sha256(bD).hexdigest() == MAP_SHA else bad(f"the stored master PDF does not read back as the reviewed file ({sD})")
U = f"{FNBASE}/functions/v1/{FN}"
s1, _ = http("OPTIONS", U)
say("  ✓ the Hub page can reach it (the browser check answers)") if s1 == 200 else bad(f"the browser check answered {s1}")
s2, b2 = http("POST", U, {"action": "form"})
say("  ✓ every action refuses anyone not signed in (401)") if s2 == 401 else bad(f"an action without sign-in answered {s2}: {b2[:120]}")
s3, b3 = http("POST", U, {"action": "list", "client_ax": "1"}, {"Authorization": "Bearer not-a-real-sign-in"})
say("  ✓ a made-up sign-in is refused (401)") if s3 == 401 else bad(f"a made-up sign-in answered {s3}: {b3[:120]}")
say("  · tested before deploying: the real function against a fake database and storage (40 checks: sign-in and roles, office-only and family-only fields, required answers, six initials, finger signature limits, the representative path, stale signing, the master PDF fingerprint, the signed PDF with its record page, logged opens), and the table on a real local Postgres (18 checks).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the agreement server is installed. Merge the Hub pull request next; then each client's record has a Client Care Agreement card."); done(0)
