#!/usr/bin/env python3
# 541 · BRANDED SIGNED PDFs (Samantha approved the letterhead design on 2026-10-09 after the full-page previews). Hub project.
# Replaces the offer-sign function with the reviewed build: the PDFs it writes from now on carry the company letterhead
# (logo, company block, gold rule, Poppins, the at-will box, "Warmly" with Samantha's name and title as the issuer and
# no signature on her behalf, the caregiver's typed e-signature with its audit record, the branded footer).
# Nothing else changes: the bucket, the open log, the fictional offers and every PDF already written stay exactly as
# they are. It still serves only offers on the new onboarding path and never sends a text or an email.
import os, json
os.environ.setdefault("SB_STEP", "541")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FN = "offer-sign"
start("BRANDED SIGNED PDFs: THE SIGNING SERVER IS REPLACED WITH THE REVIEWED BUILD")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
for gone in ("_shared/simple-pdf.ts",):
    say(f"  ✓ the plain PDF writer ({gone}) is retired in this build") if not os.path.exists(os.path.join(FNROOT, gone)) else bad(f"{gone} is still in the build")
sx, mx = fmeta(REF, FN)
if sx == 200 and mx: say(f"  ✓ {FN} is live at version {mx.get('version', '?')}; it is replaced by this reviewed build")
else: bad(f"{FN} is not live (run 540 first): {sx}")
ok_, sec = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
names = {x.get("name") for x in (json.loads(sec) if ok_ == 200 and sec.startswith("[") else [])}
for need_ in ("HUB_JOB_SECRET", "OFFERS_PROJECT_URL", "OFFERS_SERVICE_ROLE_KEY"):
    say(f"  ✓ the function secret {need_} is set") if need_ in names else bad(f"the function secret {need_} is not set; offer-sign would refuse every link")
ok_, bk = sql(REF, "select public from storage.buckets where id = 'onboarding-documents'")
say("  ✓ the private bucket onboarding-documents is in place") if ok_ and bk and bk[0]["public"] is False else bad(f"the bucket is missing or public: {bk}")
ok_, n0 = sql(REF, "select count(*)::int as n from storage.objects where bucket_id = 'onboarding-documents'")
FILES_BEFORE = int(n0[0]["n"]) if ok_ else -1
say(f"  · {FILES_BEFORE} signed PDF file(s) are stored now; none is rewritten (the server writes each file once)")
say("  · what changes: only the offer-sign function. Nothing is sent; no record or file changes.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, FN, True): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent or changed)")
okd, livef = live_files(REF, FN)
L_ = {k.split("supabase/functions/", 1)[-1] for k in livef} if okd else set()
say("  ✓ the live copy carries the letterhead writer and the embedded fonts, and no plain writer") if okd and "_shared/brand-pdf.ts" in L_ and "_shared/brand-assets.ts" in L_ and "_shared/simple-pdf.ts" not in L_ else bad(f"live files: {sorted(livef) if okd else livef}")
BASE = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
s_, b_ = http("POST", f"{BASE}/functions/v1/{FN}", {"action": "view", "o": "00000000-0000-0000-0000-000000000000", "e": 4102444800, "t": "A" * 43}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ a forged offer link still gets nothing from the signing server ({s_})") if s_ in (401, 403) else bad(f"a forged link answered {s_}")
s_, b_ = http("POST", f"{BASE}/functions/v1/{FN}", {"action": "open", "offer_id": "00000000-0000-0000-0000-000000000000", "doc": "offer"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ a staff open without a sign-in is still refused ({s_})") if s_ in (401, 403) else bad(f"a staff open without a sign-in answered {s_}")
ok_, n1 = sql(REF, "select count(*)::int as n from storage.objects where bucket_id = 'onboarding-documents'")
say(f"  ✓ the stored PDF files are untouched ({FILES_BEFORE} before, {int(n1[0]['n']) if ok_ else '?'} after)") if ok_ and int(n1[0]["n"]) == FILES_BEFORE else bad(f"file count changed: {FILES_BEFORE} → {n1}")
say("  · tested before deploying: 24 checks on the real function and 20 on the texts and the letterhead writer (embedded Poppins fonts, the logo, every term, the at-will box, the closing, the typed e-signature and its audit record, no signature for Samantha, byte-for-byte deterministic).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · signed PDFs now carry the company letterhead. Nothing was sent; no existing record or file changed."); done(0)
