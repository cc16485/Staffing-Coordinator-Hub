#!/usr/bin/env python3
# 591 · SLICE 10, THE PRACTICE RUN: SET-UP (Samantha "yes to all" + "approve the two fixes", 2026-10-11). Hub and Training.
# 1. Deploys the practice-address guard (a 555-0180..0189 number or an @practice.invalid email is never texted, emailed or
#    added to GoHighLevel) to the nine Hub services the run passes through, each only when its live copy is main's build
#    apart from the two changed files, so nobody else's live work is overwritten.
# 2. Creates ONE made-up offer on the new path for Pat Practice, the way the October 9 rehearsal did (directly, so no switch
#    date is set and no AxisCare applicant is made). Every switch stays off. Nothing is sent to anyone.
# 3. Writes the station guide to the Desktop folder "Slice 10 practice run".
import os, json, datetime as dt
os.environ.setdefault("SB_STEP", "591")
from cc_step_lib import *
from practice_run_lib import *
FNS = ["outreach-check", "welcome-call", "interview-messages", "step2-handoff", "reference-chase", "reference-send", "caregiver-profile", "ghl-attach-doc", "caregiver-journey"]
CHANGED = {"supabase/functions/_shared/optout.ts", "supabase/functions/ghl-attach-doc/index.ts"}
import subprocess, hashlib
_HIST = {}
def in_history(rel, live_sha):
    """True when this exact file content was committed on main at some point (the live copy is just older than main)"""
    if not live_sha: return False
    if rel not in _HIST:
        shas = set()
        try:
            commits = subprocess.run(["git", "-C", ROOT, "log", "--format=%H", "--", rel], capture_output=True, text=True, timeout=120).stdout.split()
            for c in commits:
                b = subprocess.run(["git", "-C", ROOT, "show", f"{c}:{rel}"], capture_output=True, timeout=60).stdout
                if b: shas.add(hashlib.sha256(b).hexdigest())
        except Exception: pass
        _HIST[rel] = shas
    return live_sha in _HIST[rel]
start("SLICE 10, THE PRACTICE RUN: SET-UP (one made-up hire)")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
st = switches()
if st is None: bad("could not read the Hub switches"); done(3)
on = [k for k in MUST_BE_OFF if st.get(k) is True or str(st.get(k)).lower() == 'true']
say("  ✓ every sending switch on the path is off: " + ", ".join(MUST_BE_OFF)) if not on else bad("a switch is ON (" + ", ".join(on) + "); the practice run must not send. Turn it off on the Admin page first.")
say("  · also shown (not used by the run): " + ", ".join(f"{k} {'on' if st.get(k) is True else 'off'}" for k in SHOWN_ONLY))
sd = str(st.get("onboarding_switch_date") or "")
say("  ✓ the switch date is not set: real offers stay on the old path") if not sd else bad(f"the switch date is set ({sd}); tell Claude before a practice run")
ok_, n = sql(TRN, f"select count(*) filter (where offered_by = {lit(LABEL)} and offer_withdrawn_at is null)::int as open_run, "
                  f"count(*) filter (where right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = {lit(PHONE)} or lower(coalesce(email, '')) = {lit(EMAIL)} "
                  f"or (lower(first_name) = 'pat' and lower(last_name) = 'practice'))::int as clash, "
                  f"count(*) filter (where onboarding_path = 'new' and offered_by not in ('Slice 1b test', 'Slice 1g rehearsal', {lit(LABEL)}))::int as real_new from public.job_offers")
if not ok_: bad(f"could not read the offers: {n}"); done(3)
if int(n[0]['open_run']): bad("a practice-run offer is already open: run 595 (close-out) first, or carry on with the one you have")
elif int(n[0]['clash']): bad("an offer already uses Pat Practice's name, number or email; tell Claude")
else: say("  ✓ no offer uses Pat Practice's name, number (417-555-0183) or email")
say(f"  ✓ no real offer is on the new path ({n[0]['real_new']})") if int(n[0]['real_new']) == 0 else bad(f"{n[0]['real_new']} real offer(s) are on the new path; tell Claude")
ok_, h = sql(HUB, f"select count(*)::int as n from public.app_data, jsonb_array_elements(data) x where key in ('candidates', 'caregivers') and ("
                  f"right(regexp_replace(coalesce(x->>'phone', ''), '\\D', '', 'g'), 10) = {lit(PHONE)} or (lower(x->>'first') = 'pat' and lower(x->>'last') = 'practice') "
                  f"or x->>'axiscare_id' = {lit(AXID)})")
