#!/usr/bin/env python3
# 712 · STEP 1 SCREEN 5b ASKS THE FCSR FACTS, AND THE FCSR REGISTRATION TEXT AND EMAIL (Samantha 2026-10-14 14:38 UTC,
# "ok great, approved!", on the 5b wording page https://claude.ai/artifact/Gj2NFJSbr2DFVR6m6K7LFf, version 1791988544-e4d9).
# Hub project only. Staffing PR "step1-fcsr-facts".
# WHAT CHANGES FOR PEOPLE: screen 5b (Your Details for the Background Checks) is version 5: middle name, suffix, birth name,
# gender and county, and a line on registering with the Family Care Safety Registry. The office's Text button gets the quick
# pick "FCSR registration"; when the office sends it and we have the applicant's email, the registration steps go by email too.
# Forms already signed keep their signed version and PDF; nothing is sent by this step.
# PART 1 reads only and stops before any change if anything is wrong: the details form must be approved for real at its exact
# version in the reviewed build (APPROVED_FOR_REAL), or NOTHING runs; the approval record is the reviewed one and lists every
# form at the version APPROVED_FOR_REAL holds; the reviewed build (every file the two services need, pinned); main has not
# changed those files since the review; each service's live files against this build (a live file from this build's own
# history is just older; one newer on main, or never on main, STOPS); the table the texts are kept in; the Step 1s under way.
# PART 2: applicant-text, then step1-sign deployed (each keeps its own gateway setting; only these two changed behavior).
# PART 3 proves it with nothing sent and nothing else changed: both live as tested; both answer (CORS); a stranger gets 401
# from the office-only doors of both; the Step 1 preview shows the details form at version 5, approved, with the five new
# questions; every form at the version and wording fingerprint in the approval record; the read-only approval check accepts
# every approved version and refuses the next one.
# ORDER: merge Staffing PR step1-fcsr-facts (merge commit, not squash), then run this. The Hub's part (the FCSR sheet and the
# pick on the Text button) can come before or after: the server answers the old Hub the same way it did.
import os, re, json, subprocess, hashlib
os.environ.setdefault("SB_STEP", "712")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
# the services whose behavior changed (git grep: step1-documents.ts is also read by driver-compliance, hire-profile and
# reference-tasks; none of them uses the details form, so each keeps its live copy). step1-sign last.
FNS = ["applicant-text", "step1-sign"]
REC_REL = "supabase/step1-approved-2026-10-14.json"
DOC_REL = "supabase/functions/_shared/step1-documents.ts"
FORM = "edl_fcsr_consent"
NEW_IDS = ["middle_name", "suffix", "birth_name", "gender", "county"]
ZERO = "00000000-0000-0000-0000-000000000000"
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
def approvals(src):
    """(details form version, its status, APPROVED_FOR_REAL as a dict, FORM_ORDER, STEP1_VERSION) read from the reviewed build"""
    m = re.search(r"key: '" + FORM + r"',[^\n]*?\bversion: (\d+), status: '(\w+)'", src)
    a = re.search(r"export const APPROVED_FOR_REAL[^=]*= \{(.*?)\n\}", src, re.S)
    body = re.sub(r"/\*.*?\*/", "", a.group(1), flags=re.S) if a else ""
    ap = {k: int(v) for k, v in re.findall(r"\b(\w+): (\d+)", body)}
    o = re.search(r"export const FORM_ORDER[^=]*= \[([^\]]*)\]", src)
    order = re.findall(r"'(\w+)'", o.group(1)) if o else []
    sv = re.search(r"export const STEP1_VERSION = (\d+)", src)
    return (int(m.group(1)) if m else None, m.group(2) if m else None, ap, order, int(sv.group(1)) if sv else None)

start("STEP 1 SCREEN 5b ASKS THE FCSR FACTS, AND THE FCSR REGISTRATION TEXT AND EMAIL")
say("  Nothing is sent by this step. The email goes only when a person in the office presses Send on the FCSR registration pick.")
say()
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
# THE GATE: the details form at its exact version must be in APPROVED_FOR_REAL in the reviewed build
DOCP = os.path.join(ROOT, DOC_REL)
fv, status, AP, ORDER, S1V = approvals(open(DOCP).read()) if os.path.exists(DOCP) else (None, None, {}, [], None)
if fv is None: bad("the details form (screen 5b) is not in this build's Step 1 forms. Nothing ran. Tell Claude."); done(2)
if AP.get(FORM) != fv or status != "approved":
    say(f"  ✗ the details form (screen 5b, version {fv}, {status}) is NOT approved for real applicants in this build"
        + (f" (approved: version {AP.get(FORM)})" if AP.get(FORM) is not None else "") + ".")
    say("  Samantha approves its wording first; then Claude adds it to APPROVED_FOR_REAL and gives you a new 712. Nothing ran; nothing changed.")
    fails.append("not approved"); done(2)
