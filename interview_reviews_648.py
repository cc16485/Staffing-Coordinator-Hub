#!/usr/bin/env python3
# 648 · THE AI INTERVIEW REVIEW (Samantha 2026-10-13: "yes to all" on the Interview Notes and AI Review preview, then "build").
#   1. interview_reviews_648.sql: the review's own record, office only to read and mark, written only by the server. Adds only.
#   2. Deploys interview-review (new): runs only when office staff tap Analyze Interview / Check before they leave.
#   3. Deploys hire-profile: the applicant's journey shows the interview observations and each AI review (office only).
# Replaced only when the live copy is main's build or an older version of it. Nothing is sent; the AI is not called.
# Prints counts only: no name, number, email, key or secret.
import os, json, subprocess, hashlib
os.environ.setdefault("SB_STEP", "648")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FNS = ["interview-review", "hire-profile"]
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
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
def anon_key():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_publishable_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        for k in arr:
            if isinstance(k, dict) and k.get("name") == "anon" and usable(k.get("api_key")): return k["api_key"]
    return ""
def command(url, anon):
    return ("select net.http_post(url := " + lit(url) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
            "'Authorization', " + lit("Bearer " + anon) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT) + ")), "
            "body := '{}'::jsonb, timeout_milliseconds := 120000);")
def jget(b, k):
    try: return json.loads(b).get(k)
    except Exception: return None

start("THE AI INTERVIEW REVIEW")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
for f, want in json.loads(os.environ.get("SB_SQL_SHAS", "{}")).items():
    (say(f"  ✓ {f} is the reviewed build") if sha(os.path.join(ROOT, f)) == want else bad(f"{f} is not the reviewed build"))
ANON = anon_key(); HIDE.append(ANON)
s_, b_ = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
try: names = {x.get("name") for x in json.loads(b_)} if s_ == 200 else set()
except Exception: names = set()
say("  ✓ the AI key is set on the server (ANTHROPIC_API_KEY)") if "ANTHROPIC_API_KEY" in names else bad("ANTHROPIC_API_KEY is not set on the server")
ok, r = sql(REF, "select to_regprocedure('public.hub_office_ok()') is not null as fn, to_regclass('public.interview_reviews') is not null as t")
if not ok or not r or not r[0]["fn"]: bad("the office test (hub_office_ok) is missing; run 647 first")
else: say(f"  · the review record: {'already there' if r[0]['t'] else 'not there yet (it will be added)'}")
VJ = {}
for FN in FNS:
    sx, mx = fmeta(REF, FN)
    if sx == 404: VJ[FN] = True; say(f"  · {FN}: new (it will be added)"); continue
    if sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool):
        VJ[FN] = mx["verify_jwt"]; okl, livef = live_files(REF, FN)
        differ = [k for k in need(FNROOT, FN) if livef.get(k) != sha(os.path.join(ROOT, k))] if okl else []
        unknown = [k for k in differ if livef.get(k) is not None and not in_history(k, livef.get(k))]
        if not okl: bad(f"could not read {FN}'s live files")
        elif unknown: bad(f"{FN}'s live copy holds {', '.join(unknown[:3])} in a version that was never on main (someone's unmerged work). Tell Claude.")
        else: say(f"  ✓ {FN} is live at version {mx.get('version', '?')}" + (": will be brought up to this build" if differ else ": already this build"))
    else: bad(f"{FN} is unreadable: {sx}")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
ok, r = sql(REF, open(os.path.join(ROOT, "interview_reviews_648.sql")).read())
if not ok: bad("the review record did not go in (nothing changed): " + str(r)); done(6)
say("  ✓ the review record is in place (office only)")
for FN in FNS:
    if not deploy(REF, FNROOT, FN, VJ[FN]): say(f"  RESULT: stopped at {FN}. Tell Claude."); done(6)

say(); say("PART 3 · PROOF (the AI is not called; nothing is sent)")
for FN in FNS:
    okl, livef = live_files(REF, FN)
    say(f"  ✓ {FN}: the live copy is exactly this build") if okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need(FNROOT, FN)) else bad(f"{FN}'s live copy is not this build")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
A = {"apikey": ANON, "Authorization": "Bearer " + ANON}
DU = f"{FNB}/functions/v1/interview-review"
d1 = http("POST", DU, {"applicant_id": "00000000-0000-0000-0000-000000000000"}, A)[0]
say(f"  ✓ the review refuses anyone not signed in as office staff ({d1})") if d1 in (401, 403) else bad(f"the review answered the public key ({d1})")
c1 = http("OPTIONS", DU, None, {"Origin": "https://cc.mo-care.com", "Access-Control-Request-Method": "POST"})[0]
say(f"  ✓ the Hub can reach it ({c1})") if c1 == 200 else bad(f"the Hub cannot reach it ({c1})")
s2, b2 = http("GET", f"{FNB}/rest/v1/interview_reviews?select=id&limit=1", None, A)
say(f"  ✓ signed out: no reviews ({s2})") if s2 in (401, 403) or b2.strip() == "[]" else bad("signed out can read reviews")
s0, b0 = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": open(os.path.join(ROOT, "interview_reviews_648_probe.sql")).read()}, MG())
try: msg = json.loads(b0).get("message", b0)
except Exception: msg = b0
m = re.search(r"PROBE_RESULT: (\{.*?\})", str(msg))
if not m: bad("the proof did not run: " + str(msg)[:300])
else:
    p = json.loads(m.group(1))
    def chk(g, t): (say("  ✓ " + t) if g else bad(t))
    chk(p["office_reads"] == 1 and p["office_marks"] == 1, "an office member reads a review and can confirm, correct or dismiss")
    chk(p["office_rewrites_ai"] is False and p["office_inserts"] is False, "...but can never change the AI's words or write a review themselves")
    chk(p["stranger_reads"] == 0 and p["stranger_marks"] == 0, "a signed-in stranger sees no reviews and can mark none")
say("  · tested before deploying: quotes checked against the transcript, no score kept, no consent no review, first name only to the AI (27 checks);")
say("    the journey lines (18 checks); the Hub and phone screens (24 checks).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · Analyze Interview is ready in the Hub. It runs only when someone taps it."); done(0)
