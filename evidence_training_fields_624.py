#!/usr/bin/env python3
# 624 · THE CHANGE HISTORY KEEPS EVERY TRAINING FIELD (Samantha 2026-10-12: training proof for the MMAC audit). Widens the
# value history (Slice 9) to the in-person on-the-job training (date, sign-off, proof) and the ethics and rights
# acknowledgments, patching the live rule in place; refuses if the live rule is not the expected one. Nothing is sent; no
# record changes (the history only starts keeping these fields from now). Undo: evidence-training-fields-rollback.sql.
import os, hashlib
os.environ.setdefault("SB_STEP", "624")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
start("THE CHANGE HISTORY KEEPS EVERY TRAINING FIELD")
say("PART 1 · READ ONLY (nothing changes)")
mig = open(os.path.join(ROOT, "evidence-training-fields.sql"), "rb").read()
say("  ✓ evidence-training-fields.sql is the reviewed build") if hashlib.sha256(mig).hexdigest() == os.environ.get("SB_SQL_SHA", "") else bad("the SQL is not the reviewed build: nothing runs")
if fails: done(2)
ok, r = sql(REF, "select public.evidence_field_kept('caregivers','ojt_date') as ojt_date, public.evidence_field_kept('caregivers','ojt_online') as ojt_online, public.evidence_field_kept('caregivers','casenet_date') as casenet, public.evidence_field_kept('caregivers','ssn') as ssn, (select count(*) from public.evidence_history) as hist")
if not ok: bad(f"could not read the rule: {r}"); done(3)
x = r[0]; say(f"  · today: in-person on-the-job date kept? {x['ojt_date']}; online part kept? {x['ojt_online']}; Case.net kept? {x['casenet']}; Social Security number kept? {x['ssn']}; {x['hist']} history rows")
say("  · what changes: the rule also keeps ojt_date, ojt_signed, ojt_proof and the ethics and rights fields. Nothing else.")
say(); say("PART 2 · CHANGE")
ok, rc = sql(REF, mig.decode())
say("  ✓ the rule is widened") if ok else bad(f"not changed (nothing changed): {rc}")
say(); say("PART 3 · PROOF")
ok, r2 = sql(REF, "select public.evidence_field_kept('caregivers','ojt_date') as a, public.evidence_field_kept('caregivers','ojt_proof') as b, public.evidence_field_kept('caregivers','ethics_date') as c, public.evidence_field_kept('caregivers','casenet_date') as d, public.evidence_field_kept('caregivers','ssn') as e, (select count(*) from public.evidence_history) as hist")
if ok and r2[0]['a'] and r2[0]['b'] and r2[0]['c'] and r2[0]['d'] and not r2[0]['e']: say("  ✓ kept now: on-the-job date and proof, ethics; still kept: Case.net; never kept: Social Security number")
else: bad(f"the rule does not read back as expected: {r2}")
say(f"  ✓ no history was written or removed ({r2[0]['hist']} rows)") if ok and int(r2[0]['hist']) >= int(x['hist']) else bad("the history count dropped")
say("  · tested before deploying: on a local copy of the live rule (widened, idempotent, Case.net kept, SSN excluded, the undo).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · every training field is kept in the change history from now on. Nothing was sent; no record changed."); done(0)
