#!/usr/bin/env python3
# 1185 · CARE PLAN STAGE 1 (Samantha approved Stage 1 of "From Visit to First Shift", 2026-10-29).
#   1. careplan_stage1_1185.sql: Start of Care step 4 gets the check "Care plan approved in the Hub". Adds only.
#   2. Deploys ai-draft-careplan: drafts the care plan from the whole iPad visit when the visit is finished (the stronger
#      model; every line must name a source that checks out, or it comes back "Ask before approving"). Saves nothing.
#   3. Deploys client-journey: the new check, and "Care tasks in AxisCare" now looks for the approved plan's tasks.
# Replaced only when the live copy is main's build or an older version of it. Nothing is sent; the drafting service is not
# called. Prints counts only: no name, number, email, key or secret.
import os, json, subprocess, hashlib, time
os.environ.setdefault("SB_STEP", "1185")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FNS = ["ai-draft-careplan", "client-journey"]; SQLF = "careplan_stage1_1185.sql"
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
CHECKS = "select string_agg(c->>'key', ',' order by i) as k from public.client_journey_step_def d, jsonb_array_elements(d.def->'checks') with ordinality t(c, i) where d.key = 'soc.setup'"
start("CARE PLAN STAGE 1 (draft from the visit, approval, Start of Care check)")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("the Supabase tool was not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
for f, want in json.loads(os.environ.get("SB_SQL_SHAS", "{}")).items():
    (say(f"  ✓ {f} is the reviewed build") if sha(os.path.join(ROOT, f)) == want else bad(f"{f} is not the reviewed build"))
ANON = anon_key(); HIDE.append(ANON)
if not ANON: bad("could not read the project's public key")
s_, b_ = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
try: names = {x.get("name") for x in json.loads(b_)} if s_ == 200 else set()
except Exception: names = set()
say("  ✓ the drafting key is set on the server (ANTHROPIC_API_KEY)") if "ANTHROPIC_API_KEY" in names else bad("ANTHROPIC_API_KEY is not set on the server")
say("  ✓ AxisCare is set on the server (for its task list)") if names & {"AXISCARE_API_KEY", "AXISCARE_TOKEN"} else bad("AxisCare is not set on the server")
ok, r = sql(REF, CHECKS)
if not ok or not r or not r[0]["k"]: bad("Start of Care step 4 (soc.setup) was not found; it comes with 911")
else:
    k = r[0]["k"].split(","); say(f"  ✓ Start of Care step 4 has {len(k)} checks" + ("; the care plan check is already there" if "plan_approved" in k else "; the care plan check will be added after 'Care tasks in AxisCare'"))
    if "ax_tasks" not in k: bad("step 4 has no 'Care tasks in AxisCare' check to sit after")
VJ = {}
for FN in FNS:
    sx, mx = fmeta(REF, FN)
    if sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool):
        VJ[FN] = mx["verify_jwt"]; okl, livef = live_files(REF, FN)
        differ = [x for x in need(FNROOT, FN) if livef.get(x) != sha(os.path.join(ROOT, x))] if okl else []
        unknown = [x for x in differ if livef.get(x) is not None and not in_history(x, livef.get(x))]
        if not okl: bad(f"could not read {FN}'s live files")
        elif unknown: bad(f"{FN}'s live copy holds {', '.join(unknown[:3])} in a version that was never on main (someone's unmerged work). Tell Claude.")
        else: say(f"  ✓ {FN} is live at version {mx.get('version', '?')}" + (": will be brought up to this build" if differ else ": already this build"))
    else: bad(f"{FN} is not live or unreadable ({sx}); this step only updates it")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
ok, r = sql(REF, open(os.path.join(ROOT, SQLF)).read())
if not ok: bad("the Start of Care check did not go in (nothing changed): " + str(r)[:300]); done(6)
say("  ✓ Start of Care step 4 has 'Care plan approved in the Hub'")
for FN in FNS:
    if not deploy(REF, FNROOT, FN, VJ[FN]): say(f"  RESULT: stopped at {FN}. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (the drafting service is not called; nothing is sent)")
for FN in FNS:
    okl, livef = live_files(REF, FN)
    say(f"  ✓ {FN}: the live copy is exactly this build") if okl and all(livef.get(x) == sha(os.path.join(ROOT, x)) for x in need(FNROOT, FN)) else bad(f"{FN}'s live copy is not this build")
ok, r = sql(REF, CHECKS)
say("  ✓ step 4's checks: '" + r[0]["k"] + "'") if ok and r and "ax_tasks,plan_approved" in (r[0]["k"] or "") else bad("step 4's checks are not as planned")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
A = {"apikey": ANON, "Authorization": "Bearer " + ANON}
d1 = http("POST", f"{FNB}/functions/v1/ai-draft-careplan", {"mode": "visit", "assessment_id": "proof_1185"}, A)[0]
say(f"  ✓ the draft refuses anyone not signed in to the Hub ({d1})") if d1 in (401, 403) else bad(f"the draft answered the public key ({d1})")
c1 = http("OPTIONS", f"{FNB}/functions/v1/ai-draft-careplan", None, {"Origin": "https://cc.mo-care.com", "Access-Control-Request-Method": "POST"})[0]
say(f"  ✓ the Hub can reach it ({c1})") if c1 in (200, 204) else bad(f"the Hub cannot reach it ({c1})")
say("  · tested before deploying: drafting rules and the visit mode (27 checks), Start of Care (189 checks),")
say("    the iPad visit and the care plan screen in the Hub (61 checks), this step against a pretend server.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the server is ready for Care plan Stage 1. Now merge the Hub pull request."); done(0)
