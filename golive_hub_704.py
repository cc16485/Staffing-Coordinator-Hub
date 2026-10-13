#!/usr/bin/env python3
# 704 · HEPATITIS B FORM IN STEP 1, THE HUB PROJECT (Samantha 2026-10-13: "let's keep it [bloodborne pathogens training] in their
# on-the-job training... they are fine to complete the [Hepatitis B] form in step one"; and "lets keep it easy and offer to
# everyone"). Hub project only. Staffing PR "hepb-step1".
# LEGAL BASIS: OSHA 29 CFR 1910.1030(f)(2)(i) makes the vaccine available "after the employee has received the training required
# in paragraph (g)(2)(vii)(I)"; element (I) is only the vaccine information (efficacy, safety, method of administration,
# benefits, offered free). The Step 1 form shows that information first, then the choice. It does NOT complete the
# bloodborne pathogens training (that stays in the on-the-job courses). Offering to every applicant is a superset of OSHA's
# exposure-based duty.
# PART 1 reads only and stops before any change if anything is wrong: the Hepatitis B form must be approved for real at its
# exact version in the reviewed build (APPROVED_FOR_REAL), or NOTHING runs; the reviewed build (every file the three services
# need and the SQL, pinned); main has not changed those files since the review; each service's live files against this build
# (a live file from this build's own history is just older; one newer on main, or never on main, STOPS); the tables the SQL
# needs; the Step 1s already under way (they keep their 12 forms: the form is decided once, when a Step 1 starts); the switches
# (shown only).
# PART 2 changes, in this order: hepb-step1.sql (checked against its pin right before it runs); then hepb, hire-profile and
# step1-sign deployed (only the services whose behavior changed; each keeps its own gateway setting; step1-sign last, so no
# new Step 1 gets the form before the tables and the other two are ready).
# PART 3 proves it with nothing sent and nothing else changed: the three services live as tested; the columns and the guard
# are in; the Step 1 preview answers with 14 forms, 13 to sign, the Hepatitis B form last (screen 16) at the approved version
# and wording fingerprint, approved for real; the read-only approval check accepts all 13 forms a new Step 1 has; every Step 1
# that existed before keeps its 12 forms; no switch changed.
# THE hepb_offer_live SWITCH: this step neither reads nor changes it (it is only shown). The Step 1 form does not depend on it:
# from the deploy on, every new Step 1 has the form and records the answer whether the switch is on or off. The switch still
# controls only what it always did: whether the 30-minute pass sends the private hepatitis B link to people whose Step 1 did
# not have the form.
# ORDER: 705 has run (done 2026-10-13). Merge Hub PR #384 and Staffing PR hepb-step1 (merge commit, not squash), then run this.
import os, re, json, subprocess, hashlib
os.environ.setdefault("SB_STEP", "704")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FNS = ["hepb", "hire-profile", "step1-sign"]
SQLS = ["supabase/hepb-step1.sql"]
DOC_REL = "supabase/functions/_shared/step1-documents.ts"
FORM = "hepb_vaccination"
SWITCHES = ["hepb_offer_live", "step1_auto_live", "offer_send_live", "driver_reminders_live", "driver_link_send_live"]
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
def approval(src):
    """(form version, approved version or None, status) read from step1-documents.ts as reviewed"""
    m = re.search(r"key: 'hepb_vaccination',[^\n]*?\bversion: (\d+), status: '(\w+)'", src)
    a = re.search(r"export const APPROVED_FOR_REAL[^=]*= \{(.*?)\n\}", src, re.S)
    ap = re.search(r"\bhepb_vaccination: (\d+)", a.group(1)) if a else None
    return (int(m.group(1)) if m else None, int(ap.group(1)) if ap else None, m.group(2) if m else None)
def onb():
    ok_, r = sql(REF, "select data, version from public.app_data where key = 'ops_settings'")
    if not ok_ or not r: return None
    d = r[0].get("data"); return d if isinstance(d, dict) else None

