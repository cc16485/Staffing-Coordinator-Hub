#!/usr/bin/env python3
# 537 · SLICE 1a: THE OFFER LINK KIND (Samantha approved 2026-10-08). Hub project. Deploys the applicant-link function
# pinned to the reviewed build: it can now mint and check an offer-and-sign link (kind 'offer') whose expiry is the
# offer's own. Nothing calls it yet (the page is Slice 1b, the sending Slice 1c); the start and orientation links are
# unchanged. Nothing is sent; no record changes.
import os, json
os.environ.setdefault("SB_STEP", "537")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FN = "applicant-link"
start("SLICE 1a: THE OFFER LINK KIND")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
BASEP = json.loads(os.environ.get("SB_BASE_SHAS", "{}"))
sx, mx = fmeta(REF, FN)
if not (sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool)): bad(f"{FN} could not be read ({sx})"); done(3)
VJ = mx["verify_jwt"]; okd, livef = live_files(REF, FN)
if not okd: bad(f"{FN}: the live copy could not be downloaded"); done(3)
okv = lambda k: livef.get(k) == sha(os.path.join(ROOT, k)) or livef.get(k) in (BASEP.get(k) if isinstance(BASEP.get(k), list) else [BASEP.get(k)])
odd = [k for k in need(FNROOT, FN) if not okv(k)]
if odd: bad(f"{FN}: the live copy has a file that was never on main ({', '.join(odd)}); nothing runs"); done(3)
say(f"  ✓ {FN} (version {mx.get('version', '?')}): the live copy is reviewed code")
say("  · what changes: applicant-link learns the offer link kind (mint, for signed-in staff; open, for a valid link: the letter's fields only, never phone, email or notes; a withdrawn or expired offer answers like a dead link). Start and orientation links are unchanged. Nothing sends.")
say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, FN, VJ): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent or changed)")
BASE = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
s_, b_ = http("POST", f"{BASE}/functions/v1/{FN}", {"action": "mint", "kind": "offer", "offer_id": "00000000-0000-0000-0000-000000000000"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ minting an offer link without a sign-in is refused ({s_})") if s_ in (401, 403) else bad(f"minting without a sign-in answered {s_}")
s_, b_ = http("POST", f"{BASE}/functions/v1/{FN}", {"action": "open", "kind": "offer", "o": "00000000-0000-0000-0000-000000000000", "e": 4102444800, "t": "x" * 43}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ a forged offer link gets nothing ({s_})") if s_ in (401, 403) else bad(f"a forged offer link answered {s_}")
say("  · tested before deploying with 14 checks on the real code (a real code with a test secret: an offer code never opens a start form, an altered id or expiry is refused, the letter read carries no phone, email or notes, withdrawn and expired offers answer like a dead link) plus the 22 existing link checks.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the offer link kind is live and unused. Nothing was sent or changed."); done(0)
