#!/usr/bin/env python3
# 1214 · STAFFING SERVER · ON CALL FOR OUR LEVEL 3 CAREGIVERS (2026-10-30, Samantha, Krystal's idea: "Yes to all, we will only
# have caregivers who can do level 3 be on-call")
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data and a throwaway Postgres
#     only); prn-week and coverage-run live are exactly the build this one builds on (so nobody else's live change is
#     overwritten); each function's gateway setting is read, so it is kept.
#  2. Adds the caregiver on-call records (oncall_caregivers.sql, one transaction: on-call records can name an AxisCare caregiver;
#     the invites record). Deploys prn-week (the Invite caregivers box, invites, caregivers on the calendar), oncall-page (new:
#     the caregiver's My on-call page, public with its own sealed link) and coverage-run (the office calls an on-call caregiver
#     first too).
#  3. Proof (nothing is sent or saved): each refuses outsiders and forged links; the records are in; the invite switch is as it was.
# Texts nobody. The invite switch (Settings, PRN Teams) stays off until Samantha turns it on. Safe to run again.
import json, os, subprocess, shutil, time
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, deploy, start, check_build, fmeta, MG, API, sql, lit

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
BASE = os.environ.get("SB_BASE", "")   # the commit live is expected to match before this step (1212's build)
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
if NODE == "none": NODE = ""
PGLITE = os.environ.get("SB_PGLITE", "/Users/samantha/Claude/Projects/.pglite/node_modules/@electric-sql/pglite/dist/index.js")
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FNS = ("prn-week", "oncall-page", "coverage-run"); PUBLIC_NEW = {"oncall-page": False}
SWITCH = "prn_oncall_invite_live"
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
WHY = {"": ""}
def switch_on():
    for i in range(3):
        okS, st = sql(REF, f"select data->'{SWITCH}' as v from public.app_data where key='ops_settings'")
        if okS and st: return st[0].get("v") is True
        WHY[""] = str(st)[:300] if not okS else "no settings row came back"
        time.sleep(3 * (i + 1) * float(os.environ.get("SB_RETRY_SCALE", "1")))
    return None
def why_read():
    w = WHY[""].lower()
    if "unauthorized" in w or "jwt" in w or ("invalid" in w and "token" in w) or "401" in w: return "Supabase didn't accept the access token (it may have expired or been revoked). Make a new one at supabase.com/dashboard/account/tokens and run this again."
    return "Supabase answered: " + WHY[""]
def sha_of(ref, path):
    import hashlib
    c, o = run(["git", "-C", ROOT, "show", f"{ref}:{path}"])
    return hashlib.sha256(o.encode()).hexdigest() if c == 0 else None

