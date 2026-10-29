#!/usr/bin/env python3
# 1180 · STAFFING SERVER · PRN STEP 5b: OPEN SHIFTS ON THE PRN TEAM PAGE, WITH "I'M INTERESTED" (2026-10-29, Samantha: "Yes, build
# part 5b with its switch off")
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data and a throwaway Postgres
#     only); the page and the open shifts switches are off; each function's gateway setting is read, so it is kept.
#  2. Lets the page's record keep "interested" (prn_open_shifts.sql, one transaction). Deploys prn-page (open shifts and I'm
#     Interested, closed while the switch is off) and coverage-run (the open shifts a member's ask list allows, and I'm
#     Interested as a Yes on the shift, both only for prn-page with the server key; the ask list tags a Yes from their page).
#  3. Proof (nothing is sent or saved): prn-page refuses a forged link and an office look without a sign-in; coverage-run's two
#     new actions refuse the public key; the open-shift check runs read only for a made-up person; the record allows
#     "interested"; the switches are still off.
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
FNS = ("prn-page", "coverage-run"); SWITCHES = ("prn_page_live", "prn_open_shifts_live")
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

start("STAFFING SERVER · PRN STEP 5b: OPEN SHIFTS ON THE PRN TEAM PAGE (switch OFF)")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = [k for k in sorted({k for fn in FNS for k in L.need(FNROOT, fn)} | {"prn_open_shifts.sql"})
         if (lambda r: r[0] != 0 or r[1] != open(os.path.join(ROOT, k)).read())(run(["git", "-C", ROOT, "show", f"origin/main:{k}"]))]
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE and os.path.exists(PGLITE):
    env = dict(os.environ, PGLITE=PGLITE)
    # (the shift-text tests that read the Hub's own folder can't run from this fresh copy; they passed when built)
    for t, must in (("prn_open_shifts_test.mjs", "66/66"), ("prn_page_test.mjs", "43/43"), ("prn_page_texts_test.mjs", "45/45"), ("prn_week_test.mjs", "52/52"), ("prn3_coverage_test.mjs", "27/27")):
        c, o = run([NODE, t], cwd=ROOT, env=env)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    ok("the open shifts, PRN Team page, link texts, This week and PRN coverage tests pass (fake data and a throwaway Postgres only)")
else: say("  · node or the throwaway Postgres is not on this Mac, so the tests were not re-run here (they passed when built)")
on = switches_on()
if on is None: stop("couldn't read the Hub's switches", 3)
if on: stop("already on: " + ", ".join(on) + ". Turn them off in the Hub first.")
ok("the page and the new open shifts switch are off: " + ", ".join(SWITCHES))
meta = {}
for fn in FNS:
    s_, m_ = fmeta(REF, fn)
    if s_ != 200 or not m_ or "verify_jwt" not in m_: stop(f"couldn't read how {fn} is set up live ({s_})", 3)
    meta[fn] = bool(m_["verify_jwt"])
ok("each function's gateway setting is read, so it is kept: " + ", ".join(f"{k} {'on' if v else 'off'}" for k, v in meta.items()))
K = keys(); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); L.HIDE += [ANON, SVC]
if not (ANON and SVC): stop("couldn't read the Hub's keys", 3)

say(); say("PART 2 · CHANGE")
okQ, r = sql(REF, "begin;\n" + open(os.path.join(ROOT, "prn_open_shifts.sql")).read() + "\ncommit;")
if not okQ: bad("the record change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
ok("the PRN Team page's record can keep \"interested\"")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, meta[fn]): say(f"  STOP at {fn}. Tell Claude. (The switches are off; nothing new shows or sends.)"); done(6)

say(); say("PART 3 · PROOF (nothing is sent or saved)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
A = {"apikey": ANON, "Authorization": "Bearer " + ANON}
NOBODY = "00000000-0000-4000-8000-000000000000"
for act in ("open", "interested"):
    s1, b1 = http("POST", f"{FNB}/functions/v1/prn-page", {"action": act, "p": NOBODY, "e": 4102444800, "t": "x" * 43, "case_id": "x", "shift_key": "x"}, A)
    (ok if s1 == 401 and '"expired":true' in b1.replace(" ", "") else bad)(f"the page refuses a forged link for {'open shifts' if act == 'open' else 'I am Interested'} ({s1})")
s2 = http("POST", f"{FNB}/functions/v1/prn-page", {"action": "open_preview", "applicant_id": NOBODY}, A)[0]
(ok if s2 in (401, 403) else bad)(f"the office look at open shifts refuses anyone not signed in to the office ({s2})")
for act in ("prn_open", "prn_interest"):
    s3 = http("POST", f"{FNB}/functions/v1/coverage-run", {"action": act, "axiscare_id": "0", "case_id": "x"}, A)[0]
    (ok if s3 in (401, 403) else bad)(f"coverage-run {act} refuses the public key ({s3})")
SV = {"apikey": SVC, "Authorization": "Bearer " + SVC}
sP, bP = http("POST", f"{FNB}/functions/v1/coverage-run", {"action": "prn_open", "axiscare_id": "0"}, SV, 200)
try: p = json.loads(bP)
except Exception: p = {}
if sP == 200 and p.get("held"): ok("the open-shift check answers; AxisCare couldn't be read just now, so it shows none (as it should): " + str(p["held"])[:120])
elif sP == 200 and isinstance(p.get("shifts"), list) and not p["shifts"]: ok("the open-shift check runs read only: a made-up person sees no open shifts (nothing was sent or saved)")
else: bad(f"the open-shift check answered {sP}: {str(bP)[:200]}")
sI = http("POST", f"{FNB}/functions/v1/coverage-run", {"action": "prn_interest", "case_id": "no-such-case", "axiscare_id": "0"}, SV)[0]
(ok if sI == 404 else bad)(f"I'm Interested on a shift that doesn't exist is refused, nothing saved ({sI})")
okC, cc = sql(REF, "select pg_get_constraintdef(oid) d from pg_constraint where conname = 'prn_page_log_kind_check'")
(ok if okC and cc and "interested" in cc[0]["d"] and "course_request" in cc[0]["d"] and "office_preview" in cc[0]["d"] else bad)("the page's record allows \"interested\", and every earlier kind still")
(ok if switches_on() == [] else bad)("the switches are still off")
say()
say("  1180: " + ("DONE. Open shifts and I'm Interested are on the server with the switch OFF. Next: Claude merges the Hub pull request, then "
    "you'll see the switch in Settings, PRN Teams, and what each member would see in What they see."
    if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
