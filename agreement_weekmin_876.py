#!/usr/bin/env python3
# 876 · CLIENT CARE AGREEMENT: THE 8-HOUR WEEKLY MINIMUM (Samantha 2026-10-17: scheduled care keeps an 8 hours a week
# minimum; the agreement only said 4 hours per visit).
#  Stores the updated master agreement PDF next to the first one (the first is never touched), and redeploys
#  client-agreement and agreement-sign. New agreements use the updated wording. An agreement already signed on the first
#  wording is countersigned, printed and emailed on the first wording, exactly what the family read. A draft started on
#  the first wording can't be signed or sent: the Hub says to Start another. Also carries 875 (countersigning ticks the
#  agreement steps), so 875 is no longer needed. No database change. Nothing is sent.
import json, os, hashlib, re, subprocess, urllib.request, urllib.error
os.environ.setdefault("SB_STEP", "876")
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta, API, MG, HIDE

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
BUCKET = "client-agreements"
FNS = ("client-agreement", "agreement-sign")
ok = lambda s: say("  ✓ " + s)
def run(args): p = subprocess.run(args, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg): bad(msg); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(2)
def mapof(name):
    src = open(os.path.join(FNROOT, "_shared", name)).read()
    return re.search(r"MASTER_PATH = '([^']+)'", src).group(1), re.search(r'PDF_SHA256 = "([0-9a-f]{64})"', src).group(1)

start("CLIENT CARE AGREEMENT: THE 8-HOUR WEEKLY MINIMUM")
say("PART 1 · READ ONLY (nothing changes)")
NEW_PATH, NEW_SHA = mapof("client-agreement-map.ts")
OLD_PATH, OLD_SHA = mapof("client-agreement-map-2026-10-16.ts")
new = open(os.path.join(ROOT, "client-agreement", "client-care-agreement-rev-2026-10-17.pdf"), "rb").read()
old = open(os.path.join(ROOT, "client-agreement", "client-care-agreement-rev-2026-10.pdf"), "rb").read()
if hashlib.sha256(new).hexdigest() == os.environ.get("SB_PDF_SHA", "") == NEW_SHA: ok("the updated agreement PDF is the reviewed one, and it is the file the new field map was measured on")
else: stop("the updated agreement PDF does not match the reviewed build or the field map")
if hashlib.sha256(old).hexdigest() == OLD_SHA and OLD_PATH != NEW_PATH: ok("the first agreement PDF and its field map are kept unchanged, under their own name")
else: stop("the first agreement PDF or its field map changed")
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
ok1, r1 = sql(REF, f"""select to_regclass('public.client_agreement_links') is not null as stage3, to_regproc('public.lead_put_if_same') is not null as safe_write,
  to_regclass('public.client_journey_step') is not null as journeys,
  (select count(*) from public.client_agreements where status = 'draft' and pdf_sha256 = '{OLD_SHA}') as old_drafts,
  (select count(*) from public.client_agreements where status = 'signed' and pdf_sha256 = '{OLD_SHA}') as old_signed""")
if not ok1: stop(f"could not read the database: {r1}")
x = r1[0]
if not x["stage3"]: stop("signing from home is not there (step 874 first)")
if not x["safe_write"] or not x["journeys"]: stop(f"the conflict-safe lead save or the journey tables are missing: {x}. Tell Claude.")
ok("874 is in; the conflict-safe lead save and the journey tables are there")
say(f"  · agreements started on the first wording and not signed yet: {x['old_drafts']}" + (" (after this step, tap Start another on each client's card)" if int(x["old_drafts"]) else ""))
say(f"  · agreements the family signed on the first wording, waiting for the office: {x['old_signed']}" + (" (countersign as usual: they stay on the wording the family read)" if int(x["old_signed"]) else ""))
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

def store(path, data):
    req = urllib.request.Request(f"{FNB}/storage/v1/object/{BUCKET}/{path}", data=data, method="POST",
        headers={"Authorization": "Bearer " + SVC, "apikey": SVC, "Content-Type": "application/pdf", "x-upsert": "false", "User-Agent": "cc-876/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
def fetch(path):
    req = urllib.request.Request(f"{FNB}/storage/v1/object/authenticated/{BUCKET}/{path}", headers={"Authorization": "Bearer " + SVC, "apikey": SVC, "User-Agent": "cc-876/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, r.read()
    except urllib.error.HTTPError as e: return e.code, b""
    except Exception: return None, b""

sO, bO = fetch(OLD_PATH)
if sO == 200 and hashlib.sha256(bO).hexdigest() == OLD_SHA: ok("the first agreement PDF is stored and reads back byte for byte (it stays)")
else: stop(f"the first agreement PDF did not read back as expected ({sO})")
say("  · what changes: 1 file added (the updated agreement PDF), client-agreement and agreement-sign redeployed. No database change. Nothing sent, nothing in AxisCare.")
if L.fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
sU, bU = store(NEW_PATH, new)
if sU in (200, 201): ok("the updated agreement PDF is stored")
elif sU in (400, 409) and re.search(r"exists|Duplicate", bU or "", re.I): say("  · the updated agreement PDF was already stored; checking it is the same file below")
else: bad(f"the updated agreement PDF was not stored ({sU}): {(bU or '')[:160]}"); say("  RESULT: STOPPED. Nothing else changed. Tell Claude."); done(5)
sN, bN = fetch(NEW_PATH)
if not (sN == 200 and hashlib.sha256(bN).hexdigest() == NEW_SHA):
    bad(f"the stored updated PDF does not read back as the reviewed file ({sN})"); say("  RESULT: STOPPED before the functions changed. Tell Claude."); done(6)
ok("the stored updated PDF reads back byte for byte")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, gate[fn]):
        say(f"  RESULT: STOPPED at {fn}. Tell Claude. (The updated PDF is stored; it is only used once client-agreement is deployed.)"); done(7)

say(); say("PART 3 · PROOF (nothing is sent)")
for fn in FNS:
    s1, _ = http("OPTIONS", f"{FNB}/functions/v1/{fn}"); ok(f"the Hub pages can reach {fn}") if s1 == 200 else bad(f"{fn}: the browser check answered {s1}")
s2, b2 = http("POST", f"{FNB}/functions/v1/client-agreement", {"action": "countersign", "id": "00000000-0000-4000-8000-000000000000", "signature": "x"})
ok("countersigning refuses anyone not signed in to the Hub (401)") if s2 == 401 else bad(f"countersign answered a stranger {s2}: {b2[:120]}")
s3, b3 = http("POST", f"{FNB}/functions/v1/agreement-sign", {"action": "open", "t": "x" * 48})
ok(f"the from-home door refuses a made-up link ({s3})") if s3 in (400, 401, 403, 404, 410) else bad(f"the from-home door answered a made-up link {s3}: {b3[:120]}")
say("  · tested before deploying: the agreement functions against a fake database and storage (170 checks, including: a new agreement records the updated wording; one signed on the first wording is countersigned on the first wording even if the updated file is broken; a draft on the first wording can't be signed or sent; an unknown wording is refused), and the Hub screens (182 + 89 + 96).")
say()
if L.fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · Merge the Hub pull request next. Step 875 is included here, so skip it. Nothing was sent by this step."); done(0)
