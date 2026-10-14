#!/usr/bin/env python3
# 708 · LPN HIRING, THE HUB PROJECT (Samantha approved the LPN nurse visit plan, 2026-10-14: "approve nursing plan"; Natasha
# Early is our W-2 RN). Hub project only. Staffing PR "lpn-hiring". ORDER: 709 (the Training half) has run first: the Hub's
# services read job_offers.position_key from the Training Platform, and this step STOPS if that column is not there.
# WHAT IT INSTALLS (nothing is sent; no switch changes; no person's record changes; the caregiver process does not change):
#   lpn-hiring-708.sql   step1_forms.nurse_form (decided once when a Step 1 starts, only for an LPN or RN offer; a trigger
#                        refuses a change), the sealed nursing license number columns on step1_identity, the change log kind
#                        'caregiver_class' (every kind allowed before stays), and the four nurse readiness rows (they apply
#                        only to licensed nurses: no caregiver card shows them)
#   six services         hire-profile, applicant-link, step2-handoff, caregiver-journey, offer-sign, step1-sign (each keeps
#                        its gateway setting; step1-sign last): the one "offer signed" rule (an LPN or RN offer signs the
#                        letter only), the licensed nurse letter (PROPOSED: a real LPN or RN offer cannot be signed until
#                        she approves it), the "Your Nursing License" Step 1 form (PROPOSED: not in APPROVED_FOR_REAL, so a
#                        real nurse's Step 1 cannot complete until she approves it), the nurse forms on the readiness card,
#                        the LPN packet tick on Step 2 Verify, and the nurse setup at Approve to Work (switch nurse_hire_live,
#                        OFF: practice, nothing written)
# PART 1 reads only and stops before any change if anything is wrong. PART 2 changes. PART 3 proves it, with nothing sent.
import os, re, json, subprocess, hashlib
os.environ.setdefault("SB_STEP", "708")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; TRN = "rdqujxiycycwhskyvrwa"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FNS = ["hire-profile", "applicant-link", "step2-handoff", "caregiver-journey", "offer-sign", "step1-sign"]
SQLS = ["supabase/lpn-hiring-708.sql"]
DOC_REL = "supabase/functions/_shared/step1-documents.ts"; OFFER_REL = "supabase/functions/_shared/offer-documents.ts"
SWITCHES = ["nurse_hire_live", "step1_auto_live", "offer_send_live", "approve_work_axiscare_live", "axiscare_level_live", "approve_work_text_live"]
NURSE_ROWS = ["cg.credential.nurse_license", "cg.nurse.orientation", "cg.nurse.section2_ack", "cg.step2.position_description"]
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")

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
def is_on(v): return v is True or str(v).lower() == "true"
def onb():
    ok_, r = sql(REF, "select data, version from public.app_data where key = 'ops_settings'")
    if not ok_ or not r: return None
    d = r[0].get("data"); return d if isinstance(d, dict) else None

start("LPN HIRING, THE HUB PROJECT")
say("  Nothing is sent and no switch changes. The caregiver offer, Step 1 and readiness card stay exactly as they are.")
say()
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
# the two proposed wordings must still be UNAPPROVED in this build (this step approves nothing)
docs = open(os.path.join(ROOT, DOC_REL)).read() if os.path.exists(os.path.join(ROOT, DOC_REL)) else ""
ap = re.search(r"export const APPROVED_FOR_REAL[^=]*= \{(.*?)\n\}", docs, re.S)
if not re.search(r"key: 'nurse_license',[^\n]*step1Gate: 'nurse',[^\n]*status: 'proposed'", docs) or not ap or re.search(r"\bnurse_license:", ap.group(1)):
    bad("the Your Nursing License form is not in this build as a proposed, unapproved form. Nothing runs. Tell Claude."); done(2)
