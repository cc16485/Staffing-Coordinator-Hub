#!/usr/bin/env python3
# 705 · ONBOARDING GOES LIVE, THE HUB PROJECT (Samantha 2026-10-13: "approve step 1 forms", wording page version 5).
# Hub project, with one read of the Training Platform's offers. Staffing PR "golive-705".
# PART 1 reads only and stops before any change if anything is wrong: the reviewed build (every file the two services need
# and the approval record, pinned); each service's live files against this build (a live file from this build's own history
# is just older; a live file that is newer on main than this build, or was never on main, STOPS: deploying would roll it back
# or overwrite someone's work); main has not changed those files since the review; step1-sign's live version and gateway
# setting; what the live Step 1 says today; the switch date must NOT be set; the switches (shown only); the Training
# Platform keeps each offer's path (the set-once guard is there); the real offers saved today in Central time (test people,
# practice and training offers left out); Step 1 records, practice and real.
# PART 2 changes, in this order: step1-sign and driver-compliance deployed (the only two services that use the approval;
# each keeps its own gateway setting); then the switch date written into ops_settings, that one key only, compare-and-save
# on the row's version (the date: today in Central time if no real offer was saved today, otherwise tomorrow, decided again
# right before the write); then one line in the automation log with the exact moment.
# PART 3 proves it with nothing sent and nothing else changed: both services live as tested; the preview answers with 12 to
# sign, every form approved at the recorded version and fingerprint; the read-only approval check accepts the approved
# versions and refuses the next ones; the onboarding path rule as live (the live outreach-check is main's code with the rule,
# applied to the stored date); no other switch changed.
# ORDER: merge Staffing PR golive-705 (merge commit, not squash), then run this.
import os, re, json, subprocess, hashlib, datetime as dt
os.environ.setdefault("SB_STEP", "705")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; TRN = "rdqujxiycycwhskyvrwa"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
# the services that use APPROVED_FOR_REAL / approvedForReal (git grep, checked by the rehearsal); nothing else is deployed
FNS = ["step1-sign", "driver-compliance"]
REC_REL = "supabase/step1-approved-2026-10-13.json"
OUTREACH_REL = "supabase/functions/outreach-check/index.ts"
PATH_RULE = "const path = switch_date && offer_date >= switch_date ? 'new' : 'old'"
SWITCHES = ["offer_send_live", "offer_reminders_live", "step1_auto_live", "step2_send_live", "step2_reminders_live", "wc_auto_invite_live",
            "orient_remind_live", "approve_work_text_live", "approve_work_axiscare_live", "axiscare_hire_date_live", "axiscare_level_live",
            "driver_reminders_live", "driver_link_send_live", "driver_schedule_gate_live", "hepb_offer_live"]
SD_KEY = "onboarding_switch_date"
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
# the practice and test rules, the same as _shared/step1-crypto.ts practiceOffer, _shared/optout.ts practicePerson and
# _shared/test-people.ts testPerson (the rehearsal checks these against the TypeScript)
PRACTICE_OFFERS = ["Slice 10 practice run", "Training walkthrough"]
digits = lambda v: re.sub(r"\D", "", str(v or ""))
def practice_offer(o): return o.get("offered_by") in PRACTICE_OFFERS or "(TRAINING)" in str(o.get("last_name") or "")
def practice_phone(v): d = digits(v); return len(d) >= 7 and re.fullmatch(r"555018\d", d[-7:]) is not None
def practice_email(v): return re.search(r"@(?:[a-z0-9-]+\.)*practice\.invalid$", str(v or "").strip().lower()) is not None
def practice_person(phone, email):
    p, e = str(phone or "").strip(), str(email or "").strip()
    if not p and not e: return False
    return (not p or practice_phone(p)) and (not e or practice_email(e))
def test_lists(st):
    t = st.get("test_people") if isinstance(st, dict) and isinstance(st.get("test_people"), dict) else {}
    phones = [digits(x)[-10:] for x in (t.get("phones") if isinstance(t.get("phones"), list) else [])]
    emails = [str(x).strip().lower() for x in (t.get("emails") if isinstance(t.get("emails"), list) else [])]
    return [x for x in phones if len(x) == 10], [x for x in emails if "@" in x]