say("  ✓ no Hub record uses Pat's name, number or the made-up AxisCare number 990000183") if ok_ and int(h[0]['n']) == 0 else bad(f"a Hub record already uses Pat's details: {h}")
ok_, t = sql(TRN, f"select count(*)::int as n from public.caregivers where axiscare_id = {lit(AXID)} or right(regexp_replace(coalesce(mobile_phone, ''), '\\D', '', 'g'), 10) = {lit(PHONE)}")
say("  ✓ no Training caregiver uses the made-up AxisCare number or Pat's number") if ok_ and int(t[0]['n']) == 0 else bad(f"a Training caregiver already uses them: {t}")
ok_, wc = sql(HUB, f"select count(*)::int as n from public.welcome_calls where right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = {lit(PHONE)}")
if ok_ and int(wc[0]['n']): bad("a welcome call already uses Pat's number; tell Claude")
ok_, pm = sql(HUB, "select data from public.app_data where key = 'onboarding_permissions'")
perms = (pm[0]['data'] or {}) if ok_ and pm else {}
def names(k): return ", ".join(str(m.get('name') or m.get('email') or '?') for m in (perms.get(k) or [])) or "nobody"
say(f"  · Approve to Advance list: {names('advance')} (owners may too)")
say(f"  · Approve to Work list: {names('work')} (owners are NOT automatic)")
say(f"  · Screening list: {names('screening')}")
if not any(str(m.get('email', '')).lower() == 'samantha@mo-care.com' for m in (perms.get('work') or [])):
    say("  ! you are not on the Approve to Work list: add yourself on the Admin page before station 11 (only someone already on it can add, or ask Zachary)")
VJ = {}
for fn in FNS:
    sx, mx = fmeta(HUB, fn)
    if not (sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool)): bad(f"{fn} is not live or unreadable: {sx}"); continue
    VJ[fn] = mx["verify_jwt"]
    okl, livef = live_files(HUB, fn)
    if not okl: bad(f"could not read {fn}'s live files"); continue
    differ = [k for k in need(FNROOT, fn) if k not in CHANGED and livef.get(k) != sha(os.path.join(ROOT, k))]
    unknown = [k for k in differ if not in_history(k, livef.get(k))]
    short = lambda ks: ', '.join(d.split('/')[-2] + '/' + d.split('/')[-1] for d in ks[:4])
    if unknown: bad(f"{fn}'s live copy holds {short(unknown)} in a version that was never on main (someone's unmerged work); deploying would overwrite it. Tell Claude.")
    elif differ: say(f"  ✓ {fn} is live at version {mx.get('version', '?')}: main's build apart from the guard and older versions (from main's own history) of {short(differ)}, which this deploy brings up to main")
    else: say(f"  ✓ {fn} is live at version {mx.get('version', '?')} and is main's build apart from the guard")