say(f"  ✓ the details form (screen 5b) is approved for real applicants at exactly its version ({fv}) in the reviewed build")
FN_SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))
check_build(FNROOT, FN_SHAS)
REC_SHA = os.environ.get("SB_REC_SHA", "").strip().lower(); RECP = os.path.join(ROOT, REC_REL)
if not (REC_SHA and os.path.exists(RECP) and sha(RECP) == REC_SHA): bad("the approval record (step1-approved-2026-10-14.json) is not the reviewed build: nothing runs"); done(2)
REC = json.load(open(RECP)); RECF = {f["key"]: f for f in REC.get("forms", [])}
off = [k for k in ORDER if not (k in RECF and RECF[k].get("version") == AP.get(k) and re.fullmatch(r"[0-9a-f]{64}", str(RECF[k].get("sha256", ""))))]
if not ORDER or off or set(RECF) != set(ORDER) or len(AP) != len(ORDER) or REC.get("step1_version") != S1V or RECF.get(FORM, {}).get("version") != fv:
    bad("the approval record does not list every form at the version APPROVED_FOR_REAL holds (" + (", ".join(off) or "the form list or the Step 1 version") + "): nothing runs"); done(2)
say(f"  ✓ the approval record is the reviewed build: {REC.get('approved_by')}, {REC.get('approved_at_central')}, \"{REC.get('her_words')}\"; "
    f"{len(RECF)} forms, each at the version APPROVED_FOR_REAL holds; Step 1 version {S1V}")
NEED = {fn: need(FNROOT, fn) for fn in FNS}
missing_fn = [fn for fn in FNS if not NEED[fn]]
if missing_fn: bad("these services are not in the reviewed build: " + ", ".join(missing_fn) + ". Nothing runs."); done(2)
unpinned = sorted({k for fn in FNS for k in NEED[fn]} - {"supabase/functions/" + k for k in FN_SHAS})
if unpinned: bad("these files the services need are not pinned to the reviewed build: " + short(unpinned) + ". Nothing runs."); done(2)
moved = []
for k in sorted({k for fn in FNS for k in NEED[fn]} | {REC_REL}):
    b = subprocess.run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"], capture_output=True).stdout
    if b and hashlib.sha256(b).hexdigest() != sha(os.path.join(ROOT, k)) and not in_hist("HEAD", k, hashlib.sha256(b).hexdigest()): moved.append(k)
if moved: bad("main has newer versions of " + short(moved) + " than this reviewed build (merged after the review); deploying would roll them back. Tell Claude. Nothing runs."); done(2)
say("  ✓ main holds no newer version of any file these two services use, nor of the approval record")

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
ok_, t = sql(REF, "select to_regclass('public.applicant_texts') is not null as at, to_regclass('public.step1_forms') is not null as sf")
if not ok_ or not t: bad(f"could not read the tables: {t}")
elif t[0]["at"] is True and t[0]["sf"] is True: say("  ✓ the texts table (applicant_texts, where the email is kept too) and the Step 1 table exist")
else: bad("applicant_texts or step1_forms does not exist. Tell Claude.")
ok_, fr = sql(REF, "select count(*) filter (where not coalesce(practice, false) and completed_at is null and not (signatures ? 'edl_fcsr_consent'))::int as open_unsigned, "
                   "count(*) filter (where not coalesce(practice, false) and (signatures ? 'edl_fcsr_consent'))::int as signed_real from public.step1_forms")
if not ok_ or not fr: bad(f"could not count the Step 1 records: {fr}")
else:
    say(f"  · Step 1 records: {fr[0]['signed_real']} real ones already signed screen 5b (they keep the form and PDF they signed; "
        f"the Hub's FCSR sheet says \"not collected\" for the five new facts and the office asks); "
        f"{fr[0]['open_unsigned']} real ones under way have not signed it yet (they will see the five new questions)")
ok_, ks = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG()); ANON = ""
try:
    arr = json.loads(ks) if ok_ == 200 else []
    if isinstance(arr, dict): arr = arr.get("keys") or []
    for k in arr:
        v = str(k.get("api_key", "")) if isinstance(k, dict) else ""
        if k.get("name") == "anon" and v.startswith("eyJ"): ANON = v
except Exception: pass
HIDE.append(ANON)
say("  ✓ the project's public key is readable (the proofs call both services as a visitor)") if ANON else bad("could not read the project's public key")
VIS = {"apikey": ANON, "Authorization": "Bearer " + ANON}
def call(fn, body, method="POST", qs=""):
    s_, b_ = http(method, f"{FNB}/functions/v1/{fn}{qs}", body, VIS)
    try: return s_, json.loads(b_)
    except Exception: return s_, b_
