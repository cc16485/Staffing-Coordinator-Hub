#!/usr/bin/env python3
# 602 · ORIENTATION VIDEO CALL: THE OFFER LETTER (VERSION 2) AND THE JOB ADVERTS (Samantha 2026-10-11, "yes to both").
#   1. The job adverts and the Recruit tab's saved descriptions: only "welcome call" / "welcome video call" changes to
#      "Orientation Video Call" (every row it changes is saved first, next to this report). The website's job pages and the
#      Indeed feed rebuild from these within the hour.
#   2. The offer letter becomes version 2 (one sentence: "a short Orientation Video Call"). The Hub's offer-sign shows and
#      fingerprints version 2; Training's job-offer stamps new offers version 2. Letters already signed keep their stored PDF,
#      version and fingerprint; anyone who signs from now on signs version 2, the words they saw.
# Run 601 first. Nothing is sent.
import os, json, subprocess, hashlib, datetime as dt
os.environ.setdefault("SB_STEP", "602")
from cc_step_lib import *
HUB = "zngsgedlsxinbygwmxwn"; TRN = "rdqujxiycycwhskyvrwa"
TR_FNROOT = os.environ.get("SB_TR_FNROOT", ""); TR_ROOT = os.path.dirname(os.path.dirname(TR_FNROOT)) if TR_FNROOT else ""
STEP601_TRN = "e69dec00b10b82417613892a3400de8498f77932"
COLS = "summary, description, responsibilities, qualifications, benefits"
OLDQ = "(" + " or ".join(f"coalesce({c}, '') ~* '\\mwelcome (video )?calls?\\M'" for c in COLS.split(", ")) + ")"
_HIST = {}
def in_history(root, rel, live_sha):
    if not live_sha: return False
    key = (root, rel)
    if key not in _HIST:
        shas = set()
        try:
            for c in subprocess.run(["git", "-C", root, "log", "--format=%H", "--", rel], capture_output=True, text=True, timeout=120).stdout.split():
                b = subprocess.run(["git", "-C", root, "show", f"{c}:{rel}"], capture_output=True, timeout=60).stdout
                if b: shas.add(hashlib.sha256(b).hexdigest())
        except Exception: pass
        _HIST[key] = shas
    return live_sha in _HIST[key]
short = lambda ks: ', '.join(d.split('/')[-2] + '/' + d.split('/')[-1] for d in ks[:4])
start("ORIENTATION VIDEO CALL: THE OFFER LETTER (VERSION 2) AND THE JOB ADVERTS")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
if not (TR_FNROOT and os.path.isdir(TR_FNROOT)): bad("the Training Platform's reviewed copy is missing"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
check_build(TR_FNROOT, json.loads(os.environ.get("SB_TR_SHAS", "{}")))
PLAN = []
for ref, fnroot, root, fn in [(HUB, FNROOT, ROOT, "offer-sign"), (TRN, TR_FNROOT, TR_ROOT, "job-offer")]:
    where = "Training" if ref == TRN else "Hub"
    sx, mx = fmeta(ref, fn)
    if not (sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool)): bad(f"{where} {fn} is not live or unreadable: {sx}"); continue
    okl, livef = live_files(ref, fn)
    if not okl: bad(f"could not read {where} {fn}'s live files"); continue
    differ = [k for k in need(fnroot, fn) if livef.get(k) != sha(os.path.join(root, k))]
    unknown = [k for k in differ if livef.get(k) is not None and not in_history(root, k, livef.get(k))]
    if unknown: bad(f"{where} {fn}'s live copy holds {short(unknown)} in a version that was never on main (someone's unmerged work). Tell Claude."); continue
    if fn == "job-offer":
        b = subprocess.run(["git", "-C", root, "show", f"{STEP601_TRN}:supabase/functions/job-offer/index.ts"], capture_output=True).stdout
        live_idx = livef.get("supabase/functions/job-offer/index.ts")
        if live_idx not in (hashlib.sha256(b).hexdigest(), sha(os.path.join(root, "supabase/functions/job-offer/index.ts"))): bad("601 has not run yet (Training's job-offer does not say Orientation Video Call). Run 601 first."); continue
    PLAN.append((ref, fnroot, fn, mx["verify_jwt"], where))
    say(f"  ✓ {where} {fn} is live at version {mx.get('version', '?')}" + (f": brought up to main ({short(differ)})" if differ else ": already this build"))
