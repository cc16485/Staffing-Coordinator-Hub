#!/usr/bin/env python3
# 1182 · STAFFING SERVER · PRN STEP 6: THE MONTHLY PRN TEAM UPDATE, AND "KEEP OFF THE PRN PAGE" (2026-10-29, Samantha: "continue";
# decision 7 monthly update by text with a page link, decision 13 the office's keep-off tick)
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data and a throwaway Postgres
#     only); the page, open shifts and monthly update switches are off; each function's gateway setting is read, so it is kept.
#  2. Adds the monthly update's records (prn_monthly.sql, one transaction: one row a month, kept, stays as sent; one text per
#     member a month). Deploys prn-week (write, save and send the update from PRN Teams, This week), prn-page (the update at
#     the top of their page) and coverage-run (a shift ticked "Keep off the PRN page" is refused at I'm Interested).
#  3. Proof (nothing is sent or saved): prn-week refuses outsiders; prn-page refuses a forged link; the open-shift check runs
#     read only; the records are there, kept and frozen once sent; the switches are still off.
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
FNS = ("prn-week", "prn-page", "coverage-run"); SWITCHES = ("prn_page_live", "prn_open_shifts_live", "prn_monthly_live")
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

start("STAFFING SERVER · PRN STEP 6: THE MONTHLY PRN TEAM UPDATE (switch OFF)")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = [k for k in sorted({k for fn in FNS for k in L.need(FNROOT, fn)} | {"prn_monthly.sql"})
         if (lambda r: r[0] != 0 or r[1] != open(os.path.join(ROOT, k)).read())(run(["git", "-C", ROOT, "show", f"origin/main:{k}"]))]
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE and os.path.exists(PGLITE):
    env = dict(os.environ, PGLITE=PGLITE)
    # (the shift-text tests that read the Hub's own folder can't run from this fresh copy; they passed when built)
    for t, must in (("prn_monthly_test.mjs", "39/39"), ("prn_open_shifts_test.mjs", "66/66"), ("prn_week_test.mjs", "52/52"), ("prn_page_test.mjs", "43/43"), ("prn_page_texts_test.mjs", "45/45"), ("prn3_coverage_test.mjs", "27/27")):
        c, o = run([NODE, t], cwd=ROOT, env=env)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    ok("the monthly update, open shifts, This week, PRN Team page, link texts and PRN coverage tests pass (fake data and a throwaway Postgres only)")
else: say("  · node or the throwaway Postgres is not on this Mac, so the tests were not re-run here (they passed when built)")
on = switches_on()
if on is None: stop("couldn't read the Hub's switches", 3)
if on: stop("already on: " + ", ".join(on) + ". Turn them off in the Hub first.")
ok("the page, open shifts and the new monthly update switch are off: " + ", ".join(SWITCHES))
meta = {}
for fn in FNS:
    s_, m_ = fmeta(REF, fn)
    if s_ != 200 or not m_ or "verify_jwt" not in m_: stop(f"couldn't read how {fn} is set up live ({s_})", 3)
    meta[fn] = bool(m_["verify_jwt"])
ok("each function's gateway setting is read, so it is kept: " + ", ".join(f"{k} {'on' if v else 'off'}" for k, v in meta.items()))
K = keys(); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); L.HIDE += [ANON, SVC]
if not (ANON and SVC): stop("couldn't read the Hub's keys", 3)

say(); say("PART 2 · CHANGE")
okQ, r = sql(REF, "begin;\n" + open(os.path.join(ROOT, "prn_monthly.sql")).read() + "\ncommit;")
if not okQ: bad("the record change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
ok("the monthly PRN Team update has its records (kept, and each month stays as it was sent)")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, meta[fn]): say(f"  STOP at {fn}. Tell Claude. (The switches are off; nothing new shows or sends.)"); done(6)

say(); say("PART 3 · PROOF (nothing is sent or saved)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
A = {"apikey": ANON, "Authorization": "Bearer " + ANON}
for act in ("monthly", "monthly_send"):
    s1 = http("POST", f"{FNB}/functions/v1/prn-week", {"action": act}, A)[0]
    (ok if s1 in (401, 403) else bad)(f"prn-week {act} refuses anyone not signed in to the office ({s1})")
s2, b2 = http("POST", f"{FNB}/functions/v1/prn-page", {"action": "view", "p": "00000000-0000-4000-8000-000000000000", "e": 4102444800, "t": "x" * 43}, A)
(ok if s2 == 401 and '"expired":true' in b2.replace(" ", "") else bad)(f"the page refuses a forged link ({s2})")
SV = {"apikey": SVC, "Authorization": "Bearer " + SVC}
sP, bP = http("POST", f"{FNB}/functions/v1/coverage-run", {"action": "prn_open", "axiscare_id": "0"}, SV, 200)
try: p = json.loads(bP)
except Exception: p = {}
(ok if sP == 200 and isinstance(p.get("shifts"), list) and not p["shifts"] else bad)(f"the open-shift check still runs read only ({sP})")
okT, tt = sql(REF, "select (select count(*) from information_schema.tables where table_schema='public' and table_name='prn_monthly')::int t, "
                   "(select count(*) from pg_trigger where tgname in ('prn_monthly_sent_stays', 'prn_monthly_no_delete'))::int g, "
                   "(select count(*) from public.prn_monthly)::int n, "
                   "(select pg_get_constraintdef(oid) from pg_constraint where conname='prn_touches_kind_check') k")
(ok if okT and tt and tt[0]["t"] == 1 and tt[0]["g"] == 2 and "monthly_sent" in (tt[0]["k"] or "") and "page_ready_sent" in (tt[0]["k"] or "") else bad)(
  f"the monthly records are there, kept, and frozen once sent; one text per member a month ({tt[0]['n'] if okT and tt else '?'} updates so far)")
(ok if switches_on() == [] else bad)("the switches are still off")
say()
say("  1182: " + ("DONE. The monthly PRN Team update and the keep-off tick are on the server with the switch OFF. Next: Claude merges the Hub "
    "pull request, then you can write October's update in PRN Teams, This week."
    if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