say("  · what changes: the guard on nine Hub services, and one made-up offer for Pat Practice with its 'sent' event. Nothing is sent to anyone.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
for fn in FNS:
    if not deploy(HUB, FNROOT, fn, VJ[fn]): say("  RESULT: STOPPED. The guard is on the services listed above; tell Claude."); done(6)
now = dt.datetime.now(dt.timezone.utc); exp = (now + dt.timedelta(days=9)).replace(hour=22, minute=0, second=0, microsecond=0).isoformat()
ok_, r_ = sql(TRN, f"""insert into public.job_offers (first_name, last_name, phone, email, position, pay_rate, hours_type, interview_date, offered_by, onboarding_path, classification, offer_status, offer_version, pd_version, offer_sent_at, offer_sent_by, offer_expires_at, created_at, notes)
  values ({lit(FIRST)}, {lit(LAST)}, {lit(PHONE)}, {lit(EMAIL)}, 'Caregiver', 17, 'PART_TIME', current_date, {lit(LABEL)}, 'new', 'part_time', 'sent', 1, 1, {lit(now.isoformat())}, {lit(LABEL + ' (made up)')}, {lit(exp)}, {lit(now.isoformat())},
          'MADE-UP practice-run hire for Slice 10; never a real person. Reachable only at practice addresses, which nothing ever contacts.') returning id""")
if not ok_ or not r_: bad(f"could not create the offer: {r_}"); done(7)
oid = r_[0]['id']
ok2, _ = sql(TRN, f"""insert into public.offer_events (offer_id, kind, by_who, channel, doc_version, detail) values ({lit(oid)}, 'sent', 'office', null, 1, '{{"step": "591", "practice": true, "made_up": true}}')""")
say(f"  ✓ Pat Practice's offer created on the new path ({oid[:8]}…, expires {exp[:10]})" + ("" if ok2 else "; its sent event was NOT written (tell Claude)"))

say(); say("PART 3 · PROOF (nothing is sent)")
o = offer()
say("  ✓ the offer reads back: new path, sent, Pat Practice") if o and o['onboarding_path'] == 'new' and o['offer_status'] == 'sent' and str(o['id']) == str(oid) else bad(f"read back: {o}")
for fn in FNS:
    s_, m_ = fmeta(HUB, fn); say(f"  · {fn}: version {(m_ or {}).get('version', '?')}")
GUIDE = f"""SLICE 10 PRACTICE RUN · THE STATIONS (Pat Practice, made up; nothing is ever sent to them)
Pat's practice addresses: phone 417-555-0183, email {EMAIL}. Every sender refuses them.
When a screen asks for something about Pat, make it up. References: phones 417-555-0184 to 417-555-0187, emails ref1@practice.invalid to ref4@practice.invalid.
Need a link (Step 2 DONE page, welcome call booking)? Run 592 (read only) at any time: it prints Pat's current links.

 1. Hub > Offers > Open offers: Pat Practice (New path). Signing link > scan the QR with your phone > sign the offer letter, then the position description.
 2. Same card: Next step "Move to Background & References" (or Background & References > Offered strip > Add to the table).
 3. Same card: Step 1 link > your phone > the nine screens. Made-up identity: SSN 123-45-6789, date of birth 1990-01-01, license S12345678 (MO).
    Two professional and two personal references with the numbers and emails above. Sign. The B&R row then says Step 1 done.
 4. Background & References, Pat's row: Run OIG (the real federal list, a made-up name). Record EDL and FCSR: first press Clear WITHOUT a proof file
    (it must refuse), then with "Practice proof.pdf" from this folder. Record answer: two references Positive (one professional).
 5. ☰ Readiness on Pat's row: read the card; Confirm "Approve to Advance".
 6. Orientations tab > Ready for Orientation > Pat: "Record Step 2 sent" (Practice: recorded, not sent). Run 592 for the DONE link > open it on your
    phone > tap that you finished. Back in the Hub: "✓ Verify", tick every item including I-9 Section 2.
 7. Pat's row: "📹 Invite to welcome call" (the text and email are refused for a practice address; that is the point). Run 592 for the booking
    link > book a time on your phone > in the Hub the welcome call shows Booked > "Welcome call done – send orientation link". Pat moves to the
    caregiver roster; the orientation link cannot match a made-up person in AxisCare, so a "Didn't go through" card appears: expected.
 8. Run 593 (training): it records Pat's orientation and Dementia course as test completions in the Training Platform and sends the
    real completion notice to the Hub. (On-the-job training is due 30 days after hire and is not part of Approve to Work.)
 9. Caregivers > Training (or Compliance): ☰ Readiness on Pat's row. "Caregiver profile published": Not needed, reason "made-up practice hire, no profile".
10. Copy sheets: ⎘ on AxisCare attributes and availability (read them; nothing to enter for a made-up person).
11. Approve to Work (you must be on the Approve to Work list). AxisCare Active and the cleared text are recorded as practice.
12. Evidence: ✏️ on Pat's roster row, change the orientation date by one day and save. Then ⇩ Personnel file (PDF) on the card: once for today,
    once "as of" yesterday.
13. Run 594 (report, read only): the whole trail, PDFs and the retirement checks into this folder; it runs the nightly passes once in practice.
14. Tell Claude "ran 594". After you have read the report, run 595 (close-out).
"""
os.makedirs(OUT, exist_ok=True); open(os.path.join(OUT, "Stations.txt"), "w").write(GUIDE)
PROOF_PDF = b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj 4 0 obj<</Length 74>>stream\nBT /F1 18 Tf 72 700 Td (PRACTICE PROOF for a made-up hire. Not a real check.) Tj ET\nendstream endobj 5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
open(os.path.join(OUT, "Practice proof.pdf"), "wb").write(PROOF_PDF)
say(); say("THE STATIONS (also in the Desktop folder 'Slice 10 practice run', file Stations.txt)"); [say("  " + l) for l in GUIDE.splitlines()]
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the guard is live on the nine services and Pat Practice's offer is ready. Nothing was sent. Start at station 1."); done(0)