say("  ✓ the Your Nursing License form is in this build, proposed and NOT approved for real (a real nurse's Step 1 cannot complete until Samantha approves it)")
offer = open(os.path.join(ROOT, OFFER_REL)).read() if os.path.exists(os.path.join(ROOT, OFFER_REL)) else ""
if not re.search(r"export const NURSE_LETTER_APPROVED = 0\b", offer): bad("the licensed nurse offer letter is not in this build as unapproved. Nothing runs. Tell Claude."); done(2)
say("  ✓ the licensed nurse offer letter is in this build, proposed and NOT approved (a real LPN or RN offer cannot be signed until she approves it)")
FN_SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))
check_build(FNROOT, FN_SHAS)
NEED = {fn: need(FNROOT, fn) for fn in FNS}
missing_fn = [fn for fn in FNS if not NEED[fn]]
if missing_fn: bad("these services are not in the reviewed build: " + ", ".join(missing_fn) + ". Nothing runs."); done(2)
unpinned = sorted({k for fn in FNS for k in NEED[fn]} - {"supabase/functions/" + k for k in FN_SHAS})
if unpinned: bad("these files the services need are not pinned to the reviewed build: " + short(unpinned) + ". Nothing runs."); done(2)
SQL_SHAS = json.loads(os.environ.get("SB_SQL_SHAS", "{}"))
def sql_reviewed(rel):
    p_ = os.path.join(ROOT, rel); return os.path.exists(p_) and SQL_SHAS.get(rel) and sha(p_) == SQL_SHAS.get(rel)
for rel in SQLS:
    say(f"  ✓ {rel.split('/')[-1]} is the reviewed build") if sql_reviewed(rel) else bad(f"{rel.split('/')[-1]} is not the reviewed build: nothing runs")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(2)
moved = []
for k in sorted({k for fn in FNS for k in NEED[fn]} | set(SQLS)):
    b = subprocess.run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"], capture_output=True).stdout
    if b and hashlib.sha256(b).hexdigest() != sha(os.path.join(ROOT, k)) and not in_hist("HEAD", k, hashlib.sha256(b).hexdigest()): moved.append(k)
if moved: bad("main has newer versions of " + short(moved) + " than this reviewed build (merged after the review); deploying would roll them back. Tell Claude. Nothing runs."); done(2)
say("  ✓ main holds no newer version of any file these six services or the SQL use")
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
# 709 first: the Training Platform's offers carry the position key
ok_, tk = sql(TRN, "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'job_offers' and column_name = 'position_key') as col, "
                   "exists (select 1 from pg_trigger where tgname = 'trg_job_offers_position_permanent' and not tgisinternal) as trg")
if not ok_ or not tk: bad(f"could not read the Training Platform's offers table: {tk}")
elif not (tk[0]["col"] is True and tk[0]["trg"] is True): bad("the Training Platform has no job_offers.position_key yet: run 709 (LPN hiring, the Training half) first. Nothing runs."); done(3)
else: say("  ✓ 709 has run: the Training Platform's offers carry position_key, set once")
ok_, t = sql(REF, "select to_regclass('public.step1_forms') is not null as sf, to_regclass('public.step1_identity') is not null as si, to_regclass('public.client_journey_step_def') is not null as cat, "
                  "to_regclass('public.axiscare_change_log') is not null as log, exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'step1_forms' and column_name = 'hepb_form') as hepb, "
                  "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'step1_forms' and column_name = 'nurse_form') as nf")
if not ok_ or not t: bad(f"could not read the tables: {t}")
else:
    x = t[0]
    say("  ✓ the Step 1 tables, the readiness catalog and the AxisCare change log exist (the Hepatitis B column too)") if all(x[k] is True for k in ["sf", "si", "cat", "log", "hepb"]) else bad("a table this step needs is missing (704 and the Step 1 tables first). Tell Claude.")
    if x["nf"] is True: say("  · step1_forms.nurse_form is already there (a re-run): the SQL is safe to run again")
ok_, fr = sql(REF, "select count(*)::int as n, count(*) filter (where completed_at is null and not coalesce(practice, false))::int as open_real from public.step1_forms")
FR0 = fr[0] if ok_ and fr else None
say(f"  · Step 1 records now: {FR0['n']} ({FR0['open_real']} real under way). Every one of them stays exactly as it is: the nursing license form is only in a Step 1 that starts from an LPN or RN offer after this step") if FR0 else bad(f"could not count the Step 1 records: {fr}")
ok_, cr = sql(REF, "select count(*) filter (where active)::int as active from public.client_journey_step_def where key like 'cg.%'")
CAT0 = cr[0]["active"] if ok_ and cr else None
say(f"  · {CAT0} caregiver readiness rows are active now; this step adds 4 that apply only to licensed nurses") if CAT0 is not None else bad(f"could not read the catalog: {cr}")
st0 = onb()
if st0 is None: bad("could not read the Hub switches (ops_settings)")
else: say("  · the switches (shown only; this step changes none): " + ", ".join(f"{k} {'on' if is_on(st0.get(k)) else 'off'}" for k in SWITCHES))
ok_, ks = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG()); ANON = ""
try:
    arr = json.loads(ks) if ok_ == 200 else []
    if isinstance(arr, dict): arr = arr.get("keys") or []
    for k in arr:
        v = str(k.get("api_key", "")) if isinstance(k, dict) else ""
        if k.get("name") == "anon" and v.startswith("eyJ"): ANON = v