def test_person(st, phone, email):
    phones, emails = test_lists(st)
    if not phones and not emails: return False
    ph, em = digits(phone)[-10:], str(email or "").strip().lower()
    if not ph and not em: return False
    return (not ph or ph in phones) and (not em or em in emails)
def kind_of(o, st):
    if practice_offer(o): return "practice"
    if practice_person(o.get("phone"), o.get("email")): return "practice"
    if test_person(st, o.get("phone"), o.get("email")): return "test"
    return "real"

def hist_shas(ref, rel):
    out = {}
    try:
        for c in subprocess.run(["git", "-C", ROOT, "log", ref, "--format=%H", "--", rel], capture_output=True, text=True, timeout=120).stdout.split():
            b = subprocess.run(["git", "-C", ROOT, "show", f"{c}:{rel}"], capture_output=True, timeout=60).stdout
            if b: out.setdefault(hashlib.sha256(b).hexdigest(), b)
    except Exception: pass
    return out
_H = {}
def in_hist(ref, rel, s):
    if (ref, rel) not in _H: _H[(ref, rel)] = hist_shas(ref, rel)
    return bool(s) and s in _H[(ref, rel)]
short = lambda ks: ", ".join(k.split("/")[-2] + "/" + k.split("/")[-1] for k in ks[:4]) + (f" and {len(ks) - 4} more" if len(ks) > 4 else "")
def onb():
    """(ops_settings data, version) or (None, None)"""
    ok_, r = sql(REF, "select data, version from public.app_data where key = 'ops_settings'")
    if not ok_ or not r: return None, None
    d = r[0].get("data")
    return (d if isinstance(d, dict) else None), int(r[0].get("version") or 0)
def is_on(v): return v is True or str(v).lower() == "true"
def offers_today(st):
    """(today, tomorrow, rows) in Central time from the Training Platform, or (None, None, error)"""
    ok_, r = sql(TRN, "with d as (select (now() at time zone 'America/Chicago')::date as day) "
                      "select to_char(d.day, 'YYYY-MM-DD') as today, to_char(d.day + 1, 'YYYY-MM-DD') as tomorrow, "
                      "coalesce((select json_agg(json_build_object('id', o.id, 'offered_by', o.offered_by, 'last_name', o.last_name, 'phone', o.phone, "
                      "'email', o.email, 'path', o.onboarding_path) order by o.created_at) from public.job_offers o "
                      "where o.created_at >= (d.day::timestamp at time zone 'America/Chicago')), '[]'::json) as offers_json from d")
    if not ok_ or not r: return None, None, str(r)[:200]
    rows = r[0].get("offers_json") or []
    if isinstance(rows, str): rows = json.loads(rows)
    return r[0]["today"], r[0]["tomorrow"], [dict(o, kind=kind_of(o, st)) for o in rows]
def decide(today, tomorrow, rows):
    real = [o for o in rows if o["kind"] == "real"]
    return (today, "today: no real offer was saved today") if not real else (tomorrow, f"tomorrow: {len(real)} real offer(s) were already saved today")
def counts(rows):
    c = {k: sum(1 for o in rows if o["kind"] == k) for k in ("real", "practice", "test")}
    return f"{c['real']} real, {c['practice']} practice or training, {c['test']} from your test list"