SQLF = os.path.join(ROOT, "supabase", "ovc-adverts.sql")
if not os.path.exists(SQLF): bad("the advert SQL is not in the reviewed build")
ok_, pc = sql(HUB, f"select count(*) filter (where {OLDQ})::int as n, count(*) filter (where {OLDQ} and status = 'published')::int as pub, count(*)::int as total from public.job_postings")
ok2, tc = sql(HUB, f"select case when to_regclass('public.job_templates') is null then -1 else 0 end as has")
TB = []
if ok2 and tc and int(tc[0]['has']) == 0:
    ok3, TB = sql(HUB, f"select id, name, {COLS} from public.job_templates where {OLDQ} order by name")
    if not ok3: bad(f"could not read the saved descriptions: {TB}"); TB = []
ok4, PB = sql(HUB, f"select id, slug, status, {COLS} from public.job_postings where {OLDQ} order by slug")
if ok_ and ok4: say(f"  · {pc[0]['n']} job advert(s) say the old name ({pc[0]['pub']} published, of {pc[0]['total']}); {len(TB)} saved description(s) in the Recruit tab")
else: bad(f"could not read the job adverts: {pc if not ok_ else PB}")
BEFORE = os.path.join(os.path.dirname(os.path.abspath(REPORT)), "Orientation Video Call 602 adverts before " + dt.datetime.now().strftime("%H.%M.%S") + ".json")
if not fails:
    json.dump({"job_postings": PB, "job_templates": TB}, open(BEFORE, "w"), indent=1)
    say(f"  ✓ every advert row that will change is saved with its old words: {os.path.basename(BEFORE)}")
ok_, op = sql(TRN, "select count(*)::int as n from public.job_offers where onboarding_path = 'new' and offer_signed_at is null and offer_withdrawn_at is null and offer_declined_at is null")
say(f"  · {op[0]['n'] if ok_ else '?'} open new-path offer(s) not signed yet: if they sign from now on, they see and sign version 2")
say("  · what changes: the words in the job adverts, offer letter version 2, two services. Nothing is sent; no offer, signature or PDF changes.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
ok_, r_ = sql(HUB, open(SQLF).read())
if not ok_: bad(f"the advert wording did not change: {r_}"); done(5)
say("  ✓ the job adverts say Orientation Video Call")
for ref, fnroot, fn, vj, where in PLAN:
    if not deploy(ref, fnroot, fn, vj): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent)")
ok_, pc2 = sql(HUB, f"select count(*) filter (where {OLDQ})::int as n, count(*)::int as total from public.job_postings")
say(f"  ✓ no job advert says the old name ({pc[0]['n']} → {pc2[0]['n']}; {pc2[0]['total']} adverts, none added or removed)") if ok_ and int(pc2[0]['n']) == 0 and pc2[0]['total'] == pc[0]['total'] else bad(f"adverts after: {pc2}")
for ref, fnroot, fn, vj, where in PLAN:
    okl, livef = live_files(ref, fn); root = os.path.dirname(os.path.dirname(fnroot))
    good = okl and all(livef.get(k) == sha(os.path.join(root, k)) for k in need(fnroot, fn))
    say(f"  ✓ {where} {fn} is live with offer letter version 2") if good else bad(f"{where} {fn}: the live copy is not this build")
s_, b_ = http("POST", f"https://{HUB}.supabase.co/functions/v1/offer-sign", {"action": "view", "id": "00000000-0000-4000-8000-000000000000", "t": "x"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ the signing page still refuses a bad link ({s_})") if s_ and 400 <= s_ < 500 else bad(f"offer-sign with a bad link answered {s_}")
say("  · tested before deploying: the offer letter (21 checks, version 2, the position description still version 1), signing (30, an offer sent as version 1 is signed as version 2), Training's offer saving (36), the advert wording in a real Postgres (8).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the adverts and the offer letter say Orientation Video Call. The website's job pages update within the hour once the website change is merged. Nothing was sent."); done(0)
