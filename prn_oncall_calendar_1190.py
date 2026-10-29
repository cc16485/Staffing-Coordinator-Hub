#!/usr/bin/env python3
# 1190 · STAFFING SERVER · PRN ON-CALL CALENDAR (2026-10-29, Samantha: "Yes, build the on-call redo as recommended (decisions 22
# to 27) and the expectations wording as drafted.")
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data and a throwaway Postgres
#     only); both new switches are off; each function's gateway setting is read, so it is kept.
#  2. Adds the calendar records (prn_oncall_calendar.sql, one transaction: asks, call outcomes and misses, signed
#     expectations). Deploys prn-week (the calendar, confirm an ask, misses, "On call now"), prn-page (sign the expectations,
#     ask for shifts) and coverage-run (the automatic texts wait while the office calls the on-call CNA; switch off = never).
#  3. Proof (nothing is sent or saved): each refuses outsiders and forged links; the records are in and kept as written; the
#     switches are still off.
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
FNS = ("prn-week", "prn-page", "coverage-run"); SWITCHES = ("prn_oncall_signup_live", "prn_oncall_first_live")
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

start("STAFFING SERVER · PRN ON-CALL CALENDAR (switches OFF)")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = [k for k in sorted({k for fn in FNS for k in L.need(FNROOT, fn)} | {"prn_oncall_calendar.sql"})
         if (lambda r: r[0] != 0 or r[1] != open(os.path.join(ROOT, k)).read())(run(["git", "-C", ROOT, "show", f"origin/main:{k}"]))]
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE and os.path.exists(PGLITE):
    env = dict(os.environ, PGLITE=PGLITE)
    for t, must in (("prn_oncall_calendar_test.mjs", "73/73"), ("prn_oncall_shift_test.mjs", "12/12"), ("prn_recognition_test.mjs", "47/47"), ("prn_week_test.mjs", "52/52"),
                    ("prn_mentor_test.mjs", "57/57"), ("prn_page_test.mjs", "43/43"), ("prn_monthly_test.mjs", "39/39"), ("prn_open_shifts_test.mjs", "66/66")):
        c, o = run([NODE, t], cwd=ROOT, env=env)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    ok("the on-call calendar, on-call shift, recognition, This week, Field Support, PRN Team page, monthly update and open shift tests pass (fake data and a throwaway Postgres only)")
else: say("  · node or the throwaway Postgres is not on this Mac, so the tests were not re-run here (they passed when built)")
on = switches_on()
if on is None: stop("couldn't read the Hub's switches", 3)
if on: stop("already on: " + ", ".join(on) + ". Turn it off in the Hub first.")
ok("the new switches are off: " + ", ".join(SWITCHES))
meta = {}
for fn in FNS:
    s_, m_ = fmeta(REF, fn)
    if s_ != 200 or not m_ or "verify_jwt" not in m_: stop(f"couldn't read how {fn} is set up live ({s_})", 3)
    meta[fn] = bool(m_["verify_jwt"])
ok("each function's gateway setting is read, so it is kept: " + ", ".join(f"{k} {'on' if v else 'off'}" for k, v in meta.items()))
K = keys(); ANON = K.get("anon", ""); L.HIDE += [ANON, K.get("service_role", "")]
if not ANON: stop("couldn't read the Hub's keys", 3)

say(); say("PART 2 · CHANGE")
okQ, r = sql(REF, "begin;\n" + open(os.path.join(ROOT, "prn_oncall_calendar.sql")).read() + "\ncommit;")
if not okQ: bad("the record change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
ok("the on-call calendar records are in: asks, call outcomes and misses, signed expectations")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, meta[fn]): say(f"  STOP at {fn}. Tell Claude. (The switches are off; on call works as before.)"); done(6)

say(); say("PART 3 · PROOF (nothing is sent or saved)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
A = {"apikey": ANON, "Authorization": "Bearer " + ANON}
s1 = http("POST", f"{FNB}/functions/v1/prn-week", {"action": "oncall_confirm"}, A)[0]
(ok if s1 in (401, 403) else bad)(f"prn-week refuses anyone not signed in to the office ({s1})")
s2, b2 = http("POST", f"{FNB}/functions/v1/prn-page", {"action": "view", "p": "00000000-0000-4000-8000-000000000000", "e": 4102444800, "t": "x" * 43}, A)
(ok if s2 == 401 and '"expired":true' in b2.replace(" ", "") else bad)(f"the page refuses a forged link ({s2})")
s3 = http("POST", f"{FNB}/functions/v1/coverage-run", {"action": "board", "case_id": "x"}, A)[0]
(ok if s3 in (401, 403) else bad)(f"coverage-run refuses anyone not signed in to the office ({s3})")
okC, cc = sql(REF, "select (select count(*) from information_schema.tables where table_schema='public' and table_name in ('prn_oncall_marks','prn_oncall_terms'))::int t, "
                   "(select count(*) from pg_trigger where tgname in ('prn_oncall_marks_kept','prn_oncall_terms_kept'))::int g, "
                   "(select pg_get_constraintdef(oid) from pg_constraint where conname='prn_oncall_kind_check') k, "
                   "(select count(*) from pg_indexes where indexname in ('prn_oncall_one_per_shift','prn_oncall_one_ask','prn_oncall_one_confirm2'))::int i")
(ok if okC and cc and cc[0]["t"] == 2 and cc[0]["g"] == 2 and "asked" in (cc[0]["k"] or "") and cc[0]["i"] == 3 else bad)(
  "the calendar records are in, kept as written, one person per shift" + ("" if okC and cc else " (couldn't read them)"))
(ok if switches_on() == [] else bad)("both switches are still off")
say()
say("  1190: " + ("DONE. The on-call calendar is on the server with both switches OFF. Next: Claude merges the Hub pull request, then you'll "
    "see the calendar in PRN Teams, On call."
    if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