start("ONBOARDING GOES LIVE, THE HUB PROJECT")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
FN_SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))
check_build(FNROOT, FN_SHAS)
NEED = {fn: need(FNROOT, fn) for fn in FNS}
missing_fn = [fn for fn in FNS if not NEED[fn]]
if missing_fn: bad("these services are not in the reviewed build: " + ", ".join(missing_fn) + ". Nothing runs."); done(2)
unpinned = sorted({k for fn in FNS for k in NEED[fn]} - {"supabase/functions/" + k for k in FN_SHAS})
if unpinned: bad("these files the services need are not pinned to the reviewed build: " + short(unpinned) + ". Nothing runs."); done(2)
REC_SHA = os.environ.get("SB_REC_SHA", "").strip().lower(); RECP = os.path.join(ROOT, REC_REL)
if not (REC_SHA and os.path.exists(RECP) and sha(RECP) == REC_SHA): bad("the approval record (step1-approved-2026-10-13.json) is not the reviewed build: nothing runs"); done(2)
REC = json.load(open(RECP)); RECF = {f["key"]: f for f in REC.get("forms", [])}
if not (len(RECF) == 13 and all(re.fullmatch(r"[0-9a-f]{64}", str(f.get("sha256", ""))) and isinstance(f.get("version"), int) for f in RECF.values())):
    bad("the approval record does not hold thirteen forms with versions and fingerprints: nothing runs"); done(2)
say(f"  ✓ the approval record is the reviewed build: {REC.get('approved_by')}, {REC.get('approved_at_central')}, \"{REC.get('her_words')}\", {REC.get('source')}, 13 forms")
# main must not have moved on in these files since the review (deploying this build would roll that work back)
moved = []
for k in sorted({k for fn in FNS for k in NEED[fn]}):
    b = subprocess.run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"], capture_output=True).stdout
    if b and hashlib.sha256(b).hexdigest() != sha(os.path.join(ROOT, k)) and not in_hist("HEAD", k, hashlib.sha256(b).hexdigest()): moved.append(k)
if moved: bad("main has newer versions of " + short(moved) + " than this reviewed build (merged after the review); deploying would roll them back. Tell Claude. Nothing runs."); done(2)
say("  ✓ main holds no newer version of any file these two services use")

VJ = {}
for fn in FNS:
    sx, mx = fmeta(REF, fn)
    if sx == 404: bad(f"{fn} is not live at all; this step only brings live services up to date. Tell Claude."); continue
    if not (sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool)): bad(f"could not read {fn} ({sx})"); continue
    VJ[fn] = mx["verify_jwt"]
    okl, livef = live_files(REF, fn)
    if not okl: bad(f"could not read {fn}'s live files"); continue
    mine = {k: sha(os.path.join(ROOT, k)) for k in NEED[fn]}
    differ = [k for k in sorted(mine) if livef.get(k) != mine[k]]
    missing = [k for k in differ if livef.get(k) is None]
    older = [k for k in differ if k not in missing and in_hist("HEAD", k, livef.get(k))]
    newer = [k for k in differ if k not in missing and k not in older and in_hist(MAIN, k, livef.get(k))]
    unknown = [k for k in differ if k not in missing and k not in older and k not in newer]
    unknown += [k for k in sorted(livef) if k not in mine and not in_hist(MAIN, k, livef[k])]
    gw = f"gateway sign-in check {'on' if VJ[fn] else 'off'}"
    if newer: bad(f"{fn}'s live copy holds {short(newer)} in a version newer than this build (from main, after the review); deploying would roll it back. Tell Claude.")
    elif unknown: bad(f"{fn}'s live copy holds {short(unknown)} in a version that was never on main (someone's unmerged work); deploying would overwrite it. Tell Claude.")
    elif differ: say(f"  ✓ {fn} is live at version {mx.get('version', '?')} ({gw}): "
                     + "; ".join(x for x in [f"older versions (from this build's own history) of {short(older)}" if older else "",
                                              f"built before it used {short(missing)}" if missing else ""] if x) + ". This deploy brings it up to date.")
    else: say(f"  ✓ {fn} is live at version {mx.get('version', '?')} ({gw}) and is already this build")
ok_, ks = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG()); ANON = ""
try:
    arr = json.loads(ks) if ok_ == 200 else []
    if isinstance(arr, dict): arr = arr.get("keys") or []
    for k in arr:
        v = str(k.get("api_key", "")) if isinstance(k, dict) else ""
        if k.get("name") == "anon" and v.startswith("eyJ"): ANON = v
