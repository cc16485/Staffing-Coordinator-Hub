#!/usr/bin/env python3
# 594 · SLICE 10, THE PRACTICE RUN: THE REPORT (Samantha's decisions 5a and 6). Hub and Training.
# First runs the nightly passes once, the way their schedules do (every switch is off, so they only count and record), so the
# run finishes in one sitting; the real overnight runs confirm it the next morning. Then reads back everything Pat's run left:
# the offer trail, Step 1, the Hub record, the readiness card with every row, event and earlier version, the value history,
# every refused send (Pat's practice addresses), the AxisCare practice records, the cards, the logged opens, Training's
# records; saves every PDF into the Desktop folder; reads back every live version, switch and schedule; and ticks the
# retirement list in the plan against what the run did. Writes run.json (made-up data only) for the offline screenshots.
import os, json, datetime as dt, re
os.environ.setdefault("SB_STEP", "594")
from cc_step_lib import *
from practice_run_lib import *
start("SLICE 10, THE PRACTICE RUN: THE REPORT")
o = offer()
if not o: bad("no practice-run offer found: run 591 first"); done(3)
oid = str(o['id']); ANON, SVC = keys(); TSVC = trn_service()
if not SVC: bad("could not read the project's server key"); done(3)
DUMP = {"offer": o}
t0 = dt.datetime.now(dt.timezone.utc).isoformat()

say("PART 1 · THE NIGHTLY PASSES, ONCE, IN PRACTICE (every switch is off: they count and record, nothing is sent)")
for fn, body in [("caregiver-journey", {"action": "sweep"}), ("caregiver-journey", {"action": "nightly"}), ("step2-handoff", {"action": "pass"}), ("eligibility-sweep", {}), ("obligations-run", {})]:
    s_, b_ = http("POST", f"{FNB}/functions/v1/{fn}", body, {"apikey": SVC, "Authorization": "Bearer " + SVC}, timeout=300)
    flat = re.sub(r'\s+', ' ', str(b_))[:220]
    say(f"  · {fn} {body.get('action', 'run')}: {s_} {flat}")
st = switches() or {}
on = [k for k in MUST_BE_OFF if st.get(k) is True]
say("  ✓ every sending switch was off while they ran") if not on else bad("a switch was ON during the passes: " + ", ".join(on))

say(); say("PART 2 · THE OFFER (Training job_offers and its append-only trail)")
for k in ("offer_status", "offer_sent_at", "offer_expires_at", "offer_viewed_at", "offer_signed_at", "offer_signer_name", "pd_signed_at", "step1_done_at", "start_link_sent_at", "viventium_entered_at", "welcome_sent_at", "axiscare_applicant_id", "matched_caregiver_id", "offer_withdrawn_at"):
    say(f"  {k}: {o.get(k) if o.get(k) is not None else '-'}")
ok_, ev = sql(TRN, f"select at, kind, by_who, channel, result, detail from public.offer_events where offer_id = {lit(oid)} order by at")
DUMP["offer_events"] = ev if ok_ else []
for e in (ev if ok_ else []): say(f"  {str(e['at'])[:19]} · {e['kind']} · {e['by_who'] or '-'}{' · ' + str(e['result']) if e.get('result') else ''} · {json.dumps(e['detail'])[:140]}")

say(); say("PART 3 · STEP 1 (Hub step1_forms; identity kept sealed, last four only)")
ok_, f1 = sql(HUB, f"select started_at, completed_at, current_screen, signatures, pdfs, esign_consent_at from public.step1_forms where offer_id = {lit(oid)}")
f1 = f1[0] if ok_ and f1 else {}
DUMP["step1"] = {k: f1.get(k) for k in ("started_at", "completed_at", "signatures", "pdfs")}
say(f"  started {f1.get('started_at') or '-'} · completed {f1.get('completed_at') or '-'} · e-sign consent {f1.get('esign_consent_at') or '-'}")
for k, v in (f1.get('signatures') or {}).items(): say(f"  signed {k}: {(v or {}).get('at', '-')} as \"{(v or {}).get('typed_name', '')}\" v{(v or {}).get('version', '?')}")
ok_, idn = sql(HUB, f"select ssn_last4, license_last4, license_state, captured_at, purge_after, coalesce(reveals, 0) as reveals from public.step1_identity where offer_id = {lit(oid)}")
if ok_ and idn: say(f"  identity: SSN ending {idn[0]['ssn_last4']}, license ending {idn[0]['license_last4']} ({idn[0]['license_state']}); {idn[0]['reveals']} reveal(s); purge after {idn[0]['purge_after']}")

