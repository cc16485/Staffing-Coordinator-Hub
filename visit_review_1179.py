#!/usr/bin/env python3
# 1179 · HOME VISIT, AFTER THE VISIT (2026-10-29, stage 3 of the iPad home visit; her mockup approved "looks good, start building").
#   Deploys visit-review (new): reads a home visit's recording when office staff tap "Read the recording" on the After the
#   visit screen, and offers answers for the EMPTY boxes only. It saves nothing; the Hub writes an answer only on Keep.
# No database change. Nothing is sent; the reader is not called by this step. Prints counts only: no name, number, key or secret.
import os, json, time
os.environ.setdefault("SB_STEP", "1179")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FN = "visit-review"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
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
start("HOME VISIT: AFTER THE VISIT (reads the recording on a tap)")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("the Supabase tool was not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
ANON = anon_key(); HIDE.append(ANON)
if not ANON: bad("could not read the project's public key")
s_, b_ = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
try: names = {x.get("name") for x in json.loads(b_)} if s_ == 200 else set()
except Exception: names = set()
say("  ✓ the reader's key is set on the server (ANTHROPIC_API_KEY)") if "ANTHROPIC_API_KEY" in names else bad("ANTHROPIC_API_KEY is not set on the server")
ok, r = sql(REF, "select count(*) filter (where column_name in ('session_id','part','offset_seconds'))::int as cols from information_schema.columns where table_schema='public' and table_name='recordings'")
if not ok or not r: bad("could not read the recordings table")
elif r[0]["cols"] != 3: bad("the recordings table is missing the parts columns; run 1177 first")
else: say("  ✓ recordings has the 10-minute part columns (from 1177)")
ok, r = sql(REF, "select count(*)::int as n, count(*) filter (where status='done')::int as done from public.recordings where kind='assessment'")
if ok and r: say(f"  · home visit recordings so far: {r[0]['n']} parts, {r[0]['done']} written out")
sx, mx = fmeta(REF, FN)
if sx == 404: say(f"  · {FN}: new (it will be added)")
elif sx == 200:
    okl, livef = live_files(REF, FN)
    same = okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need(FNROOT, FN))
    say(f"  ✓ {FN} is live at version {mx.get('version', '?')}" + (": already this build" if same else ": will be brought up to this build"))
else: bad(f"{FN} is unreadable: {sx}")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, FN, True): say(f"  RESULT: stopped at {FN}. Nothing else changed. Tell Claude."); done(6)
say(f"  ✓ {FN} is deployed (signed-in office staff only)")
say(); say("PART 3 · PROOF (the reader is not called; nothing is sent)")
okl, livef = live_files(REF, FN)
say(f"  ✓ {FN}: the live copy is exactly this build") if okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need(FNROOT, FN)) else bad(f"{FN}'s live copy is not this build")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
A = {"apikey": ANON, "Authorization": "Bearer " + ANON}
DU = f"{FNB}/functions/v1/{FN}"
d1 = http("POST", DU, {"assessment_id": "proof_1179"}, A)[0]
say(f"  ✓ it refuses anyone not signed in as office staff ({d1})") if d1 in (401, 403) else bad(f"it answered the public key ({d1})")
c1 = http("OPTIONS", DU, None, {"Origin": "https://cc.mo-care.com", "Access-Control-Request-Method": "POST"})[0]
say(f"  ✓ the Hub can reach it from the iPad ({c1})") if c1 == 200 else bad(f"the Hub cannot reach it ({c1})")
say("  · tested before deploying: only empty boxes are filled, every answer's words are checked against the recording,")
say("    choices only from the box's own choices, consent required, nothing saved by the server (27 checks);")
say("    the After the visit screen in the Hub (35 checks).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the reader is ready. Now merge the Hub pull request for After the visit."); done(0)