say("  · what changes: applicant-text and step1-sign. No table, no switch, no person's record, nothing sent. "
    "Other services that read the Step 1 forms keep their current live copy (their behavior does not change).")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, VJ[fn]): say(f"  RESULT: STOPPED at {fn}. Tell Claude."); done(6)

say(); say("PART 3 · PROOF (nothing is sent; nothing else changes)")
for fn in FNS:
    okl, livef = live_files(REF, fn); s_, m_ = fmeta(REF, fn)
    good = okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in NEED[fn])
    same_gw = (m_ or {}).get("verify_jwt") == VJ[fn]
    if good and same_gw: say(f"  ✓ {fn} is live as tested (version {(m_ or {}).get('version', '?')}, gateway sign-in check {'on' if VJ[fn] else 'off'}, as before)")
    elif not good: bad(f"{fn}'s live copy is not this build")
    else: bad(f"{fn}'s gateway setting changed (should be {'on' if VJ[fn] else 'off'})")
for fn in FNS:
    s_, b_ = http("OPTIONS", f"{FNB}/functions/v1/{fn}", None, {"Origin": "https://cc.mo-care.com"})
    say(f"  ✓ {fn} answers (the browser's first knock, CORS: {s_})") if s_ == 200 else bad(f"{fn} did not answer the browser's first knock ({s_})")
s_, j_ = call("applicant-text", {"action": "draft", "id": ZERO})
say("  ✓ a stranger (the public key, no office sign-in) gets 401 from applicant-text: no draft, nothing sent") if s_ == 401 else bad(f"applicant-text answered a stranger {s_}, not 401")
s_, j_ = call("step1-sign", {"action": "screening", "offer_id": ZERO})
say("  ✓ a stranger gets 401 from step1-sign's screening desk (where the FCSR facts are read)") if s_ == 401 else bad(f"step1-sign's screening desk answered a stranger {s_}, not 401")
s1, j1 = call("step1-sign", {"action": "preview"}); j1 = j1 if isinstance(j1, dict) else {}
forms = [f for f in (j1.get("forms") or []) if isinstance(f, dict)]; byk = {f.get("key"): f for f in forms}
d5 = byk.get(FORM) or {}
ids = [i.get("id") for s in (d5.get("sections") or []) for i in (s.get("items") or []) if isinstance(i, dict)]
if s1 == 200 and d5.get("version") == fv and d5.get("status") == "approved" and d5.get("approved_for_real") is True and all(x in ids for x in NEW_IDS):
    say(f"  ✓ the Step 1 forms list shows the details form (screen 5b) at version {fv}, approved, approved for real, with middle name, suffix, birth name, gender and county")
else: bad(f"the Step 1 preview answered {s1}: the details form at version {d5.get('version')}, {d5.get('status')}, approved for real {d5.get('approved_for_real')}, new questions {[x for x in NEW_IDS if x in ids]}")
off = [k for k in RECF if not (byk.get(k) and byk[k].get("version") == RECF[k]["version"] and byk[k].get("fingerprint") == RECF[k]["sha256"] and byk[k].get("approved_for_real") is True)]
if forms and not off: say(f"  ✓ every form ({len(RECF)}) is live at the version and wording fingerprint in the approval record (step1-approved-2026-10-14.json), approved for real")
else: bad("these forms are not live at the recorded version and wording, or not approved for real: " + ", ".join(off or ["(none answered)"]))
chk = [{"form": k, "version": RECF[k]["version"]} for k in RECF] + [{"form": k, "version": RECF[k]["version"] + 1} for k in RECF]
s2, j2 = call("step1-sign", {"action": "preview", "approval_check": chk}); j2 = j2 if isinstance(j2, dict) else {}
ac = j2.get("approval_check") if isinstance(j2.get("approval_check"), list) else []; n = len(RECF)
acc = [x for x in ac[:n] if x.get("accepted") is True]; ref_ = [x for x in ac[n:] if x.get("accepted") is False]
if s2 == 200 and len(ac) == 2 * n and len(acc) == n and len(ref_) == n:
    say("  ✓ a real applicant may sign each approved version, and the next version of every form is refused (the server's read-only approval check)")
else: bad(f"the approval check answered {s2}: {len(acc)} of {n} approved versions accepted, {len(ref_)} of {n} next versions refused")
say("  ✓ nothing was sent: this step called only the Step 1 preview and two doors that refuse a stranger")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE")
say("  ✓ screen 5b now asks middle name, suffix, birth name, gender and county, and says how to register with the Registry")
say("  ✓ forms already signed keep the version they signed; nobody's signed form or PDF changed")
say("  ✓ the office can send the FCSR registration text from the Text button; with an email on file, the steps go by email too (once the Hub shows the pick)")
done(0)