except Exception: pass
HIDE.append(ANON)
say("  ✓ the project's public key is readable (the proofs call Step 1 as a visitor)") if ANON else bad("could not read the project's public key")
VIS = {"apikey": ANON, "Authorization": "Bearer " + ANON}
def preview(body=None):
    s_, b_ = http("POST", f"{FNB}/functions/v1/step1-sign", dict({"action": "preview"}, **(body or {})), VIS)
    try: return s_, json.loads(b_)
    except Exception: return s_, {}
if ANON:
    s0, p0 = preview(); f0 = [f for f in (p0.get("forms") or []) if isinstance(f, dict)]
    if s0 == 200 and f0: say(f"  · the live Step 1 today: {len(f0)} forms, {sum(1 for f in f0 if f.get('approved_for_real') is True)} approved for real applicants")
    else: say(f"  · the live Step 1 preview answered {s0}")
st0, ver0 = onb()
if st0 is None: bad("could not read the Hub switches (ops_settings)")
else:
    sd = str(st0.get(SD_KEY) or "")
    if sd: bad(f"the switch date is already set ({sd}). Tell Claude before this runs.")
    else: say("  ✓ the switch date is not set yet (this step sets it)")
    say("  · the switches (shown only; this step changes none): " + ", ".join(f"{k} {'on' if is_on(st0.get(k)) else 'off'}" for k in SWITCHES))
ok_, tg = sql(TRN, "select count(*)::int as n from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace "
                   "where n.nspname = 'public' and c.relname = 'job_offers' and t.tgname = 'trg_job_offers_path_permanent' and t.tgenabled <> 'D' and not t.tgisinternal")
if not ok_: bad(f"could not read the Training Platform's offers guard: {tg}")
elif int(tg[0]["n"]) == 1: say("  ✓ the Training Platform stores each offer's path when it is saved and refuses any later change (trg_job_offers_path_permanent is on), so offers already sent keep the old path")
else: bad("the Training Platform's set-once guard on an offer's path (trg_job_offers_path_permanent) is missing or off. Tell Claude.")
TODAY = TOMORROW = None; ROWS = []
if st0 is not None:
    TODAY, TOMORROW, ROWS = offers_today(st0)
    if TODAY is None: bad(f"could not read today's offers on the Training Platform: {ROWS}"); ROWS = []
    else:
        say(f"  · offers saved today ({TODAY}, Central time): {len(ROWS)} ({counts(ROWS)})")
        newp = [o for o in ROWS if o.get("path") == "new" and o["kind"] == "real"]
        if newp: say(f"  ! {len(newp)} real offer(s) saved today are already on the new path, before the switch date. Not stopping; tell Claude.")
        d_, why_ = decide(TODAY, TOMORROW, ROWS)
        say(f"  · the switch date will be {d_} ({why_}); decided again right before it is written")
ok_, fr = sql(REF, "select count(*) filter (where coalesce(practice, false))::int as practice, count(*) filter (where not coalesce(practice, false))::int as real, "
                   "count(*) filter (where not coalesce(practice, false) and started_at is not null)::int as real_started from public.step1_forms")
if not ok_: bad(f"could not count the Step 1 records: {fr}")
else:
    f_ = fr[0]
    say(f"  · Step 1 records: {f_['practice']} practice, {f_['real']} real")
    if int(f_["real_started"]): say(f"  ! {f_['real_started']} real Step 1 record(s) already started before the switch date. Not stopping; tell Claude who they are.")
    else: say("  ✓ no real Step 1 has started (expected before the switch date)")
