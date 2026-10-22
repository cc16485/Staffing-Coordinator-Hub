#!/usr/bin/env python3
# 1065 · WHO REALLY FINISHED (read only, 2026-10-22, Samantha: "make sure that they really finished the orientation first, i think
# there might be a few new hires that havent completed step 1 or done orientation and got pushed ahead").
# For everyone In Training on the Training Platform and every caregiver hired since Sept 1: what the records say about
#   orientation  the Agency Orientation enrollment (status, when), how many of its modules are finished, the certificate, and
#                whether the office marked it complete by hand (a note or a document) instead of the person doing it
#   Step 1       the signed Step 1 (new path), or the offer's Step 1 stamps
#   Step 2       sent, they said done, the office checked it in Viventium
#   checks       references and OIG, EDL, FCSR, Case.net as the Background and References record holds them
#   video call   the 15-minute welcome video call marked done (their ID on camera for the I-9)
# and one line: READY to make Active in AxisCare, or HOLD with what is missing. Changes nothing, sends nothing.
import json, os, datetime as dt
import cc_step_lib as L
from cc_step_lib import say, bad, done, sql, start, lit

HUB = "zngsgedlsxinbygwmxwn"; TRAIN = "rdqujxiycycwhskyvrwa"
SINCE = os.environ.get("SB_SINCE", "2026-09-01")
def q(ref, s):
    ok, r = sql(ref, s)
    if not ok: bad("could not read: " + str(r)[:200]); return []
    return r
def js(v):
    if isinstance(v, str):
        try: return json.loads(v)
        except Exception: return None
    return v