start("HEPATITIS B FORM IN STEP 1, THE HUB PROJECT")
say("  This step pays no attention to the hepb_offer_live switch: it does not read it to decide anything and does not change it.")
say("  The Step 1 form works whether that switch is on or off; the switch only controls the 30-minute pass's private link.")
say()
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
# THE GATE: the Hepatitis B form at its exact version must be in APPROVED_FOR_REAL in the reviewed build
DOCP = os.path.join(ROOT, DOC_REL)
fv, av, status = approval(open(DOCP).read()) if os.path.exists(DOCP) else (None, None, None)
if fv is None: bad("the Hepatitis B form is not in this build's Step 1 forms. Nothing ran. Tell Claude."); done(2)
if av != fv:
    say(f"  ✗ the Hepatitis B form (version {fv}, {status}) is NOT approved for real applicants in this build"
        + (f" (approved: version {av})" if av is not None else "") + ".")
    say("  Samantha approves its wording first; then Claude adds it to APPROVED_FOR_REAL and gives you a new 704. Nothing ran; nothing changed.")
    fails.append("not approved"); done(2)
say(f"  ✓ the Hepatitis B form is approved for real applicants at exactly its version ({fv}) in the reviewed build")
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
HEPB_FP = os.environ.get("SB_HEPB_FP", "").strip().lower()
if not re.fullmatch(r"[0-9a-f]{64}", HEPB_FP): bad("the reviewed wording fingerprint of the Hepatitis B form is missing: nothing runs")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(2)
moved = []
for k in sorted({k for fn in FNS for k in NEED[fn]} | set(SQLS)):
    b = subprocess.run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"], capture_output=True).stdout
    if b and hashlib.sha256(b).hexdigest() != sha(os.path.join(ROOT, k)) and not in_hist("HEAD", k, hashlib.sha256(b).hexdigest()): moved.append(k)
if moved: bad("main has newer versions of " + short(moved) + " than this reviewed build (merged after the review); deploying would roll them back. Tell Claude. Nothing runs."); done(2)
say("  ✓ main holds no newer version of any file these three services or the SQL use")

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
ok_, t = sql(REF, "select to_regclass('public.hepb_record') is not null as hr, to_regclass('public.step1_forms') is not null as sf, "
                  "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'step1_forms' and column_name = 'hepb_form') as col")
if not ok_ or not t: bad(f"could not read the tables: {t}")
else:
    x = t[0]
    say("  ✓ the hepatitis B tables and the Step 1 table exist") if x["hr"] is True and x["sf"] is True else bad("hepb_record or step1_forms does not exist (703 and the Step 1 tables first). Tell Claude.")
    if x["col"] is True: say("  · the Step 1 column is already there (a re-run): the SQL is safe to run again")
ok_, fr = sql(REF, "select count(*) filter (where not coalesce(practice, false) and completed_at is null)::int as open_real, "
                   "count(*) filter (where not coalesce(practice, false) and completed_at is not null)::int as done_real, "
                   "count(*) filter (where coalesce(practice, false))::int as practice from public.step1_forms")
if not ok_ or not fr: bad(f"could not count the Step 1 records: {fr}"); FR0 = None
else:
    FR0 = fr[0]
    say(f"  · Step 1 records now: {FR0['open_real']} real under way, {FR0['done_real']} real complete, {FR0['practice']} practice. "
        "Every one of them keeps its 12 forms (the Hepatitis B form is only in a Step 1 that starts after this step); "
        "the 30-minute hepatitis B pass offers those people the vaccine at Approve to Work, as before.")
st0 = onb()
if st0 is None: bad("could not read the Hub switches (ops_settings)")
else:
    say("  · the switches (shown only; this step changes none and decides nothing by them): " + ", ".join(f"{k} {'on' if is_on(st0.get(k)) else 'off'}" for k in SWITCHES))
    sd = str(st0.get("onboarding_switch_date") or "")
    say(f"  · the onboarding switch date (705): {sd}" if sd else "  ! the onboarding switch date is not set (705 has not run). Not stopping: only practice Step 1s get the form until it is.")
ok_, ks = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG()); ANON = ""
try:
    arr = json.loads(ks) if ok_ == 200 else []
    if isinstance(arr, dict): arr = arr.get("keys") or []
    for k in arr:
        v = str(k.get("api_key", "")) if isinstance(k, dict) else ""
        if k.get("name") == "anon" and v.startswith("eyJ"): ANON = v