say("  · what changes: step1-sign and driver-compliance (they now let real applicants sign the approved forms), and the switch date. "
    "No other service, no other setting, no person's record. Nothing is sent.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, VJ[fn]): say("  RESULT: STOPPED. The switch date was NOT set. Tell Claude."); done(6)
SET = None
for i in range(5):
    stc, verc = onb()
    if stc is None: bad("could not read the Hub switches again; the switch date was not set"); break
    if str(stc.get(SD_KEY) or ""): bad(f"the switch date was set by someone else meanwhile ({stc.get(SD_KEY)}); this step left it alone"); break
    today, tomorrow, rows = offers_today(stc)
    if today is None: bad(f"could not read today's offers again; the switch date was not set: {rows}"); break
    date, why = decide(today, tomorrow, rows)
    # only this one key is written, and only if nobody saved ops_settings since it was read (the Admin page's rule)
    ok_, w = sql(REF, f"update public.app_data set data = jsonb_set(data, '{{{SD_KEY}}}', to_jsonb({lit(date)}::text), true) "
                      f"where key = 'ops_settings' and version = {int(verc)} and jsonb_typeof(data) = 'object' and coalesce(data->>'{SD_KEY}', '') = '' "
                      "returning version, data->>'" + SD_KEY + "' as sd, to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') as written_at")
    if not ok_: bad(f"the switch date could not be saved: {w}"); break
    if w:
        SET = {"date": w[0]["sd"], "at": w[0]["written_at"], "why": why, "today": today, "rows": rows}
        say(f"  ✓ the switch date is {SET['date']} ({why}); written at {SET['at']} (UTC)"); break
else: bad("someone kept saving the Hub settings at the same moment, so the switch date was not set. Tell Claude.")
if SET:
    item = {"id": "golive_705_" + re.sub(r"\D", "", SET["at"]), "at": SET["at"], "automation": "onboarding_go_live", "ran_by": "705 Desktop step", "ok": True, "dry": False,
            "summary": {"switch_date": SET["date"], "rule": SET["why"], "real_offers_today": sum(1 for o in SET["rows"] if o["kind"] == "real"),
                        "forms_approved": 13, "approval": "Samantha, 2026-10-13, 'approve step 1 forms', wording page version 5", "services": FNS}}
    ok_, r_ = sql(REF, f"select public.upsert_app_data_item('automation_log', {lit(json.dumps(item))}::jsonb)")
    if not ok_:
        ok_, r_ = sql(REF, f"update public.app_data set data = coalesce(data, '[]'::jsonb) || jsonb_build_array({lit(json.dumps(item))}::jsonb) "
                          "where key = 'automation_log' and jsonb_typeof(coalesce(data, '[]'::jsonb)) = 'array' returning key")
        ok_ = ok_ and bool(r_)
    say(f"  ✓ the go-live moment is in the automation log (onboarding_go_live, {SET['at']})") if ok_ else bad(f"the go-live moment could not be added to the automation log ({str(r_)[:160]}); it is in this report: {SET['at']} UTC")
if not SET: say("  RESULT: STOPPED. The two services are deployed; the switch date is NOT set. Tell Claude."); done(7)

say(); say("PART 3 · PROOF (nothing is sent; nothing else changes)")
for fn in FNS:
    okl, livef = live_files(REF, fn); s_, m_ = fmeta(REF, fn)
    good = okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in NEED[fn])
    same_gw = (m_ or {}).get("verify_jwt") == VJ[fn]
    if good and same_gw: say(f"  ✓ {fn} is live as tested (version {(m_ or {}).get('version', '?')}, gateway sign-in check {'on' if VJ[fn] else 'off'}, as before)")
    elif not good: bad(f"{fn}'s live copy is not this build")
    else: bad(f"{fn}'s gateway setting changed (should be {'on' if VJ[fn] else 'off'})")