say(); say("PART 4 · PAT'S HUB RECORD (Background & References, then the caregiver roster)")
rows = person_rows(oid); DUMP["records"] = rows
EVK = re.compile(r"^(oig|edl|fcsr|fp|r[1-4](s|_type)|step1_|step2_(sent_at|done_at|verified_at|checklist|msg|invite)|orient|alz|ojt|hire_date|axiscare_id|approved_to_work|work_lock|welcome_|not_hired|offer_id|onboarding_path)")
for key, lst in rows.items():
    for r in lst:
        say(f"  {key}: id {r.get('id')}")
        for k in sorted(r):
            if EVK.match(k): say(f"    {k}: {json.dumps(r[k])[:160]}")
ids = {"candidates": [str(r.get('id')) for r in rows['candidates']] + [str(r.get('candidate_id')) for r in rows['caregivers'] if r.get('candidate_id')], "caregivers": [str(r.get('id')) for r in rows['caregivers']]}

say(); say("PART 5 · THE READINESS CARD (every row, every event in order, the earlier versions kept)")
j = journey(oid); DUMP["journey"] = j
if j:
    jid = j['journey_id']
    say(f"  status {j['status']} · started {str(j.get('created_at'))[:19]} · AxisCare {j.get('axiscare_caregiver_id') or '-'}")
    ok_, s = sql(HUB, f"select step_key, state, completed_by_name, completed_at, blocked_reason, evidence, version from public.client_journey_step where journey_id = {lit(jid)} order by step_key")
    DUMP["steps"] = s if ok_ else []
    for x in (s if ok_ else []): say(f"  {x['step_key']:<34} {x['state']:<11} {(x['completed_by_name'] or ''):<18} {str(x['completed_at'] or '')[:16]}{' · ' + x['blocked_reason'] if x.get('blocked_reason') else ''}")
    ok_, e2 = sql(HUB, f"select at, kind, step_key, actor_name, reason from public.client_journey_event where journey_id = {lit(jid)} order by at, id")
    DUMP["events"] = e2 if ok_ else []
    say(f"  {len(e2) if ok_ else '?'} event(s):")
    for e in (e2 if ok_ else []):
        why = (' · "' + str(e['reason'])[:100] + '"') if e.get('reason') else ''
        say(f"    {str(e['at'])[:19]} · {e['kind']}{' · ' + e['step_key'] if e['step_key'] else ''} · {e['actor_name'] or ''}{why}")
    ok_, v = sql(HUB, f"select count(*)::int as n, count(distinct step_key)::int as rows_ from public.journey_row_version where journey_id = {lit(jid)}")
    if ok_: say(f"  earlier versions kept: {v[0]['n']} (across {v[0]['rows_']} row(s))")
else: bad("no readiness card for Pat")

say(); say("PART 6 · THE VALUE HISTORY (Slice 9: what each piece of evidence said before and after, who, when)")
evh = []
for src, lst in (("app_data:candidates", ids['candidates']), ("app_data:caregivers", ids['caregivers'])):
    if not lst: continue
    ok_, h = sql(HUB, f"select at, source, record_id, change, field, old_value, new_value, actor from public.evidence_history where source = {lit(src)} and record_id in ({','.join(lit(i) for i in lst)}) order by at, id")
    if ok_: evh += h
DUMP["evidence_history"] = evh
for h in evh: say(f"  {str(h['at'])[:19]} · {h['source'].split(':')[1]} · {h['change']}{' ' + h['field'] if h['field'] else ''}: from {json.dumps(h['old_value'])[:60]} to {json.dumps(h['new_value'])[:60]} · {h['actor']}")

say(); say("PART 7 · EVERY SEND THE GUARD REFUSED (Pat's and the references' practice addresses; nothing went out)")
ok_, rf = sql(HUB, f"select at, sender, channel, address, reasons from public.contact_send_refusal where (address ~ '55501[8][0-9]$' or address ilike '%@practice.invalid') and at >= {lit(o['created_at'])} order by at")
DUMP["refusals"] = rf if ok_ else []
for r in (rf if ok_ else []): say(f"  {str(r['at'])[:19]} · {r['sender']} · {r['channel']} · {r['address']}")
if ok_ and not rf: say("  (none: no button that would send was pressed)")
ok_, ax = sql(HUB, f"select at, kind, outcome, summary from public.axiscare_change_log where axiscare_caregiver_id = {lit(AXID)} order by at")
DUMP["axiscare"] = ax if ok_ else []
say("  AxisCare (practice records, nothing written to AxisCare):")
for a in (ax if ok_ else []): say(f"    {str(a['at'])[:19]} · {a['kind']} · {a['outcome']} · {a['summary']}")