except Exception: pass
HIDE.append(ANON)
say("  ✓ the project's public key is readable (the proofs call the Step 1 preview as a visitor)") if ANON else bad("could not read the project's public key")
VIS = {"apikey": ANON, "Authorization": "Bearer " + ANON}
def preview(body=None):
    s_, b_ = http("POST", f"{FNB}/functions/v1/step1-sign", dict({"action": "preview"}, **(body or {})), VIS)
    try: return s_, json.loads(b_)
    except Exception: return s_, {}
say("  · what changes: the Step 1 column and two hepatitis B columns (hepb-step1.sql), and hepb, hire-profile and step1-sign. "
    "No switch, no person's record, nothing sent. Other services that read the form list keep their current live copy (their behavior does not change).")
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
ok_, c = sql(REF, "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'step1_forms' and column_name = 'hepb_form') as a, "
                  "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hepb_record' and column_name = 'step1_pdf') as b, "
                  "exists (select 1 from pg_trigger where tgname = 'hepb_record_step1_keep_t' and not tgisinternal) as c, "
                  "has_table_privilege('authenticated', 'public.hepb_record', 'select') as leak")
if ok_ and c and c[0]["a"] is True and c[0]["b"] is True and c[0]["c"] is True and c[0]["leak"] is False:
    say("  ✓ the Step 1 column, the hepatitis B Step 1 columns and the keep-guard are in; no browser role reads the record")
else: bad(f"the columns or the guard are not as expected: {c}")
s1, j1 = preview()
forms = [f for f in (j1.get("forms") or []) if isinstance(f, dict)]; hb = forms[-1] if forms else {}
if s1 == 200 and len(forms) == 14 and j1.get("form_count") == 13 and hb.get("key") == FORM and "16" in (j1.get("screens") or []):
    say("  ✓ the Step 1 preview answers with 14 forms, 13 to sign, the Hepatitis B form last (screen 16)")
else: bad(f"the Step 1 preview answered {s1}: {len(forms)} forms, form_count {j1.get('form_count')}, last {hb.get('key')}")
if hb.get("version") == fv and hb.get("fingerprint") == HEPB_FP and hb.get("approved_for_real") is True and len((hb.get("choices") or {}).get("options") or []) == 5:
    say(f"  ✓ the Hepatitis B form is live at version {fv} with the reviewed wording fingerprint, approved for real, with its five choices")
else: bad(f"the Hepatitis B form is not live as reviewed (version {hb.get('version')}, approved {hb.get('approved_for_real')})")
chk = [{"form": f.get("key"), "version": f.get("version")} for f in forms]
s2, j2 = preview({"approval_check": chk}); ac = j2.get("approval_check") if isinstance(j2.get("approval_check"), list) else []
if s2 == 200 and len(ac) == 14 and all(x.get("accepted") is True for x in ac):
    say("  ✓ a real applicant may sign every form a new Step 1 has, the Hepatitis B form included (the server's read-only approval check)")
else: bad(f"the approval check answered {s2}: " + ", ".join(f"{x.get('form')} {x.get('accepted')}" for x in ac if x.get("accepted") is not True))
ok_, fr = sql(REF, "select count(*) filter (where hepb_form)::int as with_form, count(*)::int as n from public.step1_forms")
if ok_ and fr:
    say(f"  · Step 1 records with the Hepatitis B form: {fr[0]['with_form']} of {fr[0]['n']} (only ones started after the deploy)")
st1 = onb()
if st1 is None: bad("could not read the Hub switches again")
else:
    moved = [k for k in SWITCHES if (st0 or {}).get(k) != st1.get(k)]
    say("  ✓ no switch changed") if not moved else bad("these switches changed during the step: " + ", ".join(moved))
say("  ✓ nothing was sent: this step called only the Step 1 preview, which reads and never writes")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE")
say("  ✓ every Step 1 that starts from now has the Hepatitis B form last: the vaccine information first, then their choice")
say("  ✓ Step 1s already under way keep their 12 forms; the 30-minute pass covers those people at Approve to Work")
say("  ✓ the choice and the signed form are confidential medical records (owners only, the Hepatitis B card); the office sees only the status words")
done(0)