s1, j1 = preview()
forms = [f for f in (j1.get("forms") or []) if isinstance(f, dict)]; byk = {f.get("key"): f for f in forms}
if s1 == 200 and j1.get("preview") is True and len(forms) == 13 and j1.get("form_count") == 12: say("  ✓ the Step 1 preview answers with 13 forms, 12 to sign (the Driver or the Non-Driver Agreement)")
else: bad(f"the Step 1 preview answered {s1}: {len(forms)} forms, form_count {j1.get('form_count')}")
off = [k for k in RECF if not (byk.get(k) and byk[k].get("version") == RECF[k]["version"] and byk[k].get("fingerprint") == RECF[k]["sha256"] and byk[k].get("approved_for_real") is True)]
if forms and not off: say("  ✓ every form is approved for real at the version and wording fingerprint Samantha approved (step1-approved-2026-10-13.json)")
else: bad("these forms are not live at the approved version and wording, or not approved for real: " + ", ".join(off or ["(none answered)"]))
chk = [{"form": k, "version": RECF[k]["version"]} for k in RECF] + [{"form": k, "version": RECF[k]["version"] + 1} for k in RECF]
s2, j2 = preview({"approval_check": chk}); ac = j2.get("approval_check") if isinstance(j2.get("approval_check"), list) else []
acc = [x for x in ac[:13] if x.get("accepted") is True]; ref_ = [x for x in ac[13:] if x.get("accepted") is False]
if s2 == 200 and len(ac) == 26 and len(acc) == 13 and len(ref_) == 13:
    say("  ✓ a real applicant may sign each approved version, and the next version of every form is refused (the server's read-only approval check)")
else: bad(f"the approval check answered {s2}: {len(acc)} of 13 approved versions accepted, {len(ref_)} of 13 next versions refused")
st1, _v1 = onb()
if st1 is None: bad("could not read the Hub switches again")
else:
    sd1 = str(st1.get(SD_KEY) or "")
    say(f"  ✓ the switch date reads {sd1}") if sd1 == SET["date"] else bad(f"the switch date reads {sd1 or '(not set)'}, not {SET['date']}")
    # the onboarding path, as the live outreach-check decides it (its own door needs a staff sign-in, so this step reads its
    # live code and applies that code's rule to the stored date; nothing is written)
    okl, lo = live_files(REF, "outreach-check"); lsha = lo.get(OUTREACH_REL) if okl else None
    body = _H[(MAIN, OUTREACH_REL)].get(lsha) if in_hist(MAIN, OUTREACH_REL, lsha) else None
    if body and PATH_RULE.encode() in body:
        swd = sd1 if re.fullmatch(r"\d{4}-\d{2}-\d{2}", sd1) else None
        d0 = dt.date.fromisoformat(SET["date"]); prev_, next_ = (d0 - dt.timedelta(days=1)).isoformat(), (d0 + dt.timedelta(days=1)).isoformat()
        path = lambda od: "new" if swd and od >= swd else "old"
        if (path(prev_), path(SET["date"]), path(next_)) == ("old", "new", "new"):
            say(f"  ✓ the live outreach-check (main's code) answers path 'old' for an offer dated {prev_} and 'new' for {SET['date']} and {next_}")
        else: bad(f"the onboarding path for {prev_}, {SET['date']}, {next_} would be {path(prev_)}, {path(SET['date'])}, {path(next_)}")
    else: bad("the live outreach-check is not main's code with the onboarding path rule. Tell Claude.")
    moved = [k for k in SWITCHES if st1.get(k) != st0.get(k)]
    say("  ✓ no switch changed (only the switch date was written)") if not moved else bad("these switches changed during the step: " + ", ".join(moved))
    others = sorted(k for k in (set(st0) | set(st1)) - {SD_KEY} - set(SWITCHES) if st0.get(k) != st1.get(k))
    if others: say("  · other Hub settings changed while this ran (not by this step): " + ", ".join(others[:8]))
say("  ✓ nothing was sent: this step called only the Step 1 preview, which reads and never writes")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE")
say("  ✓ real applicants can now sign the 12 approved forms")
say(f"  ✓ new offers from {SET['date']} use the new path; offers already sent keep the old path")
say(f"  ✓ went live at {SET['at']} (UTC); no switch changed and nothing was sent")
off_sw = [k for k in SWITCHES if not is_on(st1.get(k))] if st1 else []
if off_sw: say("  · still off (practice until you turn them on, Owners Hub Admin page): " + ", ".join(off_sw[:8]) + (f" and {len(off_sw) - 8} more" if len(off_sw) > 8 else ""))
done(0)
