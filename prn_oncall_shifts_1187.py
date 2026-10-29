#!/usr/bin/env python3
# 1187 · STAFFING SERVER · PRN ON-CALL SHIFTS ON THE PRN TEAM PAGE (2026-10-29, Samantha: "Keep it at $25 per shift and $50 for a
# whole 24-hour day. Update the plan and the on-call wording on the PRN page to these two shifts.")
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data and a throwaway Postgres
#     only); the page switch is off; prn-page's gateway setting is read, so it is kept.
#  2. Redeploys prn-page, whose on-call words now say: daytime 7am to 5pm, overnight 5pm to 7am, both = a whole day. No pay is
#     shown on their page (her rule); nothing else changes. No record changes.
#  3. Proof: the page still refuses a forged link; the switch is still off.
# Texts nobody. Safe to run again.
import json, os, subprocess, shutil, time
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, deploy, start, check_build, fmeta, MG, API, sql

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
if NODE == "none": NODE = ""
PGLITE = os.environ.get("SB_PGLITE", "/Users/samantha/Claude/Projects/.pglite/node_modules/@electric-sql/pglite/dist/index.js")
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FNS = ("prn-page",); SWITCHES = ("prn_page_live",)
ok = lambda s: say("  ✓ " + s)
def run(args, cwd=None, env=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True, env=env); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def keys():
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        out = {}
        for k in arr:
            v = k.get("api_key", "") if isinstance(k, dict) else ""
            if isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_")) and "·" not in v and "*" not in v: out[k.get("name")] = v
        if out.get("service_role") and out.get("anon"): return out
    return {}
def switches_on():
    okS, st = sql(REF, "select " + ", ".join(f"data->'{k}' as {k}" for k in SWITCHES) + " from public.app_data where key='ops_settings'")
    return None if not okS or not st else [k for k in SWITCHES if st[0].get(k) is True]

start("STAFFING SERVER · PRN ON-CALL SHIFTS ON THE PRN TEAM PAGE")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = [k for k in sorted({k for fn in FNS for k in L.need(FNROOT, fn)})
         if (lambda r: r[0] != 0 or r[1] != open(os.path.join(ROOT, k)).read())(run(["git", "-C", ROOT, "show", f"origin/main:{k}"]))]
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE and os.path.exists(PGLITE):
    env = dict(os.environ, PGLITE=PGLITE)
    for t, must in (("prn_recognition_test.mjs", "47/47"), ("prn_mentor_test.mjs", "57/57"), ("prn_page_test.mjs", "43/43"), ("prn_week_test.mjs", "52/52")):
        c, o = run([NODE, t], cwd=ROOT, env=env)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    ok("the on-call wording, Gap Mentor, PRN Team page and This week tests pass (fake data and a throwaway Postgres only)")
else: say("  · node or the throwaway Postgres is not on this Mac, so the tests were not re-run here (they passed when built)")
on = switches_on()
if on is None: stop("couldn't read the Hub's switches", 3)
if on: say("  · note: the PRN Team page is switched on, so members will see the new on-call wording right away")
else: ok("the page switch is off: members see nothing until you turn it on")
s_, m_ = fmeta(REF, "prn-page")
if s_ != 200 or not m_ or "verify_jwt" not in m_: stop(f"couldn't read how prn-page is set up live ({s_})", 3)
meta = {"prn-page": bool(m_["verify_jwt"])}
ok("prn-page's gateway setting is read, so it is kept: " + ("on" if meta["prn-page"] else "off"))
K = keys(); ANON = K.get("anon", ""); L.HIDE += [ANON, K.get("service_role", "")]
if not ANON: stop("couldn't read the Hub's keys", 3)

say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, "prn-page", meta["prn-page"]): say("  STOP at prn-page. Tell Claude."); done(6)

say(); say("PART 3 · PROOF (nothing is sent or saved)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
A = {"apikey": ANON, "Authorization": "Bearer " + ANON}
s2, b2 = http("POST", f"{FNB}/functions/v1/prn-page", {"action": "view", "p": "00000000-0000-4000-8000-000000000000", "e": 4102444800, "t": "x" * 43}, A)
(ok if s2 == 401 and '"expired":true' in b2.replace(" ", "") else bad)(f"the page refuses a forged link ({s2})")
(ok if switches_on() == (on or []) else bad)("the switch is as it was")
say()
say("  1187: " + ("DONE. The PRN Team page now describes on call as two shifts: daytime 7am to 5pm and overnight 5pm to 7am. Next: Claude "
    "merges the Hub pull request (the office's On call tab and the sample page)."
    if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