say(); say("PART 8 · CARDS, OPENS, WELCOME CALL, TRAINING")
needles = [oid] + ids['candidates'] + ids['caregivers'] + ([j['journey_id']] if j else []) + ["Pat Practice"]
ok_, cards = sql(HUB, "select x as it from public.app_data, jsonb_array_elements(data) x where key = 'ops_items' and (" + " or ".join(f"x::text ilike {lit('%' + n + '%')}" for n in needles if n) + ")")
DUMP["cards"] = [c['it'] for c in cards] if ok_ else []
for c in DUMP["cards"]: say(f"  card {c.get('kind') or c.get('id')}: {str(c.get('title') or '')[:90]} · {c.get('status')}")
subj = [oid] + [f"caregiver:{i}" for i in ids['caregivers']]
ok_, op = sql(HUB, "select at, doc, by_name, reason from public.document_access_log where offer_id in (" + ",".join(lit(s_) for s_ in subj) + ") order by at")
DUMP["opens"] = op if ok_ else []
say(f"  {len(op) if ok_ else '?'} logged open(s) of Pat's documents" + (": " + "; ".join(f"{p['doc']} by {p['by_name']}" for p in op[:12]) if ok_ and op else ""))
cid = (ids['candidates'] or [''])[0]
ok_, wc = sql(HUB, f"select status, invited_at, starts_at, done_at, done_by from public.welcome_calls where candidate_id = {lit(cid)} order by invited_at")
DUMP["welcome_calls"] = wc if ok_ else []
for w in (wc if ok_ else []): say(f"  welcome call: {w['status']} · invited {str(w['invited_at'])[:16]} · done {str(w['done_at'] or '-')[:16]} by {w['done_by'] or '-'}")
ok_, tc = sql(TRN, f"select c.name, c.status_label, c.active, c.cleared_reported_at, c.cleared_notified_at, (select json_agg(json_build_object('course', co.slug, 'status', e.status, 'requirement', e.requirement)) from public.enrollments e join public.courses co on co.id = e.course_id where e.caregiver_id = c.id) as enr from public.caregivers c where c.axiscare_id = {lit(AXID)}")
DUMP["training"] = tc if ok_ else []
for t in (tc if ok_ else []): say(f"  Training: {t['name']} · {t['status_label']} · active {t['active']} · reported to the Hub {t['cleared_reported_at'] or '-'} · cleared text {t['cleared_notified_at'] or 'none'} · {json.dumps(t['enr'])[:200]}")
ok_, al = sql(HUB, f"select x as it from public.app_data, jsonb_array_elements(data) x where key = 'automation_log' and x->>'at' >= {lit(t0)}")
for a in ([r['it'] for r in al] if ok_ else []): say(f"  automation log: {a.get('automation')} · practice {a.get('dry')} · {json.dumps(a.get('summary'))[:160]}")

say(); say("PART 9 · THE PDFs (saved into the Desktop folder 'Slice 10 practice run')")
files = []
if o.get('offer_pdf_path'): files.append(("onboarding-documents", o['offer_pdf_path'], "Pat Practice - offer letter.pdf"))
if o.get('pd_pdf_path'): files.append(("onboarding-documents", o['pd_pdf_path'], "Pat Practice - position description.pdf"))
for k, v in (f1.get('pdfs') or {}).items():
    p_ = v.get('path') if isinstance(v, dict) else v
    if p_: files.append(("onboarding-documents", p_, f"Pat Practice - Step 1 - {safe_name(k)}.pdf"))
ok_, ex = sql(HUB, f"select name from storage.objects where bucket_id = 'onboarding-documents' and (name like {lit('exports/' + oid + '/%')} " + "".join(f"or name like {lit('exports/caregiver:' + i + '/%')} " for i in ids['caregivers']) + ") order by created_at")
for n_, e in enumerate(ex if ok_ else [], 1): files.append(("onboarding-documents", e['name'], f"Pat Practice - personnel file export {n_}.pdf"))
for b_, p_, n_ in files:
    size = save_object(FNB, SVC, b_, p_, n_)
    say(f"  ✓ {n_} ({size} bytes)") if size else bad(f"could not save {n_} ({p_})")