except Exception: pass
HIDE.append(ANON)
say("  ✓ the project's public key is readable (the proofs call the read-only previews as a visitor)") if ANON else bad("could not read the project's public key")
VIS = {"apikey": ANON, "Authorization": "Bearer " + ANON}
def call(fn, body):
    s_, b_ = http("POST", f"{FNB}/functions/v1/{fn}", body, VIS)
    try: return s_, json.loads(b_)
    except Exception: return s_, {}
say("  · what changes: lpn-hiring-708.sql, then hire-profile, applicant-link, step2-handoff, caregiver-journey, offer-sign and step1-sign. No switch, no person's record, nothing sent.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
for rel in SQLS:
    name = rel.split("/")[-1]
    if not sql_reviewed(rel): bad(f"{name} changed since it was checked"); say("  RESULT: STOPPED. Nothing was changed. Tell Claude."); done(5)
    ok_, r_ = sql(REF, open(os.path.join(ROOT, rel)).read())
    if not ok_: bad(f"{name} did not install: {str(r_)[:300]}"); say("  RESULT: STOPPED. No service was deployed. Tell Claude."); done(5)
    say(f"  ✓ {name} is in")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, VJ[fn]): say(f"  RESULT: STOPPED at {fn}. The SQL is in (it changes nothing on its own). Tell Claude."); done(6)

say(); say("PART 3 · PROOF (nothing is sent; nothing else changes)")
for fn in FNS:
    okl, livef = live_files(REF, fn); s_, m_ = fmeta(REF, fn)
    good = okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in NEED[fn])
    same_gw = (m_ or {}).get("verify_jwt") == VJ[fn]
    if good and same_gw: say(f"  ✓ {fn} is live as tested (version {(m_ or {}).get('version', '?')}, gateway sign-in check {'on' if VJ[fn] else 'off'}, as before)")
    elif not good: bad(f"{fn}'s live copy is not this build")
    else: bad(f"{fn}'s gateway setting changed (should be {'on' if VJ[fn] else 'off'})")
ok_, c = sql(REF, "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'step1_forms' and column_name = 'nurse_form') as nf, "
                  "exists (select 1 from pg_trigger where tgname = 'step1_forms_nurse_form_keep_t' and not tgisinternal) as trg, "
                  "(select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'step1_identity' and column_name in ('nurse_license_sealed', 'nurse_license_last4'))::int as idc, "
                  "has_table_privilege('authenticated', 'public.step1_identity', 'select') as leak, "
                  "(select pg_get_constraintdef(oid) from pg_constraint where conname = 'axiscare_change_log_kind_check') as kinds, "
                  "(select count(*) from public.client_journey_step_def where key in ('cg.credential.nurse_license', 'cg.nurse.orientation', 'cg.nurse.section2_ack', 'cg.step2.position_description') and active and def->'applies'->>'licensed_nurse' = 'true')::int as rows4, "
                  "(select count(*) filter (where active) from public.client_journey_step_def where key like 'cg.%')::int as active, "
                  "(select count(*) from public.step1_forms)::int as n, (select count(*) from public.step1_forms where nurse_form)::int as nurse")
if ok_ and c:
    x = c[0]
    say("  ✓ step1_forms.nurse_form and its keep trigger are in") if x["nf"] is True and x["trg"] is True else bad(f"nurse_form or its trigger is missing: {x}")
    say("  ✓ the sealed nursing license columns are in; no browser role reads step1_identity") if x["idc"] == 2 and x["leak"] is False else bad(f"the identity columns are not as expected: {x}")
    say("  ✓ the change log allows caregiver_class, and every kind it allowed before") if x["kinds"] and "caregiver_class" in x["kinds"] and "caregiver_level" in x["kinds"] and "client_created" in x["kinds"] else bad(f"the change log kinds: {x['kinds']}")
    say("  ✓ the four nurse readiness rows are active and apply only to licensed nurses") if x["rows4"] == 4 else bad(f"the nurse rows: {x['rows4']} of 4")
    say(f"  ✓ the caregiver rows are as they were: {x['active']} active now = {CAT0} + the 4 nurse rows") if CAT0 is not None and x["active"] == CAT0 + 4 else bad(f"the active catalog rows: {x['active']} (before {CAT0})")
    say(f"  ✓ no Step 1 record changed: {x['n']} on file, {x['nurse']} with the nursing license form") if FR0 and x["n"] >= FR0["n"] and x["nurse"] == 0 else (say(f"  · {x['nurse']} Step 1 records already have the nursing license form (an LPN or RN started Step 1 during the step)") if FR0 and x["n"] >= FR0["n"] else bad(f"Step 1 records: {x}"))