day = lambda v: str(v or "")[:10]
def mins(a, b):
    try: return int((dt.datetime.fromisoformat(str(b).replace("Z", "+00:00")) - dt.datetime.fromisoformat(str(a).replace("Z", "+00:00"))).total_seconds() // 60)
    except Exception: return None
digits = lambda s: "".join(ch for ch in str(s or "") if ch.isdigit())[-10:]

start("WHO REALLY FINISHED (read only)")
# ── the Training Platform: who, and their orientation ──
people = q(TRAIN, f"""select c.id, c.name, c.axiscare_id, c.status_label, c.active, c.hire_date, c.mobile_phone, c.email
  from public.caregivers c where c.active and (c.status_label = 'In Training' or c.hire_date >= {lit(SINCE)}) order by c.hire_date nulls last, c.name""")
if not people: say("  · nobody In Training or hired since " + SINCE + " on the Training Platform"); done(0)
ids = "array[" + ",".join(lit(p["id"]) for p in people) + "]::uuid[]"
enr = {e["cid"]: e for e in q(TRAIN, f"""select e.caregiver_id::text as cid, to_jsonb(e.*) as e from public.enrollments e join public.courses k on k.id = e.course_id
  where k.slug = 'agency-orientation' and e.caregiver_id = any({ids})""")}
mods = {m["cid"]: m for m in q(TRAIN, f"""select mp.caregiver_id::text as cid, count(*) filter (where mp.completed_at is not null)::int as done,
    (select count(*)::int from public.modules mm join public.courses kk on kk.id = mm.course_id where kk.slug = 'agency-orientation') as total,
    min(mp.completed_at) as first_done, max(mp.completed_at) as last_done, min(mp.updated_at) as first_seen
  from public.module_progress mp join public.modules m on m.id = mp.module_id join public.courses k on k.id = m.course_id
  where k.slug = 'agency-orientation' and mp.caregiver_id = any({ids}) group by mp.caregiver_id""")}
certs = {c["cid"]: c for c in q(TRAIN, f"""select c.caregiver_id::text as cid, max(c.completed_at) as at, max(c.learner_name) as signed_as from public.completions c join public.courses k on k.id = c.course_id
  where k.slug = 'agency-orientation' and c.caregiver_id = any({ids}) group by c.caregiver_id""")}
offers = q(TRAIN, f"""select id::text, matched_caregiver_id::text as cid, first_name, last_name, phone, email, onboarding_path, offer_signed_at, step1_sent_at, step1_done_at
  from public.job_offers where matched_caregiver_id = any({ids}) or offer_signed_at >= {lit(SINCE)}""")
# ── the Hub: roster, Background and References, Step 1, video call, readiness card ──
roster = js((q(HUB, "select data from public.app_data where key = 'caregivers'") or [{}])[0].get("data")) or []
cands = js((q(HUB, "select data from public.app_data where key = 'candidates'") or [{}])[0].get("data")) or []
step1 = {r["offer_id"]: r for r in q(HUB, "select offer_id::text, completed_at from public.step1_forms")}
calls = q(HUB, "select candidate_id, status, done_at from public.welcome_calls")
jsteps = q(HUB, """select j.offer_id::text, j.status as jstatus, s.step_key, s.state, s.completed_at, s.completed_by_name from public.client_journey j
  left join public.client_journey_step s on s.journey_id = j.journey_id where j.subject = 'caregiver'""")
by_offer = {}
for r in jsteps: by_offer.setdefault(r["offer_id"], {})[r["step_key"]] = r
DONE = ("complete", "not_needed", "exception")
CLEAR = lambda v: str(v or "").strip().lower() in ("clear", "clear (manual)", "passed", "no matches")

say(f"Everyone In Training on the Training Platform, and every caregiver hired since {SINCE}: {len(people)}")
say("READY = orientation really finished, Step 1 signed, Step 2 checked, checks and references clear, welcome video call done.")
say()
ready, hold = [], []
for p in people:
    cid, ax = p["id"], digits(p.get("axiscare_id"))
    g = next((r for r in roster if digits(r.get("axiscare_id")) == ax and ax), None) if isinstance(roster, list) else None
    o = next((x for x in offers if x["cid"] == cid), None) or (next((x for x in offers if g and str(g.get("offer_id")) == x["id"]), None))
    c = None
    cand_id = str((g or {}).get("candidate_id") or "")
    if cand_id: c = next((x for x in cands if str(x.get("id")) == cand_id), None)
    if not c and p.get("mobile_phone"): c = next((x for x in cands if digits(x.get("phone")) == digits(p["mobile_phone"])), None)
    rec = c or g or {}
    jr = by_offer.get(str((o or {}).get("id") or (g or {}).get("offer_id") or ""), {})
    missing, lines = [], []
    # orientation
    e = js((enr.get(cid) or {}).get("e")) or {}
    m = mods.get(cid) or {}
    ce = certs.get(cid) or {}
    st = e.get("status") or "not enrolled"
    by_hand = bool(e.get("completion_note") or e.get("completion_doc_path") or e.get("waived_at"))
    span = mins(m.get("first_seen"), m.get("last_done")) if m.get("last_done") else None
    if st == "complete" and not by_hand and m.get("total") and m.get("done", 0) >= m.get("total", 0):
        lines.append(f"orientation FINISHED {day(e.get('completed_at'))} by them: {m.get('done')} of {m.get('total')} modules" + (f", over about {span // 60}h {span % 60:02d}m" if span is not None else "") + (", certificate signed" if ce.get("at") else ""))
        if span is not None and span < 45:
            lines.append(f"  ⚠ only about {span} minutes from the first module to the last (orientation is about 2 hours)")
            missing.append(f"orientation took only about {span} minutes: check it was really done")
    elif st == "complete" and by_hand:
        lines.append(f"orientation MARKED complete by the office {day(e.get('completed_at') or e.get('waived_at'))}" + (f" (note: {str(e.get('completion_note'))[:90]})" if e.get("completion_note") else "") + f"; modules done online: {m.get('done', 0)} of {m.get('total', '?')}")
        missing.append("orientation was marked by hand, not done online: confirm it")
    elif st == "complete":
        lines.append(f"orientation shows complete {day(e.get('completed_at'))}, but only {m.get('done', 0)} of {m.get('total', '?')} modules are finished")
        missing.append("orientation modules not all finished")
    else:
        lines.append(f"orientation NOT finished ({st.replace('_', ' ')}{', ' + str(round(float(e.get('progress') or 0) * 100)) + '%' if e.get('progress') else ''}; {m.get('done', 0)} of {m.get('total', '?')} modules)")
        missing.append("orientation")
    # Step 1
    s1 = step1.get(str((o or {}).get("id") or ""))
    if s1 and s1.get("completed_at"): lines.append(f"Step 1 signed {day(s1['completed_at'])}")
    elif o and o.get("step1_done_at"): lines.append(f"Step 1 done {day(o['step1_done_at'])} (offer record)")
    elif o and (o.get("onboarding_path") or "") == "new": lines.append("Step 1 NOT signed" + (f" (sent {day(o.get('step1_sent_at'))})" if o.get("step1_sent_at") else " (never sent)")); missing.append("Step 1")
    else: lines.append("Step 1: no new-path record (hired on the older path: check their Step 1 packet in GoHighLevel)"); missing.append("Step 1 (older path, check by hand)")
    # Step 2
    if rec.get("step2_verified_at"): lines.append(f"Step 2 checked in Viventium {day(rec['step2_verified_at'])}")
    elif rec.get("step2_done_at"): lines.append(f"Step 2: they said done {day(rec['step2_done_at'])}, NOT checked by the office"); missing.append("Step 2 check")
    elif rec.get("step2_sent_at"): lines.append(f"Step 2 sent {day(rec['step2_sent_at'])}, NOT done"); missing.append("Step 2")
    else: lines.append("Step 2: nothing recorded in the Hub"); missing.append("Step 2 (nothing recorded)")
    # checks and references (the record, or the readiness card)
    refs_ok = sum(1 for n in range(1, 5) if str(rec.get(f"r{n}s") or "") == "Positive")
    rc = jr.get("cg.refs.cleared", {})
    chk = {k: (CLEAR(rec.get(k)) or (jr.get(f"cg.check.{k}", {}).get("state") in DONE)) for k in ("oig", "edl", "fcsr")}
    cn = jr.get("cg.check.casenet", {}).get("state") in DONE or CLEAR(rec.get("casenet"))
    lines.append(f"references {refs_ok} positive" + (" (card: cleared)" if rc.get("state") in DONE else "") + " · " + " · ".join(f"{k.upper()} {'clear' if v else 'NOT clear'}" for k, v in chk.items()) + f" · Case.net {'done' if cn else 'not recorded'}")
    if not (refs_ok >= 2 or rc.get("state") in DONE): missing.append("references")
    for k, v in chk.items():
        if not v: missing.append(k.upper())
    # welcome video call
    wc = [w for w in calls if cand_id and str(w.get("candidate_id")) == cand_id] or [w for w in calls if c and str(w.get("candidate_id")) == str(c.get("id"))]
    wdone = next((w for w in wc if w.get("status") == "done"), None) or (jr.get("cg.welcome.call") if jr.get("cg.welcome.call", {}).get("state") in DONE else None)
    if wdone: lines.append(f"welcome video call done {day(wdone.get('done_at') or wdone.get('completed_at'))}")
    else: lines.append("welcome video call NOT done" + (f" ({wc[0].get('status')})" if wc else "")); missing.append("welcome video call (I-9 ID check)")
    if jr: lines.append("readiness card: " + ("Approved to Work" if jr.get("cg.approve.work", {}).get("state") == "complete" else "not approved yet") + f" ({sum(1 for v in jr.values() if v.get('state') in DONE)} rows done)")
    who = f"{p['name']} (AxisCare {p.get('axiscare_id') or '?'}, {p.get('status_label') or '?'}, hired {day(p.get('hire_date')) or '?'})"
    (ready if not missing else hold).append(who)
    say(("  ✓ READY  " if not missing else "  ✗ HOLD   ") + who)
    for l in lines: say("        · " + l)
    if missing: say("        → missing: " + "; ".join(dict.fromkeys(missing)))
    say()
say(f"READY to make Active ({len(ready)}): " + (", ".join(r.split(' (')[0] for r in ready) or "nobody"))
say(f"HOLD ({len(hold)}): " + (", ".join(h.split(' (')[0] for h in hold) or "nobody"))
say("Nothing was changed or sent.")
done(0 if not L.fails else 1)
