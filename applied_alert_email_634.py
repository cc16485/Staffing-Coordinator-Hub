#!/usr/bin/env python3
# 634 · THE "JUST APPLIED" OFFICE ALERT GOES BY EMAIL ONLY (Samantha 2026-10-12: "email only not text on the admin just
# applied office alert"). interview-messages: the new-applicant alert to the applicant-alert list is emailed, never
# texted, and its wording loses the em dash. The do-not-rehire / applied-again alerts are unchanged (text and email).
# STOPS if anyone active on the applicant-alert list has no email address (they would stop hearing about new applicants).
# Nothing is sent.
import os, json
os.environ.setdefault("SB_STEP", "634")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FN = "interview-messages"
start("THE \"JUST APPLIED\" OFFICE ALERT GOES BY EMAIL ONLY")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
ok, r0 = sql(REF, "select to_jsonb(a) as r from public.applicant_alerts a where active = true")
r = [{"name": str((x["r"] or {}).get("name") or ""), "email": str((x["r"] or {}).get("email") or ""), "phone": str((x["r"] or {}).get("phone") or "")} for x in (r0 or [])] if ok else r0
if not ok: bad(f"could not read the applicant-alert list: {r}")
else:
    say(f"  · {len(r)} active on the applicant-alert list")
    for x in r:
        e = (x["email"] or "").strip()
        say(f"     - {x['name'] or '(no name)'}: {'email ' + e[:3] + '…' + e[e.find('@'):] if '@' in e else 'NO EMAIL'}{' · phone on file' if x['phone'] else ''}")
    missing = [x["name"] or "(no name)" for x in r if "@" not in (x["email"] or "")]
    if missing: bad(f"{', '.join(missing)} would stop hearing about new applicants (no email on the list). Add their email in the Hub first, then run this again")
    if not r: bad("nobody is on the applicant-alert list, so nobody would hear about new applicants")
sx, mx = fmeta(REF, FN)
say(f"  · {FN} is live at version {mx.get('version', '?')}; replaced by this build") if sx == 200 else bad(f"{FN} is not live: {sx}")
okl, livef = live_files(REF, FN)
if okl:
    others = [k[len("supabase/functions/"):] for k, h in livef.items() if k.startswith("supabase/functions/") and not k.endswith(f"{FN}/index.ts")
              and os.path.exists(os.path.join(ROOT, k)) and sha(os.path.join(ROOT, k)) != h]
    say(f"  · shared files that also update with it (all already merged): {', '.join(others)}" if others else "  · no shared file changes ride along")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, FN, mx.get("verify_jwt", False) if isinstance(mx, dict) else False): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent)")
okl, livef = live_files(REF, FN)
say(f"  ✓ {FN} is live as tested") if okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need(FNROOT, FN)) else bad("the live copy is not this build")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · new-applicant alerts go to the office by email only, without the em dash. Nothing was sent."); done(0)