if not any('export' in f[2] for f in files): say("  · no personnel file export yet (station 12)")

say(); say("PART 10 · THE RETIREMENT LIST, AGAINST WHAT THE RUN DID")
c0 = (rows['candidates'] or rows['caregivers'] or [{}])[0]
r0 = (rows['caregivers'] or [{}])[0]
step = {x['step_key']: x for x in DUMP.get('steps', [])}
def tick(cond, text): say(("  ✓ " if cond else "  ✗ ") + text) if cond else bad(text)
tick(not o.get('start_link_sent_at'), "start form page: no start link went to Pat (new path)")
tick(not o.get('viventium_entered_at') and not o.get('welcome_sent_at'), "Mark entered in Viventium and its welcome text: not used on the new path (the card no longer offers it)")
tick(bool(o.get('step1_done_at')) and any(e['kind'] == 'step1_done' for e in DUMP['offer_events']), "Mark Step 1 done: set by Step 1 itself (step1_done on the trail)")
tick(bool(r0.get('step2_msg') or c0.get('step2_msg')), "the Viventium email watch: replaced by the Step 2 message (recorded in practice)")
tick(bool((r0.get('step2_sent_at') or c0.get('step2_sent_at')) and (r0.get('step2_verified_at') or c0.get('step2_verified_at'))), "the Orientations tab Step 2 ticks: replaced by the audited actions (sent, done, verified, each stamped)")
tick(bool(r0.get('step2_invite') or c0.get('step2_invite')) or bool(DUMP['welcome_calls']), "Invite to welcome call: automatic at Verify on the new path (practice record) or by hand")
tick(bool(DUMP['training'] and DUMP['training'][0]['cleared_reported_at'] and not DUMP['training'][0]['cleared_notified_at']), "Training cleared step: reported to the Hub for the new path; no text and no AxisCare flip from Training")
tick(any(e['kind'] in ('copy_sheet', 'copy_sheet_opened') for e in DUMP.get('events', [])) or step.get('cg.axiscare.attributes', {}).get('state') in ('complete', 'not_needed'), "Starting soon card kept items: the AxisCare copy sheets used")
say("  · Viventium Group 1 tasks: yours to turn off in Viventium on the switch date (not something the run can do)")

say(); say("PART 11 · READ-BACK: WHAT IS LIVE NOW")
for fn in ["offer-sign", "step1-sign", "applicant-link", "caregiver-journey", "step2-handoff", "welcome-call", "interview-messages", "reference-chase", "reference-send", "caregiver-profile", "ghl-attach-doc", "outreach-check", "caregiver-export", "client-audit"]:
    s_, m_ = fmeta(HUB, fn); say(f"  · Hub {fn}: version {(m_ or {}).get('version', '?')}")
for fn in ["job-offer", "notify-cleared"]:
    s_, m_ = fmeta(TRN, fn); say(f"  · Training {fn}: version {(m_ or {}).get('version', '?')}")
say("  · switches: " + ", ".join(f"{k} {'ON' if st.get(k) is True else 'off'}" for k in MUST_BE_OFF + SHOWN_ONLY) + f"; switch date {st.get('onboarding_switch_date') or 'not set'}")
ok_, cj = sql(HUB, "select jobname, schedule, active from cron.job where jobname in ('caregiver-journey-sweep', 'caregiver-audit-nightly', 'step2-handoff-pass', 'eligibility-sweep-nightly', 'obligations-run-nightly', 'client-audit-nightly') order by 1")
for c_ in (cj if ok_ else []): say(f"  · schedule {c_['jobname']}: {c_['schedule']} {'on' if c_['active'] else 'OFF'}")
os.makedirs(OUT, exist_ok=True)
open(os.path.join(OUT, "run.json"), "w").write(json.dumps(DUMP, default=str, indent=1))
say("  · run.json saved for the offline screenshots (made-up data only)")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE (the report is still complete)"); done(9)
say("RESULT: DONE · the practice-run record for you and counsel is this report and the folder 'Slice 10 practice run'. Nothing was sent. Tell Claude \"ran 594\"; run 595 (close-out) when you have read it."); done(0)
