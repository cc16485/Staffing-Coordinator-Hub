#!/usr/bin/env python3
# 1183 · STAFFING SERVER · PRN STEP 7: RECOGNITION EXTRAS AND GROWTH (2026-10-29, Samantha: "Yes, build step 7 with its switches off")
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data and a throwaway Postgres
#     only); the page and the new questions switch are off; each function's gateway setting is read, so it is kept.
#  2. Lets the records keep the twice-yearly answers, an on-call offer from their page, and the invite (prn_recognition.sql,
#     one transaction). Deploys prn-welcome (the May and November invite, in its weekday run), prn-page (the two questions, on
#     call for the PRN CNA Team, more milestones) and prn-week (their answers and on-call offers on This week).
#  3. Proof (nothing is sent or saved): each refuses outsiders; a practice run of the weekday sender; the records allow the new
#     kinds and every earlier one; the switches are still off.
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
FNS = ("prn-welcome", "prn-page", "prn-week"); SWITCHES = ("prn_page_live", "prn_feedback_live")
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

start("STAFFING SERVER · PRN STEP 7: RECOGNITION EXTRAS AND GROWTH (switch OFF)")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = [k for k in sorted({k for fn in FNS for k in L.need(FNROOT, fn)} | {"prn_recognition.sql"})
         if (lambda r: r[0] != 0 or r[1] != open(os.path.join(ROOT, k)).read())(run(["git", "-C", ROOT, "show", f"origin/main:{k}"]))]
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE and os.path.exists(PGLITE):
    env = dict(os.environ, PGLITE=PGLITE)
    # (the shift-text tests that read the Hub's own folder can't run from this fresh copy; they passed when built)
    for t, must in (("prn_recognition_test.mjs", "47/47"), ("prn_monthly_test.mjs", "39/39"), ("prn_week_test.mjs", "52/52"), ("prn_page_test.mjs", "43/43"),
                    ("prn_page_texts_test.mjs", "45/45"), ("prn_welcome_test.mjs", "35/35"), ("prn_open_shifts_test.mjs", "66/66")):
        c, o = run([NODE, t], cwd=ROOT, env=env)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    ok("the recognition, monthly update, This week, PRN Team page, link texts, welcome and open shifts tests pass (fake data and a throwaway Postgres only)")
else: say("  · node or the throwaway Postgres is not on this Mac, so the tests were not re-run here (they passed when built)")
on = switches_on()
if on is None: stop("couldn't read the Hub's switches", 3)
if on: stop("already on: " + ", ".join(on) + ". Turn them off in the Hub first.")
ok("the page and the new questions switch are off: " + ", ".join(SWITCHES))
meta = {}
for fn in FNS:
    s_, m_ = fmeta(REF, fn)
    if s_ != 200 or not m_ or "verify_jwt" not in m_: stop(f"couldn't read how {fn} is set up live ({s_})", 3)
    meta[fn] = bool(m_["verify_jwt"])
ok("each function's gateway setting is read, so it is kept: " + ", ".join(f"{k} {'on' if v else 'off'}" for k, v in meta.items()))
K = keys(); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); L.HIDE += [ANON, SVC]
if not (ANON and SVC): stop("couldn't read the Hub's keys", 3)

say(); say("PART 2 · CHANGE")
okQ, r = sql(REF, "begin;\n" + open(os.path.join(ROOT, "prn_recognition.sql")).read() + "\ncommit;")
if not okQ: bad("the record change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
ok("the records can keep the twice-yearly answers, an on-call offer from their page, and the invite")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, meta[fn]): say(f"  STOP at {fn}. Tell Claude. (The switches are off; nothing new shows or sends.)"); done(6)

say(); say("PART 3 · PROOF (nothing is sent or saved)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
A = {"apikey": ANON, "Authorization": "Bearer " + ANON}
a = http("POST", f"{FNB}/functions/v1/prn-welcome?auth_check=1", {}, A)[0]
(ok if a == 401 else bad)(f"prn-welcome refuses the public key ({a})")
s1 = http("POST", f"{FNB}/functions/v1/prn-week", {"action": "week"}, A)[0]
(ok if s1 in (401, 403) else bad)(f"prn-week refuses anyone not signed in to the office ({s1})")
for act in ("feedback", "oncall"):
    s2, b2 = http("POST", f"{FNB}/functions/v1/prn-page", {"action": act, "p": "00000000-0000-4000-8000-000000000000", "e": 4102444800, "t": "x" * 43, "pattern": "weekday", "a1": "x"}, A)
    (ok if s2 == 401 and '"expired":true' in b2.replace(" ", "") else bad)(f"the page refuses a forged link for {'the questions' if act == 'feedback' else 'on call'} ({s2})")
sD, bD = http("POST", f"{FNB}/functions/v1/prn-welcome?dry=1", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 120)
try: j = json.loads(bD)
except Exception: j = {}
if sD == 200 and j.get("ok") and j.get("feedback_live") is False and not j.get("feedback_texted") and not j.get("texted") and not j.get("ready_texted"):
    ok("a practice run of the weekday sender: " + (f"the {j['feedback_round']} round would invite {len(j.get('would_feedback') or [])}" if j.get("feedback_round") else "no questions round is open today (May and November)") + " (nothing was sent)")
else: bad(f"the practice run answered {sD}: {str(bD)[:200]}")
okC, cc = sql(REF, "select (select pg_get_constraintdef(oid) from pg_constraint where conname='prn_page_log_kind_check') p, (select pg_get_constraintdef(oid) from pg_constraint where conname='prn_touches_kind_check') t")
(ok if okC and cc and all(k in (cc[0]["p"] or "") for k in ("feedback", "oncall_offer", "interested", "course_request")) and all(k in (cc[0]["t"] or "") for k in ("feedback_invite_sent", "monthly_sent", "page_ready_sent", "welcome_call")) else bad)(
  "the records allow the new kinds, and every earlier one still")
(ok if switches_on() == [] else bad)("the switches are still off")
say()
say("  1183: " + ("DONE. Step 7 is on the server with the switch OFF. Next: Claude merges the Hub pull request, then you'll see the questions "
    "switch in Settings, PRN Teams, and on call on each PRN CNA's page in What they see."
    if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
