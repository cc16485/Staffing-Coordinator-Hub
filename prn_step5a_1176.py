#!/usr/bin/env python3
# 1176 · STAFFING SERVER · PRN STEP 5a: THE PRN TEAM PAGE (2026-10-29, Samantha: "Yes, build part 5a with its switch off"; her
# picks the same day: short notice changeable on the page, a break-until date that shift texts respect)
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data and a throwaway Postgres
#     only); the page switch is off; each function's gateway setting is read, so it is kept.
#  2. Adds the page's records (prn_page_log, kept forever) and lets This week mark a page line done (prn_page.sql, one
#     transaction). Deploys prn-page (new, public: members open it from their own link, no login), prn-week (the page's This
#     week lines, Copy page link) and coverage-run (a PRN member on a break is never texted about a shift).
#  3. Proof (nothing is sent or saved): prn-page refuses a forged link and an office preview without a sign-in; prn-week
#     refuses outsiders; the page records are kept and can't be edited; coverage-run still reads AxisCare and sent nothing;
#     the switch is still off.
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
FNS = ("prn-page", "prn-week", "coverage-run"); SWITCH = "prn_page_live"
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
def switch_on():
    okS, st = sql(REF, f"select data->'{SWITCH}' as v from public.app_data where key='ops_settings'")
    return None if not okS or not st else st[0].get("v") is True

start("STAFFING SERVER · PRN STEP 5a: THE PRN TEAM PAGE (switch OFF)")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = [k for k in sorted({k for fn in FNS for k in L.need(FNROOT, fn)} | {"prn_page.sql"})
         if (lambda r: r[0] != 0 or r[1] != open(os.path.join(ROOT, k)).read())(run(["git", "-C", ROOT, "show", f"origin/main:{k}"]))]
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE and os.path.exists(PGLITE):
    env = dict(os.environ, PGLITE=PGLITE)
    for t, must in (("prn_page_test.mjs", "43/43"), ("prn_week_test.mjs", "52/52"), ("prn_welcome_test.mjs", "35/35"), ("wave_rules_test.mjs", "50/50"),
                    ("ask_list_test.mjs", "25/25"), ("cara_p1_test.mjs", "89/89"), ("cara_run_test.mjs", "70/70"), ("prn_step1_test.mjs", "34/34"), ("prn3_coverage_test.mjs", "27/27")):
        c, o = run([NODE, t], cwd=ROOT, env=env)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    ok("the PRN Team page, This week, welcome and shift-text tests pass (fake data and a throwaway Postgres only)")
else: say("  · node or the throwaway Postgres is not on this Mac, so the tests were not re-run here (they passed when built)")
sw = switch_on()
if sw is None: stop("couldn't read the Hub's switches", 3)
if sw: stop(f"{SWITCH} is already on. Turn it off in the Hub first.")
ok(f"the new switch is off: {SWITCH}")
meta = {}
for fn in FNS:
    s_, m_ = fmeta(REF, fn)
    if s_ == 404 and fn == "prn-page": meta[fn] = False; continue   # new and public: members open it from their link, no login
    if s_ != 200 or not m_ or "verify_jwt" not in m_: stop(f"couldn't read how {fn} is set up live ({s_})", 3)
    meta[fn] = bool(m_["verify_jwt"])
ok("each function's gateway setting is read, so it is kept: " + ", ".join(f"{k} {'on' if v else 'off'}" for k, v in meta.items()))
K = keys(); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); L.HIDE += [ANON, SVC]
if not (ANON and SVC): stop("couldn't read the Hub's keys", 3)

say(); say("PART 2 · CHANGE")
okQ, r = sql(REF, "begin;\n" + open(os.path.join(ROOT, "prn_page.sql")).read() + "\ncommit;")
if not okQ: bad("the record change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
ok("the PRN Team page has its records (kept forever), and This week can mark a page line done")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, meta[fn]): say(f"  STOP at {fn}. Tell Claude. (The switch is off; nothing new sends.)"); done(6)

say(); say("PART 3 · PROOF (nothing is sent or saved)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
A = {"apikey": ANON, "Authorization": "Bearer " + ANON}
s1, b1 = http("POST", f"{FNB}/functions/v1/prn-page", {"action": "view", "p": "00000000-0000-4000-8000-000000000000", "e": 4102444800, "t": "x" * 43}, A)
(ok if s1 == 401 and '"expired":true' in b1.replace(" ", "") else bad)(f"the page refuses a forged link ({s1})")
s2 = http("POST", f"{FNB}/functions/v1/prn-page", {"action": "preview", "applicant_id": "00000000-0000-4000-8000-000000000000"}, A)[0]
(ok if s2 in (401, 403) else bad)(f"the office preview refuses anyone not signed in to the office ({s2})")
s3 = http("POST", f"{FNB}/functions/v1/prn-week", {"action": "week"}, A)[0]
(ok if s3 in (401, 403) else bad)(f"prn-week refuses anyone not signed in to the office ({s3})")
okT, tt = sql(REF, "select (select count(*) from information_schema.tables where table_schema='public' and table_name='prn_page_log')::int t, "
                   "(select count(*) from pg_trigger where tgname='prn_page_log_frozen')::int f, "
                   "(select pg_get_constraintdef(oid) from pg_constraint where conname='prn_touches_kind_check') k")
(ok if okT and tt and tt[0]["t"] == 1 and tt[0]["f"] == 1 and "handled" in (tt[0]["k"] or "") and "welcome_call" in (tt[0]["k"] or "") else bad)(
  "the page records are there and can't be edited or deleted; This week's kinds are all allowed")
okB, bb = sql(REF, "select count(*)::int n from public.job_applicants a join public.pay_tracks t on t.applicant_id = a.id where t.track = 'prn_team' and a.prn ? 'break_until'")
(ok if okB and bb else bad)(f"PRN members on a break right now: {bb[0]['n'] if okB and bb else '?'} (only the page can set one, and it's off)")
today = time.strftime("%Y-%m-%d")
sP, bP = http("POST", f"{FNB}/functions/v1/coverage-run", {"action": "overlap_probe", "date": today, "time": "08:00-17:00"}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 200)
try: p = json.loads(bP)
except Exception: p = {}
if sP == 200 and p.get("read_only") and "held" not in p:
    ok(f"coverage-run reads AxisCare ({p.get('visits_read', 0)} visits, {len(p.get('working') or [])} caregiver(s) working today 8am to 5pm) and sent nothing")
elif sP == 200 and p.get("held"): bad("coverage-run couldn't read AxisCare just now: " + str(p["held"])[:160] + " (nobody is texted while it can't; run 1176 again later)")
else: bad(f"the coverage-run check answered {sP}: {str(bP)[:200]}")
(ok if switch_on() is False else bad)("the switch is still off")
say()
say("  1176: " + ("DONE. The PRN Team page is on the server with its switch OFF. Next: Claude merges the Hub pull request, then you can see "
    "any member's page in PRN Teams, What they see, and on their caregiver profile."
    if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