# the code this step changes in the two live functions (outreach.ts and send-problems.ts only gain one registry line each)
CHANGED = {"supabase/functions/prn-week/index.ts", "supabase/functions/coverage-run/index.ts", "supabase/functions/_shared/prn-oncall.ts"}
start("STAFFING SERVER · ON CALL FOR OUR LEVEL 3 CAREGIVERS")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")   # the rehearsal compares with its own commit
if MAIN == "origin/main": run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = [k for k in sorted({k for fn in FNS for k in L.need(FNROOT, fn)} | {"oncall_caregivers.sql"})
         if (lambda r: r[0] != 0 or r[1] != open(os.path.join(ROOT, k)).read())(run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"]))]
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE and os.path.exists(PGLITE):
    env = dict(os.environ, PGLITE=PGLITE)
    for t, must in (("oncall_caregivers_test.mjs", "43/43"), ("prn_oncall_weekly_test.mjs", "48/48"), ("prn_oncall_calendar_test.mjs", "73/73"), ("prn_week_test.mjs", "52/52"),
                    ("prn_page_test.mjs", "43/43"), ("prn3_coverage_test.mjs", "27/27"), ("prn_open_shifts_test.mjs", "66/66"), ("office_line_sender_test.mjs", "19/19")):
        c, o = run([NODE, t], cwd=ROOT, env=env)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    ok("the caregiver on-call, every-week, on-call calendar, This week, PRN Team page, coverage, open shift and office-line tests pass (fake data and a throwaway Postgres only)")
else: say("  · node or the throwaway Postgres is not on this Mac, so the tests were not re-run here (they passed when built)")
on = switch_on()
if on is None: stop("couldn't read the Hub's switches. " + why_read(), 3)
ok("Caregiver on-call invites: " + ("ON" if on else "OFF") + " (this step does not change that)")
meta = {}
for fn in FNS:
    s_, m_ = fmeta(REF, fn)
    if s_ == 404 and fn in PUBLIC_NEW: meta[fn] = PUBLIC_NEW[fn]; continue
    if s_ != 200 or not m_ or "verify_jwt" not in m_: stop(f"couldn't read how {fn} is set up live ({s_})", 3)
    meta[fn] = bool(m_["verify_jwt"])
ok("each function's gateway setting is read, so it is kept: " + ", ".join(f"{k} {'on' if v else 'off'}" + (" (new)" if k in PUBLIC_NEW and fmeta(REF, k)[0] == 404 else "") for k, v in meta.items()))
for fn in ("prn-week", "coverage-run"):
    okL, livef = L.live_files(REF, fn)
    if not okL: stop(f"couldn't read the live {fn} to compare", 3)
    files = sorted(k for k in L.need(FNROOT, fn) if k in CHANGED)   # the files this step changes; the rest are main as always
    is_base = bool(BASE) and all(livef.get(k) == sha_of(BASE, k) for k in files if sha_of(BASE, k))
    is_new = all(livef.get(k) == L.sha(os.path.join(ROOT, k)) for k in files)
    if not (is_base or is_new): stop(f"{fn} live has changes that aren't the build this builds on (someone else's work may be live). Tell Claude before going on.", 3)
    ok(f"{fn} live is " + ("already this build (an earlier run)" if is_new else "the build this one builds on"))
K = keys(); ANON = K.get("anon", ""); L.HIDE += [ANON, K.get("service_role", "")]
if not ANON: stop("couldn't read the Hub's keys", 3)

say(); say("PART 2 · CHANGE")
okQ, r = sql(REF, "begin;\n" + open(os.path.join(ROOT, "oncall_caregivers.sql")).read() + "\ncommit;")
if not okQ: bad("the record change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
ok("the caregiver on-call records are in: on-call records can name an AxisCare caregiver, and each invite is kept")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, meta[fn]): say(f"  STOP at {fn}. Tell Claude. (Invites are off; on call works as before.)"); done(6)

say(); say("PART 3 · PROOF (nothing is sent or saved)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
A = {"apikey": ANON, "Authorization": "Bearer " + ANON}
s1 = http("POST", f"{FNB}/functions/v1/prn-week", {"action": "oncall_invites"}, A)[0]
(ok if s1 in (401, 403) else bad)(f"prn-week refuses anyone not signed in to the office ({s1})")
s2, b2 = http("POST", f"{FNB}/functions/v1/oncall-page", {"action": "view", "c": "1", "e": 4102444800, "t": "x" * 43}, A)
(ok if s2 == 401 and '"expired":true' in b2.replace(" ", "") else bad)(f"the My on-call page refuses a forged link ({s2})")
s3 = http("POST", f"{FNB}/functions/v1/oncall-page", {"action": "preview", "caregiver_ax": "1"}, A)[0]
(ok if s3 in (401, 403) else bad)(f"the office preview of a caregiver's page needs an office sign-in ({s3})")
s4 = http("POST", f"{FNB}/functions/v1/coverage-run", {"action": "board", "case_id": "x"}, A)[0]
(ok if s4 in (401, 403) else bad)(f"coverage-run refuses anyone not signed in to the office ({s4})")
okC, cc = sql(REF, "select (select count(*) from information_schema.columns where table_schema='public' and column_name='caregiver_ax' and table_name in ('prn_oncall','prn_oncall_series','prn_oncall_marks','prn_oncall_terms'))::int c, "
                   "(select count(*) from pg_constraint where conname in ('prn_oncall_one_person','prn_oncall_series_one_person','prn_oncall_marks_one_person','prn_oncall_terms_one_person'))::int k, "
                   "(select count(*) from information_schema.tables where table_schema='public' and table_name='oncall_invites')::int t, "
                   "has_table_privilege('anon', 'public.oncall_invites', 'select') as a")
(ok if okC and cc and cc[0]["c"] == 4 and cc[0]["k"] == 4 and cc[0]["t"] == 1 and cc[0]["a"] is False else bad)(
  "the records are in: each on-call record names one person; invites kept; the public can't read them" + ("" if okC and cc else " (couldn't read them)"))
(ok if switch_on() == on else bad)("the invite switch is as it was")
say()
say("  1214: " + ("DONE. On call for our Level 3 caregivers is on the server, invites " + ("ON" if on else "OFF") + ". Next: Claude merges the Hub pull request, then "
    "the On call tab shows Invite caregivers. Turn on Caregiver on-call invites in Settings, PRN Teams, when you're ready to send them."
    if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
