#!/usr/bin/env python3
# 1188 · STAFFING SERVER · PRN ON-CALL SHIFT CHOICE (2026-10-29, Samantha: "add a shift choice (daytime, overnight or whole day) when
# the office confirms on call, with its switch off")
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data and a throwaway Postgres
#     only); the new switch is off; each function's gateway setting is read, so it is kept.
#  2. Lets a confirmed on-call date keep its shift (prn_oncall_shift.sql, one transaction; older dates keep none). Deploys
#     prn-week (the shift on confirm, the payroll counts) and prn-page (their page shows their shift).
#  3. Proof (nothing is sent or saved): each refuses outsiders and forged links; the shift is kept and checked; the switch is
#     still off.
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
FNS = ("prn-week", "prn-page"); SWITCHES = ("prn_oncall_shift_live",)
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

start("STAFFING SERVER · PRN ON-CALL SHIFT CHOICE (switch OFF)")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = [k for k in sorted({k for fn in FNS for k in L.need(FNROOT, fn)} | {"prn_oncall_shift.sql"})
         if (lambda r: r[0] != 0 or r[1] != open(os.path.join(ROOT, k)).read())(run(["git", "-C", ROOT, "show", f"origin/main:{k}"]))]
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE and os.path.exists(PGLITE):
    env = dict(os.environ, PGLITE=PGLITE)
    for t, must in (("prn_oncall_shift_test.mjs", "12/12"), ("prn_recognition_test.mjs", "47/47"), ("prn_week_test.mjs", "52/52"), ("prn_mentor_test.mjs", "57/57"),
                    ("prn_page_test.mjs", "43/43"), ("prn_monthly_test.mjs", "39/39")):
        c, o = run([NODE, t], cwd=ROOT, env=env)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    ok("the on-call shift, recognition, This week, Gap Mentor, PRN Team page and monthly update tests pass (fake data and a throwaway Postgres only)")
else: say("  · node or the throwaway Postgres is not on this Mac, so the tests were not re-run here (they passed when built)")
on = switches_on()
if on is None: stop("couldn't read the Hub's switches", 3)
if on: stop("already on: " + ", ".join(on) + ". Turn it off in the Hub first.")
ok("the new switch is off: " + ", ".join(SWITCHES))
meta = {}
for fn in FNS:
    s_, m_ = fmeta(REF, fn)
    if s_ != 200 or not m_ or "verify_jwt" not in m_: stop(f"couldn't read how {fn} is set up live ({s_})", 3)
    meta[fn] = bool(m_["verify_jwt"])
ok("each function's gateway setting is read, so it is kept: " + ", ".join(f"{k} {'on' if v else 'off'}" for k, v in meta.items()))
K = keys(); ANON = K.get("anon", ""); L.HIDE += [ANON, K.get("service_role", "")]
if not ANON: stop("couldn't read the Hub's keys", 3)

say(); say("PART 2 · CHANGE")
okQ, r = sql(REF, "begin;\n" + open(os.path.join(ROOT, "prn_oncall_shift.sql")).read() + "\ncommit;")
if not okQ: bad("the record change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
ok("a confirmed on-call date can keep its shift (older dates keep none)")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, meta[fn]): say(f"  STOP at {fn}. Tell Claude. (The switch is off; confirming works as before.)"); done(6)

say(); say("PART 3 · PROOF (nothing is sent or saved)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
A = {"apikey": ANON, "Authorization": "Bearer " + ANON}
s1 = http("POST", f"{FNB}/functions/v1/prn-week", {"action": "oncall_confirm"}, A)[0]
(ok if s1 in (401, 403) else bad)(f"prn-week refuses anyone not signed in to the office ({s1})")
s2, b2 = http("POST", f"{FNB}/functions/v1/prn-page", {"action": "view", "p": "00000000-0000-4000-8000-000000000000", "e": 4102444800, "t": "x" * 43}, A)
(ok if s2 == 401 and '"expired":true' in b2.replace(" ", "") else bad)(f"the page refuses a forged link ({s2})")
okC, cc = sql(REF, "select (select count(*) from information_schema.columns where table_schema='public' and table_name='prn_oncall' and column_name='shift')::int c, "
                   "(select pg_get_constraintdef(oid) from pg_constraint where conname='prn_oncall_shift_check') k, "
                   "(select count(*) from public.prn_oncall where kind='confirmed' and cancelled_at is null)::int n")
(ok if okC and cc and cc[0]["c"] == 1 and "overnight" in (cc[0]["k"] or "") and "whole" in (cc[0]["k"] or "") else bad)(
  f"confirmed on-call dates can keep daytime, overnight or whole day ({cc[0]['n'] if okC and cc else '?'} confirmed dates so far)")
(ok if switches_on() == [] else bad)("the switch is still off")
say()
say("  1188: " + ("DONE. The on-call shift choice is on the server with the switch OFF. Next: Claude merges the Hub pull request, then you'll "
    "see the shift choice and the payroll counts in PRN Teams, On call (owners, as practice)."
    if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