else: bad(f"could not read the result: {c}")
s1, p1 = call("step1-sign", {"action": "preview"})
forms = [f for f in (p1.get("forms") or []) if isinstance(f, dict)]
if s1 == 200 and len(forms) == 14 and p1.get("form_count") == 13 and forms[-1].get("key") == "hepb_vaccination" and not any(f.get("key") == "nurse_license" for f in forms):
    say("  ✓ a caregiver's Step 1 is unchanged: the preview has 14 forms, 13 to sign, the Hepatitis B form last, no nursing license form")
else: bad(f"the Step 1 preview answered {s1}: {len(forms)} forms, form_count {p1.get('form_count')}")
s2, p2 = call("step1-sign", {"action": "preview", "position": "lpn"})
nf = [f for f in (p2.get("forms") or []) if isinstance(f, dict)]
if s2 == 200 and len(nf) == 15 and p2.get("form_count") == 14 and nf[-1].get("key") == "nurse_license" and nf[-1].get("approved_for_real") is False and "17" in (p2.get("screens") or []):
    say("  ✓ an LPN's Step 1 (preview): 15 forms, 14 to sign, Your Nursing License last (screen 17), proposed, NOT approved for real")
else: bad(f"the LPN Step 1 preview answered {s2}: {len(nf)} forms")
chk = [{"form": f.get("key"), "version": f.get("version")} for f in forms]
s3, p3 = call("step1-sign", {"action": "preview", "approval_check": chk + [{"form": "nurse_license", "version": 1}]})
ac = p3.get("approval_check") if isinstance(p3.get("approval_check"), list) else []
if s3 == 200 and len(ac) == 15 and all(x.get("accepted") is True for x in ac[:14]) and ac[14].get("accepted") is False:
    say("  ✓ a real applicant may still sign every caregiver Step 1 form; the nursing license form is refused for real until she approves it")
else: bad(f"the approval check answered {s3}: " + ", ".join(f"{x.get('form')} {x.get('accepted')}" for x in ac))
s4, p4 = call("offer-sign", {"action": "preview"})
if s4 == 200 and p4.get("pd") and (p4.get("versions") or {}).get("offer") == 2 and (p4.get("versions") or {}).get("pd") == 2 and not p4.get("letter_only"):
    say("  ✓ a caregiver offer is unchanged: the letter and the position description, versions 2 and 2")
else: bad(f"the offer preview answered {s4}: {p4.get('versions')}")
s5, p5 = call("offer-sign", {"action": "preview", "position": "lpn"})
lt = "\n".join(str(b.get("t", "")) for b in (p5.get("offer") or []) if isinstance(b, dict))
if s5 == 200 and p5.get("letter_only") is True and p5.get("pd") is None and p5.get("approved") is False and "Licensed Practical Nurse (LPN)" in lt and "field caregiver" not in lt:
    say("  ✓ an LPN offer (preview): the licensed nurse letter alone, no position description, no \"field caregiver\", NOT approved yet")
else: bad(f"the LPN offer preview answered {s5}")
st1 = onb()
if st1 is None: bad("could not read the Hub switches again")
else:
    moved = [k for k in SWITCHES if (st0 or {}).get(k) != st1.get(k)]
    say("  ✓ no switch changed (nurse_hire_live is " + ("on" if is_on(st1.get("nurse_hire_live")) else "off") + ")") if not moved else bad("these switches changed during the step: " + ", ".join(moved))
say("  ✓ nothing was sent: this step called only the read-only previews")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE")
say("  ✓ caregivers: the same offer, the same Step 1, the same readiness card")
say("  ✓ an LPN or RN: the letter only, Step 1 with Your Nursing License, the four nurse rows before Approve to Work, the nurse setup in practice")
say("  ✓ waiting for Samantha: her approval of the licensed nurse letter, the Your Nursing License form and lpn-documents.md; the nurse_hire_live switch stays off")
done(0)
