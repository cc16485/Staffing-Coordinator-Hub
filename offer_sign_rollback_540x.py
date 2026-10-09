#!/usr/bin/env python3
# 540X · ROLLBACK OF SLICE 1b ON THE HUB PROJECT (Samantha 2026-10-08). Removes the offer-sign function, so no offer link
# can view or sign anything until it returns. HER RULE 8: nothing is deleted: the private bucket, every signed PDF and
# the open log stay exactly as they are; the offer page on cc.mo-care.com then shows its dead-link message. Nothing
# is sent; no record changes.
import os
os.environ.setdefault("SB_STEP", "540X")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FN = "offer-sign"
start("ROLLBACK OF SLICE 1b ON THE HUB PROJECT")
say("PART 1 · READ ONLY (nothing changes)")
sx, mx = fmeta(REF, FN)
if sx == 404: say(f"  · {FN} is not live; nothing to remove"); say(); say("RESULT: DONE · nothing to undo."); done(0)
if sx != 200: bad(f"{FN} could not be read ({sx})"); done(3)
say(f"  ✓ {FN} is live at version {(mx or {}).get('version', '?')}; it will be removed")
ok_, n_ = sql(REF, "select count(*) as n from storage.objects where bucket_id = 'onboarding-documents'")
say(f"  · {n_[0]['n']} signed document file(s) in the private bucket: all kept (rule 8)") if ok_ else say("  · could not count the stored files")
say(); say("PART 2 · CHANGE")
s_, b_ = http("DELETE", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
say(f"  ✓ {FN} removed") if s_ in (200, 204) else bad(f"{FN} could not be removed ({s_}): {b_[:120]}")
say(); say("PART 3 · PROOF")
sx2, _ = fmeta(REF, FN); say(f"  ✓ {FN} is gone ({sx2})") if sx2 == 404 else bad(f"{FN} still answers ({sx2})")
ok_, n2 = sql(REF, "select count(*) as n from storage.objects where bucket_id = 'onboarding-documents'")
say(f"  ✓ the bucket still holds {n2[0]['n']} file(s); the open log is untouched") if ok_ else say("  · could not count the stored files")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · no offer link can view or sign anything until offer-sign is deployed again. Nothing was deleted."); done(0)
