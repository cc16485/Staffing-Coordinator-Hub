#!/usr/bin/env python3
# 1186 · STAFFING SERVER · PRN STEP 8a: GAP MENTORS (2026-10-29, Samantha: "Yes, build step 8 (Gap Mentors) with its switches off")
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data and a throwaway Postgres
#     only); the page and the new Gap Mentors switch are off; each function's gateway setting is read, so it is kept.
#  2. Adds the Gap Mentor records (prn_mentor.sql, one transaction: each ask and its answers, kept; a note stays as written).
#     Deploys prn-week (name Gap Mentors, ask, assign) and prn-page (their visits, "I can do it", and the note after).
#  3. Proof (nothing is sent or saved): each refuses outsiders and forged links; the records are there, kept and checked; the
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
FNS = ("prn-week", "prn-page"); SWITCHES = ("prn_page_live", "prn_mentor_live")
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

start("STAFFING SERVER · PRN STEP 8a: GAP MENTORS (switch OFF)")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = [k for k in sorted({k for fn in FNS for k in L.need(FNROOT, fn)} | {"prn_mentor.sql"})
         if (lambda r: r[0] != 0 or r[1] != open(os.path.join(ROOT, k)).read())(run(["git", "-C", ROOT, "show", f"origin/main:{k}"]))]
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE and os.path.exists(PGLITE):
    env = dict(os.environ, PGLITE=PGLITE)
    # (the shift-text tests that read the Hub's own folder can't run from this fresh copy; they passed when built)
    for t, must in (("prn_mentor_test.mjs", "57/57"), ("prn_recognition_test.mjs", "47/47"), ("prn_monthly_test.mjs", "39/39"), ("prn_week_test.mjs", "52/52"),
                    ("prn_page_test.mjs", "43/43"), ("prn_open_shifts_test.mjs", "66/66")):
        c, o = run([NODE, t], cwd=ROOT, env=env)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    ok("the Gap Mentor, recognition, monthly update, This week, PRN Team page and open shifts tests pass (fake data and a throwaway Postgres only)")
else: say("  · node or the throwaway Postgres is not on this Mac, so the tests were not re-run here (they passed when built)")
on = switches_on()
if on is None: stop("couldn't read the Hub's switches", 3)
if on: stop("already on: " + ", ".join(on) + ". Turn them off in the Hub first.")
ok("the page and the new Gap Mentors switch are off: " + ", ".join(SWITCHES))
meta = {}
for fn in FNS:
    s_, m_ = fmeta(REF, fn)
    if s_ != 200 or not m_ or "verify_jwt" not in m_: stop(f"couldn't read how {fn} is set up live ({s_})", 3)
    meta[fn] = bool(m_["verify_jwt"])
ok("each function's gateway setting is read, so it is kept: " + ", ".join(f"{k} {'on' if v else 'off'}" for k, v in meta.items()))
K = keys(); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); L.HIDE += [ANON, SVC]
if not (ANON and SVC): stop("couldn't read the Hub's keys", 3)

say(); say("PART 2 · CHANGE")
okQ, r = sql(REF, "begin;\n" + open(os.path.join(ROOT, "prn_mentor.sql")).read() + "\ncommit;")
if not okQ: bad("the record change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
ok("Gap Mentor visits have their records (kept, and a note stays as written)")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, meta[fn]): say(f"  STOP at {fn}. Tell Claude. (The switches are off; nothing new shows.)"); done(6)

say(); say("PART 3 · PROOF (nothing is sent or saved)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
A = {"apikey": ANON, "Authorization": "Bearer " + ANON}
for act in ("mentor_set", "mentor_ask", "mentor_list"):
    s1 = http("POST", f"{FNB}/functions/v1/prn-week", {"action": act}, A)[0]
    (ok if s1 in (401, 403) else bad)(f"prn-week {act} refuses anyone not signed in to the office ({s1})")
for act in ("mentor_answer", "mentor_note"):
    s2, b2 = http("POST", f"{FNB}/functions/v1/prn-page", {"action": act, "p": "00000000-0000-4000-8000-000000000000", "e": 4102444800, "t": "x" * 43, "id": 1}, A)
    (ok if s2 == 401 and '"expired":true' in b2.replace(" ", "") else bad)(f"the page refuses a forged link for {act.replace('_', ' ')} ({s2})")
okT, tt = sql(REF, "select (select count(*) from information_schema.tables where table_schema='public' and table_name in ('prn_mentor_visits','prn_mentor_answers'))::int t, "
                   "(select count(*) from pg_trigger where tgname='prn_mentor_kept')::int g, (select count(*) from public.prn_mentor_visits)::int n, "
                   "(select count(*) from pg_constraint where conname in ('prn_mentor_refresher_has_caregiver','prn_mentor_update_has_family_ok','prn_mentor_assigned_has_who'))::int c")
(ok if okT and tt and tt[0]["t"] == 2 and tt[0]["g"] == 1 and tt[0]["c"] == 3 else bad)(
  f"the Gap Mentor records are there, kept, and checked (the family's OK, the caregiver, who it went to) ({tt[0]['n'] if okT and tt else '?'} asks so far)")
(ok if switches_on() == [] else bad)("the switches are still off")
say()
say("  1186: " + ("DONE. Gap Mentors are on the server with the switch OFF. Next: Claude merges the Hub pull request, then you can name "
    "Gap Mentors in PRN Teams, Our teams, and see \"Ask a Gap Mentor\" on a client's Care tab (owners, as practice)."
    if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
