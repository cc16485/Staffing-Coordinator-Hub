#!/usr/bin/env python3
# 611 · STEP 1 EXPERIENCE AND REFERENCES, PRACTICE HIRES ONLY (Samantha 2026-10-11: "I approve the screen designs for the
# first inactive build step using test applicants. No real caregiver records, reference requests, or live matching behavior
# should change yet."). Adds five columns (supabase/step1-experience.sql), marks the practice and training hires' Step 1
# records, deploys step1-sign (the version 3 application and reference forms: tasks per job, family care, backups),
# hire-profile (the Skills and experience card) and reference-tasks (new: the task questions on the reference form, for
# practice hires only). Stops before any change if a real offer is on the new onboarding path (it would see the new forms).
# Nothing is sent. No level, qualification, match, pay or AxisCare record changes.
import os, json, subprocess, hashlib
os.environ.setdefault("SB_STEP", "611")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; TRN = "rdqujxiycycwhskyvrwa"
FNS = ["step1-sign", "hire-profile", "reference-tasks"]
PRACTICE = ['Slice 10 practice run', 'Training walkthrough']
_HIST = {}
def in_history(rel, live_sha):
    if not live_sha: return False
    if rel not in _HIST:
        shas = set()
        try:
            for c in subprocess.run(["git", "-C", ROOT, "log", "--format=%H", "--", rel], capture_output=True, text=True, timeout=120).stdout.split():
                b = subprocess.run(["git", "-C", ROOT, "show", f"{c}:{rel}"], capture_output=True, timeout=60).stdout
                if b: shas.add(hashlib.sha256(b).hexdigest())
        except Exception: pass
        _HIST[rel] = shas
    return live_sha in _HIST[rel]
start("STEP 1 EXPERIENCE AND REFERENCES (PRACTICE HIRES ONLY)")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
VJ = {}
for fn in FNS:
    sx, mx = fmeta(REF, fn)
    if fn == "reference-tasks" and sx == 404: VJ[fn] = True; say("  ✓ reference-tasks is new (not live yet)"); continue
    if sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool):
        VJ[fn] = mx["verify_jwt"]; okl, livef = live_files(REF, fn)
        differ = [k for k in need(FNROOT, fn) if livef.get(k) != sha(os.path.join(ROOT, k))] if okl else []
        unknown = [k for k in differ if livef.get(k) is not None and not in_history(k, livef.get(k))]
        if not okl: bad(f"could not read {fn}'s live files")
        elif unknown: bad(f"{fn}'s live copy holds {', '.join(unknown[:3])} in a version that was never on main (someone's unmerged work). Tell Claude.")
        else: say(f"  ✓ {fn} is live at version {mx.get('version', '?')}" + (f": brought up to main ({', '.join(k.split('/')[-1] for k in differ[:4])})" if differ else ": already this build"))
    else: bad(f"{fn} is not live or unreadable: {sx}")
ok1, r1 = sql(REF, "select has_table_privilege('authenticated','public.reference_requests','SELECT') as auth_sel, has_table_privilege('anon','public.reference_requests','SELECT') as anon_sel, has_table_privilege('anon','public.step1_forms','SELECT') as anon_s1, (select count(*) from public.step1_forms) as forms, (select count(*) from public.reference_requests) as reqs")
if not ok1: bad(f"could not read the tables: {r1}")
else:
    x = r1[0]
    if x["auth_sel"] is not True: bad("office staff read reference requests column by column, so new columns would break their screen. Tell Claude.")
    elif x["anon_sel"] or x["anon_s1"]: bad("the public key can read reference_requests or step1_forms. Tell Claude.")
    else: say(f"  ✓ the tables: {x['forms']} Step 1 record(s), {x['reqs']} reference request(s); office staff read whole rows; the public key reads neither")
pl = ",".join(lit(p) for p in PRACTICE)
ok2, r2 = sql(TRN, f"select id, first_name, last_name, offered_by, onboarding_path, offer_status from public.job_offers where onboarding_path = 'new'")
practice_ids = []
if not ok2: bad(f"could not read the Training Platform's offers: {r2}")
else:
    real = [o for o in r2 if o.get("offered_by") not in PRACTICE and "(TRAINING)" not in str(o.get("last_name") or "") and o.get("offer_status") not in ("withdrawn", "declined")]
    practice_ids = [o["id"] for o in r2 if o.get("offered_by") in PRACTICE or "(TRAINING)" in str(o.get("last_name") or "")]
    if real: bad(f"{len(real)} real offer(s) on the new onboarding path would see the new forms ({', '.join((o.get('first_name') or '?') + ' ' + (o.get('last_name') or '')[:1] for o in real[:3])}). Tell Claude.")
    else: say(f"  ✓ no real offer is on the new onboarding path; {len(practice_ids)} practice or training offer(s) are")
say("  · what changes: five new columns; the practice and training hires' Step 1 records marked practice; step1-sign (version 3 application and reference forms), hire-profile (the Skills and experience card), reference-tasks (new). Nothing is sent.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
okc, rc = sql(REF, open(os.path.join(ROOT, "supabase/step1-experience.sql")).read())
if not okc: bad(f"the columns could not be added: {rc}"); say("  RESULT: STOPPED. Tell Claude."); done(5)
say("  ✓ the five columns are in")
if practice_ids:
    okp, rp = sql(REF, f"update public.step1_forms set practice = true where offer_id::text in ({','.join(lit(i) for i in practice_ids)}) and practice = false returning offer_id")
    say(f"  ✓ {len(rp)} practice Step 1 record(s) marked practice") if okp else bad(f"could not mark the practice records: {rp}")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, VJ.get(fn, True)): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent)")
for fn in FNS:
    okl, livef = live_files(REF, fn)
    say(f"  ✓ {fn} is live as tested") if okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need(FNROOT, fn)) else bad(f"{fn}: the live copy is not this build")
okk, rk = sql(REF, "select count(*) filter (where practice) as p, count(*) as n from public.step1_forms")
if okk: say(f"  ✓ Step 1 records: {rk[0]['p']} practice of {rk[0]['n']}")
s_, b_ = http("POST", f"https://{REF}.supabase.co/functions/v1/reference-tasks", {"action": "view", "r": "00000000-0000-4000-8000-000000000000"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ reference-tasks answers ({s_}) and needs the public key like every page") if s_ and s_ < 500 else bad(f"reference-tasks answered {s_}")
okr, rr = sql(REF, "select count(*) as n from public.reference_requests where task_confirm is not null")
if okr: say(f"  ✓ reference requests with task answers: {rr[0]['n']} (none until a practice hire's reference answers)")
say("  · tested before deploying: Step 1 experience and references (46), Step 1 signing (72), the forms (25), the landing (13), the main profile (15), and on a phone: the new screens and the reference form, practice and real (27), the original Step 1 look (19).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · practice hires now see the version 3 work history and references, their references see task questions, and the profile shows Skills and experience. Real hires, real reference requests and matching are unchanged. Nothing was sent."); done(0)
